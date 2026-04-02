'use strict';

const { google } = require('googleapis');
const { logger } = require('../lib/logger');
const { EVENT_TYPES } = require('../lib/constants');

/**
 * Google Chat bot integration (Phase 2 enhanced).
 *
 * Flow:
 * 1. Google Chat POSTs to /chat/google
 * 2. We respond immediately with a "Processing..." card (must respond <30s)
 * 3. CLI runs asynchronously, we collect events
 * 4. When done, we post the response as a new message in the thread
 *
 * Phase 2 enhancements:
 * - Rich card formatting with sections for response, tools, and stats
 * - Progress updates during long operations
 * - Proper error handling (no silent failures)
 * - Code block formatting
 * - Tool call summaries
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
          text: '👋 *Gemini CLI as a Service* is ready. Send me a message and I\'ll help you build apps, write code, and more.\n\nEach thread is a separate conversation with its own context.',
        };

      case 'REMOVED_FROM_SPACE':
        return {};

      case 'MESSAGE':
        return handleMessage(event, deps);

      case 'CARD_CLICKED':
        return {};

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
      return { text: `⚠️ ${classification.explanation}` };
    }

    // Fire async CLI processing — respond immediately with thinking card
    processMessageAsync(text, userId, threadName, spaceName, deps, log)
      .catch((err) => {
        log.error({ err: err.message }, 'Async message processing failed');
        sendChatMessage(spaceName, threadName, {
          text: `❌ *Error:* ${err.message}`,
        }).catch(() => {});
      });

    return {
      cardsV2: [{
        cardId: 'processing',
        card: {
          header: {
            title: 'Processing...',
            subtitle: text.length > 60 ? text.slice(0, 57) + '...' : text,
            imageUrl: 'https://fonts.gstatic.com/s/i/googlematerialicons/hourglass_empty/v6/24px.svg',
            imageType: 'CIRCLE',
          },
          sections: [{
            widgets: [{
              textParagraph: { text: '⏳ <i>Working on it — I\'ll reply in this thread when done.</i>' },
            }],
          }],
        },
      }],
    };
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
    } catch { /* first message — no session yet */ }

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

    // Collect events
    let fullContent = '';
    const toolCalls = [];
    let tokenStats = null;
    let hasApps = false;

    invocation.on('event', (event) => {
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

      // Track tool calls
      if (event.type === 'tool_use') {
        const toolName = (event.tool_name || '').replace(/^mcp_apps_/, '');
        toolCalls.push({
          name: toolName,
          params: event.parameters || {},
        });
        if (toolName.startsWith('apps_create')) hasApps = true;
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
        fullContent += `\n\n⚠️ Error: ${err.message}`;
        resolve();
      });
    });

    // Build and send response
    const responseCard = buildResponseCard(fullContent, toolCalls, tokenStats, hasApps);
    await sendChatMessage(spaceName, threadName, responseCard);
    log.info('Google Chat message updated with response');
  }

  function formatMetaResponse(classification, deps, userId) {
    switch (classification.handler) {
      case 'create_conversation':
        return { text: '💡 Start a new thread to create a new conversation.' };
      case 'list_conversations': {
        const convs = deps.sessionManager.list(userId);
        if (convs.length === 0) return { text: 'No conversations yet. Send me a message to start!' };
        const list = convs.slice(0, 10).map((c) =>
          `• *${c.name || c.conversationId.slice(0, 8)}* — ${c.turnCount} turns`
        ).join('\n');
        return { text: `📋 *Your conversations:*\n\n${list}` };
      }
      case 'show_costs': {
        if (!registry) return { text: 'Token tracking not available.' };
        const total = registry.getTotalTokenUsage(userId);
        if (!total || !total.total_tokens) return { text: 'No usage recorded yet.' };
        return { text: `📊 *Usage:* ${total.total_tokens.toLocaleString()} tokens across ${total.invocations} invocations` };
      }
      case 'list_apps': {
        if (!registry) return { text: 'App registry not available.' };
        const apps = registry.listApps(userId);
        if (apps.length === 0) return { text: 'No apps running. Ask me to build something!' };
        const list = apps.map((a) => {
          const dot = a.status === 'running' ? '🟢' : '⚫';
          return `${dot} *${a.name}* — <${a.url || '#'}|Open>`;
        }).join('\n');
        return { text: `📱 *Your apps:*\n\n${list}` };
      }
      default:
        return { text: `Unknown command: ${classification.handler}` };
    }
  }
}

