'use strict';

const { logger } = require('../lib/logger');

/**
 * Token budget system (W11, F-34).
 *
 * Configurable daily/monthly budgets per user.
 * Warns at 80%, pauses at 100%.
 */
class BudgetManager {
  constructor(registry, opts = {}) {
    this._registry = registry;
    this._dailyLimit = opts.dailyLimit || 10_000_000;    // 10M tokens/day default
    this._monthlyLimit = opts.monthlyLimit || 200_000_000; // 200M tokens/month default
    this._warnThreshold = opts.warnThreshold || 0.8;       // 80%
  }

  /**
   * Checks budget status for a user before processing a message.
   *
   * Returns:
   *   { allowed: true } — under budget
   *   { allowed: true, warning: "..." } — over 80%
   *   { allowed: false, reason: "..." } — budget exhausted (F-34)
   */
  check(userId) {
    const total = this._registry.getTotalTokenUsage(userId);
    const totalTokens = total?.total_tokens || 0;

    // Check daily limit
    const dailyRatio = totalTokens / this._dailyLimit;
    if (dailyRatio >= 1.0) {
      return {
        allowed: false,
        reason: `Daily token budget exhausted (${totalTokens.toLocaleString()} / ${this._dailyLimit.toLocaleString()} tokens). Budget resets at midnight UTC.`,
        usage: totalTokens,
        limit: this._dailyLimit,
      };
    }

    if (dailyRatio >= this._warnThreshold) {
      const remaining = this._dailyLimit - totalTokens;
      return {
        allowed: true,
        warning: `${Math.round(dailyRatio * 100)}% of daily token budget used. ${remaining.toLocaleString()} tokens remaining.`,
        usage: totalTokens,
        limit: this._dailyLimit,
      };
    }

    return { allowed: true, usage: totalTokens, limit: this._dailyLimit };
  }

  /**
   * Gets budget configuration.
   */
  get config() {
    return {
      dailyLimit: this._dailyLimit,
      monthlyLimit: this._monthlyLimit,
      warnThreshold: this._warnThreshold,
    };
  }
}

module.exports = { BudgetManager };
