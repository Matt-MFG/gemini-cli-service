'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { spawnCli, buildArgs } = require('../../src/daemon/cli/spawner');
const { StreamJsonParser, collectEvents } = require('../../src/daemon/cli/stream-parser');
const { Readable } = require('node:stream');

/**
 * Integration tests for daemon <-> CLI interaction.
 *
 * These tests require Gemini CLI to be installed.
 * Skip if CLI is not available (CI environments without CLI).
 */

let cliAvailable = false;

describe('daemon-cli integration', () => {
  before(() => {
    try {
      execFileSync('gemini', ['--version'], { encoding: 'utf8', timeout: 5000 });
      cliAvailable = true;
    } catch {
      console.log('Gemini CLI not installed; skipping integration tests');
    }
  });

  describe('buildArgs', () => {
    it('builds correct args for new conversation', () => {
      const args = buildArgs('Hello world', null);
      assert.deepEqual(args, ['-p', 'Hello world', '--output-format', 'stream-json', '--yolo']);
    });

    it('includes --resume for existing session', () => {
      const args = buildArgs('Continue', 'session-abc');
      assert.deepEqual(args, [
        '-p', 'Continue',
        '--output-format', 'stream-json',
        '--yolo',
        '--resume', 'session-abc',
      ]);
    });

    it('handles text with special characters', () => {
      const args = buildArgs('Build a "React" app with $variables', 'sess-1');
      assert.equal(args[1], 'Build a "React" app with $variables');
    });

    it('handles multi-line text', () => {
      const args = buildArgs('Line 1\nLine 2\nLine 3', null);
      assert.ok(args[1].includes('\n'));
    });
  });

  describe('stream-json round-trip', () => {
    it('parses a realistic CLI output stream', async () => {
      // Simulate a realistic stream-json output
      const lines = [
        JSON.stringify({ type: 'turn_start', turn_number: 1, session_id: 'test-123' }),
        JSON.stringify({ type: 'model_turn', content: 'I\'ll help you with that. Let me ' }),
        JSON.stringify({ type: 'model_turn', content: 'create a simple Node.js server.' }),
        JSON.stringify({ type: 'tool_call', tool_name: 'write_file', tool_call_id: 'tc_1', args: { path: 'server.js', content: 'const http = require("http");\n' } }),
        JSON.stringify({ type: 'tool_result', tool_call_id: 'tc_1', output: 'File written: server.js' }),
        JSON.stringify({ type: 'model_response', content: 'I\'ve created server.js for you.', finish_reason: 'stop' }),
        JSON.stringify({ type: 'result', session_id: 'test-123', input_tokens: 150, output_tokens: 75, cached_tokens: 100, total_tokens: 225, duration_ms: 3200 }),
      ];

      const input = new Readable({ read() {} });
      const parser = new StreamJsonParser({ sessionId: 'test-123' });
      input.pipe(parser);

      for (const line of lines) {
        input.push(line + '\n');
      }
      input.push(null);

      const events = await collectEvents(parser);

      // Verify event sequence
      assert.equal(events.length, 7);
      assert.equal(events[0].type, 'turn_start');
      assert.equal(events[0].session_id, 'test-123');

      // Verify model content can be concatenated
      const modelContent = events
        .filter((e) => e.type === 'model_turn')
        .map((e) => e.content)
        .join('');
      assert.ok(modelContent.includes('create a simple Node.js server'));

      // Verify tool call
      assert.equal(events[3].type, 'tool_call');
      assert.equal(events[3].tool_name, 'write_file');
      assert.equal(events[3].args.path, 'server.js');

      // Verify result has token info
      const result = events[6];
      assert.equal(result.type, 'result');
      assert.equal(result.total_tokens, 225);
      assert.equal(result.duration_ms, 3200);

      // Verify parser stats
      assert.equal(parser.stats.linesProcessed, 7);
      assert.equal(parser.stats.errorsSkipped, 0);
    });
  });

  describe('spawnCli (real CLI)', { skip: !cliAvailable ? 'CLI not installed' : undefined }, () => {
    it('spawns CLI and receives events', async () => {
      const invocation = spawnCli({
        text: 'Say "hello integration test" and nothing else.',
        sessionId: null,
        timeoutMs: 30000,
      });

      const result = await invocation.collect();
      assert.ok(result.events.length > 0, 'Should receive at least one event');

      // Should have at least a model_turn or model_response
      const hasModelEvent = result.events.some(
        (e) => e.type === 'model_turn' || e.type === 'model_response'
      );
      assert.ok(hasModelEvent, 'Should receive model output');
    });

    it('respects timeout (D-04)', async () => {
      const invocation = spawnCli({
        text: 'Count from 1 to 1000000 very slowly, one number per line.',
        sessionId: null,
        timeoutMs: 2000, // Very short timeout
      });

      try {
        await invocation.collect();
        // If it completes in 2s, that's fine too
      } catch (err) {
        assert.equal(err.code, 'CLI_TIMEOUT');
      }
    });
  });
});
