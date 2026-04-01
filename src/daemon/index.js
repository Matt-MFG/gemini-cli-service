'use strict';

require('dotenv').config();
const fastify = require('fastify');
const cors = require('@fastify/cors');
const { loadConfig, validateCliVersion } = require('./config');
const { logger } = require('./lib/logger');
const { SessionManager } = require('./cli/session-manager');
const { spawnCli } = require('./cli/spawner');
const { CommandClassifier } = require('./router/classifier');
const { ConversationQueue } = require('./queue/conversation-queue');
const { AppRegistry } = require('./db/registry');
const { ApprovalGate } = require('./mcp/approval-gate');
const { TokenTracker } = require('./tokens/tracker');
const { BudgetManager } = require('./tokens/budget');
const { AutoCompressor } = require('./tokens/compressor');
const { ContainerManager } = require('./docker/container-manager');
const { NetworkManager } = require('./docker/network-manager');

const healthRoutes = require('./routes/health');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const appRoutes = require('./routes/apps');
const approvalRoutes = require('./routes/approvals');
const webRoutes = require('./routes/web');
const fileRoutes = require('./routes/files');
const googleChatRoutes = require('./routes/google-chat');
const skillsRoutes = require('./routes/skills');
const reflectionRoutes = require('./routes/reflection');

const startTime = Date.now();

async function main() {
  // 1. Load and validate config
  const config = loadConfig();
  logger.info({ port: config.port, host: config.host }, 'Starting daemon');

  // V-01: Validate CLI version on startup
  try {
    validateCliVersion(config);
  } catch (err) {
    logger.fatal({ err }, 'CLI version validation failed; refusing to start');
    process.exit(1);
  }

  // 2. Initialize core services
  const sessionManager = new SessionManager(config.sessionDir);
  const classifier = new CommandClassifier();
  const queue = new ConversationQueue();
  const registry = new AppRegistry(config.dbPath);
  const approvalGate = new ApprovalGate();
  const tokenTracker = new TokenTracker(registry);
  const budgetManager = new BudgetManager(registry);
  const compressor = new AutoCompressor();
  const containerManager = new ContainerManager({ domainSuffix: config.domainSuffix });
  const networkManager = new NetworkManager();

  // 3. Build Fastify server
  const app = fastify({
    logger: false, // We use our own pino instance
    bodyLimit: 1048576, // 1MB
  });

  await app.register(cors, { origin: true });

  // Auth: API key check on all routes except /, /health, /ready (F-30)
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    const skipPaths = new Set(['/', '/health', '/ready', '/chat/google']);
    app.addHook('onRequest', async (req, reply) => {
      if (skipPaths.has(req.url.split('?')[0])) return;
      const key = req.headers['x-api-key'] || req.query?.api_key;
      if (!key) return reply.code(401).send({ error: 'X-API-Key header required' });
      if (key !== apiKey) return reply.code(403).send({ error: 'Invalid API key' });
    });
    logger.info('API key authentication enabled');
  } else {
    logger.warn('API_KEY not set — authentication DISABLED');
  }

  // 4. Register routes
  const deps = {
    config, startTime, sessionManager, classifier, queue, registry,
    spawner: spawnCli, approvalGate, tokenTracker, budgetManager, compressor,
    containerManager, networkManager,
  };

  await app.register(healthRoutes, deps);
  await app.register(conversationRoutes, deps);
  await app.register(messageRoutes, deps);
  await app.register(appRoutes, deps);
  await app.register(approvalRoutes, deps);
  await app.register(webRoutes, deps);
  await app.register(fileRoutes, deps);
  await app.register(googleChatRoutes, deps);
  await app.register(skillsRoutes, deps);
  await app.register(reflectionRoutes, deps);

  // Global error handler
  app.setErrorHandler((err, _req, reply) => {
    logger.error({ err }, 'Unhandled route error');
    reply.code(err.statusCode || 500).send({
      error: err.code || 'INTERNAL_ERROR',
      message: err.message,
    });
  });

  // 5. Start server
  try {
    await app.listen({ port: config.port, host: config.host });
    logger.info({ port: config.port, host: config.host }, 'Daemon listening');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start daemon');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down');
    approvalGate.cancelAll();
    await app.close();
    registry.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
