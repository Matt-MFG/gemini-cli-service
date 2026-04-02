'use strict';

const { logger } = require('../lib/logger');

/**
 * Uninstalls harness apps — stops container, optionally drops database/bucket,
 * removes Caddy route, cleans up env files and GEMINI.md.
 */
class Uninstaller {
  constructor(deps) {
    this.containerManager = deps.containerManager;
    this.caddyRouter = deps.caddyRouter;
    this.envManager = deps.envManager;
    this.aliasManager = deps.aliasManager;
    this.geminiMdManager = deps.geminiMdManager;
    this.postgresClient = deps.postgresClient;
    this.minioClient = deps.minioClient;
    this.ssoClient = deps.ssoClient;
    this.registryManager = deps.registryManager;
    this.registry = deps.registry;
  }

  /**
   * Uninstall an app. Data preserved by default (P3-16).
   * @param {string} appName - App name
   * @param {string} userId - User ID
   * @param {object} [opts] - Options
   * @param {boolean} [opts.deleteData] - Also drop database, bucket, SSO client (P3-17)
   */
  async uninstall(appName, userId, opts = {}) {
    const log = logger.child({ appName, userId, deleteData: opts.deleteData });
    log.info('Uninstalling harness app');

    // Stop and remove container
    try {
      await this.containerManager.stop(appName);
      await this.containerManager.remove(appName);
    } catch (err) {
      log.warn({ err: err.message }, 'Container cleanup error (may already be removed)');
    }

    // Remove Caddy route
    try {
      await this.caddyRouter.unregister(appName);
    } catch (err) {
      log.warn({ err: err.message }, 'Caddy route cleanup error');
    }

    // Remove env file
    this.envManager.removeEnvFile(appName);

    // Remove aliases
    const appConfig = this.registryManager.getApp(appName);
    if (appConfig?.cli?.aliases) {
      this.aliasManager.removeAliases(appName, appConfig.cli.aliases);
    }

    // Remove GEMINI.md section
    await this.geminiMdManager.removeAppSection(appName);

    // P3-17: Full deletion only on explicit request
    if (opts.deleteData && appConfig) {
      const requires = appConfig.harness?.requires || [];

      if (requires.includes('postgres') && appConfig.harness?.postgres?.database) {
        try {
          await this.postgresClient.dropDatabase(appConfig.harness.postgres.database);
        } catch (err) {
          log.warn({ err: err.message }, 'Database drop error');
        }
      }

      if (requires.includes('minio') && appConfig.harness?.minio?.bucket) {
        try {
          await this.minioClient.removeBucket(appConfig.harness.minio.bucket);
        } catch (err) {
          log.warn({ err: err.message }, 'Bucket removal error');
        }
      }

      if (requires.includes('sso') && appConfig.harness?.sso?.clientId) {
        try {
          await this.ssoClient.removeClient(appConfig.harness.sso.clientId);
        } catch (err) {
          log.warn({ err: err.message }, 'SSO client removal error');
        }
      }
    }

    // Update registry
    if (this.registry) {
      try {
        this.registry.updateStatus(appName, 'removed');
      } catch { /* ignore */ }
    }

    log.info({ dataDeleted: !!opts.deleteData }, 'Harness app uninstalled');

    return { name: appName, status: 'removed', dataDeleted: !!opts.deleteData };
  }
}

module.exports = { Uninstaller };
