'use strict';

const { logger } = require('../lib/logger');

/**
 * MCP server that the Gemini CLI calls during its ReAct loop (W8).
 *
 * Provides tools for:
 * - App lifecycle (@apps.create, stop, restart, list, exec, logs, compose)
 * - Approval gate (block until user approves/rejects)
 * - A2UI rendering (structured output for chat panels)
 *
 * Transport: stdio (CLI spawns the MCP server as a subprocess).
 * The daemon configures this in the CLI's settings.json (D-08).
 *
 * This module defines the tool schemas and handlers.
 * The actual stdio transport setup happens in the CLI settings config.
 */

/**
 * Defines all MCP tool schemas for the daemon.
 * These are registered with the @modelcontextprotocol/sdk server.
 */
const TOOL_DEFINITIONS = [
  {
    name: 'apps_create',
    description: 'Create and start a new application container. Returns the public URL. Use this whenever the user asks to build and run an application.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Short name for the app (used in URL, e.g., "dashboard")' },
        image: { type: 'string', description: 'Docker image to use (default: node:22-alpine)' },
        port: { type: 'integer', description: 'Port the app listens on internally (default: 3000)' },
        start_command: { type: 'string', description: 'Command to start the app (e.g., "npm start")' },
        env: { type: 'object', description: 'Environment variables as key-value pairs' },
      },
    },
  },
  {
    name: 'apps_stop',
    description: 'Stop a running application container.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Name of the app to stop' },
      },
    },
  },
  {
    name: 'apps_restart',
    description: 'Restart an application container.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Name of the app to restart' },
      },
    },
  },
  {
    name: 'apps_list',
    description: 'List all running and stopped applications with their URLs and status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'apps_exec',
    description: 'Execute a shell command inside an application container. Use this for ALL file operations, package installs, and commands that should run inside the app environment.',
    inputSchema: {
      type: 'object',
      required: ['name', 'command'],
      properties: {
        name: { type: 'string', description: 'Name of the app container' },
        command: { type: 'string', description: 'Shell command to execute' },
      },
    },
  },
  {
    name: 'apps_logs',
    description: 'Get recent logs from an application container.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Name of the app' },
        lines: { type: 'integer', description: 'Number of log lines to retrieve (default: 100)' },
      },
    },
  },
  {
    name: 'apps_compose',
    description: 'Create a multi-container project from a Docker Compose specification. Use for projects needing multiple services (app + database, frontend + backend, etc.).',
    inputSchema: {
      type: 'object',
      required: ['name', 'services'],
      properties: {
        name: { type: 'string', description: 'Project name' },
        services: {
          type: 'object',
          description: 'Service definitions (name -> {image, port, command, env, volumes})',
        },
      },
    },
  },
  {
    name: 'approval_request',
    description: 'Request user approval before executing a potentially destructive action. Blocks until the user approves or rejects.',
    inputSchema: {
      type: 'object',
      required: ['action', 'description'],
      properties: {
        action: { type: 'string', description: 'Short action name (e.g., "delete_files")' },
        description: { type: 'string', description: 'Detailed description of what will happen' },
        changes: {
          type: 'array',
          items: { type: 'object' },
          description: 'List of specific changes for the user to review',
        },
      },
    },
  },
  {
    name: 'a2ui_render',
    description: 'Render structured output as a rich visual panel in the chat interface. Use for test results, file diffs, app inventories, and other structured data.',
    inputSchema: {
      type: 'object',
      required: ['template', 'data'],
      properties: {
        template: {
          type: 'string',
          enum: ['test_results', 'file_changes', 'app_inventory', 'selection_list', 'token_usage', 'table'],
          description: 'Template type for rendering',
        },
        data: { type: 'object', description: 'Data to render with the template' },
      },
    },
  },
  // Phase 2 context management tools (P2-W2, F2-06 through F2-09)
  {
    name: 'app_render_text',
    description: 'Returns the rendered text content of a page served by a running app. Use when you need to know what the user sees without loading full HTML into context. Equivalent to viewing the page in a text browser.',
    inputSchema: {
      type: 'object',
      required: ['app_name', 'url_path'],
      properties: {
        app_name: { type: 'string', description: 'Name of the running app' },
        url_path: { type: 'string', description: 'URL path to render, e.g. "/" or "/settings"' },
      },
    },
  },
  {
    name: 'app_render_html',
    description: 'Returns the full rendered HTML of a page served by a running app. Use for design work where you need to inspect markup and CSS classes. Warns if response exceeds 50KB.',
    inputSchema: {
      type: 'object',
      required: ['app_name', 'url_path'],
      properties: {
        app_name: { type: 'string', description: 'Name of the running app' },
        url_path: { type: 'string', description: 'URL path to fetch, e.g. "/" or "/api/users"' },
      },
    },
  },
  {
    name: 'app_source',
    description: 'Finds and reads source files matching a pattern inside an app container. Automatically checks file size — if a file exceeds max_lines, returns only the first and last 50 lines with a note. Prevents accidental context flooding.',
    inputSchema: {
      type: 'object',
      required: ['app_name', 'file_pattern'],
      properties: {
        app_name: { type: 'string', description: 'Name of the app container' },
        file_pattern: { type: 'string', description: 'File glob or path pattern, e.g. "src/App.tsx" or "*.config.js"' },
        max_lines: { type: 'integer', description: 'Max lines per file before truncation (default: 500)' },
      },
    },
  },
];

