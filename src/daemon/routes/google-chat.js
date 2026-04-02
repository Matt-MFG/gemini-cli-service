'use strict';

const { google } = require('googleapis');
const { logger } = require('../lib/logger');
const { EVENT_TYPES } = require('../lib/constants');

/**
 * Google Chat bot integration — Phase 3 progressive card delivery.
 *
 * Flow:
 * 1. Google Chat POSTs to /chat/google
 * 2. Immediate "Thinking..." card response (<1s)
 * 3. Thinking card updated in-place with contextual status
 * 4. Tool result cards sent individually as they complete
 * 5. Final answer card with "View in web app" link
 */

let chatClient = null;

async function getChatClient() {
  if (chatClient) return chatClient;
  const keyFile = process.env.GOOGLE_CHAT_SA_KEY || '/opt/gemini-cli-service/chat-sa-key.json';
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/chat.bot'],
  });
  chatClient = google.chat({ version: 'v1', auth });
  return chatClient;
}

async function googleChatRoutes(fastify, deps) {
  const { sessionManager, classifier, queue, registry, config } = deps;
  const { spawnCli } = require('../cli/spawner');

  fastify.post('/chat/google', async (req, reply) => {
    const event = req.body;

    switch (event.type) {
      case 'ADDED_TO_SPACE':
        return {
          text: '*Gemini CLI as a Service* is ready. Send me a message and I\'ll help you build apps, write code, and more.\n\nEach thread is a separate conversation with its own context.',
        };

      case 'REMOVED_FROM_SPACE':
        return {};

      case 'MESSAGE':
        return handleMessage(event, deps);

      case 'CARD_CLICKED':
        return handleCardClick(event, deps);

      default:
        return {};
    }
  });

  async function handleMessage(event, deps) {
    const text = event.message?.argumentText?.trim() || event.message?.text?.trim() || '';
    const senderEmail = event.user?.email || 'unknown';
    const userId = senderEmail.replace(/[^a-zA-Z0-9]/g, '-');
    const spaceName = event.space?.name || '';
    const threadName = event.message?.thread?.name || '';
    const log = logger.child({ userId, conversationKey: threadName });

    if (!text) {
      return { text: 'I received an empty message. Please type something!' };
    }

    log.info({ text: text.slice(0, 100) }, 'Google Chat message received');

    // Handle local commands
    const classification = deps.classifier.classify(text);

    if (classification.category === 'meta') {
      return formatMetaResponse(classification, deps, userId);
    }

    if (classification.category === 'unsupported') {
      return { text: classification.explanation };
    }

    // Fire async CLI processing — respond immediately with thinking card
    processMessageAsync(text, userId, threadName, spaceName, deps, log)
      .catch((err) => {
        log.error({ err: err.message }, 'Async message processing failed');
        sendChatMessage(spaceName, threadName, {
          text: `Error: ${err.message}`,
        }).catch(() => {});
      });

    // P3-66: Thinking card within 1s
    return buildThinkingCard(text);
  }

  async function handleCardClick(event, deps) {
    const action = event.common?.invokedFunction;
    if (action === 'approve') {
      const requestId = event.common?.parameters?.requestId;
      if (requestId && deps.approvalGate) {
        deps.approvalGate.approve(requestId);
        return { text: 'Approved.' };
      }
    } else if (action === 'reject') {
      const requestId = event.common?.parameters?.requestId;
      if (requestId && deps.approvalGate) {
        deps.approvalGate.reject(requestId);
        return { text: 'Rejected.' };
      }
    }
    return {};
  }

  async function processMessageAsync(text, userId, threadName, spaceName, deps, log) {
    const conversationKey = threadName || `gchat-${Date.now()}`;

    // Ensure conversation exists
    let conversationId;
    try {
      const conversations = deps.sessionManager.list(userId);
      const existing = conversations.find((c) => c.name === conversationKey);
      if (existing) {
        conversationId = existing.conversationId;
      } else {
        const created = deps.sessionManager.create(userId, conversationKey);
        conversationId = created.conversationId;
      }
    } catch (err) {
      log.warn({ err: err.message }, 'Session lookup failed, creating fresh');
      const created = deps.sessionManager.create(userId, conversationKey);
      conversationId = created.conversationId;
    }

    // Get CLI session ID (may be null for first message)
    let cliSessionId = null;
    try {
      cliSessionId = deps.sessionManager.getCliSessionId(userId, conversationId);
    } catch { /* first message -- no session yet */ }

    // Build CLI env
    const cliEnv = {};
    if (config && config.vertexAi) {
      cliEnv.GOOGLE_GENAI_USE_VERTEXAI = 'true';
      cliEnv.GOOGLE_CLOUD_PROJECT = config.gcpProject;
      cliEnv.GOOGLE_CLOUD_LOCATION = config.gcpLocation;
    }

    // Spawn CLI
    const invocation = spawnCli({
      text,
      sessionId: cliSessionId,
      timeoutMs: config?.cliTimeoutMs || 600000,
      model: config?.cliModel,
      env: cliEnv,
    });

    // Track the thinking card message name for updates
    let thinkingMessageName = null;
    let lastStatusUpdate = 0;
    const statusUpdateInterval = 3000; // Update thinking card at most every 3s

    // Collect events for progressive delivery
    let fullContent = '';
    const toolCalls = [];
    let tokenStats = null;
    let hasApps = false;
    let toolCardCount = 0;

    invocation.on('event', async (event) => {
      // Capture CLI session ID
      if (event.type === EVENT_TYPES.INIT && event.session_id) {
        try {
          deps.sessionManager.setCliSessionId(userId, conversationId, event.session_id);
        } catch (err) {
          log.warn({ err: err.message }, 'Failed to store CLI session ID');
        }
      }

      // Accumulate assistant text
      if (event.type === 'message' && event.role === 'assistant') {
        fullContent += event.content || '';
      }

      // P3-35: Contextual status during tool execution
      if (event.type === 'tool_use') {
        const toolName = (event.tool_name || '').replace(/^mcp_apps_/, '');
        const params = event.parameters || {};
        toolCalls.push({ name: toolName, params });

        if (toolName.startsWith('apps_create')) hasApps = true;

        // Update thinking card with current tool status
        const now = Date.now();
        if (now - lastStatusUpdate > statusUpdateInterval) {
          lastStatusUpdate = now;
          const statusText = getToolStatusText(toolName, params);
          updateThinkingStatus(spaceName, thinkingMessageName, statusText, toolCalls.length)
            .catch(() => {});
        }
      }

      // P3-67: Tool results as separate cards
      if (event.type === 'tool_result') {
        toolCardCount++;
        const toolName = (event.tool_name || '').replace(/^mcp_apps_/, '');
        const output = String(event.output || event.status || '').slice(0, 2000);

        sendToolCard(spaceName, threadName, toolName, output, toolCardCount)
          .catch((err) => log.debug({ err: err.message }, 'Failed to send tool card'));
      }

      // Token stats
      if (event.type === EVENT_TYPES.RESULT && event.stats) {
        tokenStats = event.stats;
        if (registry) {
          registry.recordTokenUsage({
            userId,
            conversationId,
            inputTokens: event.stats.input_tokens || event.stats.input,
            outputTokens: event.stats.output_tokens || event.stats.output,
            cachedTokens: event.stats.cached_tokens || event.stats.cached,
            totalTokens: event.stats.total_tokens,
            durationMs: event.stats.duration_ms,
          });
        }
      }
    });

    // Wait for completion
    await new Promise((resolve) => {
      invocation.on('close', () => {
        try { deps.sessionManager.recordTurn(userId, conversationId, text); } catch {}
        resolve();
      });
      invocation.on('error', (err) => {
        log.error({ err: err.message }, 'CLI error during Google Chat processing');
        fullContent += `\n\nError: ${err.message}`;
        resolve();
      });
    });

    // P3-68: Final answer as distinct card
    const webAppUrl = config?.publicUrl || `http://${config?.domainSuffix || 'localhost'}`;
    const answerCard = buildAnswerCard(fullContent, toolCalls, tokenStats, hasApps, webAppUrl, conversationId);
    await sendChatMessage(spaceName, threadName, answerCard);
    log.info({ toolCalls: toolCalls.length, tokens: tokenStats?.total_tokens }, 'Google Chat progressive response complete');
  }

  function formatMetaResponse(classification, deps, userId) {
    switch (classification.handler) {
      case 'create_conversation':
        return { text: 'Start a new thread to create a new conversation.' };
      case 'list_conversations': {
        const convs = deps.sessionManager.list(userId);
        if (convs.length === 0) return { text: 'No conversations yet. Send me a message to start!' };
        const list = convs.slice(0, 10).map((c) =>
          `*${c.name || c.conversationId.slice(0, 8)}* -- ${c.turnCount} turns`
        ).join('\n');
        return { text: `*Your conversations:*\n\n${list}` };
      }
      case 'show_costs': {
        if (!registry) return { text: 'Token tracking not available.' };
        const total = registry.getTotalTokenUsage(userId);
        if (!total || !total.total_tokens) return { text: 'No usage recorded yet.' };
        return { text: `*Usage:* ${total.total_tokens.toLocaleString()} tokens across ${total.invocations} invocations` };
      }
      case 'list_apps': {
        if (!registry) return { text: 'App registry not available.' };
        const apps = registry.listApps(userId);
        if (apps.length === 0) return { text: 'No apps running. Ask me to build something!' };
        const list = apps.map((a) => {
          const dot = a.status === 'running' ? 'Running' : 'Stopped';
          return `*${a.name}* (${dot}) -- <${a.url || '#'}|Open>`;
        }).join('\n');
        return { text: `*Your apps:*\n\n${list}` };
      }
      default:
        return { text: `Unknown command: ${classification.handler}` };
    }
  }
}

