'use strict';

const Docker = require('dockerode');
const { logger } = require('../lib/logger');

/**
 * Per-user Docker bridge network manager (A-05).
 *
 * All user containers connect to the same bridge network,
 * enabling inter-container DNS resolution (e.g., api-server can reach postgres:5432).
 */
class NetworkManager {
  constructor(opts = {}) {
    this._docker = opts.docker || new Docker();
  }

  /**
   * Creates or gets a bridge network for a user.
   * Idempotent — safe to call multiple times.
   */
  async ensure(userId) {
    const name = this.networkName(userId);
    try {
      const network = this._docker.getNetwork(name);
      await network.inspect();
      return name;
    } catch {
      await this._docker.createNetwork({
        Name: name,
        Driver: 'bridge',
        Labels: { 'gemini.user': userId, 'gemini.managed': 'true' },
      });
      logger.info({ network: name, userId }, 'Created user network');
      return name;
    }
  }

  /**
   * Connects a container to the user's network with a DNS alias.
   */
  async connect(userId, containerId, alias) {
    const name = this.networkName(userId);
    const network = this._docker.getNetwork(name);
    await network.connect({
      Container: containerId,
      EndpointConfig: { Aliases: alias ? [alias] : [] },
    });
  }

  /**
   * Standard network name for a user.
   */
  networkName(userId) {
    return `gemini-${userId}`;
  }
}

module.exports = { NetworkManager };
