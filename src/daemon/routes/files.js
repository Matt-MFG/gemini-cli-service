'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * File browser routes — view files created by Gemini CLI on the VM.
 *
 * GET /files?path=...       — list directory contents
 * GET /files/read?path=...  — read file contents
 */

// Restrict browsing to safe directories
const ALLOWED_ROOTS = [
  process.env.HOME || '/home',
  '/tmp',
];

function isPathAllowed(p) {
  const resolved = path.resolve(p);
  return ALLOWED_ROOTS.some((root) => resolved.startsWith(path.resolve(root)));
}

async function fileRoutes(fastify) {
  fastify.get('/files', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          path: { type: 'string', default: process.env.HOME || '/home' },
        },
      },
    },
  }, async (req, reply) => {
    const dirPath = req.query.path || process.env.HOME || '/home';

    if (!isPathAllowed(dirPath)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    try {
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) {
        return reply.code(400).send({ error: 'Not a directory' });
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const items = entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
          path: path.join(dirPath, e.name),
          size: e.isFile() ? fs.statSync(path.join(dirPath, e.name)).size : null,
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      return {
        path: dirPath,
        parent: path.dirname(dirPath),
        items,
      };
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });

  fastify.get('/files/read', {
    schema: {
      querystring: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const filePath = req.query.path;

    if (!isPathAllowed(filePath)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    try {
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        return reply.code(400).send({ error: 'Path is a directory, use /files instead' });
      }

      if (stat.size > 1024 * 1024) {
        return reply.code(413).send({ error: 'File too large (>1MB)' });
      }

      const content = fs.readFileSync(filePath, 'utf8');
      return {
        path: filePath,
        name: path.basename(filePath),
        size: stat.size,
        content,
      };
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });
}

module.exports = fileRoutes;
