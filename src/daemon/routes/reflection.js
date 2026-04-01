'use strict';

const { analyzeUsage } = require('../reflection/analyzer');

/**
 * Reflection loop routes (P2-W8, F2-35 through F2-39).
 *
 * GET  /reflection         — Get latest reflection report
 * POST /reflection/analyze — Trigger new analysis
 * POST /reflection/stage   — Stage a recommended skill/tool (F2-38)
 * POST /reflection/enable  — Enable a staged recommendation
 * POST /reflection/dismiss — Dismiss a recommendation
 */
async function reflectionRoutes(fastify, { registry }) {
  // Cached report (refreshed on-demand or by schedule)
  let cachedReport = null;
  let lastAnalysis = 0;
  const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * GET /reflection — Returns the current reflection report (F2-39)
   */
  fastify.get('/reflection', {
    schema: {
      querystring: {
        type: 'object',
        properties: { user_id: { type: 'string' } },
      },
    },
  }, async (req) => {
    const userId = req.query.user_id || 'web-user';
    const now = Date.now();

    // Auto-refresh if cache is stale
    if (!cachedReport || now - lastAnalysis > CACHE_TTL_MS) {
      cachedReport = analyzeUsage(registry, userId);
      lastAnalysis = now;
    }

    return cachedReport;
  });

  /**
   * POST /reflection/analyze — Trigger fresh analysis
   */
  fastify.post('/reflection/analyze', {
    schema: {
      body: {
        type: 'object',
        properties: { user_id: { type: 'string' } },
      },
    },
  }, async (req) => {
    const userId = req.body?.user_id || 'web-user';
    cachedReport = analyzeUsage(registry, userId);
    lastAnalysis = Date.now();
    return cachedReport;
  });

  /**
   * POST /reflection/stage — Stage a recommendation for review (F2-38)
   */
  fastify.post('/reflection/stage', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          user_id: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const { name } = req.body;
    if (!cachedReport) return { error: 'No report available. Run /reflection/analyze first.' };

    const rec = cachedReport.recommendations.find((r) => r.name === name);
    if (!rec) return { error: `Recommendation "${name}" not found` };

    rec.staged = true;
    return { staged: true, name, message: `"${name}" staged for review. Enable when ready.` };
  });

  /**
   * POST /reflection/enable — Enable a staged recommendation
   */
  fastify.post('/reflection/enable', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          user_id: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const { name } = req.body;
    if (!cachedReport) return { error: 'No report available' };

    const rec = cachedReport.recommendations.find((r) => r.name === name);
    if (!rec) return { error: `Recommendation "${name}" not found` };
    if (!rec.staged) return { error: `"${name}" must be staged first` };

    rec.enabled = true;
    return { enabled: true, name, message: `"${name}" enabled. Available in next invocation.` };
  });

  /**
   * POST /reflection/dismiss — Dismiss a recommendation
   */
  fastify.post('/reflection/dismiss', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          user_id: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const { name } = req.body;
    if (!cachedReport) return { error: 'No report available' };

    cachedReport.recommendations = cachedReport.recommendations.filter((r) => r.name !== name);
    return { dismissed: true, name };
  });
}

module.exports = reflectionRoutes;
