'use strict';

/**
 * Builds Traefik Docker labels for container auto-discovery.
 *
 * URL pattern: {app}.{user}.agent.{project}.run.app (F-21)
 * Supports: HTTPS, WebSocket (HMR), auto-discovery within 5s (P-01).
 */
function buildLabels({ containerName, hostname, internalPort, routerName }) {
  const router = routerName || containerName.replace(/[^a-zA-Z0-9-]/g, '-');

  return {
    'traefik.enable': 'true',
    // Router: match hostname
    [`traefik.http.routers.${router}.rule`]: `Host(\`${hostname}\`)`,
    [`traefik.http.routers.${router}.entrypoints`]: 'websecure',
    [`traefik.http.routers.${router}.tls`]: 'true',
    [`traefik.http.routers.${router}.tls.certresolver`]: 'letsencrypt',
    // Service: point to internal port
    [`traefik.http.services.${router}.loadbalancer.server.port`]: String(internalPort),
    // WebSocket support for HMR / devtools (P-04)
    [`traefik.http.routers.${router}.middlewares`]: `${router}-headers`,
    [`traefik.http.middlewares.${router}-headers.headers.customrequestheaders.X-Forwarded-Proto`]: 'https',
    // Metadata for reconciliation
    'gemini.managed': 'true',
  };
}

/**
 * Generates the public hostname for an app.
 */
function appHostname(userId, appName, domainSuffix) {
  return `${appName}.${userId}.${domainSuffix}`;
}

module.exports = { buildLabels, appHostname };
