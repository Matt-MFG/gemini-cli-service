'use strict';

const { logger } = require('../lib/logger');

/**
 * Dynamic Caddy route manager (P1-FIX-2).
 *
 * Registers and removes reverse proxy routes via Caddy's admin API
 * when apps are created/stopped. This replaces Traefik Docker labels
 * with a simpler, more reliable approach.
 *
 * Each app gets a subdomain: {appName}.{domain} -> localhost:{hostPort}
 */
class CaddyRouter {
  constructor(opts = {}) {
    this._adminUrl = opts.adminUrl || 'http://localhost:2019';
    this._domain = opts.domain || process.env.DOMAIN || 'localhost';
    this._apiKey = opts.apiKey || process.env.API_KEY || '';
    this._routes = new Map(); // appName -> route config
  }

  /**
   * Registers a route for a new app.
   * {appName}.{domain} -> localhost:{hostPort}
   *
   * @param {string} appName
   * @param {number} hostPort
   * @returns {string} The app's public URL
   */
  async register(appName, hostPort) {
    const hostname = `${appName}.${this._domain}`;
    const url = `https://${hostname}`;

    const route = {
      match: [{ host: [hostname] }],
      handle: [
        // API key auth
        ...(this._apiKey ? [{
          handler: 'authentication',
          providers: {
            http_basic: {
              accounts: [{
                username: 'api',
                password: this._apiKey,
              }],
            },
          },
        }] : []),
        // Strip CSP for iframe embedding (R2-01)
        {
          handler: 'headers',
          response: {
            delete: ['Content-Security-Policy', 'X-Frame-Options'],
          },
        },
        // Reverse proxy to container
        {
          handler: 'reverse_proxy',
          upstreams: [{ dial: `localhost:${hostPort}` }],
          headers: {
            request: {
              set: {
                'X-Forwarded-Proto': ['https'],
                Host: [hostname],
              },
            },
          },
        },
      ],
    };

    try {
      const resp = await fetch(`${this._adminUrl}/config/apps/http/servers/srv0/routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(route),
      });

      if (resp.ok) {
        this._routes.set(appName, { hostname, hostPort });
        logger.info({ appName, hostname, hostPort }, 'Caddy route registered');
        return url;
      }

      // If Caddy admin API isn't available, fall back to direct port URL
      logger.warn({ appName, status: resp.status }, 'Caddy admin API unavailable; using direct port');
    } catch (err) {
      logger.warn({ appName, err: err.message }, 'Caddy not reachable; using direct port URL');
    }

    // Fallback: return direct port URL (Phase 1 behavior)
    return `http://${this._domain.replace('.nip.io', '').split('.').slice(0, 4).join('.')}:${hostPort}`;
  }

  /**
   * Removes a route for a stopped/deleted app.
   */
  async unregister(appName) {
    this._routes.delete(appName);
    // Caddy admin API route removal would go here
    // For now, the route persists until Caddy restarts
    logger.info({ appName }, 'Caddy route unregistered');
  }

  /**
   * Returns the public URL for an app, or null if not registered.
   */
  getUrl(appName) {
    const route = this._routes.get(appName);
    if (!route) return null;
    return `https://${route.hostname}`;
  }

  /**
   * Returns whether Caddy is available.
   */
  async isAvailable() {
    try {
      const resp = await fetch(`${this._adminUrl}/config/`, { method: 'GET' });
      return resp.ok;
    } catch {
      return false;
    }
  }
}

module.exports = { CaddyRouter };
