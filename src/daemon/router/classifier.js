'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { COMMAND_CATEGORIES } = require('../lib/constants');
const { logger } = require('../lib/logger');

/**
 * Classifies incoming user text into routing categories.
 *
 * Categories:
 * - text_safe: forwarded as `-p` content to CLI (CL-02)
 * - parameterized_safe: interactive when bare, text-safe with args (CL-03)
 * - unsupported: terminal-specific, return explanation within 200ms (CL-04)
 * - meta: daemon-handled commands (::new, ::list, ::costs, etc.)
 * - passthrough: not a command, forward as regular message
 *
 * Custom .toml commands are treated as text_safe (CL-05).
 * Registry is hot-reloadable without daemon restart (CL-06).
 */
class CommandClassifier {
  constructor(registryPath, opts = {}) {
    this._registryPath = registryPath || path.join(__dirname, 'command-registry.json');
    this._registry = null;
    this._watcher = null;
    this._lastLoad = 0;
    this._loadRegistry();

    // Watch for changes (CL-06)
    if (opts.watch !== false && fs.existsSync(this._registryPath)) {
      this._watcher = fs.watch(this._registryPath, () => {
        logger.info('Command registry changed; reloading');
        this._loadRegistry();
      });
      this._watcher.unref(); // Don't keep process alive
    }
  }

  /**
   * Classifies user input text.
   *
   * @param {string} text - Raw user input
   * @returns {ClassificationResult}
   */
  classify(text) {
    const trimmed = text.trim();

    // Check meta commands first (::new, ::list, etc.)
    if (trimmed.startsWith('::')) {
      return this._classifyMeta(trimmed);
    }

    // Check slash commands
    if (trimmed.startsWith('/')) {
      return this._classifySlash(trimmed);
    }

    // Regular message — passthrough to CLI
    return {
      category: 'passthrough',
      text: trimmed,
      cliText: trimmed,
    };
  }

  _classifyMeta(text) {
    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    const meta = this._registry.meta_commands[command];
    if (!meta) {
      return {
        category: 'passthrough',
        text,
        cliText: text,
      };
    }

    return {
      category: COMMAND_CATEGORIES.META,
      command,
      args,
      handler: meta.handler,
      description: meta.description,
    };
  }

  _classifySlash(text) {
    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    const entry = this._registry.commands[command];

    // Unknown slash command → treat as text_safe (CL-05: custom .toml commands)
    if (!entry) {
      return {
        category: COMMAND_CATEGORIES.TEXT_SAFE,
        command,
        args,
        text,
        cliText: text,
      };
    }

    switch (entry.category) {
      case COMMAND_CATEGORIES.TEXT_SAFE:
        return {
          category: COMMAND_CATEGORIES.TEXT_SAFE,
          command,
          args,
          text,
          cliText: text, // Forward as-is to CLI
        };

      case COMMAND_CATEGORIES.PARAMETERIZED_SAFE:
        if (args) {
          // Has args → text-safe, forward to CLI
          return {
            category: COMMAND_CATEGORIES.TEXT_SAFE,
            command,
            args,
            text,
            cliText: text,
          };
        }
        // Bare → needs interactive adapter
        return {
          category: COMMAND_CATEGORIES.PARAMETERIZED_SAFE,
          command,
          args: '',
          text,
          adapter: entry.interactive_adapter,
          description: entry.description,
        };

      case COMMAND_CATEGORIES.UNSUPPORTED:
        return {
          category: COMMAND_CATEGORIES.UNSUPPORTED,
          command,
          text,
          explanation: entry.explanation,
        };

      default:
        logger.warn({ command, category: entry.category }, 'Unknown command category');
        return {
          category: COMMAND_CATEGORIES.TEXT_SAFE,
          command,
          args,
          text,
          cliText: text,
        };
    }
  }

  _loadRegistry() {
    try {
      const raw = fs.readFileSync(this._registryPath, 'utf8');
      this._registry = JSON.parse(raw);
      this._lastLoad = Date.now();
      logger.info(
        { commandCount: Object.keys(this._registry.commands).length },
        'Command registry loaded'
      );
    } catch (err) {
      logger.error({ err: err.message, path: this._registryPath }, 'Failed to load command registry');
      if (!this._registry) {
        this._registry = { commands: {}, meta_commands: {} };
      }
    }
  }

  /** Returns the full registry for inspection */
  get registry() {
    return this._registry;
  }
}

module.exports = { CommandClassifier };
