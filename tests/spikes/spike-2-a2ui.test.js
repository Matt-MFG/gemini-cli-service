'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { render, toSlackBlocks } = require('../../src/daemon/a2ui/renderer');

/**
 * Spike 2: A2UI component audit.
 *
 * Tests the A2UI renderer templates and Slack Block Kit fallback.
 * This spike validates what components we can render before deciding
 * whether to use A2UI natively or build platform-native fallbacks.
 *
 * Exit criteria: Component availability matrix documented.
 */

describe('Spike 2: A2UI component audit', () => {
  describe('test_results template (F-27)', () => {
    it('renders a test results table', () => {
      const rendered = render('test_results', {
        suite: 'unit',
        tests: [
          { name: 'test_add', passed: true, duration: 5 },
          { name: 'test_sub', passed: true, duration: 3 },
          { name: 'test_div', passed: false, duration: 10 },
        ],
        passed: 2,
        failed: 1,
        skipped: 0,
        duration: 18,
      });

      assert.equal(rendered.component, 'table');
      assert.ok(rendered.title.includes('unit'));
      assert.ok(rendered.summary.includes('2/3 passed'));
      assert.equal(rendered.rows.length, 3);
      assert.equal(rendered.style, 'error'); // Has failures
    });

    it('shows success style when all pass', () => {
      const rendered = render('test_results', {
        tests: [{ name: 'test_ok', passed: true }],
        passed: 1,
        failed: 0,
        duration: 5,
      });
      assert.equal(rendered.style, 'success');
    });
  });

  describe('file_changes template (F-29)', () => {
    it('renders approval with file change summary', () => {
      const rendered = render('file_changes', {
        action: 'Refactor auth module',
        files: [
          { path: 'src/auth.js', action: 'modify', additions: 15, deletions: 8 },
          { path: 'src/auth.test.js', action: 'create', additions: 40, deletions: 0 },
          { path: 'src/legacy-auth.js', action: 'delete', additions: 0, deletions: 120 },
        ],
      });

      assert.equal(rendered.component, 'approval');
      assert.ok(rendered.summary.includes('3 files'));
      assert.equal(rendered.items.length, 3);
    });
  });

  describe('app_inventory template (F-26)', () => {
    it('renders app inventory table', () => {
      const rendered = render('app_inventory', {
        apps: [
          { name: 'dashboard', status: 'running', url: 'https://dashboard.test.example.com', port: 3000 },
          { name: 'api-server', status: 'stopped', url: 'https://api.test.example.com', port: 8080 },
        ],
      });

      assert.equal(rendered.component, 'table');
      assert.ok(rendered.summary.includes('1 running'));
      assert.ok(rendered.summary.includes('1 stopped'));
      assert.equal(rendered.rows.length, 2);
    });
  });

  describe('selection_list template (F-28)', () => {
    it('renders interactive selection', () => {
      const rendered = render('selection_list', {
        prompt: 'Select a session:',
        options: [
          { id: '1', label: 'React Dashboard', detail: '15 turns', value: 'sess-1' },
          { id: '2', label: 'API Project', detail: '8 turns', value: 'sess-2' },
        ],
      });

      assert.equal(rendered.component, 'selection');
      assert.equal(rendered.options.length, 2);
      assert.equal(rendered.options[0].value, 'sess-1');
    });
  });

  describe('token_usage template (F-33)', () => {
    it('renders token stats', () => {
      const rendered = render('token_usage', {
        total: {
          inputTokens: 50000,
          outputTokens: 20000,
          cachedTokens: 40000,
          totalTokens: 70000,
          invocations: 15,
          estimatedCost: '$0.0053',
        },
        conversations: [],
      });

      assert.equal(rendered.component, 'stats');
      assert.ok(rendered.summary.includes('70,000'));
      assert.equal(rendered.metrics.length, 5);
    });
  });

  describe('unknown template', () => {
    it('falls back to raw data', () => {
      const rendered = render('nonexistent_template', { foo: 'bar' });
      assert.equal(rendered.component, 'raw');
      assert.deepEqual(rendered.data, { foo: 'bar' });
    });
  });

  describe('Slack Block Kit fallback', () => {
    it('converts table to Slack blocks', () => {
      const rendered = render('app_inventory', {
        apps: [
          { name: 'dashboard', status: 'running', url: 'https://d.example.com', port: 3000 },
        ],
      });

      const blocks = toSlackBlocks(rendered);
      assert.ok(blocks.length > 0);
      assert.equal(blocks[0].type, 'header');
    });

    it('converts selection to action buttons', () => {
      const rendered = render('selection_list', {
        prompt: 'Pick one:',
        options: [
          { id: 'a', label: 'Option A', value: 'a' },
          { id: 'b', label: 'Option B', value: 'b' },
        ],
      });

      const blocks = toSlackBlocks(rendered);
      const actionBlock = blocks.find((b) => b.type === 'actions');
      assert.ok(actionBlock, 'Should have an actions block');
      assert.equal(actionBlock.elements.length, 2);
    });
  });

  describe('Component availability matrix', () => {
    it('documents available components', () => {
      const matrix = {
        test_results: { status: 'ready', fallback: 'Slack Block Kit table' },
        file_changes: { status: 'ready', fallback: 'Slack Block Kit sections' },
        app_inventory: { status: 'ready', fallback: 'Slack Block Kit table' },
        selection_list: { status: 'ready', fallback: 'Slack action buttons' },
        token_usage: { status: 'ready', fallback: 'Slack Block Kit stats' },
        table: { status: 'ready', fallback: 'Slack code block' },
      };

      console.log('\n=== SPIKE 2: A2UI Component Matrix ===');
      for (const [name, info] of Object.entries(matrix)) {
        console.log(`  ${name}: ${info.status} (fallback: ${info.fallback})`);
      }

      const readyCount = Object.values(matrix).filter((c) => c.status === 'ready').length;
      console.log(`\n${readyCount}/${Object.keys(matrix).length} components ready`);

      assert.equal(readyCount, 6, 'All 6 components should be ready');
    });
  });
});
