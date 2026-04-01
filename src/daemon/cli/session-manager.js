'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { logger } = require('../lib/logger');
const { SessionNotFoundError } = require('../lib/errors');

/**
 * Maps (user_id, conversation_id) to CLI session IDs on disk.
 *
 * Session files are stored at: SESSION_DIR/{user_id}/{conversation_id}/
 * The CLI writes its own session data there via --resume.
 *
 * Supports: create, list, get, branch (F-05), delete.
 */
class SessionManager {
  constructor(sessionDir) {
    this._sessionDir = sessionDir;
    this._metadataCache = new Map(); // key: `${userId}/${conversationId}`
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  /**
   * Creates a new conversation session for a user.
   * Returns the conversation ID and session path.
   */
  create(userId, name) {
    const conversationId = crypto.randomUUID();
    const sessionPath = this._sessionPath(userId, conversationId);
    fs.mkdirSync(sessionPath, { recursive: true });

    const metadata = {
      conversationId,
      userId,
      name: name || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turnCount: 0,
      firstMessage: null,
      checkpoints: {},
    };

    this._writeMetadata(userId, conversationId, metadata);
    logger.info({ userId, conversationId }, 'Created new conversation session');

    return { conversationId, sessionPath, metadata };
  }

  /**
   * Gets the CLI session ID (path) for a conversation.
   * The CLI uses the session directory as its resume target.
   */
  getSessionId(userId, conversationId) {
    const sessionPath = this._sessionPath(userId, conversationId);
    if (!fs.existsSync(sessionPath)) {
      throw new SessionNotFoundError(conversationId);
    }
    return sessionPath;
  }

  /**
   * Gets metadata for a conversation.
   */
  getMetadata(userId, conversationId) {
    return this._readMetadata(userId, conversationId);
  }

  /**
   * Gets the CLI session ID for resuming. Returns null for new conversations.
   * The CLI generates its own session UUIDs; we store them after the first turn.
   */
  getCliSessionId(userId, conversationId) {
    try {
      const metadata = this._readMetadata(userId, conversationId);
      return metadata.cliSessionId || null;
    } catch {
      return null;
    }
  }

  /**
   * Stores the CLI's session ID after the first invocation.
   * Called when we receive the `init` event with session_id from CLI.
   */
  setCliSessionId(userId, conversationId, cliSessionId) {
    const metadata = this._readMetadata(userId, conversationId);
    metadata.cliSessionId = cliSessionId;
    this._writeMetadata(userId, conversationId, metadata);
    logger.info({ userId, conversationId, cliSessionId }, 'Stored CLI session ID');
  }

  /**
   * Updates metadata after a message is processed.
   */
  recordTurn(userId, conversationId, firstMessage) {
    const metadata = this._readMetadata(userId, conversationId);
    metadata.turnCount++;
    metadata.updatedAt = new Date().toISOString();
    if (!metadata.firstMessage && firstMessage) {
      metadata.firstMessage = firstMessage.slice(0, 100);
    }
    this._writeMetadata(userId, conversationId, metadata);
  }

  /**
   * Lists all conversations for a user with metadata.
   * Satisfies F-06: enough metadata to identify each conversation.
   */
  list(userId) {
    const userDir = path.join(this._sessionDir, userId);
    if (!fs.existsSync(userDir)) return [];

    const entries = fs.readdirSync(userDir, { withFileTypes: true });
    const conversations = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const metadata = this._readMetadata(userId, entry.name);
        conversations.push(metadata);
      } catch {
        // Skip corrupted session directories
        logger.warn({ userId, conversationId: entry.name }, 'Skipping unreadable session');
      }
    }

    // Sort by most recently active
    conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return conversations;
  }

  /**
   * Branches a conversation from a checkpoint (F-05).
   * Copies the session directory to create a new independent conversation.
   */
  branch(userId, sourceConversationId, checkpointName) {
    const sourcePath = this.getSessionId(userId, sourceConversationId);
    const sourceMetadata = this._readMetadata(userId, sourceConversationId);

    // If checkpoint name specified, verify it exists
    if (checkpointName && !sourceMetadata.checkpoints[checkpointName]) {
      throw new Error(`Checkpoint "${checkpointName}" not found`);
    }

    // Create new conversation
    const { conversationId: newId, sessionPath: newPath } = this.create(
      userId,
      `Branch from ${sourceMetadata.name || sourceConversationId}`
    );

    // Copy session files
    this._copyDir(sourcePath, newPath);

    // Update metadata for the branch
    const newMetadata = this._readMetadata(userId, newId);
    newMetadata.branchedFrom = {
      conversationId: sourceConversationId,
      checkpoint: checkpointName || null,
      branchedAt: new Date().toISOString(),
    };
    this._writeMetadata(userId, newId, newMetadata);

    logger.info(
      { userId, sourceConversationId, newConversationId: newId, checkpoint: checkpointName },
      'Branched conversation'
    );

    return { conversationId: newId, sessionPath: newPath };
  }

  /**
   * Saves a named checkpoint for a conversation.
   */
  saveCheckpoint(userId, conversationId, name) {
    const metadata = this._readMetadata(userId, conversationId);
    metadata.checkpoints[name] = {
      savedAt: new Date().toISOString(),
      turnCount: metadata.turnCount,
    };
    this._writeMetadata(userId, conversationId, metadata);
    logger.info({ userId, conversationId, checkpoint: name }, 'Saved checkpoint');
  }

  /**
   * Deletes a conversation and its session data.
   */
  delete(userId, conversationId) {
    const sessionPath = this._sessionPath(userId, conversationId);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
    this._metadataCache.delete(`${userId}/${conversationId}`);
    logger.info({ userId, conversationId }, 'Deleted conversation session');
  }

  // -- Private helpers --

  _sessionPath(userId, conversationId) {
    return path.join(this._sessionDir, userId, conversationId);
  }

  _metadataPath(userId, conversationId) {
    return path.join(this._sessionPath(userId, conversationId), '_metadata.json');
  }

  _readMetadata(userId, conversationId) {
    const cacheKey = `${userId}/${conversationId}`;
    const cached = this._metadataCache.get(cacheKey);
    if (cached) return { ...cached };

    const metaPath = this._metadataPath(userId, conversationId);
    try {
      const data = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      this._metadataCache.set(cacheKey, data);
      return { ...data };
    } catch {
      throw new SessionNotFoundError(conversationId);
    }
  }

  _writeMetadata(userId, conversationId, metadata) {
    const metaPath = this._metadataPath(userId, conversationId);
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    this._metadataCache.set(`${userId}/${conversationId}`, metadata);
  }

  _copyDir(src, dest) {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this._copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

module.exports = { SessionManager };