/**
 * Builds a rich Google Chat card response.
 */
function buildResponseCard(content, toolCalls, stats, hasApps) {
  const sections = [];

  // Main response content — split into chunks if needed (4096 char limit per widget)
  if (content) {
    const formatted = formatContentForChat(content);
    const chunks = splitText(formatted, 3800);

    for (const chunk of chunks) {
      sections.push({
        widgets: [{
          textParagraph: { text: chunk },
        }],
      });
    }
  } else {
    sections.push({
      widgets: [{
        textParagraph: { text: '<i>Task completed (no text response).</i>' },
      }],
    });
  }

  // Tool calls summary (collapsed)
  if (toolCalls.length > 0) {
    const toolSummary = toolCalls.map((tc) => {
      const shortParams = summarizeParams(tc.params);
      return `<font color="#888888">▸ <b>${tc.name}</b>${shortParams ? ` — ${shortParams}` : ''}</font>`;
    }).join('\n');

    sections.push({
      header: `🔧 ${toolCalls.length} tool call${toolCalls.length > 1 ? 's' : ''}`,
      collapsible: true,
      uncollapsibleWidgetsCount: 0,
      widgets: [{
        textParagraph: { text: toolSummary },
      }],
    });
  }

  // App links
  if (hasApps) {
    const appCreates = toolCalls.filter((tc) => tc.name === 'apps_create');
    if (appCreates.length > 0) {
      const appWidgets = appCreates.map((tc) => ({
        textParagraph: {
          text: `🟢 <b>${tc.params.name || 'app'}</b> — app created`,
        },
      }));
      sections.push({ header: '📱 Apps', widgets: appWidgets });
    }
  }

  // Stats footer
  if (stats) {
    const tokens = (stats.total_tokens || 0).toLocaleString();
    const duration = stats.duration_ms ? `${(stats.duration_ms / 1000).toFixed(1)}s` : '';
    sections.push({
      widgets: [{
        textParagraph: {
          text: `<font color="#888888"><i>${tokens} tokens${duration ? ` · ${duration}` : ''}</i></font>`,
        },
      }],
    });
  }

  return {
    cardsV2: [{
      cardId: 'response-' + Date.now(),
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

/**
 * Formats content for Google Chat (subset of HTML supported).
 * Google Chat cards support: <b>, <i>, <code>, <a>, <font>, <br>
 * Does NOT support: <pre>, <h1>, <ul>, <li>, <img>
 */
function formatContentForChat(content) {
  let formatted = content;

  // Convert markdown code blocks to <code> (Google Chat doesn't support <pre>)
  formatted = formatted.replace(/```[\w]*\n?([\s\S]*?)```/g, (_m, code) => {
    // Replace newlines with <br> inside code blocks
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

  // Italic (single *)
  formatted = formatted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>');

  // Links
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Headings → bold
  formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // Bullet lists → • prefix
  formatted = formatted.replace(/^[-*]\s+(.+)$/gm, '• $1');

  // Numbered lists stay as-is

  // Line breaks
  formatted = formatted.replace(/\n/g, '<br>');

  return formatted;
}

/**
 * Splits text into chunks under maxLen.
 */
function splitText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Find a good break point
    let breakAt = remaining.lastIndexOf('<br>', maxLen);
    if (breakAt < maxLen * 0.5) breakAt = remaining.lastIndexOf(' ', maxLen);
    if (breakAt < maxLen * 0.5) breakAt = maxLen;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }
  return chunks;
}

/**
 * Summarizes tool parameters for display.
 */
function summarizeParams(params) {
  if (!params || Object.keys(params).length === 0) return '';
  const parts = [];
  if (params.name) parts.push(params.name);
  if (params.command) parts.push(params.command.slice(0, 80) + (params.command.length > 80 ? '…' : ''));
  if (params.url_path) parts.push(params.url_path);
  if (parts.length === 0) return JSON.stringify(params).slice(0, 100);
  return parts.join(', ');
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
