'use strict';

const { logger } = require('../lib/logger');

/**
 * API key authentication middleware (F-30).
 *
 * Requires X-API-Key header on all requests except GET /, /health, /ready.
 */

const SKIP_AUTH_PATHS = new Set(['/', '/health', '/ready']);

async function authPlugin(fastify) {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    logger.warn('API_KEY not set — authentication DISABLED');
    return;
  }

  fastify.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (SKIP_AUTH_PATHS.has(path)) return;

    const key = req.headers['x-api-key'];

    if (!key) {
      logger.warn({ ip: req.ip, url: req.url }, 'Missing API key');
      return reply.code(401).send({ error: 'Authentication required. Provide X-API-Key header.' });
    }

    if (key !== apiKey) {
      logger.warn({ ip: req.ip, url: req.url }, 'Invalid API key');
      return reply.code(403).send({ error: 'Invalid API key.' });
    }
  });

  logger.info('API key authentication enabled');
}

module.exports = authPlugin;
