'use strict';

class AppError extends Error {
  constructor(message, code, statusCode = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

class CliVersionMismatchError extends AppError {
  constructor(expected, actual) {
    super(
      `CLI version mismatch: expected ${expected}, found ${actual}`,
      'CLI_VERSION_MISMATCH',
      503
    );
    this.expected = expected;
    this.actual = actual;
  }
}

class CliTimeoutError extends AppError {
  constructor(sessionId, timeoutMs) {
    super(
      `CLI invocation timed out after ${timeoutMs}ms for session ${sessionId}`,
      'CLI_TIMEOUT',
      504
    );
    this.sessionId = sessionId;
    this.timeoutMs = timeoutMs;
  }
}

class SessionNotFoundError extends AppError {
  constructor(conversationId) {
    super(
      `Session not found for conversation ${conversationId}`,
      'SESSION_NOT_FOUND',
      404
    );
    this.conversationId = conversationId;
  }
}

class ConversationBusyError extends AppError {
  constructor(conversationId) {
    super(
      `Conversation ${conversationId} is currently processing a message`,
      'CONVERSATION_BUSY',
      409
    );
    this.conversationId = conversationId;
  }
}

module.exports = {
  AppError,
  CliVersionMismatchError,
  CliTimeoutError,
  SessionNotFoundError,
  ConversationBusyError,
};
