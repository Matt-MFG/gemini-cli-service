'use strict';

const { Transform } = require('node:stream');
const { KNOWN_EVENT_TYPES } = require('../lib/constants');
const { logger } = require('../lib/logger');

/**
 * Transform stream that parses newline-delimited JSON from Gemini CLI stdout.
 *
 * Each line is expected to be a valid JSON object with a `type` field.
 * - Valid events are emitted as parsed objects
 * - Malformed JSON lines are skipped with a warning (D-11)
 * - Unknown event types are logged and passed through (V-04)
 *
 * Usage:
 *   cliProcess.stdout.pipe(new StreamJsonParser())
 */
class StreamJsonParser extends Transform {
  constructor(opts = {}) {
    super({ ...opts, objectMode: true });
    this._buffer = '';
    this._lineCount = 0;
    this._errorCount = 0;
    this._sessionId = opts.sessionId || 'unknown';
  }

  _transform(chunk, _encoding, callback) {
    this._buffer += chunk.toString();

    const lines = this._buffer.split('\n');
    // Keep the last (possibly incomplete) line in the buffer
    this._buffer = lines.pop() || '';

    for (const line of lines) {
      this._parseLine(line.trim());
    }

    callback();
  }

  _flush(callback) {
    // Process any remaining data in buffer
    if (this._buffer.trim()) {
      this._parseLine(this._buffer.trim());
    }
    callback();
  }

  _parseLine(line) {
    if (!line) return;

    this._lineCount++;
    let parsed;

    try {
      parsed = JSON.parse(line);
    } catch {
      this._errorCount++;
      logger.warn(
        { sessionId: this._sessionId, line: line.slice(0, 200), lineNumber: this._lineCount },
        'Malformed JSON line in stream-json output; skipping (D-11)'
      );
      return;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      this._errorCount++;
      logger.warn(
        { sessionId: this._sessionId, lineNumber: this._lineCount },
        'Non-object JSON value in stream-json output; skipping'
      );
      return;
    }

    if (!parsed.type) {
      this._errorCount++;
      logger.warn(
        { sessionId: this._sessionId, lineNumber: this._lineCount, keys: Object.keys(parsed) },
        'JSON object missing "type" field; skipping'
      );
      return;
    }

    if (!KNOWN_EVENT_TYPES.has(parsed.type)) {
      logger.info(
        { sessionId: this._sessionId, type: parsed.type },
        'Unknown event type in stream-json output; passing through (V-04)'
      );
    }

    this.push(parsed);
  }

  get stats() {
    return {
      linesProcessed: this._lineCount,
      errorsSkipped: this._errorCount,
    };
  }
}

/**
 * Collects all events from a readable stream of parsed events.
 * Useful for testing and non-streaming consumers.
 */
async function collectEvents(eventStream) {
  const events = [];
  for await (const event of eventStream) {
    events.push(event);
  }
  return events;
}

module.exports = { StreamJsonParser, collectEvents };
