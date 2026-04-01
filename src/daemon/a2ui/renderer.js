'use strict';

const { logger } = require('../lib/logger');

/**
 * A2UI template renderer (W10, F-27/F-28/F-29).
 *
 * Renders structured agent output as visual elements for chat platforms.
 * Supports both A2UI JSONL format and platform-native fallbacks
 * (Slack Block Kit, HTML).
 */

const templates = {
  /**
   * Test results table (F-27)
   */
  test_results(data) {
    const { suite, tests, passed, failed, skipped, duration } = data;
    return {
      component: 'table',
      title: `Test Results: ${suite || 'Test Suite'}`,
      summary: `${passed}/${tests.length} passed${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped` : ''} (${duration}ms)`,
      columns: ['Status', 'Test', 'Duration'],
      rows: tests.map((t) => [
        t.passed ? '✓' : '✗',
        t.name,
        `${t.duration || 0}ms`,
      ]),
      style: failed > 0 ? 'error' : 'success',
    };
  },

  /**
   * File changes summary for approval (F-29)
   */
  file_changes(data) {
    const { files, action } = data;
    return {
      component: 'approval',
      title: `Proposed Changes: ${action || 'Edit files'}`,
      summary: `${files.length} file${files.length !== 1 ? 's' : ''} will be modified`,
      items: files.map((f) => ({
        path: f.path,
        action: f.action || 'modify',
        additions: f.additions || 0,
        deletions: f.deletions || 0,
        preview: f.preview,
      })),
    };
  },

  /**
   * App inventory list (F-26)
   */
  app_inventory(data) {
    const { apps } = data;
    return {
      component: 'table',
      title: 'Running Applications',
      summary: `${apps.filter((a) => a.status === 'running').length} running, ${apps.filter((a) => a.status === 'stopped').length} stopped`,
      columns: ['Name', 'Status', 'URL', 'Port'],
      rows: apps.map((a) => [
        a.name,
        a.status === 'running' ? '● Running' : '○ Stopped',
        a.url || '—',
        String(a.port || '—'),
      ]),
    };
  },

  /**
   * Selection list for interactive commands (F-28)
   */
  selection_list(data) {
    const { prompt, options } = data;
    return {
      component: 'selection',
      title: prompt || 'Select an option',
      options: options.map((o, i) => ({
        id: o.id || String(i),
        label: o.label,
        detail: o.detail,
        value: o.value,
      })),
    };
  },

  /**
   * Token usage stats (F-33)
   */
  token_usage(data) {
    const { total, conversations } = data;
    return {
      component: 'stats',
      title: 'Token Usage',
      summary: `${(total.totalTokens || 0).toLocaleString()} total tokens · ${total.estimatedCost || '$0.00'}`,
      metrics: [
        { label: 'Input Tokens', value: (total.inputTokens || 0).toLocaleString() },
        { label: 'Output Tokens', value: (total.outputTokens || 0).toLocaleString() },
        { label: 'Cached Tokens', value: (total.cachedTokens || 0).toLocaleString() },
        { label: 'Invocations', value: String(total.invocations || 0) },
        { label: 'Estimated Cost', value: total.estimatedCost || '$0.00' },
      ],
      breakdown: conversations,
    };
  },

  /**
   * Generic table for arbitrary data
   */
  table(data) {
    const { title, columns, rows } = data;
    return {
      component: 'table',
      title: title || 'Data',
      columns: columns || [],
      rows: rows || [],
    };
  },
};

/**
 * Renders structured data using a named template.
 *
 * @param {string} templateName - Template to use
 * @param {object} data - Data to render
 * @returns {object} Rendered component spec
 */
function render(templateName, data) {
  const template = templates[templateName];
  if (!template) {
    logger.warn({ templateName }, 'Unknown A2UI template; falling back to raw data');
    return { component: 'raw', data };
  }

  try {
    return template(data);
  } catch (err) {
    logger.error({ err, templateName }, 'Failed to render A2UI template');
    return { component: 'error', message: `Render error: ${err.message}` };
  }
}

/**
 * Converts a rendered component to Slack Block Kit format (fallback).
 */
function toSlackBlocks(rendered) {
  const blocks = [];

  // Header
  if (rendered.title) {
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: rendered.title },
    });
  }

  // Summary
  if (rendered.summary) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: rendered.summary },
    });
  }

  // Table rows as text
  if (rendered.component === 'table' && rendered.rows) {
    const header = rendered.columns.join(' | ');
    const rowsText = rendered.rows.map((r) => r.join(' | ')).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `\`\`\`\n${header}\n${'-'.repeat(header.length)}\n${rowsText}\n\`\`\`` },
    });
  }

  // Selection as buttons
  if (rendered.component === 'selection' && rendered.options) {
    blocks.push({
      type: 'actions',
      elements: rendered.options.slice(0, 25).map((o) => ({
        type: 'button',
        text: { type: 'plain_text', text: o.label.slice(0, 75) },
        value: o.value || o.id,
        action_id: `select_${o.id}`,
      })),
    });
  }

  return blocks;
}

module.exports = { render, toSlackBlocks, templates };
