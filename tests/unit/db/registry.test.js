'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { AppRegistry } = require('../../../src/daemon/db/registry');

describe('AppRegistry', () => {
  let tmpDir;
  let registry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'));
    registry = new AppRegistry(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    registry.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('app CRUD', () => {
    it('creates and retrieves an app', () => {
      const app = registry.createApp({
        userId: 'user-1',
        name: 'dashboard',
        image: 'node:22-alpine',
        internalPort: 3000,
        url: 'https://dashboard.user-1.agent.example.com',
        containerId: 'abc123',
        startCommand: 'npm start',
        env: { NODE_ENV: 'production' },
      });

      assert.ok(app.id);
      assert.equal(app.name, 'dashboard');
      assert.equal(app.user_id, 'user-1');
      assert.equal(app.status, 'creating');
      assert.equal(app.internal_port, 3000);
      assert.deepEqual(app.env, { NODE_ENV: 'production' });
    });

    it('finds app by name', () => {
      registry.createApp({ userId: 'user-1', name: 'api-server' });
      const found = registry.getAppByName('user-1', 'api-server');
      assert.ok(found);
      assert.equal(found.name, 'api-server');
    });

    it('lists apps for a user', () => {
      registry.createApp({ userId: 'user-1', name: 'app-a' });
      registry.createApp({ userId: 'user-1', name: 'app-b' });
      registry.createApp({ userId: 'user-2', name: 'app-c' });

      const user1Apps = registry.listApps('user-1');
      assert.equal(user1Apps.length, 2);

      const allApps = registry.listApps();
      assert.equal(allApps.length, 3);
    });

    it('updates app status', () => {
      const app = registry.createApp({ userId: 'user-1', name: 'myapp' });
      const updated = registry.updateAppStatus(app.id, 'running', 'container-xyz');

      assert.equal(updated.status, 'running');
      assert.equal(updated.container_id, 'container-xyz');
    });

    it('deletes an app', () => {
      const app = registry.createApp({ userId: 'user-1', name: 'temp' });
      registry.deleteApp(app.id);

      const found = registry.getApp(app.id);
      assert.equal(found, null);
    });

    it('enforces unique (user_id, name)', () => {
      registry.createApp({ userId: 'user-1', name: 'unique' });
      assert.throws(
        () => registry.createApp({ userId: 'user-1', name: 'unique' }),
        /UNIQUE constraint failed/
      );
    });
  });

  describe('token usage', () => {
    it('records and retrieves token usage (F-33)', () => {
      registry.recordTokenUsage({
        userId: 'user-1',
        conversationId: 'conv-a',
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 80,
        totalTokens: 150,
        durationMs: 2000,
      });

      registry.recordTokenUsage({
        userId: 'user-1',
        conversationId: 'conv-a',
        inputTokens: 200,
        outputTokens: 100,
        cachedTokens: 180,
        totalTokens: 300,
        durationMs: 3000,
      });

      const perConv = registry.getTokenUsage('user-1');
      assert.equal(perConv.length, 1);
      assert.equal(perConv[0].input_tokens, 300);
      assert.equal(perConv[0].invocations, 2);

      const total = registry.getTotalTokenUsage('user-1');
      assert.equal(total.total_tokens, 450);
    });
  });

  describe('audit log', () => {
    it('logs tool executions (F-32)', () => {
      registry.logToolExecution({
        userId: 'user-1',
        sessionId: 'session-1',
        toolName: 'run_shell_command',
        args: { command: 'npm install' },
        result: { exitCode: 0 },
      });

      // Just verify it doesn't throw — retrieval would be via direct SQL
    });
  });

  describe('persistence (D-10)', () => {
    it('survives close and reopen', () => {
      const dbPath = path.join(tmpDir, 'persist.db');
      const reg1 = new AppRegistry(dbPath);
      reg1.createApp({ userId: 'user-1', name: 'persistent-app' });
      reg1.close();

      const reg2 = new AppRegistry(dbPath);
      const apps = reg2.listApps('user-1');
      assert.equal(apps.length, 1);
      assert.equal(apps[0].name, 'persistent-app');
      reg2.close();
    });
  });
});
