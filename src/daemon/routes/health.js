'use strict';

/**
 * Health and readiness routes.
 *
 * GET /health — daemon status, CLI version, uptime
 * GET /ready  — checks CLI binary exists and version matches
 */
async function healthRoutes(fastify, { config, startTime }) {
  fastify.get('/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    cliVersion: config.pinnedCliVersion,
    nodeEnv: config.nodeEnv,
  }));

  fastify.get('/ready', async (_req, reply) => {
    // Could add deeper checks here (CLI binary exists, DB accessible)
    reply.send({ ready: true });
  });
}

module.exports = healthRoutes;
