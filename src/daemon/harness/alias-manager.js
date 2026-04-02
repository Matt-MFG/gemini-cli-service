'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../lib/logger');

const ALIAS_DIR = process.env.HARNESS_ALIAS_DIR || '/usr/local/bin';

/**
 * Manages convenience aliases for installed harness apps.
 * Creates shell scripts in /usr/local/bin/ so the agent
 * can use short commands like `outline-search "query"`.
 */
class AliasManager {
  constructor(aliasDir) {
    this.aliasDir = aliasDir || ALIAS_DIR;
  }

  /**
   * Install aliases for an app.
   * @param {string} appName - App name (used as prefix)
   * @param {object} aliases - Map of alias name -> shell command template
   */
  installAliases(appName, aliases) {
    if (!aliases || typeof aliases !== 'object') return;

    for (const [name, command] of Object.entries(aliases)) {
      const filePath = path.join(this.aliasDir, name);
      const script = `#!/bin/sh\n# Harness alias for ${appName}\n${command.replace(/\$1/g, '"$1"').replace(/\$@/g, '"$@"')}\n`;

      try {
        fs.writeFileSync(filePath, script, { mode: 0o755 });
        logger.info({ appName, alias: name }, 'Installed harness alias');
      } catch (err) {
        logger.warn({ err: err.message, alias: name }, 'Failed to install alias');
      }
    }
  }

  /**
   * Remove aliases for an app.
   * @param {string} appName - App name
   * @param {object} aliases - Map of alias name -> command (only keys used)
   */
  removeAliases(appName, aliases) {
    if (!aliases || typeof aliases !== 'object') return;

    for (const name of Object.keys(aliases)) {
      const filePath = path.join(this.aliasDir, name);
      try {
        // Only remove if it's our alias (contains the harness comment)
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.includes(`Harness alias for ${appName}`)) {
          fs.unlinkSync(filePath);
          logger.info({ appName, alias: name }, 'Removed harness alias');
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn({ err: err.message, alias: name }, 'Failed to remove alias');
        }
      }
    }
  }
}

module.exports = { AliasManager };
