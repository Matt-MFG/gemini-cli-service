'use strict';

const { execFile } = require('child_process');
const { logger } = require('../lib/logger');

/**
 * Cloud context — wraps gcloud, bq, gsutil CLI tools
 * so the agent can reach beyond the VM into GCP services.
 * P3-58 through P3-61
 */
class CloudContext {
  /**
   * Run a gcloud command and return the output.
   */
  async gcloud(args) {
    return this._exec('gcloud', args);
  }

  /**
   * Run a bq (BigQuery) command and return the output.
   */
  async bq(args) {
    return this._exec('bq', args);
  }

  /**
   * Run a gsutil command and return the output.
   */
  async gsutil(args) {
    return this._exec('gsutil', args);
  }

  /**
   * Check which cloud CLI tools are available on the system.
   */
  async availableTools() {
    const tools = {};
    for (const tool of ['gcloud', 'bq', 'gsutil', 'kubectl']) {
      try {
        await this._exec(tool, ['--version']);
        tools[tool] = true;
      } catch {
        tools[tool] = false;
      }
    }
    return tools;
  }

  /**
   * Get the current GCP project and account.
   */
  async getContext() {
    try {
      const project = await this._exec('gcloud', ['config', 'get-value', 'project']);
      const account = await this._exec('gcloud', ['config', 'get-value', 'account']);
      return {
        project: project.trim(),
        account: account.trim(),
        available: true,
      };
    } catch {
      return { project: null, account: null, available: false };
    }
  }

  /**
   * Execute a CLI command and return stdout.
   */
  _exec(command, args) {
    return new Promise((resolve, reject) => {
      execFile(command, args, {
        timeout: 60_000,
        env: process.env,
      }, (err, stdout, stderr) => {
        if (err) {
          logger.debug({ command, args, stderr }, 'Cloud CLI command failed');
          return reject(new Error(stderr || err.message));
        }
        resolve(stdout);
      });
    });
  }
}

module.exports = { CloudContext };
