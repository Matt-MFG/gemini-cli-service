#!/usr/bin/env node
'use strict';

/**
 * MCP stdio server for Gemini CLI (W8).
 *
 * The CLI spawns this as a subprocess. It communicates via JSON-RPC over stdin/stdout.
 * Tools call the daemon's HTTP API to manage containers.
 *
 * Registered in ~/.gemini/settings.json as an MCP server.
 * CLI discovers tools via the standard MCP handshake.
 */

const http = require('node:http');
const readline = require('node:readline');

const DAEMON_URL = process.env.DAEMON_URL || 'http://localhost:3100';
const USER_ID = process.env.GEMINI_USER_ID || 'web-user';

// MCP tool definitions
const TOOLS = [
  {
    name: 'apps_create',
    description: 'Create and start a new application container. Returns a public URL. ALWAYS use this when the user asks to build and run an app.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Short name for the app (e.g., "dashboard")' },
        image: { type: 'string', description: 'Docker image (default: node:22-alpine)' },
        port: { type: 'integer', description: 'Internal port (default: 3000)' },
        start_command: { type: 'string', description: 'Start command (e.g., "npm start")' },
      },
    },
  },
  {
    name: 'apps_exec',
    description: 'Execute a shell command inside an app container. Use for ALL file writes, package installs, build commands inside the app.',
    inputSchema: {
      type: 'object',
      required: ['name', 'command'],
      properties: {
        name: { type: 'string', description: 'App name' },
        command: { type: 'string', description: 'Shell command to run' },
      },
    },
  },
  {
    name: 'apps_stop',
    description: 'Stop a running application.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    },
  },
  {
    name: 'apps_restart',
    description: 'Restart an application.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    },
  },
  {
    name: 'apps_list',
    description: 'List all running and stopped apps with their URLs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'apps_logs',
    description: 'Get recent logs from an app.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        lines: { type: 'integer', description: 'Number of lines (default: 50)' },
      },
    },
  },
];

// JSON-RPC helpers
function respond(id, result) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

function respondError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

// HTTP client for daemon API
function daemonRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, DAEMON_URL);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Tool handlers
async function handleTool(name, args) {
  switch (name) {
    case 'apps_create':
      return daemonRequest('POST', '/apps/create', {
        user_id: USER_ID,
        name: args.name,
        image: args.image,
        port: args.port,
        start_command: args.start_command,
      });

    case 'apps_exec':
      return daemonRequest('POST', `/apps/${args.name}/exec`, {
        user_id: USER_ID,
        command: args.command,
      });

    case 'apps_stop':
      return daemonRequest('POST', `/apps/${args.name}/stop`, { user_id: USER_ID });

    case 'apps_restart':
      return daemonRequest('POST', `/apps/${args.name}/restart`, { user_id: USER_ID });

    case 'apps_list':
      return daemonRequest('GET', `/apps?user_id=${USER_ID}`);

    case 'apps_logs':
      return daemonRequest('GET', `/apps/${args.name}/logs?user_id=${USER_ID}&lines=${args.lines || 50}`);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Parse MCP JSON-RPC messages from stdin (Content-Length framing)
let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  processBuffer();
});

function processBuffer() {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;

    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }

    const len = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + len) return;

    const body = buffer.slice(bodyStart, bodyStart + len);
    buffer = buffer.slice(bodyStart + len);

    try {
      const msg = JSON.parse(body);
      handleMessage(msg).catch((err) => {
        process.stderr.write(`[MCP] Error handling message: ${err.message}\n`);
        if (msg.id != null) respondError(msg.id, -32603, err.message);
      });
    } catch (err) {
      process.stderr.write(`[MCP] Parse error: ${err.message}\n`);
    }
  }
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      respond(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'gemini-apps', version: '1.0.0' },
      });
      break;

    case 'initialized':
      // No response needed for notification
      break;

    case 'tools/list':
      respond(id, { tools: TOOLS });
      break;

    case 'tools/call': {
      const { name, arguments: args } = params;
      try {
        const result = await handleTool(name, args || {});
        respond(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        respond(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        });
      }
      break;
    }

    default:
      if (id != null) respondError(id, -32601, `Method not found: ${method}`);
  }
}

process.stderr.write('[MCP] Gemini Apps MCP server started\n');
