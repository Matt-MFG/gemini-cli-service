'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ConversationQueue } = require('../../../src/daemon/queue/conversation-queue');

describe('ConversationQueue', () => {
  it('executes tasks for different conversations in parallel', async () => {
    const queue = new ConversationQueue();
    const order = [];

    await Promise.all([
      queue.enqueue('conv-a', async () => {
        order.push('a-start');
        await sleep(50);
        order.push('a-end');
        return 'a';
      }),
      queue.enqueue('conv-b', async () => {
        order.push('b-start');
        await sleep(50);
        order.push('b-end');
        return 'b';
      }),
    ]);

    // Both should start before either finishes (parallel)
    assert.equal(order[0], 'a-start');
    assert.equal(order[1], 'b-start');
  });

  it('executes tasks for same conversation sequentially (D-05)', async () => {
    const queue = new ConversationQueue();
    const order = [];

    const p1 = queue.enqueue('conv-1', async () => {
      order.push('first-start');
      await sleep(100);
      order.push('first-end');
    });

    const p2 = queue.enqueue('conv-1', async () => {
      order.push('second-start');
      await sleep(50);
      order.push('second-end');
    });

    const p3 = queue.enqueue('conv-1', async () => {
      order.push('third-start');
      order.push('third-end');
    });

    await Promise.all([p1, p2, p3]);

    // Must be strictly sequential
    assert.deepEqual(order, [
      'first-start', 'first-end',
      'second-start', 'second-end',
      'third-start', 'third-end',
    ]);
  });

  it('reports queue depth', async () => {
    const queue = new ConversationQueue();

    assert.equal(queue.depth('conv-1'), 0);
    assert.equal(queue.isBusy('conv-1'), false);

    let resolve;
    const blocker = new Promise((r) => { resolve = r; });

    const p = queue.enqueue('conv-1', () => blocker);
    assert.equal(queue.depth('conv-1'), 1);
    assert.equal(queue.isBusy('conv-1'), true);

    queue.enqueue('conv-1', async () => {});
    assert.equal(queue.depth('conv-1'), 2);

    resolve();
    await p;
  });

  it('continues queue after task failure', async () => {
    const queue = new ConversationQueue();
    const results = [];

    const p1 = queue.enqueue('conv-1', async () => {
      throw new Error('task 1 failed');
    }).catch(() => results.push('caught'));

    const p2 = queue.enqueue('conv-1', async () => {
      results.push('task 2 ran');
    });

    await Promise.all([p1, p2]);

    // Task 2 should still run despite task 1 failing
    assert.ok(results.includes('task 2 ran'));
  });

  it('cleans up after all tasks complete', async () => {
    const queue = new ConversationQueue();

    await queue.enqueue('conv-1', async () => 'done');

    assert.equal(queue.depth('conv-1'), 0);
    assert.equal(queue.stats.activeConversations, 0);
  });

  it('returns task result', async () => {
    const queue = new ConversationQueue();
    const result = await queue.enqueue('conv-1', async () => 42);
    assert.equal(result, 42);
  });
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
