'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { AppRegistry } = require('../../../src/daemon/db/registry');
const { BudgetManager } = require('../../../src/daemon/tokens/budget');

describe('BudgetManager', () => {
  let tmpDir, registry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-test-'));
    registry = new AppRegistry(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    registry.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allows usage under budget', () => {
    const budget = new BudgetManager(registry, { dailyLimit: 10_000 });

    registry.recordTokenUsage({ userId: 'user-1', conversationId: 'c1', totalTokens: 1000 });

    const result = budget.check('user-1');
    assert.equal(result.allowed, true);
    assert.equal(result.warning, undefined);
  });

  it('warns at 80% threshold (F-34)', () => {
    const budget = new BudgetManager(registry, { dailyLimit: 10_000, warnThreshold: 0.8 });

    registry.recordTokenUsage({ userId: 'user-1', conversationId: 'c1', totalTokens: 8500 });

    const result = budget.check('user-1');
    assert.equal(result.allowed, true);
    assert.ok(result.warning);
    assert.ok(result.warning.includes('85%'));
  });

  it('pauses at 100% (F-34)', () => {
    const budget = new BudgetManager(registry, { dailyLimit: 10_000 });

    registry.recordTokenUsage({ userId: 'user-1', conversationId: 'c1', totalTokens: 10_000 });

    const result = budget.check('user-1');
    assert.equal(result.allowed, false);
    assert.ok(result.reason);
    assert.ok(result.reason.includes('exhausted'));
  });

  it('allows when no usage recorded', () => {
    const budget = new BudgetManager(registry, { dailyLimit: 10_000 });
    const result = budget.check('new-user');
    assert.equal(result.allowed, true);
  });
});
