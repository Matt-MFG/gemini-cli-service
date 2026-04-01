'use strict';

const { logger } = require('../lib/logger');

/**
 * Interactive adapters for parameterized-safe commands (F-08).
 *
 * When a user types a bare command that would normally open a TUI
 * (e.g., /resume without args), these adapters provide a chat-friendly
 * alternative: show a selection list, wait for the user's choice,
 * then forward the parameterized version to CLI.
 */

const adapters = {
  /**
   * /resume (bare) -> show session list for selection (CL-03)
   */
  session_picker: {
    async generate(context) {
      const { sessionManager, userId } = context;
      const sessions = sessionManager.list(userId);

      if (sessions.length === 0) {
        return {
          type: 'message',
          content: 'No previous sessions found. Start a new conversation instead.',
        };
      }

      return {
        type: 'interactive_selection',
        command: '/resume',
        prompt: 'Select a session to resume:',
        options: sessions.map((s) => ({
          id: s.conversationId,
          label: s.firstMessage || `Session ${s.conversationId.slice(0, 8)}`,
          detail: formatSessionDetail(s),
          value: s.conversationId,
        })),
      };
    },

    /**
     * Converts user selection back to a CLI command.
     */
    resolve(selection) {
      return `/resume ${selection.value}`;
    },
  },

  /**
   * /restore (bare) -> show checkpoint list
   */
  checkpoint_picker: {
    async generate(context) {
      const { sessionManager, userId, conversationId } = context;

      let metadata;
      try {
        metadata = sessionManager.getMetadata(userId, conversationId);
      } catch {
        return {
          type: 'message',
          content: 'No active conversation. Start or resume one first.',
        };
      }

      const checkpoints = Object.entries(metadata.checkpoints || {});
      if (checkpoints.length === 0) {
        return {
          type: 'message',
          content: 'No checkpoints saved in this conversation. Use `/chat save <name>` to create one.',
        };
      }

      return {
        type: 'interactive_selection',
        command: '/restore',
        prompt: 'Select a checkpoint to restore:',
        options: checkpoints.map(([name, info]) => ({
          id: name,
          label: name,
          detail: `Saved at turn ${info.turnCount} on ${info.savedAt}`,
          value: name,
        })),
      };
    },

    resolve(selection) {
      return `/restore ${selection.value}`;
    },
  },
};

/**
 * Gets the adapter for a given adapter name.
 */
function getAdapter(adapterName) {
  const adapter = adapters[adapterName];
  if (!adapter) {
    logger.warn({ adapterName }, 'Unknown interactive adapter');
    return null;
  }
  return adapter;
}

function formatSessionDetail(session) {
  const turns = session.turnCount || 0;
  const lastActive = session.updatedAt
    ? new Date(session.updatedAt).toLocaleString()
    : 'unknown';
  return `${turns} turn${turns !== 1 ? 's' : ''} · last active ${lastActive}`;
}

module.exports = { getAdapter, adapters };