/**
 * Creates tool handlers that bridge MCP tool calls to daemon services.
 *
 * @param {object} services - { containerManager, networkManager, volumeManager, registry, approvalGate }
 * @returns {object} Map of tool_name -> async handler function
 */
function createToolHandlers(services) {
  const { containerManager, networkManager, registry } = services;

  return {
    async apps_create({ name, image, port, start_command, env }, context) {
      const userId = context.userId;
      const networkName = await networkManager.ensure(userId);

      const result = await containerManager.create({
        userId,
        name,
        image,
        internalPort: port || 3000,
        startCommand: start_command,
        env,
        networkName,
      });

      // Register in app registry
      registry.createApp({
        userId,
        name,
        image: image || 'node:22-alpine',
        internalPort: port || 3000,
        url: result.url,
        containerId: result.containerId,
        startCommand: start_command,
        env,
      });
      registry.updateAppStatus(
        registry.getAppByName(userId, name).id,
        'running',
        result.containerId
      );

      return { url: result.url, container_id: result.containerId, status: 'running' };
    },

    async apps_stop({ name }, context) {
      const app = registry.getAppByName(context.userId, name);
      if (!app) return { error: `App "${name}" not found` };

      await containerManager.stop(app.container_id);
      registry.updateAppStatus(app.id, 'stopped');
      return { stopped: true, name };
    },

    async apps_restart({ name }, context) {
      const app = registry.getAppByName(context.userId, name);
      if (!app) return { error: `App "${name}" not found` };

      await containerManager.restart(app.container_id);
      registry.updateAppStatus(app.id, 'running');
      return { restarted: true, name };
    },

    async apps_list(_args, context) {
      const apps = registry.listApps(context.userId);
      return {
        apps: apps.map((a) => ({
          name: a.name,
          url: a.url,
          status: a.status,
          image: a.image,
          port: a.internal_port,
        })),
      };
    },

    async apps_exec({ name, command }, context) {
      const app = registry.getAppByName(context.userId, name);
      if (!app) return { error: `App "${name}" not found` };

      const result = await containerManager.exec(app.container_id, command);
      return {
        exit_code: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },

    async apps_logs({ name, lines }, context) {
      const app = registry.getAppByName(context.userId, name);
      if (!app) return { error: `App "${name}" not found` };

      const output = await containerManager.logs(app.container_id, lines);
      return { logs: output };
    },

    async apps_compose({ name, services: serviceDefs }, context) {
      const userId = context.userId;
      const networkName = await networkManager.ensure(userId);
      const results = [];

      for (const [svcName, svcConfig] of Object.entries(serviceDefs)) {
        const fullName = `${name}-${svcName}`;
        const result = await containerManager.create({
          userId,
          name: fullName,
          image: svcConfig.image,
          internalPort: svcConfig.port || 3000,
          startCommand: svcConfig.command,
          env: svcConfig.env,
          networkName,
        });

        registry.createApp({
          userId,
          name: fullName,
          image: svcConfig.image,
          internalPort: svcConfig.port || 3000,
          url: result.url,
          containerId: result.containerId,
          startCommand: svcConfig.command,
          env: svcConfig.env,
        });

        results.push({ name: fullName, url: result.url, status: 'running' });
      }

      return { project: name, services: results };
    },

    async approval_request({ action, description, changes }, context) {
      // In a real implementation, this blocks until user responds via SSE
      logger.info({ action, userId: context.userId }, 'Approval requested');
      return { approved: true, action, note: 'Auto-approved (approval gate not yet wired)' };
    },

    async a2ui_render({ template, data }) {
      // Returns structured data for the chat platform to render
      return { template, data, rendered: true };
    },

    // Phase 2 context management tools (P2-W2)

    async app_render_text({ app_name, url_path }, context) {
      const app = registry.getAppByName(context.userId, app_name);
      if (!app) return { error: `App "${app_name}" not found` };
      if (app.status !== 'running') return { error: `App "${app_name}" is not running` };

      // curl the app's internal URL and extract text via lynx-like stripping
      const internalUrl = `http://localhost:${app.internal_port}${url_path || '/'}`;
      const curlCmd = `curl -sL --max-time 10 "${internalUrl}" | sed 's/<script[^>]*>.*<\\/script>//g; s/<style[^>]*>.*<\\/style>//g; s/<[^>]*>//g; s/&nbsp;/ /g; s/&amp;/\\&/g; s/&lt;/</g; s/&gt;/>/g' | sed '/^$/d' | head -200`;

      try {
        const result = await containerManager.exec(app.container_id, curlCmd);
        if (result.exitCode !== 0) {
          return { error: `Failed to fetch ${url_path}: ${result.stderr}` };
        }
        return {
          app: app_name,
          path: url_path,
          text: result.stdout.trim(),
          note: 'Rendered text content (HTML tags stripped). Use app_render_html for full markup.',
        };
      } catch (err) {
        return { error: `Failed to render: ${err.message}` };
      }
    },

    async app_render_html({ app_name, url_path }, context) {
      const app = registry.getAppByName(context.userId, app_name);
      if (!app) return { error: `App "${app_name}" not found` };
      if (app.status !== 'running') return { error: `App "${app_name}" is not running` };

      const internalUrl = `http://localhost:${app.internal_port}${url_path || '/'}`;
      const curlCmd = `curl -sL --max-time 10 "${internalUrl}"`;

      try {
        const result = await containerManager.exec(app.container_id, curlCmd);
        if (result.exitCode !== 0) {
          return { error: `Failed to fetch ${url_path}: ${result.stderr}` };
        }

        const html = result.stdout;
        const sizeKb = Math.round(Buffer.byteLength(html, 'utf8') / 1024);
        const warning = sizeKb > 50
          ? `⚠ Response is ${sizeKb}KB. Consider using app_render_text for a lighter view, or app_source to read specific files.`
          : null;

        return {
          app: app_name,
          path: url_path,
          html,
          size_kb: sizeKb,
          ...(warning && { warning }),
        };
      } catch (err) {
        return { error: `Failed to fetch HTML: ${err.message}` };
      }
    },

    async app_source({ app_name, file_pattern, max_lines }, context) {
      const app = registry.getAppByName(context.userId, app_name);
      if (!app) return { error: `App "${app_name}" not found` };

      const limit = max_lines || 500;
      const headTail = 50; // lines from start/end for truncated files

      // Find matching files inside the container
      const findCmd = `find /app /src /home -maxdepth 5 -name "${file_pattern}" -type f 2>/dev/null | head -20`;
      try {
        const findResult = await containerManager.exec(app.container_id, findCmd);
        const files = findResult.stdout.trim().split('\n').filter(Boolean);

        if (files.length === 0) {
          return { app: app_name, pattern: file_pattern, files: [], note: 'No files matched the pattern.' };
        }

        const results = [];
        for (const filePath of files) {
          // Check line count first (F2-08: context budget awareness)
          const wcResult = await containerManager.exec(app.container_id, `wc -l < "${filePath}"`);
          const lineCount = parseInt(wcResult.stdout.trim(), 10) || 0;

          let content;
          if (lineCount > limit) {
            // Return first and last N lines with truncation note
            const headResult = await containerManager.exec(app.container_id, `head -${headTail} "${filePath}"`);
            const tailResult = await containerManager.exec(app.container_id, `tail -${headTail} "${filePath}"`);
            content = headResult.stdout +
              `\n\n... [${lineCount - headTail * 2} lines omitted — file has ${lineCount} lines total, exceeds max_lines=${limit}] ...\n\n` +
              tailResult.stdout;
          } else {
            const catResult = await containerManager.exec(app.container_id, `cat "${filePath}"`);
            content = catResult.stdout;
          }

          results.push({
            path: filePath,
            lines: lineCount,
            truncated: lineCount > limit,
            content,
          });
        }

        return { app: app_name, pattern: file_pattern, files: results };
      } catch (err) {
        return { error: `Failed to read source: ${err.message}` };
      }
    },
  };
}

module.exports = { TOOL_DEFINITIONS, createToolHandlers };
