'use strict';

const { render } = require('./renderer');
const { logger } = require('../lib/logger');

/**
 * A2UI structured panel detection (P2-W3, F2-10 through F2-13).
 *
 * Inspects CLI events and detects when tool output matches a known
 * structured data shape. Returns rendered panel data when a match is found.
 *
 * Detection is heuristic. False positives are low-cost (raw data still
 * accessible via expand). False negatives degrade gracefully to raw text.
 */

// Test result patterns from common test runners
const TEST_PATTERNS = [
  /(\d+)\s+passing/i,
  /(\d+)\s+failing/i,
  /Tests:\s+\d+\s+(passed|failed)/i,
  /PASS\s+/,
  /FAIL\s+/,
  /\btest\b.*\b(passed|failed|ok)\b/i,
];

/**
 * Inspects an event and returns an A2UI panel if a structured shape is detected.
 *
 * @param {object} event - The parsed stream-json event
 * @returns {object|null} Rendered A2UI panel, or null if no match
 */
function detectStructuredPanel(event) {
  if (!event) return null;

  // Direct a2ui_render tool results
  const toolName = event.tool_name || event.tool_id || '';
  if (event.type === 'tool_result' && (toolName === 'a2ui_render' || toolName.includes('a2ui_render'))) {
    try {
      const data = typeof event.output === 'string' ? JSON.parse(event.output) : event.output;
      if (data && data.template && data.data) {
        return { type: 'a2ui', ...render(data.template, data.data) };
      }
    } catch { /* fall through */ }
  }

  // apps_list results -> app_inventory template
  const toolKey = event.tool_name || event.tool_id || '';
  if (event.type === 'tool_result' && (toolKey === 'apps_list' || toolKey.includes('apps_list'))) {
    try {
      const data = typeof event.output === 'string' ? JSON.parse(event.output) : event.output;
      if (data && data.apps && Array.isArray(data.apps)) {
        return { type: 'a2ui', ...render('app_inventory', { apps: data.apps }) };
      }
    } catch { /* fall through */ }
  }

  // apps_create results -> single app card
  if (event.type === 'tool_result' && (toolKey === 'apps_create' || toolKey.includes('apps_create'))) {
    try {
      const data = typeof event.output === 'string' ? JSON.parse(event.output) : event.output;
      if (data && data.url) {
        return {
          type: 'a2ui',
          component: 'app_created',
          name: data.name || 'app',
          url: data.url,
          status: data.status || 'running',
        };
      }
    } catch { /* fall through */ }
  }

  // Token stats in result events -> token_usage template
  if (event.type === 'result' && event.stats) {
    const stats = event.stats;
    if (stats.total_tokens || stats.input_tokens) {
      return {
        type: 'a2ui',
        ...render('token_usage', {
          total: {
            totalTokens: stats.total_tokens,
            inputTokens: stats.input_tokens || stats.input,
            outputTokens: stats.output_tokens || stats.output,
            cachedTokens: stats.cached_tokens || stats.cached,
            invocations: 1,
            estimatedCost: estimateCost(stats),
          },
          conversations: [],
        }),
      };
    }
  }

  // Test output detection from tool results
  if (event.type === 'tool_result') {
    const output = event.output || event.stdout || '';
    const text = typeof output === 'string' ? output : JSON.stringify(output);

    if (looksLikeTestOutput(text)) {
      const parsed = parseTestOutput(text);
      if (parsed) {
        return { type: 'a2ui', ...render('test_results', parsed) };
      }
    }

    // Generic JSON arrays -> table template
    try {
      const data = typeof output === 'string' ? JSON.parse(output) : output;
      if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
        const columns = Object.keys(data[0]);
        const rows = data.map((row) => columns.map((c) => String(row[c] ?? '')));
        return { type: 'a2ui', ...render('table', { title: 'Results', columns, rows }) };
      }
    } catch { /* not JSON, that's fine */ }
  }

  return null;
}

/**
 * Checks if text output looks like test runner output.
 */
function looksLikeTestOutput(text) {
  let matchCount = 0;
  for (const pattern of TEST_PATTERNS) {
    if (pattern.test(text)) matchCount++;
  }
  return matchCount >= 1;
}

/**
 * Attempts to parse test output into structured test_results data.
 */
function parseTestOutput(text) {
  const lines = text.split('\n');
  const tests = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let duration = 0;

  for (const line of lines) {
    // Mocha/Jest style: ✓ test name (123ms)
    const passMatch = line.match(/[✓✔]\s+(.+?)(?:\s+\((\d+)ms\))?$/);
    if (passMatch) {
      tests.push({ name: passMatch[1].trim(), passed: true, duration: parseInt(passMatch[2] || '0', 10) });
      passed++;
      continue;
    }

    // Failed test: ✗ test name / ✕ test name
    const failMatch = line.match(/[✗✕×]\s+(.+?)(?:\s+\((\d+)ms\))?$/);
    if (failMatch) {
      tests.push({ name: failMatch[1].trim(), passed: false, duration: parseInt(failMatch[2] || '0', 10) });
      failed++;
      continue;
    }

    // Summary line: N passing (Ns)
    const summaryPass = line.match(/(\d+)\s+passing\s*(?:\((\d+)([ms]+)\))?/i);
    if (summaryPass) {
      const count = parseInt(summaryPass[1], 10);
      if (count > passed) passed = count;
      if (summaryPass[2]) {
        const unit = summaryPass[3];
        duration = parseInt(summaryPass[2], 10) * (unit === 's' ? 1000 : 1);
      }
    }

    const summaryFail = line.match(/(\d+)\s+failing/i);
    if (summaryFail) {
      const count = parseInt(summaryFail[1], 10);
      if (count > failed) failed = count;
    }

    const summarySkip = line.match(/(\d+)\s+(?:pending|skipped)/i);
    if (summarySkip) {
      skipped = parseInt(summarySkip[1], 10);
    }
  }

  if (tests.length === 0 && passed === 0 && failed === 0) return null;

  return {
    suite: 'Test Suite',
    tests,
    passed,
    failed,
    skipped,
    duration,
  };
}

/**
 * Rough cost estimate based on Gemini pricing.
 */
function estimateCost(stats) {
  const input = stats.input_tokens || stats.input || 0;
  const output = stats.output_tokens || stats.output || 0;
  // Gemini 2.5 Flash rough pricing: $0.15/M input, $0.60/M output
  const cost = (input * 0.00000015) + (output * 0.0000006);
  return '$' + cost.toFixed(4);
}

module.exports = { detectStructuredPanel, looksLikeTestOutput, parseTestOutput };