// ============================================================
// CARD BUILDERS
// ============================================================

/**
 * P3-66: Thinking card -- shown immediately (<1s).
 */
function buildThinkingCard(text) {
  return {
    cardsV2: [{
      cardId: 'thinking',
      card: {
        header: {
          title: 'Thinking...',
          subtitle: text.length > 60 ? text.slice(0, 57) + '...' : text,
          imageUrl: 'https://fonts.gstatic.com/s/i/googlematerialicons/psychology/v6/24px.svg',
          imageType: 'CIRCLE',
        },
        sections: [{
          widgets: [{
            textParagraph: { text: '<i>Working on your request...</i>' },
          }],
        }],
      },
    }],
  };
}

/**
 * P3-35: Update thinking card with contextual status.
 */
async function updateThinkingStatus(spaceName, messageName, statusText, toolCount) {
  if (!messageName) return;
  try {
    const chat = await getChatClient();
    await chat.spaces.messages.update({
      name: messageName,
      updateMask: 'cardsV2',
      requestBody: {
        cardsV2: [{
          cardId: 'thinking',
          card: {
            header: {
              title: statusText,
              subtitle: `${toolCount} tool${toolCount !== 1 ? 's' : ''} used`,
              imageUrl: 'https://fonts.gstatic.com/s/i/googlematerialicons/psychology/v6/24px.svg',
              imageType: 'CIRCLE',
            },
            sections: [{
              widgets: [{
                textParagraph: { text: `<i>${statusText}</i>` },
              }],
            }],
          },
        }],
      },
    });
  } catch {
    // Best-effort update -- don't fail the main flow
  }
}

