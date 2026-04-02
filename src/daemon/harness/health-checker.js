'use strict';

const { execFile } = require('child_process');
const { logger } = require('../lib/logger');

/**
 * Health checker for harness infrastructure services.
 * Uses docker exec to verify service connectivity.
 */
class HealthChecker {
  constructor(infraManager) {
    this.infra = infraManager;
    this._interval = null;
  }

  /**
   * Check if Postgres is accepting connections.
   */
  async checkPostgres() {
    return this._dockerExec('harness-postgres', [
      'pg_isready', '-U', 'harness',
    ]);
  }

  /**
   * Check if Redis is responding to PING.
   */
  async checkRedis() {
    const conn = this.infra.getConnectionInfo().redis;
    return this._dockerExec('harness-redis', [
      'redis-cli', '-a', conn.password, 'ping',
    ]);
  }

  /**
   * Check if MinIO is healthy.
   */
  async checkMinio() {
    return this._dockerExec('harness-minio', [
      'mc', 'ready', 'local',
    ]);
  }

  /**
   * Check if Authelia is responding.
   */
  async checkAuthelia() {
    return this._dockerExec('harness-authelia', [
      'wget', '--quiet', '--tries=1', '--spider', 'http://localhost:9091/api/health',
    ]);
  }

  /**
   * Run all health checks and return results.
   */
  async checkAll() {
    const results = {};
    const checks = [
      { name: 'postgres', fn: () => this.checkPostgres() },
      { name: 'redis', fn: () => this.checkRedis() },
      { name: 'minio', fn: () => this.checkMinio() },
      { name: 'authelia', fn: () => this.checkAuthelia() },
    ];

    await Promise.all(checks.map(async ({ name, fn }) => {
      try {
        const ok = await fn();
        results[name] = { healthy: ok, error: null };
      } catch (err) {
        results[name] = { healthy: false, error: err.message };
      }
    }));

    return results;
  }

  /**
   * Start periodic health checking.
   */
  startMonitoring(intervalMs = 30_000) {
    this.stopMonitoring();
    this._interval = setInterval(async () => {
      try {
        const results = await this.checkAll();
        const unhealthy = Object.entries(results)
          .filter(([, v]) => !v.healthy)
          .map(([k]) => k);

        if (unhealthy.length > 0) {
          logger.warn({ unhealthy }, 'Harness services unhealthy');
        }
      } catch (err) {
        logger.error({ err }, 'Health check failed');
      }
    }, intervalMs);
  }

  /**
   * Stop periodic health checking.
   */
  stopMonitoring() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  /**
   * Execute a command in a Docker container and return success/failure.
   */
  _dockerExec(container, command) {
    return new Promise((resolve) => {
      execFile('docker', ['exec', container, ...command], {
        timeout: 10_000,
      }, (err) => {
        resolve(!err);
      });
    });
  }
}

module.exports = { HealthChecker };
