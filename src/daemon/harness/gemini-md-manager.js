'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('../lib/logger');

const GEMINI_MD_PATH = path.join(os.homedir(), '.gemini', 'GEMINI.md');

// In-memory mutex for serializing writes (single-process daemon)
let writePromise = Promise.resolve();

/**
 * Manages the GEMINI.md agent guidance file.
 * Dynamically updates it when harness apps are installed/uninstalled,
 * so the agent knows what CLI tools and credentials are available.
 */
class GeminiMdManager {
  constructor(mdPath) {
    this.mdPath = mdPath || GEMINI_MD_PATH;
  }

  /**
   * Read the current GEMINI.md content.
   */
  read() {
    try {
      return fs.readFileSync(this.mdPath, 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return '';
      throw err;
    }
  }

  /**
   * Add a harness app section to GEMINI.md.
   * Each app gets a clearly delimited block so it can be
   * surgically removed on uninstall.
   */
  async addAppSection(appName, section) {
    return this._serializedWrite(() => {
      let content = this.read();
      const marker = this._marker(appName);

      // Remove existing section if present (idempotent)
      content = this._removeSection(content, marker);

      // Append new section
      const block = `\n${marker.start}\n${section.trim()}\n${marker.end}\n`;
      content = content.trimEnd() + '\n' + block;

      this._write(content);
      logger.info({ appName }, 'Added GEMINI.md section');
    });
  }

  /**
   * Remove a harness app section from GEMINI.md.
   */
  async removeAppSection(appName) {
    return this._serializedWrite(() => {
      let content = this.read();
      const marker = this._marker(appName);
      const updated = this._removeSection(content, marker);

      if (updated !== content) {
        this._write(updated);
        logger.info({ appName }, 'Removed GEMINI.md section');
      }
    });
  }

  /**
   * Generate a GEMINI.md section for an installed app.
   */
  generateSection(appName, config) {
    const lines = [
      `## Harness App: ${appName}`,
      '',
    ];

    if (config.description) {
      lines.push(config.description, '');
    }

    // Environment variables
    if (config.envVars && Object.keys(config.envVars).length) {
      lines.push('### Available Environment Variables');
      lines.push('');
      for (const [key, desc] of Object.entries(config.envVars)) {
        lines.push(`- \`$${key}\` — ${desc}`);
      }
      lines.push('');
    }

    // CLI tools
    if (config.tools && config.tools.length) {
      lines.push('### CLI Tools');
      lines.push('');
      for (const tool of config.tools) {
        lines.push(`- \`${tool}\` — pre-configured with harness credentials`);
      }
      lines.push('');
    }

    // Example commands
    if (config.examples && config.examples.length) {
      lines.push('### Example Commands');
      lines.push('');
      for (const example of config.examples) {
        lines.push('```bash');
        lines.push(example);
        lines.push('```');
        lines.push('');
      }
    }

    // Aliases
    if (config.aliases && Object.keys(config.aliases).length) {
      lines.push('### Convenience Aliases');
      lines.push('');
      for (const [alias, desc] of Object.entries(config.aliases)) {
        lines.push(`- \`${alias}\` — ${desc}`);
      }
      lines.push('');
    }

    // Database access
    if (config.database) {
      lines.push('### Direct Database Access');
      lines.push('');
      lines.push(`\`\`\`bash`);
      lines.push(`psql -d ${config.database}`);
      lines.push('```');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Marker comments for delimiting app sections.
   */
  _marker(appName) {
    return {
      start: `<!-- HARNESS:${appName}:START -->`,
      end: `<!-- HARNESS:${appName}:END -->`,
    };
  }

  /**
   * Remove a delimited section from content.
   */
  _removeSection(content, marker) {
    const startIdx = content.indexOf(marker.start);
    const endIdx = content.indexOf(marker.end);
    if (startIdx === -1 || endIdx === -1) return content;

    const before = content.slice(0, startIdx).trimEnd();
    const after = content.slice(endIdx + marker.end.length).trimStart();
    return before + '\n' + after;
  }

  /**
   * Write content to GEMINI.md.
   */
  _write(content) {
    const dir = path.dirname(this.mdPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.mdPath, content.trim() + '\n', 'utf-8');
  }

  /**
   * Serialize writes to prevent race conditions.
   */
  _serializedWrite(fn) {
    writePromise = writePromise.then(fn).catch(err => {
      logger.error({ err }, 'GEMINI.md write failed');
    });
    return writePromise;
  }
}

module.exports = { GeminiMdManager };