/**
 * Generate a human-readable status from tool name + params.
 */
function getToolStatusText(toolName, params) {
  if (toolName === 'apps_create') return `Creating app "${params.name || 'app'}"...`;
  if (toolName === 'apps_exec') return `Running command in ${params.name || 'container'}...`;
  if (toolName === 'apps_list') return 'Listing apps...';
  if (toolName === 'apps_logs') return `Reading logs from ${params.name || 'container'}...`;
  if (toolName === 'apps_stop') return `Stopping ${params.name || 'container'}...`;
  if (toolName === 'apps_restart') return `Restarting ${params.name || 'container'}...`;
  if (toolName.includes('read') || toolName.includes('source')) return 'Reading files...';
  if (toolName.includes('write') || toolName.includes('file')) return 'Writing files...';
  if (toolName.includes('search')) return 'Searching...';
  if (toolName.includes('test')) return 'Running tests...';
  return `Running ${toolName}...`;
}

/**
 * P3-67: Send a tool result as a separate card.
 */
async function sendToolCard(spaceName, threadName, toolName, output, index) {
  const truncated = output.length > 800 ? output.slice(0, 797) + '...' : output;

  await sendChatMessage(spaceName, threadName, {
    cardsV2: [{
      cardId: `tool-${index}-${Date.now()}`,
      card: {
        sections: [{
          header: `Tool: ${toolName}`,
          collapsible: true,
          uncollapsibleWidgetsCount: 0,
          widgets: [{
            textParagraph: {
              text: `<font color="#888888"><code>${escapeHtml(truncated)}</code></font>`,
            },
          }],
        }],
      },
    }],
  });
}

