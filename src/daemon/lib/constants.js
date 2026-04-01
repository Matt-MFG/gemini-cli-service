'use strict';

/** Known stream-json event types from Gemini CLI */
const EVENT_TYPES = Object.freeze({
  TURN_START: 'turn_start',
  MODEL_TURN: 'model_turn',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  MODEL_RESPONSE: 'model_response',
  ERROR: 'error',
  RESULT: 'result',
});

const KNOWN_EVENT_TYPES = new Set(Object.values(EVENT_TYPES));

/** Default configuration values */
const DEFAULTS = Object.freeze({
  PORT: 3100,
  HOST: '0.0.0.0',
  CLI_PATH: 'gemini',
  CLI_TIMEOUT_MS: 10 * 60 * 1000, // 10 minutes (D-04)
  SESSION_DIR: './data/sessions',
  DB_PATH: './data/registry.db',
  LOG_LEVEL: 'info',
  DOMAIN_SUFFIX: 'agent.example.com',
  META_COMMAND_TIMEOUT_MS: 500, // D-06: meta commands within 500ms
  FIRST_EVENT_TARGET_MS: 3000, // D-02: first event within 3s
});

/** Slash command categories (CL-01 through CL-06) */
const COMMAND_CATEGORIES = Object.freeze({
  TEXT_SAFE: 'text_safe',
  PARAMETERIZED_SAFE: 'parameterized_safe',
  UNSUPPORTED: 'unsupported',
  META: 'meta',
});

module.exports = {
  EVENT_TYPES,
  KNOWN_EVENT_TYPES,
  DEFAULTS,
  COMMAND_CATEGORIES,
};
