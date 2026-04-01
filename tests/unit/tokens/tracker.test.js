'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { AppRegistry } = require('../../../src/daemon/db/registry');
const { TokenTracker } = require('../../../src/daemon/tokens/tracker');

describe('TokenTracker', () => {
  let tmpDir, registry, tracker;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-test-'));
    registry = new AppRegistry(path.join(tmpDir, 'test.db'));
    tracker = new TokenTracker(registry);
  });

  afterEach(() => {
    registry.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records token usage from result events', () => {
    const usage = tracker.recordFromEvent('user-1', 'conv-a', {
      type: 'result',
      input_tokens: 500,
      output_tokens: 200,
      cached_tokens: 400,
      total_tokens: 700,
      duration_ms: 2500,
    });

    assert.equal(usage.totalTokens, 700);
    assert.equal(usage.durationMs, 2500);
  });

  it('ignores non-result events', () => {
    const result = tracker.recordFromEvent('user-1', 'conv-a', {
      type: 'model_turn',
      content: 'Hello',
    });
    assert.equal(result, null);
  });

  it('aggregates per-conversation usage (F-33)', () => {
    tracker.recordFromEvent('user-1', 'conv-a', { type: 'result', total_tokens: 100 });
    tracker.recordFromEvent('user-1', 'conv-a', { type: 'result', total_tokens: 200 });
    tracker.recordFromEvent('user-1', 'conv-b', { type: 'result', total_tokens: 300 });

    const perConv = tracker.getPerConversation('user-1');
    assert.equal(perConv.length, 2);

    const total = tracker.getTotal('user-1');
    assert.equal(total.total_tokens, 600);
  });

  it('formats cost report', () => {
    tracker.recordFromEvent('user-1', 'conv-a', { type: 'result', total_tokens: 1_000_000 });

    const report = tracker.formatCostReport('user-1', 0.075);
    assert.equal(report.total.totalTokens, 1_000_000);
    assert.equal(report.total.estimatedCost, '$0.0750');
    assert.equal(report.conversations.length, 1);
  });
});
