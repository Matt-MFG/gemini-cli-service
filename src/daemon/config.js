'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DEFAULTS } = require('./lib/constants');
const { CliVersionMismatchError } = require('./lib/errors');
const { logger } = require('./lib/logger');

/**
 * Loads and validates daemon configuration.
 * Refuses to start on CLI version mismatch (V-01).
 */
function loadConfig() {
  const config = {
    port: parseInt(process.env.PORT, 10) || DEFAULTS.PORT,
    host: process.env.HOST || DEFAULTS.HOST,
    cliPath: process.env.CLI_PATH || DEFAULTS.CLI_PATH,
    cliTimeoutMs: parseInt(process.env.CLI_TIMEOUT_MS, 10) || DEFAULTS.CLI_TIMEOUT_MS,
    sessionDir: path.resolve(process.env.SESSION_DIR || DEFAULTS.SESSION_DIR),
    dbPath: path.resolve(process.env.DB_PATH || DEFAULTS.DB_PATH),
    logLevel: process.env.LOG_LEVEL || DEFAULTS.LOG_LEVEL,
    domainSuffix: process.env.DOMAIN_SUFFIX || DEFAULTS.DOMAIN_SUFFIX,
    nodeEnv: process.env.NODE_ENV || 'development',
    cliModel: process.env.CLI_MODEL || 'gemini-2.5-flash',
    vertexAi: process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true',
    gcpProject: process.env.GOOGLE_CLOUD_PROJECT || '',
    gcpLocation: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
  };

  // Read pinned version
  const versionFile = path.resolve(
    process.env.CLI_VERSION_FILE || '.gemini-cli-version'
  );
  config.pinnedCliVersion = readPinnedVersion(versionFile);

  return config;
}

/**
 * Reads pinned CLI version from the version file.
 */
function readPinnedVersion(versionFile) {
  try {
    return fs.readFileSync(versionFile, 'utf8').trim();
  } catch (err) {
    logger.warn({ versionFile, err: err.message }, 'No pinned CLI version file found; skipping version check');
    return null;
  }
}

/**
 * Gets the actual installed CLI version by running `gemini --version`.
 */
function getInstalledCliVersion(cliPath) {
  try {
    const output = execFileSync(cliPath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    // Extract version number from output (e.g., "Gemini CLI v1.0.0" -> "1.0.0")
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : output.trim();
  } catch {
    return null;
  }
}

/**
 * Validates that installed CLI version matches the pinned version (V-01).
 * Throws CliVersionMismatchError on mismatch.
 */
function validateCliVersion(config) {
  if (!config.pinnedCliVersion) {
    logger.warn('No pinned CLI version configured; skipping version validation');
    return;
  }

  const installedVersion = getInstalledCliVersion(config.cliPath);

  if (!installedVersion) {
    logger.warn(
      { cliPath: config.cliPath },
      'Could not determine installed CLI version; CLI may not be installed'
    );
    return;
  }

  if (installedVersion !== config.pinnedCliVersion) {
    throw new CliVersionMismatchError(config.pinnedCliVersion, installedVersion);
  }

  logger.info(
    { version: installedVersion },
    'CLI version validated'
  );
}

module.exports = { loadConfig, validateCliVersion, getInstalledCliVersion, readPinnedVersion };
