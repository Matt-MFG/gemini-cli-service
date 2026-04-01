'use strict';

const { logger } = require('../lib/logger');

/**
 * Application management routes — wired to real Docker (W10a).
 *
 * POST /apps/create         — create and start a container
 * GET  /apps                — list all apps for a user (F-26)
 * GET  /apps/:name          — get specific app details
 * POST /apps/:name/stop     — stop a container (A-02)
 * POST /apps/:name/restart  — restart a container
 * POST /apps/:name/exec     — execute command in container (E-04)
 * GET  /apps/:name/logs     — get container logs
 * DELETE /apps/:name        — remove container
 */
async function appRoutes(fastify, { registry, containerManager, networkManager }) {
  // Create and start an app container
  fastify.post('/apps/create', {
    schema: {
      body: {
        type: 'object',
        required: ['user_id', 'name'],
        properties: {
          user_id: { type: 'string' },
          name: { type: 'string' },
          image: { type: 'string' },
          port: { type: 'integer' },
          start_command: { type: 'string' },
          env: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const { user_id, name, image, port, start_command, env } = req.body;
    const log = logger.child({ userId: user_id, appName: name });

    // Check if app already exists
    const existing = registry.getAppByName(user_id, name);
    if (existing && existing.status === 'running') {
      return { url: existing.url, status: 'already_running', container_id: existing.container_id };
    }

    try {
      // Ensure user network exists for inter-container DNS (A-05)
      let networkName;
      if (networkManager) {
        networkName = await networkManager.ensure(user_id);
      }

      // Create container with direct port mapping
      const result = await containerManager.create({
        userId: user_id,
        name,
        image: image || 'node:22-alpine',
        internalPort: port || 3000,
        startCommand: start_command,
        env,
        networkName,
      });

      // Register in app registry
      const app = registry.createApp({
        userId: user_id,
        name,
        image: image || 'node:22-alpine',
        internalPort: port || 3000,
        url: result.url,
        containerId: result.containerId,
        startCommand: start_command,
        env,
      });
      registry.updateAppStatus(app.id, 'running', result.containerId);

      log.info({ url: result.url, containerId: result.containerId }, 'App created');
      return { url: result.url, container_id: result.containerId, status: 'running' };

    } catch (err) {
      log.error({ err }, 'Failed to create app');
      return reply.code(500).send({ error: err.message });
    }
  });

  // List all apps
  fastify.get('/apps', {
    schema: {
      querystring: {
        type: 'object',
        required: ['user_id'],
        properties: { user_id: { type: 'string' } },
      },
    },
  }, async (req) => {
    return { apps: registry.listApps(req.query.user_id) };
  });

  // Get app details
  fastify.get('/apps/:name', {
    schema: {
      params: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      querystring: { type: 'object', required: ['user_id'], properties: { user_id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const app = registry.getAppByName(req.query.user_id, req.params.name);
    if (!app) return reply.code(404).send({ error: 'App not found' });
    return app;
  });

  // Stop a container (A-02: stopping one must not affect others)
  fastify.post('/apps/:name/stop', {
    schema: {
      params: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      body: { type: 'object', required: ['user_id'], properties: { user_id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const app = registry.getAppByName(req.body.user_id, req.params.name);
    if (!app) return reply.code(404).send({ error: 'App not found' });

    try {
      if (containerManager && app.container_id) {
        await containerManager.stop(app.container_id);
      }
      registry.updateAppStatus(app.id, 'stopped');
      return { stopped: true, name: req.params.name };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Restart a container
  fastify.post('/apps/:name/restart', {
    schema: {
      params: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      body: { type: 'object', required: ['user_id'], properties: { user_id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const app = registry.getAppByName(req.body.user_id, req.params.name);
    if (!app) return reply.code(404).send({ error: 'App not found' });

    try {
      if (containerManager && app.container_id) {
        await containerManager.restart(app.container_id);
      }
      registry.updateAppStatus(app.id, 'running');
      return { restarted: true, name: req.params.name };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Execute command in container (E-04)
  fastify.post('/apps/:name/exec', {
    schema: {
      params: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['user_id', 'command'],
        properties: {
          user_id: { type: 'string' },
          command: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const app = registry.getAppByName(req.body.user_id, req.params.name);
    if (!app) return reply.code(404).send({ error: 'App not found' });

    try {
      const result = await containerManager.exec(app.container_id, req.body.command);
      return result;
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Get container logs
  fastify.get('/apps/:name/logs', {
    schema: {
      params: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      querystring: {
        type: 'object',
        required: ['user_id'],
        properties: {
          user_id: { type: 'string' },
          lines: { type: 'integer' },
        },
      },
    },
  }, async (req, reply) => {
    const app = registry.getAppByName(req.query.user_id, req.params.name);
    if (!app) return reply.code(404).send({ error: 'App not found' });

    try {
      const logs = await containerManager.logs(app.container_id, req.query.lines || 100);
      return { logs };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Remove container (volumes preserved per A-10)
  fastify.delete('/apps/:name', {
    schema: {
      params: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      querystring: { type: 'object', required: ['user_id'], properties: { user_id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const app = registry.getAppByName(req.query.user_id, req.params.name);
    if (!app) return reply.code(404).send({ error: 'App not found' });

    try {
      if (containerManager && app.container_id) {
        await containerManager.remove(app.container_id, true);
      }
      registry.deleteApp(app.id);
      return { deleted: true, name: req.params.name };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}

module.exports = appRoutes;
