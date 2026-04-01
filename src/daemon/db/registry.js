'use strict';

const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { logger } = require('../lib/logger');

/**
 * SQLite-backed app registry (D-10).
 *
 * Stores metadata about user applications (containers).
 * Survives daemon restarts. On startup, reconciles with actual Docker state.
 * Also tracks token usage (F-33) and audit logs (F-32).
 */
class AppRegistry {
  constructor(dbPath) {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });

    this._db = new Database(dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');

    this._initSchema();
    logger.info({ dbPath }, 'App registry initialized');
  }

  _initSchema() {
    const schema = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf8'
    );
    this._db.exec(schema);
  }

  // -- App CRUD --

  createApp({ userId, name, image, internalPort, url, containerId, startCommand, env }) {
    const id = crypto.randomUUID();
    const stmt = this._db.prepare(`
      INSERT INTO apps (id, user_id, name, image, internal_port, url, container_id, status, start_command, env_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?)
    `);
    stmt.run(id, userId, name, image || 'node:22-alpine', internalPort || 3000, url, containerId, startCommand, JSON.stringify(env || {}));
    return this.getApp(id);
  }

  getApp(id) {
    const row = this._db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
    return row ? this._deserializeApp(row) : null;
  }

  getAppByName(userId, name) {
    const row = this._db.prepare('SELECT * FROM apps WHERE user_id = ? AND name = ?').get(userId, name);
    return row ? this._deserializeApp(row) : null;
  }

  listApps(userId) {
    const rows = userId
      ? this._db.prepare('SELECT * FROM apps WHERE user_id = ? ORDER BY created_at DESC').all(userId)
      : this._db.prepare('SELECT * FROM apps ORDER BY created_at DESC').all();
    return rows.map((r) => this._deserializeApp(r));
  }

  updateAppStatus(id, status, containerId) {
    const updates = ['status = ?', 'updated_at = datetime(\'now\')'];
    const params = [status];

    if (containerId !== undefined) {
      updates.push('container_id = ?');
      params.push(containerId);
    }

    params.push(id);
    this._db.prepare(`UPDATE apps SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    return this.getApp(id);
  }

  updateAppUrl(id, url) {
    this._db.prepare('UPDATE apps SET url = ?, updated_at = datetime(\'now\') WHERE id = ?').run(url, id);
  }

  deleteApp(id) {
    this._db.prepare('DELETE FROM apps WHERE id = ?').run(id);
  }

  // -- Token Usage --

  recordTokenUsage({ userId, conversationId, inputTokens, outputTokens, cachedTokens, totalTokens, durationMs }) {
    this._db.prepare(`
      INSERT INTO token_usage (user_id, conversation_id, input_tokens, output_tokens, cached_tokens, total_tokens, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, conversationId, inputTokens || 0, outputTokens || 0, cachedTokens || 0, totalTokens || 0, durationMs || 0);
  }

  getTokenUsage(userId) {
    return this._db.prepare(`
      SELECT
        conversation_id,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(cached_tokens) AS cached_tokens,
        SUM(total_tokens) AS total_tokens,
        COUNT(*) AS invocations
      FROM token_usage
      WHERE user_id = ?
      GROUP BY conversation_id
    `).all(userId);
  }

  getTotalTokenUsage(userId) {
    return this._db.prepare(`
      SELECT
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(cached_tokens) AS cached_tokens,
        SUM(total_tokens) AS total_tokens,
        COUNT(*) AS invocations
      FROM token_usage
      WHERE user_id = ?
    `).get(userId);
  }

  // -- Audit Log --

  logToolExecution({ userId, sessionId, toolName, args, result }) {
    this._db.prepare(`
      INSERT INTO audit_log (user_id, session_id, tool_name, args_json, result_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, sessionId, toolName, JSON.stringify(args), JSON.stringify(result));
  }

  // -- Helpers --

  _deserializeApp(row) {
    return {
      ...row,
      env: JSON.parse(row.env_json || '{}'),
      volumeNames: JSON.parse(row.volume_names || '[]'),
    };
  }

  close() {
    this._db.close();
  }
}

module.exports = { AppRegistry };
