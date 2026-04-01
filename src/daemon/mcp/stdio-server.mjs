#!/usr/bin/env node

/**
 * MCP stdio server using the official @modelcontextprotocol/sdk (W8).
 *
 * Uses the same SDK that Gemini CLI's client uses, ensuring protocol compatibility.
 * Tools call the daemon's HTTP API to manage Docker containers.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import http from 'node:http';

const DAEMON_URL = process.env.DAEMON_URL || 'http://localhost:3100';
const USER_ID = process.env.GEMINI_USER_ID || 'web-user';

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

// Create MCP server
const server = new McpServer({
  name: 'gemini-apps',
  version: '1.0.0',
});

// Register tools
server.tool(
  'apps_create',
  'Create and start a new application container. Returns a public URL. ALWAYS use this when the user asks to build and run an app.',
  {
    name: z.string().describe('Short name for the app (e.g., "dashboard")'),
    image: z.string().optional().describe('Docker image (default: node:22-alpine)'),
    port: z.number().optional().describe('Internal port (default: 3000)'),
    start_command: z.string().optional().describe('Start command (e.g., "npm start")'),
  },
  async ({ name, image, port, start_command }) => {
    const result = await daemonRequest('POST', '/apps/create', {
      user_id: USER_ID, name, image, port, start_command,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'apps_exec',
  'Execute a shell command inside an app container. Use for ALL file writes, package installs, build commands inside the app.',
  {
    name: z.string().describe('App name'),
    command: z.string().describe('Shell command to run'),
  },
  async ({ name, command }) => {
    const result = await daemonRequest('POST', `/apps/${name}/exec`, {
      user_id: USER_ID, command,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'apps_stop',
  'Stop a running application.',
  { name: z.string().describe('App name') },
  async ({ name }) => {
    const result = await daemonRequest('POST', `/apps/${name}/stop`, { user_id: USER_ID });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'apps_restart',
  'Restart an application.',
  { name: z.string().describe('App name') },
  async ({ name }) => {
    const result = await daemonRequest('POST', `/apps/${name}/restart`, { user_id: USER_ID });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'apps_list',
  'List all running and stopped apps with their URLs.',
  {},
  async () => {
    const result = await daemonRequest('GET', `/apps?user_id=${USER_ID}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'apps_logs',
  'Get recent logs from an app.',
  {
    name: z.string().describe('App name'),
    lines: z.number().optional().describe('Number of lines (default: 50)'),
  },
  async ({ name, lines }) => {
    const result = await daemonRequest('GET', `/apps/${name}/logs?user_id=${USER_ID}&lines=${lines || 50}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Start server with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('[MCP] Gemini Apps server started via SDK\n');
