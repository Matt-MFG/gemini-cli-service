'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Spike 1: Token economics measurement.
 *
 * Measures actual per-message token cost with serial headless + resume.
 * Records input/output/cached tokens across conversations of varying length.
 *
 * Exit criteria: Cost-per-message curve documented. Budget defaults calibrated.
 *
 * Set RUN_SPIKES=true and ensure Gemini CLI is installed.
 */

const CONVERSATION_LENGTHS = [5, 10, 20, 30, 50];

const PROMPTS = [
  'Explain what a REST API is in 2 sentences.',
  'What is the difference between GET and POST?',
  'How do you handle authentication in APIs?',
  'Explain rate limiting and why it matters.',
  'What is CORS and how do you configure it?',
  'Describe the difference between SQL and NoSQL databases.',
  'What is an ORM and when should you use one?',
  'Explain database indexing strategies.',
  'What is connection pooling?',
  'How do you handle database migrations?',
  'What is Docker and why use it?',
  'Explain the difference between containers and VMs.',
  'What is a Dockerfile?',
  'How does Docker networking work?',
  'What is Docker Compose used for?',
  'Explain microservices architecture.',
  'What is an API gateway?',
  'How do you handle service discovery?',
  'What is circuit breaking?',
  'Explain event-driven architecture.',
  'What is CI/CD?',
  'How does GitHub Actions work?',
  'What is infrastructure as code?',
  'Explain blue-green deployments.',
  'What is a CDN?',
  'How do you monitor production applications?',
  'What is structured logging?',
  'Explain distributed tracing.',
  'What are SLOs and SLIs?',
  'How do you handle incidents?',
  'What is WebSocket?',
  'Explain Server-Sent Events.',
  'What is GraphQL?',
  'How does gRPC work?',
  'What is a message queue?',
  'Explain pub/sub patterns.',
  'What is caching strategy?',
  'How does Redis work?',
  'What is a reverse proxy?',
  'Explain load balancing algorithms.',
  'What is TLS/SSL?',
  'How does OAuth2 work?',
  'What is JWT?',
  'Explain RBAC.',
  'What is a firewall?',
  'How do you secure API keys?',
  'What is input validation?',
  'Explain SQL injection prevention.',
  'What is XSS?',
  'How do you handle secrets management?',
];

describe('Spike 1: Token economics', {
  skip: process.env.RUN_SPIKES !== 'true' ? 'Set RUN_SPIKES=true to run' : undefined,
}, () => {
  it('measures token costs across conversation lengths', async () => {
    const report = { conversations: [], summary: {} };

    for (const targetLength of CONVERSATION_LENGTHS) {
      console.log(`\n--- Conversation: ${targetLength} turns ---`);
      const conversation = await measureConversation(targetLength);
      report.conversations.push(conversation);

      console.log(`  Total tokens: ${conversation.totalTokens}`);
      console.log(`  Avg per turn: ${Math.round(conversation.avgTokensPerTurn)}`);
      console.log(`  Cache hit ratio: ${(conversation.cacheHitRatio * 100).toFixed(1)}%`);
    }

    // Calculate summary
    const allConvs = report.conversations;
    report.summary = {
      avgTokensPerTurn: Math.round(
        allConvs.reduce((s, c) => s + c.avgTokensPerTurn, 0) / allConvs.length
      ),
      avgCacheHitRatio: (
        allConvs.reduce((s, c) => s + c.cacheHitRatio, 0) / allConvs.length
      ).toFixed(2),
      costPerMillionTokens: 0.075, // Gemini pricing estimate
    };

    // Write report
    const reportPath = path.join(__dirname, '..', '..', 'docs', 'spike-1-results.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n=== SPIKE 1 RESULTS ===`);
    console.log(`Report written to: ${reportPath}`);
    console.log(`Avg tokens/turn: ${report.summary.avgTokensPerTurn}`);
    console.log(`Avg cache hit ratio: ${(parseFloat(report.summary.avgCacheHitRatio) * 100).toFixed(1)}%`);

    assert.ok(report.conversations.length === CONVERSATION_LENGTHS.length);
  });
});

async function measureConversation(turns) {
  const turnData = [];
  let sessionId = null;

  for (let i = 0; i < turns && i < PROMPTS.length; i++) {
    const prompt = PROMPTS[i];
    const args = ['-p', prompt, '--output-format', 'stream-json', '--yolo'];
    if (sessionId) args.push('--resume', sessionId);

    try {
      const output = execFileSync('gemini', args, {
        encoding: 'utf8',
        timeout: 60000,
      });

      const events = output.split('\n')
        .filter((l) => l.trim())
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);

      const result = events.find((e) => e.type === 'result');
      if (result) {
        if (!sessionId && result.session_id) sessionId = result.session_id;

        turnData.push({
          turn: i + 1,
          inputTokens: result.input_tokens || 0,
          outputTokens: result.output_tokens || 0,
          cachedTokens: result.cached_tokens || 0,
          totalTokens: result.total_tokens || 0,
          durationMs: result.duration_ms || 0,
        });
      }
    } catch (err) {
      console.log(`  Turn ${i + 1} failed: ${err.message}`);
    }
  }

  const totalTokens = turnData.reduce((s, t) => s + t.totalTokens, 0);
  const totalCached = turnData.reduce((s, t) => s + t.cachedTokens, 0);
  const totalInput = turnData.reduce((s, t) => s + t.inputTokens, 0);

  return {
    targetTurns: turns,
    actualTurns: turnData.length,
    turns: turnData,
    totalTokens,
    avgTokensPerTurn: turnData.length > 0 ? totalTokens / turnData.length : 0,
    cacheHitRatio: totalInput > 0 ? totalCached / totalInput : 0,
  };
}
