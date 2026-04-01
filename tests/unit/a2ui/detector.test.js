'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectStructuredPanel, looksLikeTestOutput, parseTestOutput } = require('../../../src/daemon/a2ui/detector');

test('detectStructuredPanel', async (t) => {
  await t.test('returns null for non-matching events', () => {
    assert.strictEqual(detectStructuredPanel({ type: 'message' }), null);
    assert.strictEqual(detectStructuredPanel(null), null);
    assert.strictEqual(detectStructuredPanel({ type: 'tool_result', tool_name: 'unknown' }), null);
  });

  await t.test('detects apps_list results as app_inventory', () => {
    const event = {
      type: 'tool_result',
      tool_name: 'apps_list',
      output: {
        apps: [
          { name: 'dashboard', status: 'running', url: 'http://localhost:8001', port: 8001 },
          { name: 'api', status: 'stopped', url: 'http://localhost:8002', port: 8002 },
        ],
      },
    };
    const panel = detectStructuredPanel(event);
    assert.ok(panel);
    assert.strictEqual(panel.type, 'a2ui');
    assert.strictEqual(panel.component, 'table');
    assert.strictEqual(panel.title, 'Running Applications');
    assert.ok(panel.summary.includes('1 running'));
  });

  await t.test('detects apps_create results', () => {
    const event = {
      type: 'tool_result',
      tool_name: 'apps_create',
      output: { url: 'http://localhost:8001', status: 'running' },
    };
    const panel = detectStructuredPanel(event);
    assert.ok(panel);
    assert.strictEqual(panel.type, 'a2ui');
    assert.strictEqual(panel.component, 'app_created');
    assert.strictEqual(panel.url, 'http://localhost:8001');
  });

  await t.test('detects a2ui_render tool results', () => {
    const event = {
      type: 'tool_result',
      tool_name: 'a2ui_render',
      output: {
        template: 'table',
        data: { title: 'Users', columns: ['Name', 'Role'], rows: [['Alice', 'Admin']] },
      },
    };
    const panel = detectStructuredPanel(event);
    assert.ok(panel);
    assert.strictEqual(panel.type, 'a2ui');
    assert.strictEqual(panel.component, 'table');
    assert.strictEqual(panel.title, 'Users');
  });

  await t.test('detects JSON arrays as tables', () => {
    const event = {
      type: 'tool_result',
      tool_name: 'some_tool',
      output: [
        { id: 1, name: 'Alpha' },
        { id: 2, name: 'Beta' },
      ],
    };
    const panel = detectStructuredPanel(event);
    assert.ok(panel);
    assert.strictEqual(panel.component, 'table');
    assert.deepStrictEqual(panel.columns, ['id', 'name']);
  });
});

test('looksLikeTestOutput', async (t) => {
  await t.test('detects mocha-style output', () => {
    assert.strictEqual(looksLikeTestOutput('  5 passing (200ms)\n  1 failing'), true);
  });

  await t.test('detects PASS/FAIL markers', () => {
    assert.strictEqual(looksLikeTestOutput('PASS src/app.test.js'), true);
  });

  await t.test('rejects normal text', () => {
    assert.strictEqual(looksLikeTestOutput('Hello world, this is a normal message'), false);
  });
});

test('parseTestOutput', async (t) => {
  await t.test('parses mocha-style output', () => {
    const output = `  stream-parser
    ✓ should parse valid JSON lines (2ms)
    ✓ should skip empty lines
    ✗ should handle malformed JSON (1ms)

  2 passing (50ms)
  1 failing`;

    const result = parseTestOutput(output);
    assert.ok(result);
    assert.strictEqual(result.passed, 2);
    assert.strictEqual(result.failed, 1);
    assert.strictEqual(result.tests.length, 3);
    assert.strictEqual(result.tests[0].passed, true);
    assert.strictEqual(result.tests[2].passed, false);
  });

  await t.test('returns null for non-test output', () => {
    assert.strictEqual(parseTestOutput('just some random text\nnothing here'), null);
  });
});
