'use strict';

const { execFile } = require('child_process');
const { logger } = require('../lib/logger');

/**
 * Creates databases and users in the harness Postgres instance
 * via `docker exec` into the harness-postgres container.
 */
class PostgresClient {
  constructor(infraManager) {
    this.infra = infraManager;
  }

  /**
   * Create a database if it doesn't already exist.
   */
  async createDatabase(dbName) {
    const conn = this.infra.getConnectionInfo().postgres;

    // Check if database exists
    const exists = await this._exec([
      'psql', '-U', conn.user, '-d', 'harness', '-tAc',
      `SELECT 1 FROM pg_database WHERE datname='${dbName}'`,
    ]);

    if (exists.trim() === '1') {
      logger.info({ dbName }, 'Database already exists');
      return;
    }

    // Create database
    await this._exec([
      'psql', '-U', conn.user, '-d', 'harness', '-c',
      `CREATE DATABASE "${dbName}" OWNER "${conn.user}"`,
    ]);

    logger.info({ dbName }, 'Created harness database');
  }

  /**
   * Drop a database (for uninstall with data deletion).
   */
  async dropDatabase(dbName) {
    const conn = this.infra.getConnectionInfo().postgres;

    // Terminate connections first
    await this._exec([
      'psql', '-U', conn.user, '-d', 'harness', '-c',
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}' AND pid <> pg_backend_pid()`,
    ]).catch(() => {});

    await this._exec([
      'psql', '-U', conn.user, '-d', 'harness', '-c',
      `DROP DATABASE IF EXISTS "${dbName}"`,
    ]);

    logger.info({ dbName }, 'Dropped harness database');
  }

  /**
   * List all harness databases.
   */
  async listDatabases() {
    const conn = this.infra.getConnectionInfo().postgres;
    const output = await this._exec([
      'psql', '-U', conn.user, '-d', 'harness', '-tAc',
      `SELECT datname FROM pg_database WHERE datistemplate = false AND datname != 'postgres' AND datname != 'harness'`,
    ]);
    return output.trim().split('\n').filter(Boolean);
  }

  /**
   * Execute a command inside the harness-postgres container.
   */
  _exec(command) {
    return new Promise((resolve, reject) => {
      execFile('docker', ['exec', 'harness-postgres', ...command], {
        timeout: 30_000,
        env: { ...process.env, PGPASSWORD: this.infra.getConnectionInfo().postgres.password },
      }, (err, stdout, stderr) => {
        if (err) {
          logger.error({ err, stderr, command: command.join(' ') }, 'Postgres exec failed');
          return reject(new Error(stderr || err.message));
        }
        resolve(stdout);
      });
    });
  }
}

module.exports = { PostgresClient };
