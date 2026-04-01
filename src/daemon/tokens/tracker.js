'use strict';

const { EVENT_TYPES } = require('../lib/constants');
const { logger } = require('../lib/logger');

/**
 * Token usage tracker (W11, F-33).
 *
 * Extracts token counts from stream-json result events and records
 * them in the app registry. Provides per-conversation and total usage.
 */
class TokenTracker {
  constructor(registry) {
    this._registry = registry;
  }

  /**
   * Processes a stream-json event and records token usage if it's a result event.
   */
  recordFromEvent(userId, conversationId, event) {
    if (event.type !== EVENT_TYPES.RESULT) return null;

    const usage = {
      userId,
      conversationId,
      inputTokens: event.input_tokens || 0,
      outputTokens: event.output_tokens || 0,
      cachedTokens: event.cached_tokens || 0,
      totalTokens: event.total_tokens || 0,
      durationMs: event.duration_ms || 0,
    };

    this._registry.recordTokenUsage(usage);
    logger.debug({ userId, conversationId, totalTokens: usage.totalTokens }, 'Recorded token usage');
    return usage;
  }

  /**
   * Gets per-conversation token breakdown for a user (F-33).
   */
  getPerConversation(userId) {
    return this._registry.getTokenUsage(userId);
  }

  /**
   * Gets total token usage for a user.
   */
  getTotal(userId) {
    return this._registry.getTotalTokenUsage(userId);
  }

  /**
   * Formats a cost report for display.
   */
  formatCostReport(userId, costPerMillionTokens = 0.075) {
    const total = this.getTotal(userId);
    const perConv = this.getPerConversation(userId);

    if (!total || !total.total_tokens) {
      return { total: { tokens: 0, cost: '$0.00' }, conversations: [] };
    }

    const totalCost = (total.total_tokens / 1_000_000) * costPerMillionTokens;

    return {
      total: {
        inputTokens: total.input_tokens,
        outputTokens: total.output_tokens,
        cachedTokens: total.cached_tokens,
        totalTokens: total.total_tokens,
        invocations: total.invocations,
        estimatedCost: `$${totalCost.toFixed(4)}`,
      },
      conversations: perConv.map((c) => ({
        conversationId: c.conversation_id,
        totalTokens: c.total_tokens,
        invocations: c.invocations,
        estimatedCost: `$${((c.total_tokens / 1_000_000) * costPerMillionTokens).toFixed(4)}`,
      })),
    };
  }
}

module.exports = { TokenTracker };
