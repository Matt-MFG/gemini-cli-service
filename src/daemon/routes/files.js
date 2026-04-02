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

async function fileRoutes(fastify, deps) {
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

  // P3-51: GET /files/tree — recursive tree to depth N
  fastify.get('/files/tree', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          path: { type: 'string', default: process.env.HOME || '/home' },
          depth: { type: 'integer', default: 2 },
        },
      },
    },
  }, async (req, reply) => {
    const rootPath = req.query.path || process.env.HOME || '/home';
    const maxDepth = Math.min(req.query.depth || 2, 5);

    if (!isPathAllowed(rootPath)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    function buildTree(dirPath, depth) {
      if (depth <= 0) return [];
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        return entries
          .filter(e => !e.name.startsWith('.'))
          .map(e => {
            const fullPath = path.join(dirPath, e.name);
            const isDir = e.isDirectory();
            const node = {
              name: e.name,
              path: fullPath,
              type: isDir ? 'directory' : 'file',
            };
            if (!isDir) {
              try { node.size = fs.statSync(fullPath).size; } catch { node.size = 0; }
              node.ext = path.extname(e.name).slice(1);
            } else {
              node.children = buildTree(fullPath, depth - 1);
            }
            return node;
          })
          .sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
      } catch {
        return [];
      }
    }

    return {
      path: rootPath,
      breadcrumbs: buildBreadcrumbs(rootPath),
      children: buildTree(rootPath, maxDepth),
    };
  });

  // P3-52: GET /files/preview — file preview with syntax detection
  fastify.get('/files/preview', {
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
        return reply.code(400).send({ error: 'Path is a directory' });
      }

      const ext = path.extname(filePath).slice(1).toLowerCase();
      const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext);
      const isBinary = ['zip', 'tar', 'gz', 'exe', 'dll', 'so', 'wasm', 'pdf'].includes(ext);

      if (isBinary) {
        return { path: filePath, name: path.basename(filePath), size: stat.size, type: 'binary', language: ext };
      }

      if (isImage) {
        const data = fs.readFileSync(filePath);
        const base64 = data.toString('base64');
        const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        return { path: filePath, name: path.basename(filePath), size: stat.size, type: 'image', dataUri: `data:${mime};base64,${base64}` };
      }

      if (stat.size > 512 * 1024) {
        return { path: filePath, name: path.basename(filePath), size: stat.size, type: 'large', language: ext };
      }

      const content = fs.readFileSync(filePath, 'utf8');
      return {
        path: filePath,
        name: path.basename(filePath),
        size: stat.size,
        type: 'text',
        language: detectLanguage(ext),
        content,
        breadcrumbs: buildBreadcrumbs(filePath),
      };
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });

  // P3-57: POST /files/upload — upload a file
  fastify.post('/files/upload', async (req, reply) => {
    // Multipart upload handling would go here
    // For now, accept JSON { path, content }
    const { path: filePath, content } = req.body || {};
    if (!filePath || content == null) {
      return reply.code(400).send({ error: 'path and content required' });
    }

    if (!isPathAllowed(filePath)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    try {
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
      return { success: true, path: filePath };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // P3-56: GET /files/download — download a file
  fastify.get('/files/download', async (req, reply) => {
    const filePath = req.query.path;
    if (!filePath) return reply.code(400).send({ error: 'path required' });
    if (!isPathAllowed(filePath)) return reply.code(403).send({ error: 'Access denied' });

    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) return reply.code(400).send({ error: 'Cannot download directory' });

      const stream = fs.createReadStream(filePath);
      reply.header('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
      reply.header('Content-Length', stat.size);
      return reply.send(stream);
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });
}

// P3-53: Build breadcrumb segments from a path
function buildBreadcrumbs(filePath) {
  const parts = filePath.split(path.sep).filter(Boolean);
  const crumbs = [];
  let accumulated = path.sep;
  for (const part of parts) {
    accumulated = path.join(accumulated, part);
    crumbs.push({ name: part, path: accumulated });
  }
  return crumbs;
}

// Detect syntax highlighting language from file extension
function detectLanguage(ext) {
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash',
    yml: 'yaml', yaml: 'yaml', json: 'json',
    md: 'markdown', sql: 'sql', css: 'css', scss: 'scss',
    html: 'html', xml: 'xml', toml: 'toml', ini: 'ini',
    dockerfile: 'dockerfile', makefile: 'makefile',
  };
  return map[ext] || ext || 'plaintext';
}

module.exports = fileRoutes;
