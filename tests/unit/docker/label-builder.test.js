'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildLabels, appHostname } = require('../../../src/daemon/docker/label-builder');

describe('label-builder', () => {
  describe('appHostname', () => {
    it('generates correct hostname pattern (F-21)', () => {
      const hostname = appHostname('matt', 'dashboard', 'agent.example.com');
      assert.equal(hostname, 'dashboard.matt.agent.example.com');
    });
  });

  describe('buildLabels', () => {
    it('generates valid Traefik labels', () => {
      const labels = buildLabels({
        containerName: 'gemini-matt-dashboard',
        hostname: 'dashboard.matt.agent.example.com',
        internalPort: 3000,
      });

      assert.equal(labels['traefik.enable'], 'true');
      assert.ok(labels['traefik.http.routers.gemini-matt-dashboard.rule'].includes('dashboard.matt.agent.example.com'));
      assert.equal(labels['traefik.http.services.gemini-matt-dashboard.loadbalancer.server.port'], '3000');
      assert.equal(labels['traefik.http.routers.gemini-matt-dashboard.tls'], 'true');
    });

    it('sets HTTPS entrypoint', () => {
      const labels = buildLabels({
        containerName: 'test',
        hostname: 'test.example.com',
        internalPort: 8080,
      });
      assert.equal(labels['traefik.http.routers.test.entrypoints'], 'websecure');
    });

    it('includes gemini managed label', () => {
      const labels = buildLabels({
        containerName: 'test',
        hostname: 'test.example.com',
        internalPort: 3000,
      });
      assert.equal(labels['gemini.managed'], 'true');
    });

    it('uses custom router name if provided', () => {
      const labels = buildLabels({
        containerName: 'my-container',
        hostname: 'app.example.com',
        internalPort: 3000,
        routerName: 'custom-router',
      });
      assert.ok(labels['traefik.http.routers.custom-router.rule']);
    });
  });
});
