'use strict';

const { logger } = require('../lib/logger');

/**
 * Reflection loop analyzer (P2-W8, F2-35 through F2-39).
 *
 * Analyzes tool and skill usage data to generate effectiveness reports
 * and recommendations. Runs on a schedule (daily) or on-demand.
 *
 * Data sources:
 * - audit_log table (every tool call with success/failure)
 * - token_usage table (per-conversation costs)
 * - skill_usage table (skill activations)
 * - tool_effectiveness table (aggregated tool metrics)
 *
 * Output: structured report for the skills GUI "Recommendations" section.
 */

/**
 * Known skill/tool registry for recommendations (F2-37).
 * Maps work patterns to relevant skills/tools.
 */
const SKILL_RECOMMENDATIONS = [
  {
    pattern: /react|next\.?js|frontend|component|jsx|tsx/i,
    skills: [
      { name: 'react-testing-library', description: 'Component testing for React applications', source: 'npm' },
      { name: 'storybook', description: 'UI component development environment', source: 'npm' },
    ],
  },
  {
    pattern: /postgres|sql|database|migration|schema/i,
    skills: [
      { name: 'prisma', description: 'Database ORM with type-safe queries and migrations', source: 'npm' },
      { name: 'pg-monitor', description: 'PostgreSQL query monitoring and slow query detection', source: 'npm' },
    ],
  },
  {
    pattern: /python|pip|django|flask|fastapi/i,
    skills: [
      { name: 'pytest-cov', description: 'Test coverage reporting for Python', source: 'pip' },
      { name: 'black', description: 'Python code formatter', source: 'pip' },
    ],
  },
  {
    pattern: /docker|container|deploy|ci|cd|pipeline/i,
    skills: [
      { name: 'docker-compose-dev', description: 'Docker Compose patterns for local development', source: 'skill' },
      { name: 'health-check', description: 'Container health monitoring and auto-restart', source: 'skill' },
    ],
  },
  {
    pattern: /api|rest|endpoint|route|express|fastify/i,
    skills: [
      { name: 'swagger-autogen', description: 'Auto-generate OpenAPI docs from Express/Fastify routes', source: 'npm' },
      { name: 'rate-limiter', description: 'API rate limiting middleware', source: 'npm' },
    ],
  },
];

/**
 * Analyzes usage data and generates a reflection report.
 *
 * @param {object} registry - AppRegistry instance with query methods
 * @param {string} userId - User to analyze
 * @returns {object} Reflection report
 */
function analyzeUsage(registry, userId) {
  const report = {
    generated: new Date().toISOString(),
    userId,
    toolUsage: [],
    skillUsage: [],
    recommendations: [],
    health: { score: 0, issues: [] },
  };

  try {
    // 1. Analyze tool effectiveness (F2-35)
    const auditData = getToolStats(registry, userId);
    report.toolUsage = auditData.tools;

    // 2. Find unused or ineffective tools (F2-36)
    for (const tool of auditData.tools) {
      if (tool.callCount === 0) {
        report.health.issues.push({
          severity: 'info',
          message: `Tool "${tool.name}" has never been used`,
          recommendation: 'Consider disabling if not needed',
        });
      }
      if (tool.failureRate > 0.5 && tool.callCount >= 5) {
        report.health.issues.push({
          severity: 'warning',
          message: `Tool "${tool.name}" fails ${Math.round(tool.failureRate * 100)}% of the time (${tool.failCount}/${tool.callCount})`,
          recommendation: 'Check configuration or consider replacing',
        });
      }
    }

    // 3. Analyze work patterns for recommendations (F2-37)
    const recentTools = auditData.tools
      .filter((t) => t.callCount > 0)
      .map((t) => t.name)
      .join(' ');

    const recentArgs = getRecentArgs(registry, userId);
    const workContext = recentTools + ' ' + recentArgs;

    for (const rec of SKILL_RECOMMENDATIONS) {
      if (rec.pattern.test(workContext)) {
        for (const skill of rec.skills) {
          report.recommendations.push({
            type: 'add',
            ...skill,
            reason: `Matches your recent work pattern: ${rec.pattern.source}`,
            staged: false,
          });
        }
      }
    }

    // 4. Token cost analysis
    const tokenData = getTokenStats(registry, userId);
    report.tokenStats = tokenData;

    // 5. Calculate health score
    const totalTools = auditData.tools.length;
    const activeTools = auditData.tools.filter((t) => t.callCount > 0).length;
    const problematicTools = auditData.tools.filter((t) => t.failureRate > 0.5).length;
    report.health.score = totalTools > 0
      ? Math.round(((activeTools - problematicTools) / totalTools) * 100)
      : 100;

  } catch (err) {
    logger.error({ err, userId }, 'Reflection analysis failed');
    report.health.issues.push({
      severity: 'error',
      message: `Analysis error: ${err.message}`,
    });
  }

  return report;
}

/**
 * Gets aggregated tool usage statistics from audit_log.
 */
function getToolStats(registry, userId) {
  const tools = [];
  try {
    const db = registry._db;
    if (!db) return { tools };

    const rows = db.prepare(`
      SELECT tool_name, COUNT(*) as call_count,
             SUM(CASE WHEN result_json LIKE '%error%' THEN 1 ELSE 0 END) as fail_count,
             MAX(logged_at) as last_used
      FROM audit_log WHERE user_id = ?
      GROUP BY tool_name
      ORDER BY call_count DESC
    `).all(userId);

    for (const row of rows) {
      tools.push({
        name: row.tool_name,
        callCount: row.call_count,
        failCount: row.fail_count,
        failureRate: row.call_count > 0 ? row.fail_count / row.call_count : 0,
        lastUsed: row.last_used,
      });
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to query tool stats');
  }
  return { tools };
}

/**
 * Gets recent tool call arguments for pattern matching.
 */
function getRecentArgs(registry, userId) {
  try {
    const db = registry._db;
    if (!db) return '';

    const rows = db.prepare(`
      SELECT args_json FROM audit_log
      WHERE user_id = ? AND logged_at > datetime('now', '-7 days')
      ORDER BY logged_at DESC LIMIT 100
    `).all(userId);

    return rows.map((r) => r.args_json || '').join(' ');
  } catch {
    return '';
  }
}

/**
 * Gets token usage statistics.
 */
function getTokenStats(registry, userId) {
  try {
    const db = registry._db;
    if (!db) return {};

    const row = db.prepare(`
      SELECT SUM(total_tokens) as total_tokens,
             SUM(input_tokens) as input_tokens,
             SUM(output_tokens) as output_tokens,
             COUNT(*) as invocations,
             SUM(duration_ms) as total_duration_ms
      FROM token_usage WHERE user_id = ?
    `).get(userId);

    return {
      totalTokens: row?.total_tokens || 0,
      inputTokens: row?.input_tokens || 0,
      outputTokens: row?.output_tokens || 0,
      invocations: row?.invocations || 0,
      totalDurationMs: row?.total_duration_ms || 0,
    };
  } catch {
    return {};
  }
}

module.exports = { analyzeUsage, SKILL_RECOMMENDATIONS };
