'use strict';

/**
 * Web UI route — Phase 3 modular web interface.
 * Static files (index.html, css/, js/) served by @fastify/static.
 * This plugin is kept as a no-op for backward compatibility
 * with the route registration in index.js.
 */
async function webRoutes(/* fastify */) {
  // All static file serving handled by @fastify/static registered in index.js.
  // The root GET / is served automatically from public/index.html.
}

module.exports = webRoutes;
