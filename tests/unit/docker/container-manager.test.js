'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ContainerManager } = require('../../../src/daemon/docker/container-manager');

/**
 * Container manager tests using a mock Docker API.
 * Real Docker tests are in tests/integration/daemon-docker.test.js.
 */

function createMockDocker() {
  const containers = new Map();
  const networks = new Map();
  let idCounter = 0;

  return {
    createContainer: async (opts) => {
      const id = `mock-container-${++idCounter}`;
      const container = {
        id,
        opts,
        started: false,
        start: async () => { container.started = true; },
        stop: async () => { container.started = false; },
        restart: async () => { container.started = true; },
        remove: async () => { containers.delete(id); },
        exec: async (execOpts) => ({
          start: async () => ({
            on: (event, cb) => {
              if (event === 'data') cb(Buffer.from('mock output'));
              if (event === 'end') cb();
            },
          }),
          inspect: async () => ({ ExitCode: 0 }),
        }),
        logs: async () => Buffer.from('mock log line 1\nmock log line 2\n'),
      };
      containers.set(id, container);
      return container;
    },
    getContainer: (id) => containers.get(id) || {
      stop: async () => {},
      restart: async () => {},
      remove: async () => {},
    },
    getImage: () => ({ inspect: async () => ({}) }),
    getNetwork: (name) => {
      if (networks.has(name)) {
        return {
          inspect: async () => ({}),
          connect: async () => {},
        };
      }
      throw new Error('network not found');
    },
    createNetwork: async (opts) => {
      networks.set(opts.Name, opts);
    },
    listContainers: async () => [],
    pull: (image, cb) => {
      const stream = { on: (_, handler) => handler() };
      cb(null, stream);
    },
    modem: { followProgress: (stream, cb) => cb() },
    _containers: containers,
    _networks: networks,
  };
}

describe('ContainerManager', () => {
  it('creates a container and returns URL', async () => {
    const mockDocker = createMockDocker();
    const manager = new ContainerManager({
      docker: mockDocker,
      domainSuffix: 'agent.test.com',
    });

    const result = await manager.create({
      userId: 'user-1',
      name: 'dashboard',
      image: 'node:22-alpine',
      internalPort: 3000,
      startCommand: 'npm start',
    });

    assert.ok(result.containerId);
    assert.equal(result.url, 'https://dashboard.user-1.agent.test.com');
    assert.ok(result.containerName.includes('user-1'));
    assert.ok(result.containerName.includes('dashboard'));
  });

  it('generates unique container names per user/app', async () => {
    const mockDocker = createMockDocker();
    const manager = new ContainerManager({ docker: mockDocker });

    const r1 = await manager.create({ userId: 'u1', name: 'app-a' });
    const r2 = await manager.create({ userId: 'u1', name: 'app-b' });
    const r3 = await manager.create({ userId: 'u2', name: 'app-a' });

    assert.notEqual(r1.containerName, r2.containerName);
    assert.notEqual(r1.containerName, r3.containerName);
  });

  it('joins container to network when specified', async () => {
    const mockDocker = createMockDocker();
    const manager = new ContainerManager({ docker: mockDocker });

    // Create network first
    await mockDocker.createNetwork({ Name: 'gemini-user-1' });

    const result = await manager.create({
      userId: 'user-1',
      name: 'web',
      networkName: 'gemini-user-1',
    });

    assert.ok(result.containerId);
  });

  it('executes commands inside container (E-04)', async () => {
    const mockDocker = createMockDocker();
    const manager = new ContainerManager({ docker: mockDocker });

    const { containerId } = await manager.create({ userId: 'u1', name: 'test-app' });

    const result = await manager.exec(containerId, 'npm install express');
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('mock output'));
  });

  it('gets logs from container', async () => {
    const mockDocker = createMockDocker();
    const manager = new ContainerManager({ docker: mockDocker });

    const { containerId } = await manager.create({ userId: 'u1', name: 'log-app' });

    const logs = await manager.logs(containerId);
    assert.ok(logs.includes('mock log line'));
  });

  it('ensures network is created once (A-05)', async () => {
    const mockDocker = createMockDocker();
    const manager = new ContainerManager({ docker: mockDocker });

    const name1 = await manager.ensureNetwork('user-1');
    const name2 = await manager.ensureNetwork('user-1');

    assert.equal(name1, 'gemini-user-1');
    assert.equal(name2, 'gemini-user-1');
    assert.equal(mockDocker._networks.size, 1);
  });

  it('creates separate networks per user', async () => {
    const mockDocker = createMockDocker();
    const manager = new ContainerManager({ docker: mockDocker });

    await manager.ensureNetwork('user-a');
    await manager.ensureNetwork('user-b');

    assert.equal(mockDocker._networks.size, 2);
  });

  it('applies resource limits (A-09)', async () => {
    const mockDocker = createMockDocker();
    const manager = new ContainerManager({
      docker: mockDocker,
      defaultCpus: 2,
      defaultMemory: 2 * 1024 * 1024 * 1024,
    });

    await manager.create({ userId: 'u1', name: 'limited-app' });

    const container = [...mockDocker._containers.values()][0];
    assert.equal(container.opts.HostConfig.NanoCpus, 2e9);
    assert.equal(container.opts.HostConfig.Memory, 2 * 1024 * 1024 * 1024);
  });

  it('sets Traefik labels for auto-discovery', async () => {
    const mockDocker = createMockDocker();
    const manager = new ContainerManager({
      docker: mockDocker,
      domainSuffix: 'agent.example.com',
    });

    await manager.create({ userId: 'matt', name: 'dashboard', internalPort: 3000 });

    const container = [...mockDocker._containers.values()][0];
    const labels = container.opts.Labels;

    assert.equal(labels['traefik.enable'], 'true');
    assert.ok(labels['gemini.managed']);
    // Verify the hostname is in a router rule
    const routerRuleKey = Object.keys(labels).find((k) => k.includes('.rule'));
    assert.ok(routerRuleKey);
    assert.ok(labels[routerRuleKey].includes('dashboard.matt.agent.example.com'));
  });
});
