'use strict';

const { execFile } = require('child_process');
const { logger } = require('../lib/logger');

/**
 * Updates installed harness apps — pulls latest image, recreates container,
 * preserves data volumes.
 */
class Updater {
  constructor(deps) {
    this.containerManager = deps.containerManager;
    this.registry = deps.registry;
    this.caddyRouter = deps.caddyRouter;
  }

  /**
   * Update an installed app to the latest image version.
   * @param {string} appName - App name
   * @param {string} userId - User ID
   * @returns {object} Update result
   */
  async update(appName, userId) {
    const log = logger.child({ appName, userId });

    // Get current app info from registry
    const apps = this.registry.listApps(userId);
    const app = apps.find(a => a.name === appName);
    if (!app) {
      throw new Error(`App "${appName}" not found`);
    }

    log.info({ image: app.image }, 'Updating harness app');

    // Pull latest image
    await this._pullImage(app.image);

    // Stop current container
    await this.containerManager.stop(appName);

    // Remove container (volumes preserved)
    await this.containerManager.remove(appName);

    // Recreate with same config
    const result = await this.containerManager.create({
      userId,
      name: appName,
      image: app.image,
      port: app.port,
      env: app.env || {},
      network: `gemini-${userId}`,
    });

    // Re-register Caddy route
    await this.caddyRouter.register(appName, result.port);

    // Update registry status
    this.registry.updateStatus(appName, 'running');

    log.info('Harness app updated');

    return {
      name: appName,
      status: 'running',
      url: app.url,
      containerId: result.containerId,
    };
  }

  /**
   * Pull the latest version of a Docker image.
   */
  _pullImage(image) {
    return new Promise((resolve, reject) => {
      execFile('docker', ['pull', image], {
        timeout: 300_000, // 5 min for large images
      }, (err, stdout, stderr) => {
        if (err) {
          logger.error({ err, image }, 'Image pull failed');
          return reject(new Error(`Failed to pull ${image}: ${stderr || err.message}`));
        }
        resolve(stdout);
      });
    });
  }
}

module.exports = { Updater };
