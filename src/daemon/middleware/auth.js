'use strict';

const { logger } = require('../lib/logger');

/**
 * API key authentication middleware (F-30).
 *
 * Requires X-API-Key header or ?api_key query param on all requests
 * except GET /health (for monitoring).
 *
 * The web UI prompts for the key on first load and stores it in sessionStorage.
 */

const SKIP_AUTH_PATHS = new Set(['/', '/health', '/ready']);

function authPlugin(fastify, opts, done) {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    logger.warn('API_KEY not set — authentication DISABLED. Set API_KEY in .env to secure the daemon.');
    done();
    return;
  }

  fastify.addHook('onRequest', async (req, reply) => {
    // Skip auth for health checks
    if (SKIP_AUTH_PATHS.has(req.url.split('?')[0])) return;

    const key = req.headers['x-api-key'] || req.query.api_key;

    if (!key) {
      logger.warn({ ip: req.ip, url: req.url }, 'Request without API key');
      reply.code(401).send({ error: 'Authentication required. Provide X-API-Key header.' });
      return;
    }

    if (key !== apiKey) {
      logger.warn({ ip: req.ip, url: req.url }, 'Invalid API key');
      reply.code(403).send({ error: 'Invalid API key.' });
      return;
    }
  });

  logger.info('API key authentication enabled');
  done();
}

module.exports = authPlugin;
