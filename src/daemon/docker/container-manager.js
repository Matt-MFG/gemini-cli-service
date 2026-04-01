'use strict';

const Docker = require('dockerode');
const { logger } = require('../lib/logger');

/**
 * Docker container lifecycle manager (W10a).
 *
 * Creates, stops, restarts, and executes commands in containers.
 * Each user app gets its own container on a shared bridge network.
 * Traefik labels enable auto-discovery for reverse proxy routing.
 *
 * Satisfies: A-01 through A-10, F-18 through F-25.
 */
class ContainerManager {
  constructor(opts = {}) {
    this._docker = opts.docker || new Docker();
    this._domainSuffix = opts.domainSuffix || 'agent.example.com';
    this._defaultImage = opts.defaultImage || 'node:22-alpine';
    this._defaultCpus = opts.defaultCpus || 2;
    this._defaultMemory = opts.defaultMemory || 2 * 1024 * 1024 * 1024; // 2GB (A-09)
  }

  /**
   * Creates and starts a container for a user app.
   * Returns the container ID and public URL.
   *
   * @param {object} opts
   * @param {string} opts.userId
   * @param {string} opts.name - App name (used in URL)
   * @param {string} [opts.image] - Docker image
   * @param {number} [opts.internalPort] - Port the app listens on inside container
   * @param {string} [opts.startCommand] - Command to run
   * @param {object} [opts.env] - Environment variables
   * @param {string} [opts.networkName] - Docker network to join
   */
  async create(opts) {
    const {
      userId,
      name,
      image = this._defaultImage,
      internalPort = 3000,
      startCommand,
      env = {},
      networkName,
    } = opts;

    const containerName = this._containerName(userId, name);
    const url = this._appUrl(userId, name);
    const labels = this._buildTraefikLabels(containerName, url, internalPort);

    const log = logger.child({ userId, appName: name, containerName });
    log.info({ image, internalPort }, 'Creating container');

    // Build environment array
    const envArray = Object.entries({ ...env, PORT: String(internalPort) })
      .map(([k, v]) => `${k}=${v}`);

    // Container config
    const createOpts = {
      Image: image,
      name: containerName,
      Labels: labels,
      Env: envArray,
      ExposedPorts: { [`${internalPort}/tcp`]: {} },
      HostConfig: {
        NanoCpus: this._defaultCpus * 1e9, // A-09
        Memory: this._defaultMemory,        // A-09
        RestartPolicy: { Name: 'unless-stopped' },
      },
    };

    if (startCommand) {
      createOpts.Cmd = ['sh', '-c', startCommand];
    }

    // Pull image if not available
    await this._ensureImage(image);

    const container = await this._docker.createContainer(createOpts);

    // Connect to network if specified
    if (networkName) {
      const network = this._docker.getNetwork(networkName);
      await network.connect({ Container: container.id, EndpointConfig: { Aliases: [name] } });
    }

    await container.start();
    log.info({ containerId: container.id, url }, 'Container started');

    return { containerId: container.id, url, containerName };
  }

  /**
   * Stops a running container.
   */
  async stop(containerId) {
    const container = this._docker.getContainer(containerId);
    await container.stop({ t: 10 });
    logger.info({ containerId }, 'Container stopped');
  }

  /**
   * Restarts a container.
   */
  async restart(containerId) {
    const container = this._docker.getContainer(containerId);
    await container.restart({ t: 10 });
    logger.info({ containerId }, 'Container restarted');
  }

  /**
   * Executes a command inside a running container (E-04).
   * Returns { exitCode, stdout, stderr }.
   */
  async exec(containerId, command) {
    const container = this._docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: ['sh', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true });
    const { stdout, stderr } = await this._demuxStream(stream);

