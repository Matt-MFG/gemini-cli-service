'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

/**
 * Spike 0: Devcontainer behavioral reliability (BLOCKS W8-W10b).
 *
 * Question: Will the Gemini model, guided by @apps GEMINI.md, consistently use
 * @apps.exec instead of native run_shell_command/write_file when working inside
 * a devcontainer?
 *
 * Exit criteria: >=90% correct routing across 20 tasks.
 *
 * Set RUN_SPIKES=true and ensure Gemini CLI + @apps extension are installed.
 */

const TASKS = [
  // Node.js tasks (7)
  { id: 'node-1', project: 'node', prompt: 'Create a new file called index.js with a Hello World Express server' },
  { id: 'node-2', project: 'node', prompt: 'Run npm install express in the project' },
  { id: 'node-3', project: 'node', prompt: 'Edit index.js to add a /health endpoint' },
  { id: 'node-4', project: 'node', prompt: 'Run npm test to check if tests pass' },
  { id: 'node-5', project: 'node', prompt: 'Create a .env file with PORT=3000' },
  { id: 'node-6', project: 'node', prompt: 'List all files in the project directory' },
  { id: 'node-7', project: 'node', prompt: 'Read the contents of package.json' },

  // Python tasks (7)
  { id: 'py-1', project: 'python', prompt: 'Create a new file called app.py with a Flask Hello World' },
  { id: 'py-2', project: 'python', prompt: 'Run pip install flask in the project container' },
  { id: 'py-3', project: 'python', prompt: 'Edit app.py to add a /api/data endpoint' },
  { id: 'py-4', project: 'python', prompt: 'Run python -m pytest to check tests' },
  { id: 'py-5', project: 'python', prompt: 'Create a requirements.txt with flask and pytest' },
  { id: 'py-6', project: 'python', prompt: 'Check the Python version installed' },
  { id: 'py-7', project: 'python', prompt: 'Install a new package: pip install requests' },

  // Multi-service tasks (6)
  { id: 'multi-1', project: 'multi', prompt: 'Create an index.js in the web container' },
  { id: 'multi-2', project: 'multi', prompt: 'Run npm install in the api container' },
  { id: 'multi-3', project: 'multi', prompt: 'Edit the web container\'s src/App.tsx to add a chart' },
  { id: 'multi-4', project: 'multi', prompt: 'Check if postgres is running in the db container' },
  { id: 'multi-5', project: 'multi', prompt: 'Run migrations in the api container' },
  { id: 'multi-6', project: 'multi', prompt: 'View logs from the web container' },
];

describe('Spike 0: Devcontainer routing', {
  skip: process.env.RUN_SPIKES !== 'true' ? 'Set RUN_SPIKES=true to run' : undefined,
}, () => {
  let results = [];

  it('runs all 20 tasks and scores routing correctness', async () => {
    for (const task of TASKS) {
      const result = await runTask(task);
      results.push(result);
      console.log(`[${task.id}] ${result.correct ? 'CORRECT' : 'WRONG'}: ${result.toolUsed}`);
    }

    const correct = results.filter((r) => r.correct).length;
    const total = results.length;
    const ratio = correct / total;

    console.log(`\n=== SPIKE 0 RESULTS ===`);
    console.log(`Correct routing: ${correct}/${total} (${(ratio * 100).toFixed(1)}%)`);
    console.log(`Exit criteria: >= 90%`);
    console.log(`Result: ${ratio >= 0.9 ? 'PASS' : 'FAIL'}`);

    if (ratio < 0.9) {
      const failures = results.filter((r) => !r.correct);
      console.log(`\nFailures:`);
      for (const f of failures) {
        console.log(`  ${f.taskId}: used ${f.toolUsed} instead of @apps.exec`);
      }
    }

    assert.ok(ratio >= 0.9, `Routing correctness ${(ratio * 100).toFixed(1)}% is below 90% threshold`);
  });
});

async function runTask(task) {
  // This would spawn Gemini CLI with @apps extension and analyze which tools it calls
  // Placeholder — real implementation parses stream-json for tool_call events
  try {
    const output = execFileSync('gemini', [
      '-p', `You are working on the "${task.project}" project container. ${task.prompt}`,
      '--output-format', 'stream-json',
      '--yolo',
    ], { encoding: 'utf8', timeout: 60000 });

    const events = output.split('\n')
      .filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);

    const toolCalls = events.filter((e) => e.type === 'tool_call');
    const usedAppsExec = toolCalls.some((e) => e.tool_name?.startsWith('apps_'));
    const usedNative = toolCalls.some((e) =>
      e.tool_name === 'run_shell_command' || e.tool_name === 'write_file'
    );

    return {
      taskId: task.id,
      correct: usedAppsExec && !usedNative,
      toolUsed: toolCalls.map((e) => e.tool_name).join(', ') || 'none',
    };
  } catch (err) {
    return { taskId: task.id, correct: false, toolUsed: `error: ${err.message}` };
  }
}
