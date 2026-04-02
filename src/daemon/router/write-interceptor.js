'use strict';

const { logger } = require('../lib/logger');

/**
 * Write-file routing interceptor (P1-FIX-1).
 *
 * Detects when the Gemini CLI agent uses native `write_file` or `run_shell_command`
 * tools targeting paths inside container source directories, and logs a warning.
 *
 * The interceptor inspects tool_call events in the SSE stream and:
 * 1. Detects file write operations targeting container-managed paths
 * 2. Injects a system message advising the agent to use @apps.exec instead
 * 3. Logs the routing leak for monitoring
 *
 * This converts the ~80% correct routing (from GEMINI.md guidance alone)
 * into a system-level safety net.
 */

// Paths that indicate the agent is writing to the host VM
// when it should be writing inside a container via apps_exec
const CONTAINER_PATH_PATTERNS = [
  /^\/home\/[^/]+\/projects?\//i,
  /^\/app\//i,
  /^\/src\//i,
  /^\/opt\/app\//i,
  /^\/workspace\//i,
  /^\/tmp\/app/i,
];

// Tool names that write files (Gemini CLI native tools)
const WRITE_TOOL_NAMES = new Set([
  'write_file',
  'write_to_file',
  'create_file',
  'edit_file',
  'replace_in_file',
]);

// Tool names for shell commands that might write files
const SHELL_TOOL_NAMES = new Set([
  'run_shell_command',
  'execute_command',
  'shell',
]);

// Shell patterns that write files
const SHELL_WRITE_PATTERNS = [
  /\bcat\s+>/, /\becho\s+.*>/, /\btee\s+/,
  /\bcp\s+/, /\bmv\s+/, /\bmkdir\s+/,
  /\bnpm\s+init/, /\bnpx\s+create/,
];

/**
 * Checks if a tool_call event represents a write operation
 * that should have been routed through apps_exec.
 *
 * @param {object} event - The parsed stream-json event
 * @param {string[]} containerNames - Names of active containers
 * @returns {{ intercepted: boolean, reason?: string, suggestion?: string }}
 */
function checkWriteRouting(event, containerNames = []) {
  // Only inspect tool calls
  if (!event || event.type !== 'tool_call') {
    return { intercepted: false };
  }

  const toolName = (event.tool_name || event.name || '').toLowerCase();
  const args = event.args || event.parameters || event.input || {};

  // Check direct file write tools
  if (WRITE_TOOL_NAMES.has(toolName)) {
    const filePath = args.path || args.file_path || args.filename || '';
    if (isContainerPath(filePath, containerNames)) {
      const log = logger.child({ toolName, filePath });
      log.warn('Write-file routing leak detected: agent used native tool for container path');
      return {
        intercepted: true,
        reason: `Agent used ${toolName} on path "${filePath}" which appears to be inside a container`,
        suggestion: `Use @apps.exec(name="<app_name>", command="cat > ${filePath} << 'EOF'\n...\nEOF") instead`,
      };
    }
  }

  // Check shell commands that write files
  if (SHELL_TOOL_NAMES.has(toolName)) {
    const command = args.command || args.cmd || '';
    for (const pattern of SHELL_WRITE_PATTERNS) {
      if (pattern.test(command)) {
        // Only intercept if the command references a known container path
        for (const pathPattern of CONTAINER_PATH_PATTERNS) {
          if (pathPattern.test(command)) {
            logger.warn({ toolName, command: command.slice(0, 200) },
              'Shell write routing leak detected');
            return {
              intercepted: true,
              reason: `Agent used ${toolName} with a file-writing command targeting a container path`,
              suggestion: 'Use @apps.exec to run this command inside the correct container',
            };
          }
        }
      }
    }
  }

  return { intercepted: false };
}

/**
 * Checks if a file path looks like it's inside a container source directory.
 */
function isContainerPath(filePath, containerNames) {
  if (!filePath) return false;

  // Check known container path patterns
  for (const pattern of CONTAINER_PATH_PATTERNS) {
    if (pattern.test(filePath)) return true;
  }

  // Check if path contains a known container name
  for (const name of containerNames) {
    if (filePath.includes(name)) return true;
  }

  return false;
}

/**
 * Creates an SSE event that warns the agent about routing leaks.
 * This gets injected into the response stream.
 */
function createRoutingWarning(interceptResult) {
  return {
    type: 'system_warning',
    category: 'write_routing',
    message: `⚠ Routing issue: ${interceptResult.reason}. ${interceptResult.suggestion}`,
    severity: 'warning',
  };
}

module.exports = { checkWriteRouting, isContainerPath, createRoutingWarning };
