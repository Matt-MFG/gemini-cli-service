'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../lib/logger');

const ENV_DIR = process.env.HARNESS_ENV_DIR || '/etc/harness/env.d';

/**
 * Manages per-app environment files in /etc/harness/env.d/.
 * These files are sourced into the CLI process environment
 * so the agent has access to app credentials and URLs.
 */
class EnvManager {
  constructor(envDir) {
    this.envDir = envDir || ENV_DIR;
  }

  /**
   * Ensure the env directory exists.
   */
  ensureDir() {
    try {
      fs.mkdirSync(this.envDir, { recursive: true });
    } catch (err) {
      logger.warn({ err: err.message, dir: this.envDir }, 'Cannot create harness env dir');
    }
  }

  /**
   * Write an env file for an app.
   * @param {string} appName - App name (used as filename)
   * @param {object} envVars - Key-value pairs of environment variables
   */
  writeEnvFile(appName, envVars) {
    this.ensureDir();
    const filePath = path.join(this.envDir, `${appName}.env`);
    const lines = Object.entries(envVars)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}=${v}`);

    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    logger.info({ appName, file: filePath, varCount: lines.length }, 'Wrote harness env file');
  }

  /**
   * Remove an app's env file.
   */
  removeEnvFile(appName) {
    const filePath = path.join(this.envDir, `${appName}.env`);
    try {
      fs.unlinkSync(filePath);
      logger.info({ appName }, 'Removed harness env file');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err: err.message, appName }, 'Failed to remove env file');
      }
    }
  }

  /**
   * Load all env files and return merged environment variables.
   * This is called by the CLI spawner before launching a CLI process.
   */
  loadAll() {
    const merged = {};

    try {
      if (!fs.existsSync(this.envDir)) return merged;

      const files = fs.readdirSync(this.envDir)
        .filter(f => f.endsWith('.env'))
        .sort();

      for (const file of files) {
        const filePath = path.join(this.envDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
              merged[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
            }
          }
        } catch (err) {
          logger.warn({ err: err.message, file }, 'Failed to read env file');
        }
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to read harness env dir');
    }

    return merged;
  }

  /**
   * List all env files and their contents.
   */
  list() {
    try {
      if (!fs.existsSync(this.envDir)) return [];
      return fs.readdirSync(this.envDir)
        .filter(f => f.endsWith('.env'))
        .map(f => ({
          app: f.replace('.env', ''),
          file: path.join(this.envDir, f),
        }));
    } catch {
      return [];
    }
  }
}

module.exports = { EnvManager };
