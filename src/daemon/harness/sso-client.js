'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { logger } = require('../lib/logger');

const AUTHELIA_CONFIG_PATH = path.resolve(__dirname, '../../../infra/harness/authelia/configuration.yml');

/**
 * Manages Authelia OIDC client registration.
 * Authelia uses file-based config — we modify the YAML and reload via SIGHUP.
 *
 * Note: This is a simple approach for a single-user system.
 * For multi-user, consider switching to an API-based identity provider.
 */
class SsoClient {
  constructor() {
    this._writeLock = Promise.resolve();
  }

  /**
   * Register an OIDC client for an app.
   * @param {string} clientId - OIDC client ID (typically the app name)
   * @param {string} redirectUri - Full redirect URI
   * @param {string[]} scopes - Requested scopes
   * @returns {object} { clientId, clientSecret }
   */
  async registerClient(clientId, redirectUri, scopes = ['openid', 'profile', 'email']) {
    const clientSecret = crypto.randomBytes(32).toString('hex');

    await this._serializedWrite(async () => {
      let config = fs.readFileSync(AUTHELIA_CONFIG_PATH, 'utf-8');

      // Remove existing client entry if present
      config = this._removeClient(config, clientId);

      // Build the client YAML block
      const clientBlock = [
        `      - client_id: '${clientId}'`,
        `        client_name: '${clientId}'`,
        `        client_secret: '${clientSecret}'`,
        `        redirect_uris:`,
        `          - '${redirectUri}'`,
        `        scopes:`,
        ...scopes.map(s => `          - '${s}'`),
        `        response_types:`,
        `          - 'code'`,
        `        grant_types:`,
        `          - 'authorization_code'`,
      ].join('\n');

      // Insert into the clients array
      if (config.includes('clients: []')) {
        config = config.replace('clients: []', `clients:\n${clientBlock}`);
      } else if (config.includes('clients:')) {
        // Append to existing clients list
        const clientsIdx = config.indexOf('clients:');
        const insertIdx = config.indexOf('\n', clientsIdx) + 1;
        config = config.slice(0, insertIdx) + clientBlock + '\n' + config.slice(insertIdx);
      }

      fs.writeFileSync(AUTHELIA_CONFIG_PATH, config, 'utf-8');
      logger.info({ clientId }, 'Registered OIDC client');

      // Reload Authelia config
      await this._reloadAuthelia();
    });

    return { clientId, clientSecret };
  }

  /**
   * Remove an OIDC client.
   */
  async removeClient(clientId) {
    await this._serializedWrite(async () => {
      let config = fs.readFileSync(AUTHELIA_CONFIG_PATH, 'utf-8');
      const updated = this._removeClient(config, clientId);

      if (updated !== config) {
        fs.writeFileSync(AUTHELIA_CONFIG_PATH, updated, 'utf-8');
        logger.info({ clientId }, 'Removed OIDC client');
        await this._reloadAuthelia();
      }
    });
  }

  /**
   * Remove a client block from the config string.
   */
  _removeClient(config, clientId) {
    // Find and remove the client block based on client_id
    const marker = `client_id: '${clientId}'`;
    const idx = config.indexOf(marker);
    if (idx === -1) return config;

    // Find the start of this client entry (the "- client_id:" line)
    let lineStart = config.lastIndexOf('\n', idx);
    // Walk back to find the "      - " prefix
    while (lineStart > 0 && config[lineStart - 1] !== '\n') lineStart--;

    // Find the end — next "      - client_id:" or end of clients section
    let lineEnd = config.indexOf('\n      - client_id:', idx + marker.length);
    if (lineEnd === -1) {
      // Last client — find the next top-level key
      lineEnd = config.indexOf('\n    ', idx + marker.length);
      if (lineEnd === -1) lineEnd = config.length;
    }

    return config.slice(0, lineStart) + config.slice(lineEnd);
  }

  /**
   * Reload Authelia by sending SIGHUP to the container.
   */
  _reloadAuthelia() {
    return new Promise((resolve) => {
      execFile('docker', ['kill', '--signal=HUP', 'harness-authelia'], {
        timeout: 10_000,
      }, (err) => {
        if (err) {
          logger.warn({ err: err.message }, 'Failed to reload Authelia');
        }
        resolve();
      });
    });
  }

  /**
   * Serialize writes to prevent race conditions.
   */
  _serializedWrite(fn) {
    this._writeLock = this._writeLock.then(fn).catch(err => {
      logger.error({ err }, 'SSO client operation failed');
      throw err;
    });
    return this._writeLock;
  }
}

module.exports = { SsoClient };
