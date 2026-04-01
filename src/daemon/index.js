'use strict';

const fastify = require('fastify');
const cors = require('@fastify/cors');
const { loadConfig, validateCliVersion } = require('./config');
const { logger } = require('./lib/logger');
const { SessionManager } = require('./cli/session-manager');
const { spawnCli } = require('./cli/spawner');
const { CommandClassifier } = require('./router/classifier');
const { ConversationQueue } = require('./queue/conversation-queue');
const { AppRegistry } = require('./db/registry');

const healthRoutes = require('./routes/health');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const appRoutes = require('./routes/apps');

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

  // 3. Build Fastify server
  const app = fastify({
    logger: false, // We use our own pino instance
    bodyLimit: 1048576, // 1MB
  });

  await app.register(cors, { origin: true });

  // 4. Register routes
  const deps = { config, startTime, sessionManager, classifier, queue, registry, spawner: spawnCli };

  await app.register(healthRoutes, deps);
  await app.register(conversationRoutes, deps);
  await app.register(messageRoutes, deps);
  await app.register(appRoutes, deps);

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
