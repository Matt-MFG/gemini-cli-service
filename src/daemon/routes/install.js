'use strict';

const { logger } = require('../lib/logger');

/**
 * Install API routes — install, update, and uninstall harness apps.
 */
async function installRoutes(fastify, deps) {
  const { installer } = deps;

  if (!installer) {
    logger.warn('Installer not available — install routes disabled');
    return;
  }

  // POST /install/:appName — install an app from the registry
  fastify.post('/install/:appName', async (req, reply) => {
    const { appName } = req.params;
    const userId = req.body?.user_id || 'web-user';

    try {
      const result = await installer.install(appName, userId, (step, message) => {
        logger.info({ appName, step, message }, 'Install progress');
      });

      return {
        success: true,
        ...result,
      };
    } catch (err) {
      logger.error({ err, appName }, 'Install failed');
      return reply.code(500).send({
        success: false,
        error: err.message,
      });
    }
  });

  // GET /install/status — list all installed harness apps
  fastify.get('/install/status', async (req) => {
    const userId = req.query.user_id || 'web-user';
    if (!deps.registry) return { apps: [] };

    const apps = deps.registry.listApps(userId);
    return { apps };
  });
}

module.exports = installRoutes;
