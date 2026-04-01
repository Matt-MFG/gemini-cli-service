'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { StreamJsonParser, collectEvents } = require('../../../src/daemon/cli/stream-parser');

describe('StreamJsonParser', () => {
  function createParserStream(lines) {
    const input = new Readable({ read() {} });
    const parser = new StreamJsonParser({ sessionId: 'test-session' });
    input.pipe(parser);

    // Push lines as newline-delimited data
    for (const line of lines) {
      input.push(line + '\n');
    }
    input.push(null);

    return parser;
  }

  it('parses valid stream-json events', async () => {
    const events = await collectEvents(
      createParserStream([
        JSON.stringify({ type: 'turn_start', turn_number: 1 }),
        JSON.stringify({ type: 'model_turn', content: 'Hello' }),
        JSON.stringify({ type: 'result', total_tokens: 100 }),
      ])
    );

    assert.equal(events.length, 3);
    assert.equal(events[0].type, 'turn_start');
    assert.equal(events[0].turn_number, 1);
    assert.equal(events[1].type, 'model_turn');
    assert.equal(events[1].content, 'Hello');
    assert.equal(events[2].type, 'result');
    assert.equal(events[2].total_tokens, 100);
  });

  it('skips malformed JSON lines (D-11)', async () => {
    const events = await collectEvents(
      createParserStream([
        JSON.stringify({ type: 'turn_start' }),
        'this is not json',
        JSON.stringify({ type: 'model_turn', content: 'Hello' }),
        '{invalid json',
        JSON.stringify({ type: 'result' }),
      ])
    );

    assert.equal(events.length, 3);
    assert.equal(events[0].type, 'turn_start');
    assert.equal(events[1].type, 'model_turn');
    assert.equal(events[2].type, 'result');
  });

  it('skips non-object JSON values', async () => {
    const events = await collectEvents(
      createParserStream([
        '"just a string"',
        '42',
        'null',
        JSON.stringify({ type: 'model_turn', content: 'ok' }),
      ])
    );

    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'model_turn');
  });

  it('skips objects without type field', async () => {
    const events = await collectEvents(
      createParserStream([
        JSON.stringify({ content: 'no type field' }),
        JSON.stringify({ type: 'model_turn', content: 'has type' }),
      ])
    );

    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'model_turn');
  });

  it('passes through unknown event types (V-04)', async () => {
    const events = await collectEvents(
      createParserStream([
        JSON.stringify({ type: 'future_event_type', data: 'something' }),
        JSON.stringify({ type: 'model_turn', content: 'known' }),
      ])
    );

    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'future_event_type');
    assert.equal(events[1].type, 'model_turn');
  });

  it('handles empty lines', async () => {
    const events = await collectEvents(
      createParserStream([
        '',
        JSON.stringify({ type: 'turn_start' }),
        '',
        '',
        JSON.stringify({ type: 'result' }),
      ])
    );

    assert.equal(events.length, 2);
  });

  it('tracks parser stats', async () => {
    const parser = createParserStream([
      JSON.stringify({ type: 'turn_start' }),
      'bad json',
      JSON.stringify({ type: 'result' }),
    ]);

    await collectEvents(parser);

    assert.equal(parser.stats.linesProcessed, 3);
    assert.equal(parser.stats.errorsSkipped, 1);
  });

  it('handles chunked data across buffer boundaries', async () => {
    const input = new Readable({ read() {} });
    const parser = new StreamJsonParser({ sessionId: 'test-chunked' });
    input.pipe(parser);

    // Send JSON split across chunks
    const json = JSON.stringify({ type: 'model_turn', content: 'split across chunks' });
    const mid = Math.floor(json.length / 2);
    input.push(json.slice(0, mid));
    input.push(json.slice(mid) + '\n');
    input.push(null);

    const events = await collectEvents(parser);
    assert.equal(events.length, 1);
    assert.equal(events[0].content, 'split across chunks');
  });
});