/**
 * P3-68: Final answer card -- distinct from tool cards.
 * P3-69: "View in web app" link on every card.
 * P3-70: Quick-action buttons.
 */
function buildAnswerCard(content, toolCalls, stats, hasApps, webAppUrl, conversationId) {
  const sections = [];

  // Main response content
  if (content) {
    const formatted = formatContentForChat(content);
    const chunks = splitText(formatted, 3800);

    for (const chunk of chunks) {
      sections.push({
        widgets: [{ textParagraph: { text: chunk } }],
      });
    }
  } else {
    sections.push({
      widgets: [{
        textParagraph: { text: '<i>Task completed (no text response).</i>' },
      }],
    });
  }

  // App links
  if (hasApps) {
    const appCreates = toolCalls.filter((tc) => tc.name === 'apps_create');
    if (appCreates.length > 0) {
      const appWidgets = appCreates.map((tc) => ({
        textParagraph: {
          text: `<b>${tc.params.name || 'app'}</b> -- app created`,
        },
      }));
      sections.push({ header: 'Apps', widgets: appWidgets });
    }
  }

  // Stats footer
  if (stats) {
    const tokens = (stats.total_tokens || 0).toLocaleString();
    const duration = stats.duration_ms ? `${(stats.duration_ms / 1000).toFixed(1)}s` : '';
    sections.push({
      widgets: [{
        textParagraph: {
          text: `<font color="#888888"><i>${tokens} tokens${duration ? ` | ${duration}` : ''}</i></font>`,
        },
      }],
    });
  }

  // P3-69: View in web app button + P3-70: Quick-action buttons
  const buttons = [{
    textButton: {
      text: 'View in Web App',
      onClick: {
        openLink: {
          url: `${webAppUrl}?conversation=${conversationId || ''}`,
        },
      },
    },
  }];

  sections.push({
    widgets: [{
      buttonList: { buttons },
    }],
  });

  return {
    cardsV2: [{
      cardId: 'answer-' + Date.now(),
      card: {
        header: {
          title: 'Gemini CLI',
          imageUrl: 'https://fonts.gstatic.com/s/i/googlematerialicons/smart_toy/v6/24px.svg',
          imageType: 'CIRCLE',
        },
        sections,
      },
    }],
  };
}

// ============================================================
// TEXT FORMATTING
// ============================================================

/**
 * Formats markdown content for Google Chat HTML subset.
 * Supports: <b>, <i>, <code>, <a>, <font>, <br>
 */
function formatContentForChat(content) {
  let formatted = content;

  // Code blocks -> <code> with <br> for newlines
  formatted = formatted.replace(/```[\w]*\n?([\s\S]*?)```/g, (_m, code) => {
    const escaped = code.trim()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    return `<code>${escaped}</code>`;
  });

  // Inline code
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Italic
  formatted = formatted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>');

  // Links
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Headings -> bold
  formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // Bullet lists -> bullet prefix
  formatted = formatted.replace(/^[-*]\s+(.+)$/gm, '  $1');

  // Line breaks
  formatted = formatted.replace(/\n/g, '<br>');

  return formatted;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function splitText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let breakAt = remaining.lastIndexOf('<br>', maxLen);
    if (breakAt < maxLen * 0.5) breakAt = remaining.lastIndexOf(' ', maxLen);
    if (breakAt < maxLen * 0.5) breakAt = maxLen;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }
  return chunks;
}

/**
 * Sends a message to a Google Chat space/thread.
 */
async function sendChatMessage(spaceName, threadName, body) {
  const chat = await getChatClient();
  await chat.spaces.messages.create({
    parent: spaceName,
    requestBody: {
      ...body,
      thread: threadName ? { name: threadName } : undefined,
    },
    messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD',
  });
}

module.exports = googleChatRoutes;
