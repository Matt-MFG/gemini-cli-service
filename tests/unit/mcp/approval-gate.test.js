'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ApprovalGate } = require('../../../src/daemon/mcp/approval-gate');

describe('ApprovalGate', () => {
  it('resolves when approved (D-09)', async () => {
    const gate = new ApprovalGate();
    let requestId;

    gate.on('request', (req) => {
      requestId = req.requestId;
    });

    const promise = gate.request({
      userId: 'user-1',
      conversationId: 'conv-1',
      action: 'delete_files',
      description: 'Delete 3 unused files',
    });

    // Simulate user approval after a brief delay
    setTimeout(() => gate.approve(requestId, 'Looks good'), 50);

    const result = await promise;
    assert.equal(result.approved, true);
    assert.equal(result.note, 'Looks good');
  });

  it('resolves when rejected', async () => {
    const gate = new ApprovalGate();
    let requestId;

    gate.on('request', (req) => { requestId = req.requestId; });

    const promise = gate.request({
      userId: 'user-1',
      action: 'rm -rf',
      description: 'Dangerous operation',
    });

    setTimeout(() => gate.reject(requestId, 'Too risky'), 50);

    const result = await promise;
    assert.equal(result.approved, false);
    assert.equal(result.note, 'Too risky');
  });

  it('auto-rejects on timeout', async () => {
    const gate = new ApprovalGate({ timeoutMs: 100 });

    const result = await gate.request({
      userId: 'user-1',
      action: 'slow_op',
      description: 'Will timeout',
    });

    assert.equal(result.approved, false);
    assert.ok(result.note.includes('Timed out'));
  });

  it('tracks pending count', async () => {
    const gate = new ApprovalGate({ timeoutMs: 5000 });

    assert.equal(gate.pendingCount, 0);

    const p1 = gate.request({ userId: 'u1', action: 'a1', description: 'd1' });
    assert.equal(gate.pendingCount, 1);

    const p2 = gate.request({ userId: 'u1', action: 'a2', description: 'd2' });
    assert.equal(gate.pendingCount, 2);

    gate.cancelAll();
    await Promise.all([p1, p2]);
    assert.equal(gate.pendingCount, 0);
  });

  it('lists pending requests for a user', () => {
    const gate = new ApprovalGate({ timeoutMs: 5000 });

    gate.request({ userId: 'user-a', action: 'op1', description: 'd' });
    gate.request({ userId: 'user-b', action: 'op2', description: 'd' });
    gate.request({ userId: 'user-a', action: 'op3', description: 'd' });

    const userAPending = gate.listPending('user-a');
    assert.equal(userAPending.length, 2);

    const allPending = gate.listPending();
    assert.equal(allPending.length, 3);

    gate.cancelAll();
  });

  it('returns false for unknown request ID', () => {
    const gate = new ApprovalGate();
    assert.equal(gate.approve('nonexistent'), false);
    assert.equal(gate.reject('nonexistent'), false);
  });

  it('emits approved/rejected events', async () => {
    const gate = new ApprovalGate();
    const events = [];

    gate.on('approved', (e) => events.push({ type: 'approved', ...e }));
    gate.on('rejected', (e) => events.push({ type: 'rejected', ...e }));

    let reqId1, reqId2;
    gate.on('request', (req) => {
      if (!reqId1) reqId1 = req.requestId;
      else reqId2 = req.requestId;
    });

    const p1 = gate.request({ userId: 'u1', action: 'good', description: 'd' });
    const p2 = gate.request({ userId: 'u1', action: 'bad', description: 'd' });

    setTimeout(() => {
      gate.approve(reqId1);
      gate.reject(reqId2, 'nope');
    }, 50);

    await Promise.all([p1, p2]);

    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'approved');
    assert.equal(events[1].type, 'rejected');
  });
});
