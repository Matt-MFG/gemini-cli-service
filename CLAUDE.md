# Gemini CLI as a Service

## Overview
Cloud service wrapping Google's Gemini CLI in headless mode. Each user message becomes a serial CLI invocation (`gemini -p "msg" --resume <session_id> --output-format stream-json --yolo --model gemini-2.5-flash`). The CLI streams JSON events back, which are translated and forwarded to the user via SSE.

## Live Instance
- **Daemon:** http://34.59.124.147:3100
- **VM:** GCE e2-medium in us-central1-a (project: mfg-open-apps)
- **CLI version:** 0.36.0 (pinned in .gemini-cli-version)
- **Auth:** API key in .env (set API_KEY)

## Running Tests
```bash
# All unit tests
node --test tests/unit/cli/stream-parser.test.js tests/unit/cli/session-manager.test.js tests/unit/queue/conversation-queue.test.js tests/unit/router/classifier.test.js tests/unit/db/registry.test.js tests/unit/tokens/tracker.test.js tests/unit/tokens/budget.test.js tests/unit/docker/label-builder.test.js tests/unit/docker/container-manager.test.js tests/unit/mcp/approval-gate.test.js

# Integration tests
node --test tests/integration/daemon-http.test.js tests/integration/daemon-cli.test.js

# Spike tests
node --test tests/spikes/spike-2-a2ui.test.js
```

## Architecture
- **src/daemon/** — Node.js 22 Fastify server (CommonJS, except MCP server which is ESM .mjs)
  - **cli/** — Stream parser, CLI spawner (child_process.spawn), session manager
  - **router/** — Slash command classifier + command-registry.json
  - **queue/** — Per-conversation concurrency queue (prevents concurrent --resume)
  - **mcp/** — MCP stdio server (.mjs, uses @modelcontextprotocol/sdk), approval gate
  - **docker/** — Container manager (dockerode), network manager, volume manager
  - **db/** — SQLite (better-sqlite3) app registry, token usage, audit log
  - **tokens/** — Token tracker, budget manager (warn at 80%, pause at 100%), auto-compressor
  - **a2ui/** — Structured output renderer (6 templates + Slack Block Kit fallback)
  - **routes/** — HTTP: messages (SSE), conversations, apps, files, approvals, health, web UI
  - **middleware/** — API key auth
  - **lib/** — Pino logger, error types, constants
- **src/shim/** — Python ADK BaseAgent (protocol adapter for Google Agent Engine, no LLM)
- **src/extensions/apps/** — Agent guidance (GEMINI.md) + extension.toml
- **infra/** — Terraform (GCE), Traefik config, Docker Compose, VM setup script

## Key Design Decisions
- CommonJS throughout (except MCP server: ESM required by @modelcontextprotocol/sdk)
- Fastify 5 for HTTP + SSE streaming
- SQLite via better-sqlite3 for persistence (stateless daemon, all state on disk)
- Each user message = fresh CLI process with --resume (no persistent CLI processes)
- Conversations = CLI session UUIDs stored in metadata, not filesystem paths
- Direct port mapping for app containers (8001+), not Traefik (Docker API compat issue)
- API key auth on all endpoints except /, /health, /ready
- dotenv for .env loading

## VM Deployment Notes
- .gemini-cli-version must match installed CLI version (daemon refuses to start on mismatch)
- `git checkout -- .` on VM will reset .gemini-cli-version — always re-set it after pull
- The .env file is gitignored and persists across pulls
- MCP server configured in ~/.gemini/settings.json (not in daemon config)
- GEMINI.md in ~ guides the agent to use apps_exec instead of write_file
- Docker socket access: user must be in docker group (`sudo usermod -aG docker $USER`)
- Firewall rules: 3100 (daemon), 8001-8100 (app containers), 80/443 (Traefik/future)
