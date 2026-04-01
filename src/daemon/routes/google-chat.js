'use strict';

const { google } = require('googleapis');
const { logger } = require('../lib/logger');
const { EVENT_TYPES } = require('../lib/constants');

/**
 * Google Chat bot integration.
 *
 * Google Chat sends HTTP POST to /chat/google for every message.
 * We must respond within 30 seconds. For long CLI invocations:
 * 1. Immediately respond with a "thinking" card
 * 2. Spawn CLI asynchronously
 * 3. Update the message via Chat API when done
 *
 * Setup: Configure a Google Chat app in GCP console pointing to
 * https://YOUR_DOMAIN:3100/chat/google
 */

let chatClient = null;

async function getChatClient() {
  if (chatClient) return chatClient;
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/chat.bot'],
  });
  chatClient = google.chat({ version: 'v1', auth });
  return chatClient;
}

async function googleChatRoutes(fastify, deps) {
  const { sessionManager, classifier, queue, registry, config } = deps;
  const { spawnCli } = require('../cli/spawner');

  // Google Chat webhook endpoint — no API key auth (Google handles auth via token)
  fastify.post('/chat/google', async (req, reply) => {
    const event = req.body;
    const log = logger.child({ eventType: event.type });

    // Handle different event types
    switch (event.type) {
      case 'ADDED_TO_SPACE':
        return {
          text: 'Hello! I\'m Gemini CLI as a Service. Send me a message and I\'ll help you build apps, write code, and more. Each thread is a separate conversation.',
        };

      case 'REMOVED_FROM_SPACE':
        log.info('Bot removed from space');
        return {};

      case 'MESSAGE':
        return handleMessage(event, deps);

      case 'CARD_CLICKED':
        return handleCardClick(event, deps);

      default:
        log.info({ type: event.type }, 'Unhandled Google Chat event type');
        return {};
    }
  });

  async function handleMessage(event, deps) {
    const text = event.message?.argumentText?.trim() || event.message?.text?.trim() || '';
    const senderEmail = event.user?.email || 'unknown';
    const userId = senderEmail.replace(/[^a-zA-Z0-9]/g, '-');
    const spaceName = event.space?.name || '';
    const threadName = event.message?.thread?.name || '';
    const messageName = event.message?.name || '';

    // Use thread as conversation ID (each thread = independent conversation)
    const conversationKey = threadName || `gchat-${Date.now()}`;
    const log = logger.child({ userId, conversationKey });

    if (!text) {
      return { text: 'I received an empty message. Please type something!' };
    }

    log.info({ text: text.slice(0, 100) }, 'Google Chat message received');

    // Check slash commands handled locally
    const classification = deps.classifier.classify(text);

    if (classification.category === 'meta') {
      const result = handleMetaCommand(classification, deps, userId);
      return formatResponse(result);
    }

    if (classification.category === 'unsupported') {
      return { text: classification.explanation };
    }

    // For CLI messages: respond immediately with "thinking", then update async
    // Respond synchronously with a thinking indicator
    const thinkingResponse = {
      text: '',
      cardsV2: [{
        cardId: 'thinking',
        card: {
          header: { title: 'Processing...', imageUrl: '' },
          sections: [{
            widgets: [{
              textParagraph: { text: '⏳ Talking to Gemini CLI...' },
            }],
          }],
        },
      }],
    };

    // Fire async processing
    processMessageAsync(text, userId, conversationKey, spaceName, threadName, messageName, deps)
      .catch((err) => log.error({ err }, 'Async message processing failed'));

    return thinkingResponse;
  }

  async function processMessageAsync(text, userId, conversationKey, spaceName, threadName, messageName, deps) {
    const log = logger.child({ userId, conversationKey });

    // Ensure conversation exists
    let conversationId;
    const conversations = deps.sessionManager.list(userId);
    const existing = conversations.find((c) => c.name === conversationKey);

    if (existing) {
      conversationId = existing.conversationId;
    } else {
      const created = deps.sessionManager.create(userId, conversationKey);
      conversationId = created.conversationId;
    }

    // Get CLI session ID
    const cliSessionId = deps.sessionManager.getCliSessionId(userId, conversationId);

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

    invocation.on('event', (event) => {
      // Capture CLI session ID
      if (event.type === EVENT_TYPES.INIT && event.session_id) {
        deps.sessionManager.setCliSessionId(userId, conversationId, event.session_id);
      }

      // Accumulate assistant content
      if (event.type === 'message' && event.role === 'assistant') {
        fullContent += event.content || '';
      }

      // Track tool calls
      if (event.type === 'tool_use') {
        toolCalls.push({ name: event.tool_name, params: event.parameters });
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
        deps.sessionManager.recordTurn(userId, conversationId, text);
        resolve();
      });
      invocation.on('error', (err) => {
        log.error({ err }, 'CLI error during Google Chat processing');
        fullContent += `\n\n⚠️ Error: ${err.message}`;
        resolve();
      });
    });

    // Build response card
    const card = buildResponseCard(fullContent, toolCalls, tokenStats);

    // Update the original message in Google Chat
    try {
      const chat = await getChatClient();
      await chat.spaces.messages.create({
        parent: spaceName,
        requestBody: {
          ...card,
          thread: threadName ? { name: threadName } : undefined,
        },
        messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD',
      });
      log.info('Google Chat message updated with response');
    } catch (err) {
      log.error({ err: err.message }, 'Failed to send Google Chat response');
    }
  }

  function handleMetaCommand(classification, deps, userId) {
    switch (classification.handler) {
      case 'create_conversation':
        return { text: 'Start a new thread to create a new conversation.' };
      case 'list_conversations':
        const convs = deps.sessionManager.list(userId);
        if (convs.length === 0) return { text: 'No conversations yet.' };
        return {
          text: convs.map((c) =>
            `• *${c.name || c.conversationId.slice(0, 8)}* — ${c.turnCount} turns, last active ${c.updatedAt}`
          ).join('\n'),
        };
      case 'show_costs':
        if (!registry) return { text: 'Token tracking not available.' };
        const total = registry.getTotalTokenUsage(userId);
        if (!total || !total.total_tokens) return { text: 'No usage recorded yet.' };
        return { text: `Total: ${total.total_tokens.toLocaleString()} tokens across ${total.invocations} invocations.` };
      case 'list_apps':
        if (!registry) return { text: 'App registry not available.' };
        const apps = registry.listApps(userId);
        if (apps.length === 0) return { text: 'No apps running.' };
        return {
          text: apps.map((a) =>
            `• *${a.name}* — ${a.status} — ${a.url || 'no URL'}`
          ).join('\n'),
        };
      default:
        return { text: `Unknown command: ${classification.handler}` };
    }
  }
}

function buildResponseCard(content, toolCalls, stats) {
  const sections = [];

  // Tool calls section
  if (toolCalls.length > 0) {
    sections.push({
      header: 'Tools Used',
      widgets: toolCalls.map((tc) => ({
        textParagraph: {
          text: `<b>${tc.name}</b>: <code>${JSON.stringify(tc.params || {}).slice(0, 150)}</code>`,
        },
      })),
    });
  }

  // Main content
  if (content) {
    sections.push({
      widgets: [{
        textParagraph: { text: content.slice(0, 4000) },
      }],
    });
  }

  // Stats footer
  if (stats) {
    sections.push({
      widgets: [{
        textParagraph: {
          text: `<i>${stats.total_tokens?.toLocaleString() || 0} tokens · ${stats.duration_ms || 0}ms</i>`,
        },
      }],
    });
  }

  return {
    cardsV2: [{
      cardId: 'response',
      card: { sections },
    }],
  };
}

function formatResponse(result) {
  if (typeof result === 'string') return { text: result };
  if (result.text) return result;
  return { text: JSON.stringify(result, null, 2) };
}

module.exports = googleChatRoutes;
