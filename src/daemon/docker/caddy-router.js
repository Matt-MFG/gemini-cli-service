'use strict';

const { logger } = require('../lib/logger');

/**
 * Dynamic Caddy route manager (P1-FIX-2, F-21, F2-01).
 *
 * Registers and removes reverse proxy routes via Caddy's admin API
 * when apps are created/stopped/deleted.
 *
 * Each app gets a subdomain: {appName}.{domain} -> localhost:{hostPort}
 * For nip.io: hello-world.34.59.124.147.nip.io -> localhost:8022
 *
 * Uses Caddy's /load endpoint to reload the full config each time
 * a route changes. This is simpler and more reliable than patching
 * individual routes via the config API.
 */
class CaddyRouter {
  constructor(opts = {}) {
    this._adminUrl = opts.adminUrl || 'http://localhost:2019';
    this._domain = opts.domain || process.env.DOMAIN_SUFFIX || 'localhost';
    this._routes = new Map(); // appName -> { hostname, hostPort }
  }

  /**
   * Registers a route for a new app and reloads Caddy.
   *
   * @param {string} appName
   * @param {number} hostPort
   * @returns {string} The app's public URL
   */
  async register(appName, hostPort) {
    const hostname = `${appName}.${this._domain}`;
    this._routes.set(appName, { hostname, hostPort });

    const reloaded = await this._reload();
    if (reloaded) {
      logger.info({ appName, hostname, hostPort }, 'Caddy route registered');
      return `http://${hostname}`;
    }

    // Fallback: direct port URL
    const ip = this._extractIp();
    logger.warn({ appName }, 'Caddy reload failed; using direct port URL');
    return `http://${ip}:${hostPort}`;
  }

  /**
   * Removes a route for a stopped/deleted app.
   */
  async unregister(appName) {
    this._routes.delete(appName);
    await this._reload();
    logger.info({ appName }, 'Caddy route removed');
  }

  /**
   * Returns the public URL for an app, or null if not registered.
   */
  getUrl(appName) {
    const route = this._routes.get(appName);
    if (!route) return null;
    return `http://${route.hostname}`;
  }

  /**
   * Registers existing apps on startup (call after port sync).
   * Accepts an optional ContainerManager to look up host ports from Docker.
   */
  async syncFromRegistry(apps, containerManager) {
    for (const app of apps) {
      if (app.status !== 'running') continue;

      let hostPort = null;

      // Try extracting port from URL (direct port URLs like :8022)
      const portMatch = (app.url || '').match(/:(\d+)$/);
      if (portMatch) {
        hostPort = parseInt(portMatch[1], 10);
      }

      // If no port in URL, look up from ContainerManager's synced ports
      if (!hostPort && containerManager) {
        hostPort = containerManager.getHostPort(app.name);
      }

      // Fallback: try to extract from Docker container ID
      if (!hostPort && app.container_id) {
        try {
          const Docker = require('dockerode');
          const docker = new Docker();
          const container = docker.getContainer(app.container_id);
          const info = await container.inspect();
          const ports = info.NetworkSettings?.Ports || {};
          for (const [, bindings] of Object.entries(ports)) {
            if (bindings && bindings[0] && bindings[0].HostPort) {
              hostPort = parseInt(bindings[0].HostPort, 10);
              break;
            }
          }
        } catch { /* container may not exist */ }
      }

      if (hostPort) {
        this._routes.set(app.name, {
          hostname: `${app.name}.${this._domain}`,
          hostPort,
        });
      }
    }

    if (this._routes.size > 0) {
      await this._reload();
      logger.info({ appCount: this._routes.size }, 'Caddy routes synced from registry');
    }
  }

  /**
   * Rebuilds and reloads the full Caddy config via /load.
   */
  async _reload() {
    const config = this._buildConfig();
    try {
      const resp = await fetch(`${this._adminUrl}/load`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:2019',
        },
        body: JSON.stringify(config),
      });
      if (!resp.ok) {
        const text = await resp.text();
        logger.error({ status: resp.status, body: text }, 'Caddy /load failed');
        return false;
      }
      return true;
    } catch (err) {
      logger.warn({ err: err.message }, 'Caddy not reachable');
      return false;
    }
  }

  /**
   * Builds the full Caddy JSON config.
   */
  _buildConfig() {
    const routes = [];

    // App routes — each subdomain proxies to its container port
    for (const [, { hostname, hostPort }] of this._routes) {
      routes.push({
        match: [{ host: [hostname] }],
        handle: [{
          handler: 'subroute',
          routes: [{
            handle: [
              // Strip CSP/X-Frame-Options for iframe embedding (R2-01)
              {
                handler: 'headers',
                response: {
                  deferred: true,
                  delete: ['Content-Security-Policy', 'X-Frame-Options', 'Server'],
                  set: { 'X-Content-Type-Options': ['nosniff'] },
                },
              },
              // Reverse proxy to container
              {
                handler: 'reverse_proxy',
                upstreams: [{ dial: `localhost:${hostPort}` }],
              },
            ],
          }],
        }],
        terminal: true,
      });
    }

    // Default route — proxy to daemon
    routes.push({
      handle: [{
        handler: 'reverse_proxy',
        upstreams: [{ dial: 'localhost:3100' }],
      }],
      terminal: true,
    });

    return {
      admin: {
        listen: 'localhost:2019',
        origins: ['localhost:2019', '127.0.0.1:2019', '[::1]:2019'],
      },
      apps: {
        http: {
          servers: {
            srv0: {
              listen: [':80'],
              routes,
            },
          },
        },
      },
    };
  }

  /**
   * Extracts IP from domain suffix (e.g., "34.59.124.147.nip.io" -> "34.59.124.147")
   */
  _extractIp() {
    const match = this._domain.match(/(\d+\.\d+\.\d+\.\d+)/);
    return match ? match[1] : 'localhost';
  }
}

module.exports = { CaddyRouter };
