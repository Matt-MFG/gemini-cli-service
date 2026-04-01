'use strict';

/**
 * Conversation management routes.
 *
 * POST /conversations/new     — create new conversation
 * GET  /conversations/list    — list user's conversations (F-06)
 * POST /conversations/branch  — branch from checkpoint (F-05)
 * POST /conversations/checkpoint — save a named checkpoint
 * DELETE /conversations/:id   — delete a conversation
 */
async function conversationRoutes(fastify, { sessionManager }) {
  // Create new conversation
  fastify.post('/conversations/new', {
    schema: {
      body: {
        type: 'object',
        required: ['user_id'],
        properties: {
          user_id: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const { user_id, name } = req.body;
    return sessionManager.create(user_id, name);
  });

  // List conversations for a user
  fastify.get('/conversations/list', {
    schema: {
      querystring: {
        type: 'object',
        required: ['user_id'],
        properties: {
          user_id: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const { user_id } = req.query;
    return { conversations: sessionManager.list(user_id) };
  });

  // Branch a conversation from a checkpoint
  fastify.post('/conversations/branch', {
    schema: {
      body: {
        type: 'object',
        required: ['user_id', 'source_conversation_id'],
        properties: {
          user_id: { type: 'string' },
          source_conversation_id: { type: 'string' },
          checkpoint_name: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const { user_id, source_conversation_id, checkpoint_name } = req.body;
    return sessionManager.branch(user_id, source_conversation_id, checkpoint_name);
  });

  // Save a named checkpoint
  fastify.post('/conversations/checkpoint', {
    schema: {
      body: {
        type: 'object',
        required: ['user_id', 'conversation_id', 'name'],
        properties: {
          user_id: { type: 'string' },
          conversation_id: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const { user_id, conversation_id, name } = req.body;
    sessionManager.saveCheckpoint(user_id, conversation_id, name);
    return { saved: true, checkpoint: name };
  });

  // Delete a conversation
  fastify.delete('/conversations/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        required: ['user_id'],
        properties: { user_id: { type: 'string' } },
      },
    },
  }, async (req) => {
    const { id } = req.params;
    const { user_id } = req.query;
    sessionManager.delete(user_id, id);
    return { deleted: true };
  });
}

module.exports = conversationRoutes;
