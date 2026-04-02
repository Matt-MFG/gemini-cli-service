'use strict';

const { execFile } = require('child_process');
const { logger } = require('../lib/logger');

/**
 * Creates buckets and access keys in the harness MinIO instance
 * via `docker exec` with the `mc` (MinIO Client) CLI.
 */
class MinioClient {
  constructor(infraManager) {
    this.infra = infraManager;
    this._aliasConfigured = false;
  }

  /**
   * Ensure the mc alias is configured inside the container.
   */
  async _ensureAlias() {
    if (this._aliasConfigured) return;
    const conn = this.infra.getConnectionInfo().minio;
    await this._exec([
      'mc', 'alias', 'set', 'local',
      'http://localhost:9000',
      conn.user, conn.password,
    ]);
    this._aliasConfigured = true;
  }

  /**
   * Create a bucket if it doesn't already exist.
   */
  async createBucket(bucketName) {
    await this._ensureAlias();

    // Check if bucket exists
    const exists = await this._execSafe([
      'mc', 'ls', `local/${bucketName}`,
    ]);

    if (exists) {
      logger.info({ bucketName }, 'Bucket already exists');
      return;
    }

    await this._exec([
      'mc', 'mb', `local/${bucketName}`,
    ]);

    logger.info({ bucketName }, 'Created harness bucket');
  }

  /**
   * Remove a bucket (for uninstall with data deletion).
   */
  async removeBucket(bucketName) {
    await this._ensureAlias();
    await this._exec([
      'mc', 'rb', '--force', `local/${bucketName}`,
    ]);
    logger.info({ bucketName }, 'Removed harness bucket');
  }

  /**
   * List all harness buckets.
   */
  async listBuckets() {
    await this._ensureAlias();
    const output = await this._exec(['mc', 'ls', 'local']);
    return output.trim().split('\n')
      .filter(Boolean)
      .map(line => {
        const match = line.match(/\S+\s+\d+B?\s+(.+)\//);
        return match ? match[1] : line.trim();
      })
      .filter(Boolean);
  }

  /**
   * Execute a command inside the harness-minio container.
   */
  _exec(command) {
    return new Promise((resolve, reject) => {
      execFile('docker', ['exec', 'harness-minio', ...command], {
        timeout: 30_000,
      }, (err, stdout, stderr) => {
        if (err) {
          logger.error({ err, stderr }, 'MinIO exec failed');
          return reject(new Error(stderr || err.message));
        }
        resolve(stdout);
      });
    });
  }

  /**
   * Execute a command, returning true on success, false on failure.
   */
  async _execSafe(command) {
    try {
      await this._exec(command);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { MinioClient };
