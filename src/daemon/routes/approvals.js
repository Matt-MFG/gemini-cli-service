'use strict';

/**
 * Approval routes — user responds to pending tool approval requests (F-15).
 *
 * POST /approvals/:id/approve — approve a pending request
 * POST /approvals/:id/reject  — reject a pending request
 * GET  /approvals/pending      — list pending requests for a user
 */
async function approvalRoutes(fastify, { approvalGate }) {
  if (!approvalGate) return;

  fastify.post('/approvals/:id/approve', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: { note: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const ok = approvalGate.approve(req.params.id, req.body?.note);
    if (!ok) return reply.code(404).send({ error: 'No pending request with that ID' });
    return { approved: true, requestId: req.params.id };
  });

  fastify.post('/approvals/:id/reject', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: { reason: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const ok = approvalGate.reject(req.params.id, req.body?.reason);
    if (!ok) return reply.code(404).send({ error: 'No pending request with that ID' });
    return { rejected: true, requestId: req.params.id };
  });

  fastify.get('/approvals/pending', {
    schema: {
      querystring: {
        type: 'object',
        properties: { user_id: { type: 'string' } },
      },
    },
  }, async (req) => {
    return { pending: approvalGate.listPending(req.query.user_id) };
  });
}

module.exports = approvalRoutes;
