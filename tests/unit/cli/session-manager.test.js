'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { SessionManager } = require('../../../src/daemon/cli/session-manager');

describe('SessionManager', () => {
  let tmpDir;
  let manager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
    manager = new SessionManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a new conversation with metadata', () => {
    const result = manager.create('user-1', 'My Project');

    assert.ok(result.conversationId);
    assert.ok(result.sessionPath);
    assert.equal(result.metadata.userId, 'user-1');
    assert.equal(result.metadata.name, 'My Project');
    assert.equal(result.metadata.turnCount, 0);
    assert.ok(fs.existsSync(result.sessionPath));
  });

  it('gets session ID for existing conversation', () => {
    const { conversationId } = manager.create('user-1');
    const sessionId = manager.getSessionId('user-1', conversationId);
    assert.ok(sessionId);
    assert.ok(fs.existsSync(sessionId));
  });

  it('throws SessionNotFoundError for unknown conversation', () => {
    assert.throws(
      () => manager.getSessionId('user-1', 'nonexistent'),
      { code: 'SESSION_NOT_FOUND' }
    );
  });

  it('records turns and updates metadata', () => {
    const { conversationId } = manager.create('user-1');

    manager.recordTurn('user-1', conversationId, 'Hello, build me an app');
    const meta = manager.getMetadata('user-1', conversationId);

    assert.equal(meta.turnCount, 1);
    assert.equal(meta.firstMessage, 'Hello, build me an app');
  });

  it('lists conversations sorted by recency (F-06)', () => {
    manager.create('user-1', 'Project A');
    const { conversationId: bId } = manager.create('user-1', 'Project B');

    // Make B more recent
    manager.recordTurn('user-1', bId, 'newer message');

    const list = manager.list('user-1');
    assert.equal(list.length, 2);
    assert.equal(list[0].name, 'Project B'); // Most recent first
  });

  it('returns empty list for unknown user', () => {
    const list = manager.list('nobody');
    assert.deepEqual(list, []);
  });

  it('saves and retrieves checkpoints', () => {
    const { conversationId } = manager.create('user-1');
    manager.recordTurn('user-1', conversationId, 'turn 1');
    manager.recordTurn('user-1', conversationId, 'turn 2');

    manager.saveCheckpoint('user-1', conversationId, 'before-refactor');

    const meta = manager.getMetadata('user-1', conversationId);
    assert.ok(meta.checkpoints['before-refactor']);
    assert.equal(meta.checkpoints['before-refactor'].turnCount, 2);
  });

  it('branches a conversation (F-05)', () => {
    const { conversationId: sourceId } = manager.create('user-1', 'Original');
    manager.recordTurn('user-1', sourceId, 'turn 1');
    manager.saveCheckpoint('user-1', sourceId, 'checkpoint-1');

    const { conversationId: branchId } = manager.branch('user-1', sourceId, 'checkpoint-1');

    assert.notEqual(branchId, sourceId);

    const branchMeta = manager.getMetadata('user-1', branchId);
    assert.equal(branchMeta.branchedFrom.conversationId, sourceId);
    assert.equal(branchMeta.branchedFrom.checkpoint, 'checkpoint-1');

    // Both conversations should be independent
    const list = manager.list('user-1');
    assert.equal(list.length, 2);
  });

  it('throws when branching from nonexistent checkpoint', () => {
    const { conversationId } = manager.create('user-1');

    assert.throws(
      () => manager.branch('user-1', conversationId, 'nonexistent'),
      /Checkpoint "nonexistent" not found/
    );
  });

  it('deletes a conversation', () => {
    const { conversationId } = manager.create('user-1');
    manager.delete('user-1', conversationId);

    assert.throws(
      () => manager.getSessionId('user-1', conversationId),
      { code: 'SESSION_NOT_FOUND' }
    );
  });
});
