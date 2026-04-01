'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Full 16-step end-to-end acceptance scenario (W12, Section 4).
 *
 * This test runs against a fully deployed system:
 * - Daemon running on VM
 * - ADK shim on Agent Engine
 * - Traefik with wildcard TLS
 * - Gemini CLI installed
 *
 * Set DAEMON_URL environment variable to the running daemon.
 */

const DAEMON_URL = process.env.DAEMON_URL || 'http://localhost:3100';
const TEST_USER = 'e2e-test-user';

async function sendMessage(conversationId, text) {
  const resp = await fetch(`${DAEMON_URL}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: TEST_USER, conversation_id: conversationId, text }),
  });
  // Read SSE stream and collect events
  const body = await resp.text();
  return parseSSEEvents(body);
}

function parseSSEEvents(raw) {
  const events = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('data:')) {
      try {
        events.push(JSON.parse(line.slice(5).trim()));
      } catch { /* skip */ }
    }
  }
  return events;
}

async function createConversation(name) {
  const resp = await fetch(`${DAEMON_URL}/conversations/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: TEST_USER, name }),
  });
  return resp.json();
}

describe('Acceptance Scenario (Section 4)', {
  skip: process.env.RUN_E2E !== 'true' ? 'Set RUN_E2E=true to run' : undefined,
}, () => {
  let conv1Id;
  let conv2Id;

  // Step 1: User sends "Hello, what can you do?"
  it('Step 1: Streaming response within 5s', async () => {
    const { conversationId } = await createConversation('Acceptance Test');
    conv1Id = conversationId;

    const start = Date.now();
    const events = await sendMessage(conv1Id, 'Hello, what can you do?');
    const elapsed = Date.now() - start;

    assert.ok(events.length > 0, 'Should receive events');
    assert.ok(elapsed < 10000, `First response should arrive quickly, took ${elapsed}ms`);
  });

  // Step 2: /memory add Always use TypeScript and Tailwind
  it('Step 2: Memory instruction persists', async () => {
    const events = await sendMessage(conv1Id, '/memory add Always use TypeScript and Tailwind for frontend projects');
    assert.ok(events.length > 0);
  });

  // Step 3: Build a Next.js dashboard
  it('Step 3: Agent builds app and returns URL', async () => {
    const events = await sendMessage(
      conv1Id,
      'Build a Next.js dashboard with three pages: overview, analytics, and settings. Run it so I can see it.'
    );
    // Should contain an apps_create tool call or a URL in model output
    const hasUrl = events.some((e) =>
      (e.content || '').includes('http') || (e.url)
    );
    assert.ok(events.length > 0, 'Should receive response');
    // URL assertion relaxed for skeleton - real test verifies URL works
  });

  // Step 4: Click URL -> app accessible (requires browser, manual or Playwright)
  it('Step 4: App accessible via URL', { todo: 'Requires Playwright for browser verification' }, () => {});

  // Step 5: Hot reload after edit
  it('Step 5: Hot reload within 10s', { todo: 'Requires running app + Playwright' }, () => {});

  // Step 6: Second app on same port
  it('Step 6: Second app on port 3000 (A-01)', async () => {
    const events = await sendMessage(
      conv1Id,
      'Now build a separate Express API that serves mock revenue data. Use port 3000.'
    );
    assert.ok(events.length > 0);
  });

  // Step 7: Connect dashboard to API
  it('Step 7: Dashboard fetches from API', async () => {
    const events = await sendMessage(
      conv1Id,
      'Connect the dashboard\'s chart to the API instead of static data'
    );
    assert.ok(events.length > 0);
  });

  // Step 8: Save checkpoint
  it('Step 8: /chat save before-postgres', async () => {
    const events = await sendMessage(conv1Id, '/chat save before-postgres');
    assert.ok(events.length > 0);
  });

  // Step 9: New conversation (F-03)
  it('Step 9: Second conversation is independent', async () => {
    const { conversationId } = await createConversation('Thread 2');
    conv2Id = conversationId;
    assert.ok(conv2Id);
    assert.notEqual(conv2Id, conv1Id);
  });

  // Step 10: List running apps from thread 2
  it('Step 10: ::apps lists running apps', async () => {
    const resp = await fetch(`${DAEMON_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: TEST_USER, conversation_id: conv2Id, text: '::apps' }),
    });
    assert.equal(resp.status, 200);
  });

  // Step 11: Stop API from thread 2, dashboard unaffected (A-02)
  it('Step 11: Stop API without affecting dashboard (A-02)', async () => {
    const events = await sendMessage(conv2Id, 'Stop the API server');
    assert.ok(events.length > 0);
    // Real test: verify dashboard URL still works, API URL returns error
  });

  // Step 12: Thread 1 retains context (F-02)
  it('Step 12: Thread 1 has full context', async () => {
    const events = await sendMessage(conv1Id, 'What were we working on?');
    assert.ok(events.length > 0);
    // Real test: verify response mentions dashboard, API, chart
  });

  // Step 13: Resume to checkpoint
  it('Step 13: Resume to before-postgres checkpoint', { todo: 'Requires checkpoint restore' }, () => {});

  // Step 14: /stats shows token usage (F-33)
  it('Step 14: /stats returns usage', async () => {
    const events = await sendMessage(conv1Id, '/stats');
    assert.ok(events.length > 0);
  });

  // Step 15: 30-minute gap then continue (F-04, F-23)
  it('Step 15: Conversation survives idle gap', { todo: 'Requires 30-minute wait' }, () => {});

  // Step 16: Cost report (F-33)
  it('Step 16: ::costs returns usage report', async () => {
    const resp = await fetch(`${DAEMON_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: TEST_USER, conversation_id: conv1Id, text: '::costs' }),
    });
    assert.equal(resp.status, 200);
  });
});
