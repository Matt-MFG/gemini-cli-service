'use strict';

/**
 * Application management routes.
 *
 * GET /apps          — list all apps for a user (F-26)
 * GET /apps/:name    — get specific app details
 * POST /apps/:name/stop    — stop an app
 * POST /apps/:name/restart — restart an app
 * DELETE /apps/:name       — remove an app
 */
async function appRoutes(fastify, { registry }) {
  fastify.get('/apps', {
    schema: {
      querystring: {
        type: 'object',
        required: ['user_id'],
        properties: { user_id: { type: 'string' } },
      },
    },
  }, async (req) => {
    const { user_id } = req.query;
    return { apps: registry.listApps(user_id) };
  });

  fastify.get('/apps/:name', {
    schema: {
      params: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        required: ['user_id'],
        properties: { user_id: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const app = registry.getAppByName(req.query.user_id, req.params.name);
    if (!app) return reply.code(404).send({ error: 'App not found' });
    return app;
  });

  // Stop and restart are stubs — actual Docker operations come in W10a
  fastify.post('/apps/:name/stop', {
    schema: {
      params: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      body: { type: 'object', required: ['user_id'], properties: { user_id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const app = registry.getAppByName(req.body.user_id, req.params.name);
    if (!app) return reply.code(404).send({ error: 'App not found' });
    registry.updateAppStatus(app.id, 'stopped');
    return { stopped: true, name: req.params.name };
  });

  fastify.post('/apps/:name/restart', {
    schema: {
      params: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      body: { type: 'object', required: ['user_id'], properties: { user_id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const app = registry.getAppByName(req.body.user_id, req.params.name);
    if (!app) return reply.code(404).send({ error: 'App not found' });
    registry.updateAppStatus(app.id, 'running');
    return { restarted: true, name: req.params.name };
  });

  fastify.delete('/apps/:name', {
    schema: {
      params: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      querystring: { type: 'object', required: ['user_id'], properties: { user_id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const app = registry.getAppByName(req.query.user_id, req.params.name);
    if (!app) return reply.code(404).send({ error: 'App not found' });
    registry.deleteApp(app.id);
    return { deleted: true, name: req.params.name };
  });
}

module.exports = appRoutes;
