'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const fastify = require('fastify');
const cors = require('@fastify/cors');

const { SessionManager } = require('../../src/daemon/cli/session-manager');
const { CommandClassifier } = require('../../src/daemon/router/classifier');
const { ConversationQueue } = require('../../src/daemon/queue/conversation-queue');
const { AppRegistry } = require('../../src/daemon/db/registry');

const healthRoutes = require('../../src/daemon/routes/health');
const conversationRoutes = require('../../src/daemon/routes/conversations');
const appRoutes = require('../../src/daemon/routes/apps');

/**
 * Integration tests for the daemon HTTP API.
 * Tests routes against real (in-memory) services without spawning CLI.
 */
describe('daemon HTTP API', () => {
  let app;
  let tmpDir;
  let sessionManager;
  let registry;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-http-test-'));
    sessionManager = new SessionManager(path.join(tmpDir, 'sessions'));
    registry = new AppRegistry(path.join(tmpDir, 'test.db'));

    const config = { pinnedCliVersion: '1.0.0', nodeEnv: 'test' };
    const classifier = new CommandClassifier(undefined, { watch: false });
    const queue = new ConversationQueue();
    const startTime = Date.now();
    const deps = { config, startTime, sessionManager, classifier, queue, registry };

    app = fastify({ logger: false });
    await app.register(cors, { origin: true });
    await app.register(healthRoutes, deps);
    await app.register(conversationRoutes, deps);
    await app.register(appRoutes, deps);

    await app.listen({ port: 0 }); // Random available port
  });

  after(async () => {
    await app.close();
    registry.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function url(path) {
    const addr = app.server.address();
    return `http://localhost:${addr.port}${path}`;
  }

  describe('GET /health', () => {
    it('returns OK with version info', async () => {
      const resp = await fetch(url('/health'));
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.status, 'ok');
      assert.equal(body.cliVersion, '1.0.0');
      assert.ok(body.uptime >= 0);
    });
  });

  describe('GET /ready', () => {
    it('returns ready', async () => {
      const resp = await fetch(url('/ready'));
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.ready, true);
    });
  });

  describe('POST /conversations/new', () => {
    it('creates a new conversation', async () => {
      const resp = await fetch(url('/conversations/new'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'test-user', name: 'My Project' }),
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.ok(body.conversationId);
      assert.equal(body.metadata.name, 'My Project');
    });
  });

  describe('GET /conversations/list', () => {
    it('lists conversations for a user (F-06)', async () => {
      // Create a couple conversations
      await fetch(url('/conversations/new'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'list-user', name: 'Project A' }),
      });
      await fetch(url('/conversations/new'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'list-user', name: 'Project B' }),
      });

      const resp = await fetch(url('/conversations/list?user_id=list-user'));
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.ok(body.conversations.length >= 2);
    });

    it('returns empty for unknown user', async () => {
      const resp = await fetch(url('/conversations/list?user_id=nobody'));
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.conversations.length, 0);
    });
  });

  describe('POST /conversations/branch (F-05)', () => {
    it('branches a conversation from checkpoint', async () => {
      // Create and checkpoint
      const createResp = await fetch(url('/conversations/new'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'branch-user' }),
      });
      const { conversationId } = await createResp.json();

      await fetch(url('/conversations/checkpoint'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'branch-user',
          conversation_id: conversationId,
          name: 'before-refactor',
        }),
      });

      // Branch
      const branchResp = await fetch(url('/conversations/branch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'branch-user',
          source_conversation_id: conversationId,
          checkpoint_name: 'before-refactor',
        }),
      });
      assert.equal(branchResp.status, 200);
      const branchBody = await branchResp.json();
      assert.ok(branchBody.conversationId);
      assert.notEqual(branchBody.conversationId, conversationId);
    });
  });

  describe('DELETE /conversations/:id', () => {
    it('deletes a conversation', async () => {
      const createResp = await fetch(url('/conversations/new'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'delete-user' }),
      });
      const { conversationId } = await createResp.json();

      const delResp = await fetch(
        url(`/conversations/${conversationId}?user_id=delete-user`),
        { method: 'DELETE' }
      );
      assert.equal(delResp.status, 200);

      // Verify it's gone
      const listResp = await fetch(url('/conversations/list?user_id=delete-user'));
      const { conversations } = await listResp.json();
      assert.ok(!conversations.find((c) => c.conversationId === conversationId));
    });
  });

  describe('GET /apps', () => {
    it('lists apps for a user (F-26)', async () => {
      registry.createApp({ userId: 'apps-user', name: 'dashboard', internalPort: 3000 });
      registry.createApp({ userId: 'apps-user', name: 'api-server', internalPort: 8080 });

      const resp = await fetch(url('/apps?user_id=apps-user'));
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.apps.length, 2);
    });
  });

  describe('GET /apps/:name', () => {
    it('returns app details', async () => {
      registry.createApp({ userId: 'detail-user', name: 'myapp' });

      const resp = await fetch(url('/apps/myapp?user_id=detail-user'));
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.name, 'myapp');
    });

    it('returns 404 for unknown app', async () => {
      const resp = await fetch(url('/apps/nonexistent?user_id=detail-user'));
      assert.equal(resp.status, 404);
    });
  });

  describe('POST /apps/:name/stop', () => {
    it('stops an app', async () => {
      registry.createApp({ userId: 'stop-user', name: 'stopme' });
      const app = registry.getAppByName('stop-user', 'stopme');
      registry.updateAppStatus(app.id, 'running');

      const resp = await fetch(url('/apps/stopme/stop'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'stop-user' }),
      });
      assert.equal(resp.status, 200);

      const updated = registry.getAppByName('stop-user', 'stopme');
      assert.equal(updated.status, 'stopped');
    });
  });
});