    const inspectResult = await exec.inspect();
    return {
      exitCode: inspectResult.ExitCode,
      stdout,
      stderr,
    };
  }

  /**
   * Gets recent logs from a container.
   */
  async logs(containerId, lines = 100) {
    const container = this._docker.getContainer(containerId);
    const logStream = await container.logs({
      stdout: true,
      stderr: true,
      tail: lines,
      timestamps: true,
    });
    return logStream.toString('utf8');
  }

  /**
   * Removes a container. Does NOT remove volumes (A-10).
   */
  async remove(containerId, force = false) {
    const container = this._docker.getContainer(containerId);
    await container.remove({ force, v: false }); // v:false preserves volumes (A-10)
    logger.info({ containerId }, 'Container removed');
  }

  /**
   * Lists all running containers for a user.
   */
  async listContainers(userId) {
    const containers = await this._docker.listContainers({
      all: true,
      filters: { label: [`gemini.user=${userId}`] },
    });
    return containers.map((c) => ({
      id: c.Id,
      name: c.Names[0]?.replace(/^\//, ''),
      image: c.Image,
      state: c.State,
      status: c.Status,
      labels: c.Labels,
    }));
  }

  /**
   * Creates or gets a Docker bridge network for a user (A-05).
   * Enables inter-container DNS resolution.
   */
  async ensureNetwork(userId) {
    const networkName = `gemini-${userId}`;
    try {
      const network = this._docker.getNetwork(networkName);
      await network.inspect();
      return networkName;
    } catch {
      await this._docker.createNetwork({
        Name: networkName,
        Driver: 'bridge',
        Labels: { 'gemini.user': userId },
      });
      logger.info({ networkName, userId }, 'Created user network');
      return networkName;
    }
  }

  /**
   * Creates a named volume for persistent data (A-08, A-10).
   */
  async ensureVolume(name) {
    try {
      const volume = this._docker.getVolume(name);
      await volume.inspect();
    } catch {
      await this._docker.createVolume({ Name: name, Labels: { 'gemini.managed': 'true' } });
      logger.info({ volume: name }, 'Created volume');
    }
    return name;
  }

  /**
   * Reconciles registry with actual Docker state on startup (D-01).
   * Returns list of containers found.
   */
  async reconcile() {
    const containers = await this._docker.listContainers({
      all: true,
      filters: { label: ['gemini.managed=true'] },
    });
    return containers.map((c) => ({
      id: c.Id,
      name: c.Names[0]?.replace(/^\//, ''),
      state: c.State,
      userId: c.Labels['gemini.user'],
      appName: c.Labels['gemini.app'],
    }));
  }

  // -- Private helpers --

  _containerName(userId, appName) {
    return `gemini-${userId}-${appName}`;
  }

  _appUrl(userId, appName) {
    return `https://${appName}.${userId}.${this._domainSuffix}`;
  }

  /**
   * Builds Traefik Docker labels for auto-discovery (P-01, P-04).
   */
  _buildTraefikLabels(containerName, url, internalPort) {
    const hostname = new URL(url).hostname;
    const routerName = containerName.replace(/[^a-zA-Z0-9-]/g, '-');

    return {
      'traefik.enable': 'true',
      [`traefik.http.routers.${routerName}.rule`]: `Host(\`${hostname}\`)`,
      [`traefik.http.routers.${routerName}.tls`]: 'true',
      [`traefik.http.routers.${routerName}.tls.certresolver`]: 'letsencrypt',
      [`traefik.http.services.${routerName}.loadbalancer.server.port`]: String(internalPort),
      // WebSocket support for HMR (P-04)
      [`traefik.http.middlewares.${routerName}-ws.headers.customrequestheaders.Connection`]: 'Upgrade',
      // Metadata
      'gemini.managed': 'true',
      'gemini.user': containerName.split('-')[1] || 'unknown',
      'gemini.app': containerName.split('-').slice(2).join('-') || 'unknown',
    };
  }

  async _ensureImage(image) {
    try {
      await this._docker.getImage(image).inspect();
    } catch {
      logger.info({ image }, 'Pulling Docker image');
      await new Promise((resolve, reject) => {
        this._docker.pull(image, (err, stream) => {
          if (err) return reject(err);
          this._docker.modem.followProgress(stream, (err2) => {
            if (err2) return reject(err2);
            resolve();
          });
        });
      });
    }
  }

  async _demuxStream(stream) {
    return new Promise((resolve) => {
      const stdout = [];
      const stderr = [];
      // Dockerode multiplexed stream: header (8 bytes) + payload
      stream.on('data', (chunk) => {
        // Simplified: treat all output as stdout
        stdout.push(chunk);
      });
      stream.on('end', () => {
        resolve({
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
      });
    });
  }
}

module.exports = { ContainerManager };
