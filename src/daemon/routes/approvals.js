'use strict';

/**
 * Approval routes — user responds to pending tool approval requests (F-15, D-09).
 *
 * POST /approvals/request      — MCP server requests approval (blocks until user responds)
 * POST /approvals/:id/approve  — user approves
 * POST /approvals/:id/reject   — user rejects
 * GET  /approvals/pending      — list pending requests
 * GET  /approvals/subscribe    — SSE stream of approval events
 */
async function approvalRoutes(fastify, { approvalGate }) {
  if (!approvalGate) return;

  // MCP server calls this to request approval — blocks until user responds
  fastify.post('/approvals/request', {
    schema: {
      body: {
        type: 'object',
        required: ['user_id', 'action', 'description'],
        properties: {
          user_id: { type: 'string' },
          action: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const { user_id, action, description } = req.body;
    const result = await approvalGate.request({
      userId: user_id,
      action,
      description,
    });
    return result;
  });

  // User approves
  fastify.post('/approvals/:id/approve', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: { type: 'object', properties: { note: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const ok = approvalGate.approve(req.params.id, req.body?.note);
    if (!ok) return reply.code(404).send({ error: 'No pending request with that ID' });
    return { approved: true, requestId: req.params.id };
  });

  // User rejects
  fastify.post('/approvals/:id/reject', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: { type: 'object', properties: { reason: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const ok = approvalGate.reject(req.params.id, req.body?.reason);
    if (!ok) return reply.code(404).send({ error: 'No pending request with that ID' });
    return { rejected: true, requestId: req.params.id };
  });

  // List pending
  fastify.get('/approvals/pending', {
    schema: {
      querystring: { type: 'object', properties: { user_id: { type: 'string' } } },
    },
  }, async (req) => {
    return { pending: approvalGate.listPending(req.query.user_id) };
  });

  // SSE stream for approval events — web UI subscribes to this
  fastify.get('/approvals/subscribe', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendEvent = (type, data) => {
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const onRequest = (req) => sendEvent('approval_request', req);
    const onApproved = (data) => sendEvent('approved', data);
    const onRejected = (data) => sendEvent('rejected', data);
    const onTimeout = (data) => sendEvent('timeout', data);

    approvalGate.on('request', onRequest);
    approvalGate.on('approved', onApproved);
    approvalGate.on('rejected', onRejected);
    approvalGate.on('timeout', onTimeout);

    // Heartbeat
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 15000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      approvalGate.off('request', onRequest);
      approvalGate.off('approved', onApproved);
      approvalGate.off('rejected', onRejected);
      approvalGate.off('timeout', onTimeout);
    });
  });
}

module.exports = approvalRoutes;
