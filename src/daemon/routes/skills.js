'use strict';

const { readFileSync, writeFileSync, existsSync, readdirSync, statSync } = require('fs');
const { join, basename } = require('path');
const { logger } = require('../lib/logger');

/**
 * Skills and MCP server management routes (P2-W7, F2-29 through F2-34).
 *
 * Provides CRUD for skills and MCP server configuration through the GUI
 * instead of requiring terminal/file editing.
 */
async function skillsRoutes(fastify, { config }) {
  const geminiDir = config.geminiDir || join(process.env.HOME || '/root', '.gemini');
  const settingsPath = join(geminiDir, 'settings.json');
  const skillsDir = join(geminiDir, 'skills');
  const customCommandsDir = join(geminiDir, 'customCommands');

  // --- Skills ---

  /**
   * GET /skills — List installed skills with metadata (F2-29)
   */
  fastify.get('/skills', async () => {
    const skills = [];
    const settings = loadSettings(settingsPath);
    const disabledSkills = new Set(settings.disabledSkills || []);

    if (existsSync(skillsDir)) {
      for (const entry of readdirSync(skillsDir)) {
        const fullPath = join(skillsDir, entry);
        const stat = statSync(fullPath);
        if (stat.isFile() && entry.endsWith('.md')) {
          const content = readFileSync(fullPath, 'utf8');
          const meta = parseSkillMeta(content, entry);
          skills.push({
            name: meta.name || basename(entry, '.md'),
            filename: entry,
            description: meta.description || '',
            enabled: !disabledSkills.has(basename(entry, '.md')),
            size: stat.size,
            modified: stat.mtime.toISOString(),
          });
        }
      }
    }

    return { skills };
  });

  /**
   * POST /skills/:name/toggle — Enable/disable a skill (F2-30)
   */
  fastify.post('/skills/:name/toggle', async (req) => {
    const { name } = req.params;
    const settings = loadSettings(settingsPath);
    const disabled = new Set(settings.disabledSkills || []);

    if (disabled.has(name)) {
      disabled.delete(name);
    } else {
      disabled.add(name);
    }

    settings.disabledSkills = [...disabled];
    saveSettings(settingsPath, settings);

    return { name, enabled: !disabled.has(name) };
  });

  // --- MCP Servers ---

  /**
   * GET /mcp-servers — List configured MCP servers with status (F2-31)
   */
  fastify.get('/mcp-servers', async () => {
    const settings = loadSettings(settingsPath);
    const servers = settings.mcpServers || {};

    const result = Object.entries(servers).map(([name, cfg]) => ({
      name,
      command: cfg.command,
      args: cfg.args || [],
      env: cfg.env ? Object.keys(cfg.env) : [],
      toolCount: cfg._toolCount || null,
      status: cfg._status || 'unknown',
    }));

    return { servers: result };
  });

  /**
   * POST /mcp-servers — Add a new MCP server (F2-32)
   */
  fastify.post('/mcp-servers', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'command'],
        properties: {
          name: { type: 'string' },
          command: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
          env: { type: 'object' },
        },
      },
    },
  }, async (req) => {
    const { name, command, args, env } = req.body;
    const settings = loadSettings(settingsPath);
    if (!settings.mcpServers) settings.mcpServers = {};

    settings.mcpServers[name] = { command, args: args || [], env: env || {} };
    saveSettings(settingsPath, settings);

    return { added: true, name };
  });

  /**
   * DELETE /mcp-servers/:name — Remove an MCP server (F2-32)
   */
  fastify.delete('/mcp-servers/:name', async (req) => {
    const { name } = req.params;
    const settings = loadSettings(settingsPath);
    if (!settings.mcpServers || !settings.mcpServers[name]) {
      return { error: `MCP server "${name}" not found` };
    }

    delete settings.mcpServers[name];
    saveSettings(settingsPath, settings);

    return { removed: true, name };
  });

  /**
   * POST /mcp-servers/:name/test — Validate MCP connection (F2-33)
   */
  fastify.post('/mcp-servers/:name/test', async (req) => {
    const { name } = req.params;
    const settings = loadSettings(settingsPath);
    const serverCfg = settings.mcpServers?.[name];
    if (!serverCfg) return { error: `MCP server "${name}" not found` };

    // Test by checking if the command exists
    const { execSync } = require('child_process');
    try {
      execSync(`which ${serverCfg.command} 2>/dev/null || where ${serverCfg.command} 2>NUL`, { timeout: 5000 });
      return { name, reachable: true, message: `Command "${serverCfg.command}" found` };
    } catch {
      return { name, reachable: false, message: `Command "${serverCfg.command}" not found on system` };
    }
  });

  // --- Custom Commands (F2-34) ---

  /**
   * GET /commands — List custom CLI commands (.toml)
   */
  fastify.get('/commands', async () => {
    const commands = [];
    if (existsSync(customCommandsDir)) {
      for (const entry of readdirSync(customCommandsDir)) {
        if (entry.endsWith('.toml')) {
          const content = readFileSync(join(customCommandsDir, entry), 'utf8');
          commands.push({
            name: basename(entry, '.toml'),
            filename: entry,
            content,
          });
        }
      }
    }
    return { commands };
  });
}

/**
 * Parse skill frontmatter for name and description.
 */
function parseSkillMeta(content, filename) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { name: basename(filename, '.md') };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      meta[key.trim()] = rest.join(':').trim().replace(/^["']|["']$/g, '');
    }
  }
  return meta;
}

function loadSettings(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(path, settings) {
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf8');
  logger.info({ path }, 'Settings saved');
}

module.exports = skillsRoutes;
