'use strict';

const { logger } = require('../lib/logger');

/**
 * Per-conversation message queue (D-05).
 *
 * Ensures messages to the same conversation are processed sequentially,
 * preventing concurrent --resume on the same session (R-07).
 *
 * Different conversations can process in parallel.
 *
 * Design: Map of conversationId -> Promise chain. Each new message awaits
 * the previous one's completion before spawning a new CLI process.
 */
class ConversationQueue {
  constructor() {
    this._chains = new Map();  // conversationId -> Promise
    this._depths = new Map();  // conversationId -> pending count
  }

  /**
   * Enqueues a task for a conversation. Tasks for the same conversation
   * execute sequentially. Tasks for different conversations execute in parallel.
   *
   * @param {string} conversationId
   * @param {Function} task - Async function to execute. Receives no args.
   * @returns {Promise} Resolves with the task's return value.
   */
  async enqueue(conversationId, task) {
    const depth = (this._depths.get(conversationId) || 0) + 1;
    this._depths.set(conversationId, depth);

    if (depth > 1) {
      logger.info(
        { conversationId, queueDepth: depth },
        'Message queued; conversation has active invocation'
      );
    }

    // Chain onto the existing promise for this conversation
    const previous = this._chains.get(conversationId) || Promise.resolve();

    const next = previous
      .catch(() => {}) // Don't let a failed previous task block the queue
      .then(async () => {
        try {
          return await task();
        } finally {
          const current = this._depths.get(conversationId) || 1;
          if (current <= 1) {
            this._depths.delete(conversationId);
            this._chains.delete(conversationId);
          } else {
            this._depths.set(conversationId, current - 1);
          }
        }
      });

    this._chains.set(conversationId, next);

    return next;
  }

  /**
   * Returns the current queue depth for a conversation.
   * 0 = idle, 1 = processing, 2+ = queued messages waiting.
   */
  depth(conversationId) {
    return this._depths.get(conversationId) || 0;
  }

  /**
   * Returns true if the conversation has an active or queued task.
   */
  isBusy(conversationId) {
    return this.depth(conversationId) > 0;
  }

  /**
   * Returns queue stats for all conversations.
   */
  get stats() {
    const active = [];
    for (const [id, depth] of this._depths) {
      active.push({ conversationId: id, depth });
    }
    return { activeConversations: active.length, conversations: active };
  }
}

module.exports = { ConversationQueue };
