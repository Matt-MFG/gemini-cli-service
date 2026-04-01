'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { StreamJsonParser } = require('./stream-parser');
const { CliTimeoutError } = require('../lib/errors');
const { logger } = require('../lib/logger');
const { DEFAULTS } = require('../lib/constants');

/**
 * Spawns a headless Gemini CLI invocation for a single message.
 *
 * Each user message becomes:
 *   gemini -p "user message" --resume <session_id> --output-format stream-json --yolo
 *
 * The CLI loads the session, processes the message, streams events, saves, and exits.
 *
 * @param {object} opts
 * @param {string} opts.text - User message text
 * @param {string} opts.sessionId - CLI session ID to resume
 * @param {string} [opts.cliPath] - Path to gemini binary
 * @param {number} [opts.timeoutMs] - Per-invocation timeout (D-04)
 * @param {object} [opts.env] - Additional environment variables
 * @returns {CliInvocation} Event-emitting invocation handle
 */
function spawnCli(opts) {
  const {
    text,
    sessionId,
    cliPath = DEFAULTS.CLI_PATH,
    timeoutMs = DEFAULTS.CLI_TIMEOUT_MS,
    env = {},
  } = opts;

  const invocation = new CliInvocation();
  const args = buildArgs(text, sessionId);
  const log = logger.child({ sessionId, cliPath });

  log.info({ args: args.join(' ') }, 'Spawning CLI invocation');

  const child = spawn(cliPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    windowsHide: true,
  });

  invocation._child = child;
  invocation._sessionId = sessionId;

  // Parse stdout through stream-json parser
  const parser = new StreamJsonParser({ sessionId });
  child.stdout.pipe(parser);

  parser.on('data', (event) => {
    invocation.emit('event', event);
  });

  // Capture stderr for diagnostics
  const stderrChunks = [];
  child.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk);
  });

  // Timeout handling (D-04)
  const timer = setTimeout(() => {
    log.warn({ timeoutMs }, 'CLI invocation timed out; killing process (D-04)');
    child.kill('SIGTERM');
    // Give it 5s to clean up, then force kill
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 5000);
    invocation._timedOut = true;
  }, timeoutMs);

  child.on('close', (code, signal) => {
    clearTimeout(timer);
    const stderr = Buffer.concat(stderrChunks).toString();
    const parserStats = parser.stats;

    if (invocation._timedOut) {
      const err = new CliTimeoutError(sessionId, timeoutMs);
      log.error({ err, stderr: stderr.slice(0, 500) }, 'CLI invocation timed out');
      invocation.emit('error', err);
    } else if (code !== 0 && code !== null) {
      log.error({ code, signal, stderr: stderr.slice(0, 500) }, 'CLI exited with error');
      invocation.emit('error', new Error(`CLI exited with code ${code}: ${stderr.slice(0, 200)}`));
    } else {
      log.info({ code, parserStats }, 'CLI invocation completed');
    }

    invocation.emit('close', { code, signal, stderr, parserStats });
  });

  child.on('error', (err) => {
    clearTimeout(timer);
    log.error({ err }, 'Failed to spawn CLI process');
    invocation.emit('error', err);
  });

  return invocation;
}

/**
 * Builds CLI arguments for a headless invocation.
 */
function buildArgs(text, sessionId) {
  const args = ['-p', text, '--output-format', 'stream-json', '--yolo'];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  return args;
}

/**
 * Handle to a running CLI invocation.
 * Emits: 'event' (parsed JSON), 'error' (Error), 'close' ({code, signal, stderr, parserStats})
 */
class CliInvocation extends EventEmitter {
  constructor() {
    super();
    this._child = null;
    this._sessionId = null;
    this._timedOut = false;
  }

  /** Kill the running CLI process */
  kill(signal = 'SIGTERM') {
    if (this._child && !this._child.killed) {
      this._child.kill(signal);
    }
  }

  /** Whether the invocation timed out */
  get timedOut() {
    return this._timedOut;
  }

  /** Collect all events as a promise. Resolves on close, rejects on error. */
  async collect() {
    const events = [];
    return new Promise((resolve, reject) => {
      this.on('event', (e) => events.push(e));
      this.on('error', reject);
      this.on('close', (info) => resolve({ events, ...info }));
    });
  }
}

module.exports = { spawnCli, buildArgs, CliInvocation };
