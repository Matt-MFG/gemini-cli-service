'use strict';

const { logger } = require('../lib/logger');

/**
 * Harness API routes — manage shared infrastructure services.
 */
async function harnessRoutes(fastify, deps) {
  const { infraManager, healthChecker } = deps;

  if (!infraManager) {
    logger.warn('InfraManager not available — harness routes disabled');
    return;
  }

  // GET /harness/status — get infrastructure status
  fastify.get('/harness/status', async () => {
    const status = await infraManager.status();
    const health = healthChecker ? await healthChecker.checkAll() : {};
    return {
      ...status,
      health,
      connectionInfo: infraManager.getConnectionInfo(),
    };
  });

  // POST /harness/start — start infrastructure services
  fastify.post('/harness/start', async () => {
    await infraManager.start();
    const status = await infraManager.status();
    return { message: 'Infrastructure harness started', ...status };
  });

  // POST /harness/stop — stop infrastructure services (data preserved)
  fastify.post('/harness/stop', async () => {
    await infraManager.stop();
    return { message: 'Infrastructure harness stopped' };
  });

  // GET /harness/health — health check all services
  fastify.get('/harness/health', async () => {
    if (!healthChecker) return { error: 'Health checker not available' };
    return healthChecker.checkAll();
  });
}

module.exports = harnessRoutes;
