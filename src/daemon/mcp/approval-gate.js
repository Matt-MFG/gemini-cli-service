'use strict';

const { EventEmitter } = require('node:events');
const { logger } = require('../lib/logger');

/**
 * Approval gate (D-09, F-15).
 *
 * When the CLI calls the approval_request MCP tool, the daemon:
 * 1. Pushes the approval request to the user via SSE
 * 2. Holds the MCP tool response (blocking the CLI's ReAct loop)
 * 3. Waits for the user to approve or reject
 * 4. Returns the decision to the CLI so it can proceed or abort
 *
 * Supports configurable timeout (default 5 minutes).
 * If the user doesn't respond, the request is auto-rejected.
 */
class ApprovalGate extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._pending = new Map(); // requestId -> { resolve, reject, timer, metadata }
    this._timeoutMs = opts.timeoutMs || 5 * 60 * 1000; // 5 minutes
    this._counter = 0;
  }

  /**
   * Creates a pending approval request.
   * Returns a promise that resolves when the user responds.
   *
   * @param {object} opts
   * @param {string} opts.userId
   * @param {string} opts.conversationId
   * @param {string} opts.action - Short action name
   * @param {string} opts.description - Detailed description
   * @param {Array} [opts.changes] - Specific changes for review
   * @returns {Promise<{approved: boolean, note?: string}>}
   */
  request(opts) {
    const requestId = `approval-${++this._counter}-${Date.now()}`;
    const { userId, conversationId, action, description, changes } = opts;

    const log = logger.child({ requestId, userId, action });
    log.info('Approval requested; waiting for user response');

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        log.warn('Approval request timed out; auto-rejecting');
        this._pending.delete(requestId);
        resolve({ approved: false, note: 'Timed out waiting for approval' });
        this.emit('timeout', { requestId, userId, action });
      }, this._timeoutMs);

      this._pending.set(requestId, {
        resolve,
        reject,
        timer,
        metadata: { requestId, userId, conversationId, action, description, changes, createdAt: Date.now() },
      });

      // Emit event so the SSE stream can push it to the user
      this.emit('request', {
        requestId,
        userId,
        conversationId,
        action,
        description,
        changes,
      });
    });
  }

  /**
   * User approves a pending request.
   */
  approve(requestId, note) {
    const entry = this._pending.get(requestId);
    if (!entry) {
      logger.warn({ requestId }, 'Approval response for unknown/expired request');
      return false;
    }

    clearTimeout(entry.timer);
    this._pending.delete(requestId);
    entry.resolve({ approved: true, note });

    logger.info({ requestId, action: entry.metadata.action }, 'Approval granted');
    this.emit('approved', { requestId, ...entry.metadata });
    return true;
  }

  /**
   * User rejects a pending request.
   */
  reject(requestId, reason) {
    const entry = this._pending.get(requestId);
    if (!entry) {
      logger.warn({ requestId }, 'Rejection for unknown/expired request');
      return false;
    }

    clearTimeout(entry.timer);
    this._pending.delete(requestId);
    entry.resolve({ approved: false, note: reason || 'User rejected' });

    logger.info({ requestId, action: entry.metadata.action }, 'Approval rejected');
    this.emit('rejected', { requestId, ...entry.metadata });
    return true;
  }

  /**
   * Lists all pending approval requests for a user.
   */
  listPending(userId) {
    const pending = [];
    for (const [, entry] of this._pending) {
      if (!userId || entry.metadata.userId === userId) {
        pending.push({
          ...entry.metadata,
          ageMs: Date.now() - entry.metadata.createdAt,
        });
      }
    }
    return pending;
  }

  /**
   * Returns the number of pending requests.
   */
  get pendingCount() {
    return this._pending.size;
  }

  /**
   * Cancels all pending requests (for shutdown).
   */
  cancelAll() {
    for (const [requestId, entry] of this._pending) {
      clearTimeout(entry.timer);
      entry.resolve({ approved: false, note: 'System shutdown' });
    }
    this._pending.clear();
  }
}

module.exports = { ApprovalGate };
