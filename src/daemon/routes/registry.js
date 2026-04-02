'use strict';

const { logger } = require('../lib/logger');

/**
 * Registry API routes — browse available and installed harness apps.
 */
async function registryRoutes(fastify, deps) {
  const { registryManager } = deps;

  if (!registryManager) {
    logger.warn('RegistryManager not available — registry routes disabled');
    return;
  }

  // GET /registry/apps — list all available apps in the catalog
  fastify.get('/registry/apps', async () => {
    return { apps: registryManager.listAvailable() };
  });

  // GET /registry/apps/:name — get details for a specific app
  fastify.get('/registry/apps/:name', async (req, reply) => {
    const app = registryManager.getApp(req.params.name);
    if (!app) {
      return reply.code(404).send({ error: 'App not found in registry' });
    }
    return { app };
  });

  // POST /registry/reload — reload the catalog from disk
  fastify.post('/registry/reload', async () => {
    registryManager.reload();
    return { message: 'Registry catalog reloaded', apps: registryManager.listAvailable().length };
  });
}

module.exports = registryRoutes;
