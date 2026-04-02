'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logger } = require('../../lib/logger');

const CATALOG_PATH = path.resolve(__dirname, 'catalog.json');

/**
 * Manages the curated app registry catalog and resolves
 * harness dependency configurations for installation.
 */
class RegistryManager {
  constructor() {
    this._catalog = null;
  }

  /**
   * Load the catalog from disk (cached after first load).
   */
  getCatalog() {
    if (!this._catalog) {
      const raw = fs.readFileSync(CATALOG_PATH, 'utf-8');
      this._catalog = JSON.parse(raw);
    }
    return this._catalog;
  }

  /**
   * List all available apps in the catalog.
   */
  listAvailable() {
    const catalog = this.getCatalog();
    return Object.values(catalog.apps).map(app => ({
      name: app.name,
      displayName: app.displayName,
      description: app.description,
      category: app.category,
      image: app.image,
      requires: app.harness?.requires || [],
    }));
  }

  /**
   * Get a specific app config from the catalog.
   * @param {string} name - App name
   * @returns {object|null} App config or null if not found
   */
  getApp(name) {
    const catalog = this.getCatalog();
    return catalog.apps[name] || null;
  }

  /**
   * Resolve an app's environment variables by substituting
   * harness connection info and generating secrets.
   *
   * @param {object} appConfig - App config from catalog
   * @param {object} connectionInfo - From InfraManager.getConnectionInfo()
   * @param {string} domain - Domain suffix for URLs
   * @returns {object} Resolved environment variables
   */
  resolveEnv(appConfig, connectionInfo, domain) {
    const resolved = {};

    for (const [key, template] of Object.entries(appConfig.env || {})) {
      resolved[key] = this._resolveTemplate(template, connectionInfo, domain);
    }

    return resolved;
  }

  /**
   * Resolve a single template string.
   * Supported patterns:
   *   {{generate:hex:32}} — random hex string
   *   {{generate:base64:32}} — random base64 string
   *   {{harness.postgres.url}} — connection info lookup
   *   {{harness.postgres.password}} — specific field
   *   {{domain}} — domain suffix
   */
  _resolveTemplate(template, connectionInfo, domain) {
    if (typeof template !== 'string') return template;

    return template.replace(/\{\{(.+?)\}\}/g, (_, expr) => {
      // Generate random values
      if (expr.startsWith('generate:')) {
        const [, encoding, lengthStr] = expr.split(':');
        const length = parseInt(lengthStr, 10) || 32;
        if (encoding === 'hex') return crypto.randomBytes(length).toString('hex');
        if (encoding === 'base64') return crypto.randomBytes(length).toString('base64');
        return crypto.randomBytes(length).toString('hex');
      }

      // Domain substitution
      if (expr === 'domain') return domain;

      // Harness connection info lookup
      if (expr.startsWith('harness.')) {
        const parts = expr.slice(8).split('.');
        let value = connectionInfo;
        for (const part of parts) {
          if (value && typeof value === 'object') {
            value = value[part];
          } else {
            value = undefined;
            break;
          }
        }
        return value != null ? String(value) : '';
      }

      return `{{${expr}}}`;
    });
  }

  /**
   * Get the GEMINI.md documentation section for an installed app.
   */
  getAppDocumentation(appConfig, resolvedEnv, domain) {
    const cli = appConfig.cli || {};
    const doc = {
      description: appConfig.description,
      envVars: cli.envDoc || {},
      tools: cli.tools || [],
      aliases: {},
      examples: cli.examples || [],
      database: cli.database || null,
    };

    // Convert alias map to description map
    if (cli.aliases) {
      for (const [name, cmd] of Object.entries(cli.aliases)) {
        doc.aliases[name] = cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
      }
    }

    return doc;
  }

  /**
   * Get the env vars that should be written to the harness env file
   * for the CLI to use (API tokens, URLs, DB connection strings).
   */
  getCliEnvVars(appConfig, resolvedEnv, domain) {
    const name = appConfig.name.toUpperCase();
    const cliEnv = {};

    // Standard env vars the agent can use
    cliEnv[`${name}_URL`] = `http://${appConfig.name}.${domain}`;

    // Database connection string
    if (appConfig.cli?.database) {
      const pgUrl = resolvedEnv.DATABASE_URL || resolvedEnv.DB_POSTGRESDB_HOST;
      if (pgUrl) {
        cliEnv[`${name}_DB_URL`] = resolvedEnv.DATABASE_URL || pgUrl;
      }
    }

    return cliEnv;
  }

  /**
   * Reload the catalog from disk.
   */
  reload() {
    this._catalog = null;
    this.getCatalog();
    logger.info('Registry catalog reloaded');
  }
}

module.exports = { RegistryManager };
