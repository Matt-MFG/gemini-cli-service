'use strict';

const pino = require('pino');

/**
 * Creates a structured logger with context fields.
 * Outputs JSON in production, pretty-prints in development.
 * Logs flow to stdout for Cloud Logging ingestion (D-12).
 */
function createLogger(opts = {}) {
  const level = opts.level || process.env.LOG_LEVEL || 'info';
  const isDev = process.env.NODE_ENV !== 'production';

  const transport = isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined;

  return pino({
    level,
    transport,
    base: { service: 'gemini-cli-service' },
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  });
}

const logger = createLogger();

module.exports = { createLogger, logger };
