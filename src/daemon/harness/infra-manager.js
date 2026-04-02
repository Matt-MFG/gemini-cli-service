'use strict';

const { execFile } = require('child_process');
const path = require('path');
const { logger } = require('../lib/logger');

const COMPOSE_FILE = path.resolve(__dirname, '../../../infra/harness/docker-compose.yml');
const PROJECT_NAME = 'gemini-harness';

/**
 * Manages the shared infrastructure harness (Postgres, Redis, MinIO, Authelia)
 * via docker compose.
 */
class InfraManager {
  constructor(config = {}) {
    this.pgPassword = config.pgPassword || process.env.HARNESS_PG_PASSWORD || 'harness-secret';
    this.redisPassword = config.redisPassword || process.env.HARNESS_REDIS_PASSWORD || 'harness-redis-secret';
    this.minioUser = config.minioUser || process.env.HARNESS_MINIO_USER || 'harness-minio';
    this.minioPassword = config.minioPassword || process.env.HARNESS_MINIO_PASSWORD || 'harness-minio-secret';
    this.domain = config.domain || process.env.HARNESS_DOMAIN || 'localhost';
    this._starting = false;
  }

  /**
   * Build the environment for docker compose.
   */
  _composeEnv() {
    return {
      ...process.env,
      HARNESS_PG_PASSWORD: this.pgPassword,
      HARNESS_REDIS_PASSWORD: this.redisPassword,
      HARNESS_MINIO_USER: this.minioUser,
      HARNESS_MINIO_PASSWORD: this.minioPassword,
      HARNESS_DOMAIN: this.domain,
    };
  }

  /**
   * Execute a docker compose command and return stdout.
   */
  _compose(args) {
    return new Promise((resolve, reject) => {
      const fullArgs = ['compose', '-f', COMPOSE_FILE, '-p', PROJECT_NAME, ...args];
      execFile('docker', fullArgs, {
        env: this._composeEnv(),
        timeout: 120_000,
      }, (err, stdout, stderr) => {
        if (err) {
          logger.error({ err, stderr, args }, 'docker compose failed');
          return reject(new Error(`docker compose ${args.join(' ')} failed: ${stderr || err.message}`));
        }
        resolve(stdout.trim());
      });
    });
  }

  /**
   * Start all infrastructure services.
   */
  async start() {
    if (this._starting) return;
    this._starting = true;
    try {
      logger.info('Starting infrastructure harness');
      await this._compose(['up', '-d', '--wait']);
      logger.info('Infrastructure harness started');
    } finally {
      this._starting = false;
    }
  }

  /**
   * Stop all infrastructure services (preserves data).
   */
  async stop() {
    logger.info('Stopping infrastructure harness');
    await this._compose(['stop']);
    logger.info('Infrastructure harness stopped');
  }

  /**
   * Destroy all infrastructure services and volumes.
   * WARNING: This deletes all data!
   */
  async destroy() {
    logger.info('Destroying infrastructure harness');
    await this._compose(['down', '-v']);
    logger.info('Infrastructure harness destroyed');
  }

  /**
   * Get the status of all infrastructure services.
   * Returns an object mapping service name to health state.
   */
  async status() {
    try {
      const output = await this._compose(['ps', '--format', 'json']);
      if (!output) return { running: false, services: {} };

      // docker compose ps --format json returns one JSON object per line
      const services = {};
      const lines = output.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const svc = JSON.parse(line);
          services[svc.Service || svc.Name] = {
            name: svc.Name,
            state: svc.State,
            health: svc.Health || 'unknown',
            status: svc.Status,
            ports: svc.Publishers || [],
          };
        } catch (e) {
          // Skip unparseable lines
        }
      }

      const allHealthy = Object.values(services).every(
        s => s.state === 'running' && (s.health === 'healthy' || s.health === 'unknown')
      );

      return {
        running: Object.keys(services).length > 0,
        healthy: allHealthy,
        services,
      };
    } catch (err) {
      return { running: false, healthy: false, services: {}, error: err.message };
    }
  }

  /**
   * Check if all infrastructure services are healthy.
   */
  async isReady() {
    const s = await this.status();
    return s.running && s.healthy;
  }

  /**
   * Get connection info for all infrastructure services.
   * Used by the installer to configure app containers.
   */
  getConnectionInfo() {
    return {
      postgres: {
        host: 'harness-postgres',
        port: 5432,
        user: 'harness',
        password: this.pgPassword,
        url: `postgresql://harness:${this.pgPassword}@harness-postgres:5432`,
      },
      redis: {
        host: 'harness-redis',
        port: 6379,
        password: this.redisPassword,
        url: `redis://:${this.redisPassword}@harness-redis:6379`,
      },
      minio: {
        host: 'harness-minio',
        port: 9000,
        consolePort: 9001,
        user: this.minioUser,
        password: this.minioPassword,
        url: `http://harness-minio:9000`,
      },
      authelia: {
        host: 'harness-authelia',
        port: 9091,
        url: `http://harness-authelia:9091`,
      },
    };
  }
}

module.exports = { InfraManager };
