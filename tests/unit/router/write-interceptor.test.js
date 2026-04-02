'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkWriteRouting, isContainerPath } = require('../../../src/daemon/router/write-interceptor');

test('write-interceptor', async (t) => {
  await t.test('returns intercepted:false for non-tool-call events', () => {
    assert.deepStrictEqual(checkWriteRouting({ type: 'message' }), { intercepted: false });
    assert.deepStrictEqual(checkWriteRouting({ type: 'result' }), { intercepted: false });
    assert.deepStrictEqual(checkWriteRouting(null), { intercepted: false });
  });

  await t.test('detects write_file targeting container paths', () => {
    const event = {
      type: 'tool_call',
      tool_name: 'write_file',
      args: { path: '/app/src/index.js' },
    };
    const result = checkWriteRouting(event);
    assert.strictEqual(result.intercepted, true);
    assert.ok(result.reason.includes('write_file'));
    assert.ok(result.suggestion.includes('@apps.exec'));
  });

  await t.test('ignores write_file to non-container paths', () => {
    const event = {
      type: 'tool_call',
      tool_name: 'write_file',
      args: { path: '/tmp/notes.txt' },
    };
    const result = checkWriteRouting(event);
    assert.strictEqual(result.intercepted, false);
  });

  await t.test('detects write_file targeting paths matching container names', () => {
    const event = {
      type: 'tool_call',
      tool_name: 'write_file',
      args: { path: '/some/path/dashboard/src/App.tsx' },
    };
    const result = checkWriteRouting(event, ['dashboard']);
    assert.strictEqual(result.intercepted, true);
  });

  await t.test('detects edit_file and create_file tools', () => {
    const editEvent = {
      type: 'tool_call',
      tool_name: 'edit_file',
      args: { path: '/app/package.json' },
    };
    assert.strictEqual(checkWriteRouting(editEvent).intercepted, true);

    const createEvent = {
      type: 'tool_call',
      tool_name: 'create_file',
      args: { path: '/src/utils.js' },
    };
    assert.strictEqual(checkWriteRouting(createEvent).intercepted, true);
  });

  await t.test('ignores apps_exec tool calls', () => {
    const event = {
      type: 'tool_call',
      tool_name: 'apps_exec',
      args: { name: 'dashboard', command: 'cat > /app/src/index.js << EOF\n...\nEOF' },
    };
    assert.strictEqual(checkWriteRouting(event).intercepted, false);
  });
});

test('isContainerPath', async (t) => {
  await t.test('identifies /app/ paths', () => {
    assert.strictEqual(isContainerPath('/app/src/index.js', []), true);
  });

  await t.test('identifies /src/ paths', () => {
    assert.strictEqual(isContainerPath('/src/components/Header.tsx', []), true);
  });

  await t.test('identifies /home/user/projects/ paths', () => {
    assert.strictEqual(isContainerPath('/home/node/projects/myapp/index.js', []), true);
  });

  await t.test('rejects /tmp/notes.txt', () => {
    assert.strictEqual(isContainerPath('/tmp/notes.txt', []), false);
  });

  await t.test('matches container names in path', () => {
    assert.strictEqual(isContainerPath('/var/data/dashboard/config.json', ['dashboard']), true);
  });
});
