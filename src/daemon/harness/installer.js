'use strict';

const { logger } = require('../lib/logger');

/**
 * App installer — orchestrates the full install flow:
 * 1. Validate harness requirements
 * 2. Create Postgres database (if needed)
 * 3. Create MinIO bucket (if needed)
 * 4. Register SSO client (if needed)
 * 5. Resolve environment variables
 * 6. Create container via ContainerManager
 * 7. Register Caddy route
 * 8. Write harness env file
 * 9. Install convenience aliases
 * 10. Update GEMINI.md
 */
class Installer {
  constructor(deps) {
    this.infraManager = deps.infraManager;
    this.registryManager = deps.registryManager;
    this.containerManager = deps.containerManager;
    this.networkManager = deps.networkManager;
    this.caddyRouter = deps.caddyRouter;
    this.envManager = deps.envManager;
    this.aliasManager = deps.aliasManager;
    this.geminiMdManager = deps.geminiMdManager;
    this.postgresClient = deps.postgresClient;
    this.minioClient = deps.minioClient;
    this.ssoClient = deps.ssoClient;
    this.registry = deps.registry;
    this.domain = deps.domain || 'localhost';
  }

  /**
   * Install a known app from the registry.
   * @param {string} appName - Name from catalog
   * @param {string} userId - User ID for container ownership
   * @param {function} [onProgress] - Progress callback (step, message)
   * @returns {object} Install result with URL and status
   */
  async install(appName, userId, onProgress) {
    const progress = onProgress || (() => {});
    const log = logger.child({ appName, userId });

    // 1. Look up app in catalog
    const appConfig = this.registryManager.getApp(appName);
    if (!appConfig) {
      throw new Error(`App "${appName}" not found in registry. Use /registry/apps to see available apps.`);
    }

    log.info({ category: appConfig.category }, 'Starting harness app install');
    progress('lookup', `Found ${appConfig.displayName} in registry`);

    // 2. Ensure infrastructure is running
    const ready = await this.infraManager.isReady();
    if (!ready) {
      progress('infra', 'Starting infrastructure harness...');
      await this.infraManager.start();
    }
    progress('infra', 'Infrastructure ready');

    const connectionInfo = this.infraManager.getConnectionInfo();
    const requires = appConfig.harness?.requires || [];

    // 3. Create Postgres database (if required)
    if (requires.includes('postgres') && appConfig.harness.postgres) {
      const dbName = appConfig.harness.postgres.database;
      progress('postgres', `Creating database "${dbName}"...`);
      await this.postgresClient.createDatabase(dbName);
      progress('postgres', `Database "${dbName}" ready`);
    }

    // 4. Create MinIO bucket (if required)
    if (requires.includes('minio') && appConfig.harness.minio) {
      const bucket = appConfig.harness.minio.bucket;
      progress('minio', `Creating storage bucket "${bucket}"...`);
      await this.minioClient.createBucket(bucket);
      progress('minio', `Bucket "${bucket}" ready`);
    }

    // 5. Register SSO client (if required)
    let ssoSecret = null;
    if (requires.includes('sso') && appConfig.harness.sso) {
      progress('sso', 'Registering SSO client...');
      const result = await this.ssoClient.registerClient(
        appConfig.harness.sso.clientId,
        `http://${appName}.${this.domain}${appConfig.harness.sso.redirectUri}`,
        appConfig.harness.sso.scopes || ['openid', 'profile', 'email']
      );
      ssoSecret = result.clientSecret;
      progress('sso', 'SSO client registered');
    }

    // 6. Resolve environment variables
    progress('env', 'Resolving configuration...');
    const resolvedEnv = this.registryManager.resolveEnv(appConfig, connectionInfo, this.domain);

    // Override SSO secret if we generated one
    if (ssoSecret && resolvedEnv.OIDC_CLIENT_SECRET) {
      resolvedEnv.OIDC_CLIENT_SECRET = ssoSecret;
    }

    // 7. Ensure user network exists and includes harness-net
    progress('network', 'Configuring network...');
    await this.networkManager.ensureUserNetwork(userId);

    // 8. Create container
    progress('container', `Creating ${appConfig.displayName} container...`);
    const containerResult = await this.containerManager.create({
      userId,
      name: appName,
      image: appConfig.image,
      port: appConfig.ports?.internal || 3000,
      env: resolvedEnv,
      volumes: appConfig.volumes,
      network: `gemini-${userId}`,
    });

    // Connect container to harness-net for service discovery
    try {
      await this._connectToHarnessNet(containerResult.containerId);
    } catch (err) {
      log.warn({ err: err.message }, 'Could not connect to harness-net');
    }

    progress('container', 'Container started');

    // 9. Register Caddy route
    progress('routing', 'Setting up URL routing...');
    const url = await this.caddyRouter.register(appName, containerResult.port);
    progress('routing', `Available at ${url}`);

    // 10. Write harness env file for CLI
    progress('cli', 'Configuring CLI tools...');
    const cliEnv = this.registryManager.getCliEnvVars(appConfig, resolvedEnv, this.domain);
    this.envManager.writeEnvFile(appName, cliEnv);

    // 11. Install aliases
    if (appConfig.cli?.aliases) {
      this.aliasManager.installAliases(appName, appConfig.cli.aliases);
    }

    // 12. Update GEMINI.md
    progress('docs', 'Updating agent guidance...');
    const docConfig = this.registryManager.getAppDocumentation(appConfig, resolvedEnv, this.domain);
    const section = this.geminiMdManager.generateSection(appName, docConfig);
    await this.geminiMdManager.addAppSection(appName, section);

    // 13. Record in registry
    if (this.registry) {
      try {
        this.registry.createApp({
          userId,
          name: appName,
          image: appConfig.image,
          url,
          containerId: containerResult.containerId,
          status: 'running',
        });
      } catch (err) {
        log.warn({ err: err.message }, 'Failed to record in app registry');
      }
    }

    progress('done', `${appConfig.displayName} installed successfully`);

    log.info({ url, containerId: containerResult.containerId }, 'Harness app installed');

    return {
      name: appName,
      displayName: appConfig.displayName,
      url,
      containerId: containerResult.containerId,
      status: 'running',
      category: appConfig.category,
    };
  }

  /**
   * Connect a container to the harness-net network.
   */
  async _connectToHarnessNet(containerId) {
    const Docker = require('dockerode');
    const docker = new Docker();
    const network = docker.getNetwork('harness-net');
    await network.connect({ Container: containerId });
  }
}

module.exports = { Installer };
