# Gemini CLI as a Service

## Overview
Cloud service wrapping Google's Gemini CLI in headless mode. Each user message becomes a serial CLI invocation (`gemini -p "msg" --resume <session_id> --output-format stream-json --yolo --model gemini-2.5-flash`). The CLI streams JSON events back, which are translated and forwarded to the user via SSE (web UI) or Google Chat cards.

## Live Instance
- **Web UI:** http://34.59.124.147 (Caddy on port 80 → daemon on 3100)
- **Daemon:** http://34.59.124.147:3100
- **VM:** GCE e2-medium in us-central1-a (project: mfg-open-apps)
- **CLI version:** 0.36.0 (pinned in .gemini-cli-version)
- **Auth:** API key in .env (set API_KEY)
- **App URLs:** http://{appname}.34.59.124.147.nip.io (Caddy wildcard routing)

## Running Tests
```bash
# All unit tests
node --test tests/unit/**/*.test.js

# Individual test files
node --test tests/unit/router/write-interceptor.test.js
node --test tests/unit/a2ui/detector.test.js

# Integration tests
node --test tests/integration/daemon-http.test.js tests/integration/daemon-cli.test.js
```

## Architecture
- **src/daemon/** — Node.js 22 Fastify server (CommonJS, except MCP server which is ESM .mjs)
  - **cli/** — Stream parser, CLI spawner (child_process.spawn), session manager
  - **router/** — Slash command classifier + command-registry.json + write-file interceptor
  - **queue/** — Per-conversation concurrency queue (prevents concurrent --resume)
  - **mcp/** — MCP stdio server (.mjs, uses @modelcontextprotocol/sdk), approval gate
  - **docker/** — Container manager (dockerode), network manager, volume manager, Caddy router
  - **db/** — SQLite (better-sqlite3) app registry, token usage, audit log. Migrations in db/migrations/
  - **tokens/** — Token tracker, budget manager (warn at 80%, pause at 100%), auto-compressor
  - **a2ui/** — Structured output renderer (6 templates) + detector (auto-matches tool output to templates)
  - **reflection/** — Usage analyzer for skill/tool effectiveness and recommendations
  - **routes/** — HTTP: messages (SSE), conversations, apps, files, approvals, skills, reflection, health, web UI, Google Chat
  - **middleware/** — API key auth
  - **lib/** — Pino logger, error types, constants
- **src/shim/** — Python ADK BaseAgent (protocol adapter for Google Agent Engine, no LLM)
- **src/extensions/apps/** — Agent guidance (GEMINI.md) + extension.toml
- **infra/** — Caddyfile, Docker Compose, Dockerfile

## Key Design Decisions
- CommonJS throughout (except MCP server: ESM required by @modelcontextprotocol/sdk)
- Fastify 5 for HTTP + SSE streaming
- SQLite via better-sqlite3 for persistence (stateless daemon, all state on disk)
- Each user message = fresh CLI process with --resume (no persistent CLI processes)
- Conversations = CLI session UUIDs stored in metadata
- Caddy for reverse proxy: name-based URLs via admin API /load, CSP stripping for iframe embedding
- Direct port mapping for app containers (8001+) with Caddy subdomain routing on top
- API key auth on all endpoints except /, /health, /ready, /chat/google
- GEMINI.md at ~/.gemini/GEMINI.md guides the agent to use MCP tools (apps_create, apps_exec) not native write_file/run_shell_command

## VM Deployment Checklist
1. `cd /opt/gemini-cli-service && git pull origin feat/phase-2-ui-overhaul`
2. `echo '0.36.0' > .gemini-cli-version`
3. `cp src/extensions/apps/GEMINI.md ~/.gemini/GEMINI.md`
4. `killall node; sleep 2; nohup node src/daemon/index.js > /tmp/daemon.log 2>&1 &`
5. Verify: `curl -s http://localhost:3100/health`

## Maintenance Notes
- **After major milestones:** Update this CLAUDE.md and the memory file at `~/.claude/projects/.../memory/project_gemini_service.md`
- **Port conflicts after restart:** Fixed — ContainerManager.syncPorts() runs on startup
- **Agent routing leaks:** write-interceptor.js detects write_file targeting container paths
- **Container restart loops:** Use `start_command="sleep infinity"` for Node apps, omit for nginx
- **MCP tool naming:** CLI sees `mcp_apps_apps_create` (prefix: `mcp_{server}_{tool}`)
- **Caddy admin API:** Requires Origin header. Config rebuilt via /load on each app create/delete
- **Google Chat SA key:** /opt/gemini-cli-service/chat-sa-key.json (gitignored)
- **DB migrations:** Apply with `sqlite3 data/registry.db < src/daemon/db/migrations/NNN-name.sql`
