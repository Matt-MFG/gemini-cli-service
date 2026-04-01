'use strict';

const Docker = require('dockerode');
const { logger } = require('../lib/logger');

/**
 * Named volume lifecycle manager (A-08, A-10).
 *
 * Creates named volumes for database data dirs.
 * Volumes are NOT deleted on container removal — data persists across restarts.
 */
class VolumeManager {
  constructor(opts = {}) {
    this._docker = opts.docker || new Docker();
  }

  /**
   * Creates or gets a named volume.
   * Idempotent — safe to call multiple times.
   */
  async ensure(name, labels = {}) {
    try {
      const volume = this._docker.getVolume(name);
      await volume.inspect();
      return name;
    } catch {
      await this._docker.createVolume({
        Name: name,
        Labels: { 'gemini.managed': 'true', ...labels },
      });
      logger.info({ volume: name }, 'Created volume');
      return name;
    }
  }

  /**
   * Generates a standard volume name for a user's app data.
   */
  volumeName(userId, appName, purpose = 'data') {
    return `gemini-${userId}-${appName}-${purpose}`;
  }

  /**
   * Lists all managed volumes.
   */
  async list() {
    const result = await this._docker.listVolumes({
      filters: { label: ['gemini.managed=true'] },
    });
    return (result.Volumes || []).map((v) => ({
      name: v.Name,
      labels: v.Labels,
      createdAt: v.CreatedAt,
    }));
  }

  /**
   * Removes a volume. Only call when user explicitly deletes data.
   */
  async remove(name) {
    const volume = this._docker.getVolume(name);
    await volume.remove();
    logger.info({ volume: name }, 'Removed volume');
  }
}

module.exports = { VolumeManager };
