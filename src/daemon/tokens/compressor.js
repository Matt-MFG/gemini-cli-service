'use strict';

const { logger } = require('../lib/logger');

/**
 * Auto-compression trigger (W11, F-35).
 *
 * Monitors conversation token count. When approaching the context limit,
 * injects /compress before the next user message to manage costs.
 */
class AutoCompressor {
  constructor(opts = {}) {
    // Gemini model context window (approximate)
    this._contextLimit = opts.contextLimit || 1_000_000; // 1M tokens
    this._triggerRatio = opts.triggerRatio || 0.8;        // Trigger at 80% of limit
    this._conversationTokens = new Map(); // conversationId -> cumulative tokens
  }

  /**
   * Records tokens consumed by a conversation turn.
   */
  record(conversationId, totalTokens) {
    const current = this._conversationTokens.get(conversationId) || 0;
    this._conversationTokens.set(conversationId, current + totalTokens);
  }

  /**
   * Checks whether compression should be triggered before the next message.
   *
   * Returns null if no compression needed, or '/compress' command text if it should
   * be injected before the next user message.
   */
  shouldCompress(conversationId) {
    const tokens = this._conversationTokens.get(conversationId) || 0;
    const ratio = tokens / this._contextLimit;

    if (ratio >= this._triggerRatio) {
      logger.info(
        { conversationId, tokens, limit: this._contextLimit, ratio: ratio.toFixed(2) },
        'Auto-compression triggered (F-35)'
      );
      return '/compress';
    }

    return null;
  }

  /**
   * Resets token count after compression (context is now smaller).
   */
  reset(conversationId) {
    // After compression, actual token count is much lower.
    // Set to a fraction of the original to avoid immediate re-trigger.
    const current = this._conversationTokens.get(conversationId) || 0;
    this._conversationTokens.set(conversationId, Math.floor(current * 0.3));
  }

  /**
   * Gets token count for a conversation.
   */
  getTokens(conversationId) {
    return this._conversationTokens.get(conversationId) || 0;
  }
}

module.exports = { AutoCompressor };
