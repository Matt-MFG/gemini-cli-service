'use strict';

const { COMMAND_CATEGORIES, DEFAULTS } = require('../lib/constants');
const { EVENT_TYPES } = require('../lib/constants');
const { logger } = require('../lib/logger');
const { checkWriteRouting, createRoutingWarning } = require('../router/write-interceptor');
const { detectStructuredPanel } = require('../a2ui/detector');

/**
 * Message handling route — the core of the system.
 *
 * POST /send — accepts user message, spawns CLI, streams events via SSE.
 *
 * Flow:
 * 1. Classify input (slash command / meta command / passthrough)
 * 2. Route through conversation queue (D-05)
 * 3. Spawn CLI with -p + --resume + stream-json (Section 5)
 * 4. Stream parsed events back as SSE
 * 5. Record token usage from result event
 */
async function messageRoutes(fastify, { config, classifier, sessionManager, queue, spawner, registry }) {
  fastify.post('/send', {
    schema: {
      body: {
        type: 'object',
        required: ['user_id', 'conversation_id', 'text'],
        properties: {
          user_id: { type: 'string' },
          conversation_id: { type: 'string' },
          text: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { user_id, conversation_id, text } = req.body;
    const log = logger.child({ userId: user_id, conversationId: conversation_id });

    // 1. Classify the input
    const classification = classifier.classify(text);
    log.info({ category: classification.category, command: classification.command }, 'Classified input');

    // Handle meta commands immediately (D-06: within 500ms)
    if (classification.category === COMMAND_CATEGORIES.META) {
      return handleMetaCommand(classification, { sessionManager, registry, user_id, conversation_id });
    }

    // Handle unsupported commands (CL-04: within 200ms)
    if (classification.category === COMMAND_CATEGORIES.UNSUPPORTED) {
      return { type: 'unsupported_command', explanation: classification.explanation };
    }

    // Handle parameterized-safe bare commands (needs interactive UI)
    if (classification.category === COMMAND_CATEGORIES.PARAMETERIZED_SAFE) {
      return handleParameterizedBare(classification, { sessionManager, user_id });
    }

    // 2. Get CLI text to forward
    const cliText = classification.cliText || text;

    // 3. Set up SSE streaming
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // 4. Enqueue for sequential processing per conversation (D-05)
    try {
      await queue.enqueue(conversation_id, async () => {
        // Ensure conversation exists; get CLI session ID for --resume
        ensureSession(sessionManager, user_id, conversation_id, cliText);
        const cliSessionId = sessionManager.getCliSessionId(user_id, conversation_id);

        // 5. Spawn CLI with Vertex AI env if configured
        const cliEnv = {};
        if (config && config.vertexAi) {
          cliEnv.GOOGLE_GENAI_USE_VERTEXAI = 'true';
          cliEnv.GOOGLE_CLOUD_PROJECT = config.gcpProject;
          cliEnv.GOOGLE_CLOUD_LOCATION = config.gcpLocation;
        }

        const invocation = spawner({
          text: cliText,
          sessionId: cliSessionId, // null on first turn, CLI UUID on subsequent
          timeoutMs: config?.cliTimeoutMs || DEFAULTS.CLI_TIMEOUT_MS,
          model: config?.cliModel,
          env: cliEnv,
        });

        // Stream events as SSE
        invocation.on('event', (event) => {
          // P2-W3: Detect structured panels in tool output
          const panel = detectStructuredPanel(event);
          if (panel) {
            sendSSE(reply.raw, 'event', panel);
          }

          sendSSE(reply.raw, 'event', event);

          // Capture CLI session ID from init event for future --resume
          if (event.type === EVENT_TYPES.INIT && event.session_id) {
            sessionManager.setCliSessionId(user_id, conversation_id, event.session_id);
          }

          // Record token usage from result events (real CLI nests under stats)
          if (event.type === EVENT_TYPES.RESULT && registry) {
            const stats = event.stats || event;
            registry.recordTokenUsage({
              userId: user_id,
              conversationId: conversation_id,
              inputTokens: stats.input_tokens || stats.input,
              outputTokens: stats.output_tokens || stats.output,
              cachedTokens: stats.cached_tokens || stats.cached,
              totalTokens: stats.total_tokens,
              durationMs: stats.duration_ms,
            });
          }

          // Log tool calls for audit (F-32)
          if (event.type === EVENT_TYPES.TOOL_CALL && registry) {
            registry.logToolExecution({
              userId: user_id,
              sessionId: cliSessionId,
              toolName: event.tool_name,
              args: event.args,
              result: null,
            });

            // P1-FIX-1: Check for write_file routing leaks
            const activeApps = registry.listApps(user_id).map((a) => a.name);
            const routeCheck = checkWriteRouting(event, activeApps);
            if (routeCheck.intercepted) {
              sendSSE(reply.raw, 'event', createRoutingWarning(routeCheck));
            }
          }
        });

        invocation.on('error', (err) => {
          log.error({ err }, 'CLI invocation error');
          sendSSE(reply.raw, 'error', { message: err.message, code: err.code });
        });

        // Wait for completion
        return new Promise((resolve) => {
          invocation.on('close', (info) => {
            sessionManager.recordTurn(user_id, conversation_id, cliText);
            sendSSE(reply.raw, 'done', { code: info.code, stats: info.parserStats });
            reply.raw.end();
            resolve();
          });
        });
      });
    } catch (err) {
      log.error({ err }, 'Message processing failed');
      sendSSE(reply.raw, 'error', { message: err.message });
      reply.raw.end();
    }
  });
}

/**
 * Ensures a session exists for the conversation. Creates one if needed (S-05).
 */
function ensureSession(sessionManager, userId, conversationId, text) {
  try {
    return sessionManager.getSessionId(userId, conversationId);
  } catch {
    const { sessionPath } = sessionManager.create(userId);
    return sessionPath;
  }
}

/**
 * Handles daemon meta commands (::new, ::list, ::costs, etc.).
 */
function handleMetaCommand(classification, { sessionManager, registry, user_id, conversation_id }) {
  switch (classification.handler) {
    case 'create_conversation':
      return sessionManager.create(user_id, classification.args || null);

    case 'list_conversations':
      return { conversations: sessionManager.list(user_id) };

    case 'show_costs':
      if (!registry) return { error: 'Token tracking not available' };
      return {
        perConversation: registry.getTokenUsage(user_id),
        total: registry.getTotalTokenUsage(user_id),
      };

    case 'list_apps':
      if (!registry) return { error: 'App registry not available' };
      return { apps: registry.listApps(user_id) };

    default:
      return { error: `Unknown meta command handler: ${classification.handler}` };
  }
}

/**
 * Handles parameterized-safe commands that need interactive selection when bare.
 */
function handleParameterizedBare(classification, { sessionManager, user_id }) {
  if (classification.adapter === 'session_picker') {
    const sessions = sessionManager.list(user_id);
    return {
      type: 'interactive_selection',
      command: classification.command,
      prompt: 'Select a session to resume:',
      options: sessions.map((s) => ({
        id: s.conversationId,
        label: s.firstMessage || s.conversationId,
        detail: `${s.turnCount} turns, last active ${s.updatedAt}`,
      })),
    };
  }

  return { type: 'interactive_selection', command: classification.command, options: [] };
}

/**
 * Sends a Server-Sent Event to the response stream.
 */
function sendSSE(raw, eventType, data) {
  raw.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
}

module.exports = messageRoutes;
