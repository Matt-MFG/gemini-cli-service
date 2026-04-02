# Gemini CLI as a Service

## Overview
Cloud service wrapping Google's Gemini CLI in headless mode. Each user message becomes a serial CLI invocation (`gemini -p "msg" --resume <session_id> --output-format stream-json --yolo --model gemini-2.5-flash`). The CLI streams JSON events back, which are translated and forwarded to the user via SSE (web UI) or Google Chat cards.

## Live Instance
- **Web UI:** http://34.59.124.147 (Caddy on port 80 → daemon on 3100)
- **Daemon:** http://34.59.124.147:3100
- **VM:** GCE e2-medium in us-central1-a (project: mfg-open-apps) — upgrade to e2-standard-4 for Phase 3 harness
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
  - **cli/** — Stream parser, CLI spawner (sources harness env), session manager
  - **router/** — Slash command classifier + command-registry.json + write-file interceptor
  - **queue/** — Per-conversation concurrency queue (prevents concurrent --resume)
  - **mcp/** — MCP stdio server (.mjs, uses @modelcontextprotocol/sdk), approval gate
  - **docker/** — Container manager (dockerode), network manager, volume manager, Caddy router
  - **db/** — SQLite (better-sqlite3) app registry, token usage, audit log. Migrations in db/migrations/
  - **tokens/** — Token tracker, budget manager (warn at 80%, pause at 100%), auto-compressor
  - **a2ui/** — Structured output renderer (6+ templates) + detector (auto-matches tool output to templates)
  - **reflection/** — Usage analyzer for skill/tool effectiveness and recommendations
  - **harness/** — Phase 3 app harness system:
    - **infra-manager.js** — Docker Compose lifecycle for shared Postgres/Redis/MinIO/Authelia
    - **health-checker.js** — Per-service health polling via docker exec
    - **registry/** — catalog.json (20 curated apps) + registry-manager.js (template resolution)
    - **installer.js** — Orchestrates full install: DB → bucket → SSO → env → container → Caddy → GEMINI.md
    - **postgres-client.js** — CREATE/DROP DATABASE via docker exec into harness-postgres
    - **minio-client.js** — Bucket management via mc CLI in harness-minio
    - **sso-client.js** — Authelia OIDC client registration (file-based + SIGHUP reload)
    - **env-manager.js** — /etc/harness/env.d/*.env files sourced by CLI spawner
    - **alias-manager.js** — Convenience aliases in /usr/local/bin/
    - **gemini-md-manager.js** — Dynamic GEMINI.md sections per installed app
    - **updater.js** — Pull latest image, recreate container, preserve data
    - **uninstaller.js** — Stop + cleanup, data preserved by default
    - **resource-reporter.js** — Per-container CPU/memory/disk metrics
    - **cloud-context.js** — gcloud/bq/gsutil CLI wrapper
  - **routes/** — HTTP: messages (SSE), conversations, apps, files (tree/preview/upload/download), approvals, skills, reflection, health, web UI, Google Chat, harness, registry, install
  - **public/** — Phase 3 modular web UI (ES modules, Architectural Ethereal design system)
    - **css/** — design-system.css (tokens, Manrope), components.css, layout.css, file-explorer.css
    - **js/** — app.js (entry), state.js, chat.js, markdown.js, a2ui.js, panels.js, file-explorer.js, workspace.js
  - **middleware/** — API key auth
  - **lib/** — Pino logger, error types, constants
- **src/shim/** — Python ADK BaseAgent (protocol adapter for Google Agent Engine, no LLM)
- **src/extensions/apps/** — Agent guidance (GEMINI.md) + extension.toml
- **infra/** — Caddyfile, Docker Compose, Dockerfile, harness/ (infra compose + Authelia config)

## Key Design Decisions
- CommonJS throughout (except MCP server: ESM required by @modelcontextprotocol/sdk)
- Fastify 5 for HTTP + SSE streaming + @fastify/static for web UI
- SQLite via better-sqlite3 for persistence (stateless daemon, all state on disk)
- Each user message = fresh CLI process with --resume (no persistent CLI processes)
- Conversations = CLI session UUIDs stored in metadata
- Caddy for reverse proxy: name-based URLs via admin API /load, CSP stripping for iframe embedding
- Direct port mapping for app containers (8001+) with Caddy subdomain routing on top
- API key auth on all endpoints except /, /health, /ready, /chat/google, and static files (/css/, /js/)
- GEMINI.md at ~/.gemini/GEMINI.md guides the agent — dynamically updated by harness installer
- Web UI modularized into src/daemon/public/ with ES modules (no bundler)
- Architectural Ethereal design system: Manrope font, warm charcoal surfaces, zero borders, generous radius, glassmorphism
- Infrastructure harness: Docker Compose for shared services (Postgres, Redis, MinIO, Authelia)
- Authelia for SSO (~50MB vs Authentik's 2GB) — file-based OIDC client config
- JSON catalog for available apps, SQLite for installed state
- CLI spawner sources /etc/harness/env.d/*.env into process environment

## VM Deployment Checklist
1. `cd /opt/gemini-cli-service && git pull`
2. `echo '0.36.0' > .gemini-cli-version`
3. `npm install` (for @fastify/static)
4. `cp src/extensions/apps/GEMINI.md ~/.gemini/GEMINI.md`
5. `sqlite3 data/registry.db < src/daemon/db/migrations/003-harness-apps.sql`
6. `killall node; sleep 2; nohup node src/daemon/index.js > /tmp/daemon.log 2>&1 &`
7. Verify: `curl -s http://localhost:3100/health`

## Maintenance Notes
- **After major milestones:** Update this CLAUDE.md and the memory file
- **Port conflicts after restart:** Fixed — ContainerManager.syncPorts() runs on startup
- **Agent routing leaks:** write-interceptor.js detects write_file targeting container paths
- **Container restart loops:** Use `start_command="sleep infinity"` for Node apps, omit for nginx
- **MCP tool naming:** CLI sees `mcp_apps_apps_create` (prefix: `mcp_{server}_{tool}`)
- **Caddy admin API:** Requires Origin header. Config rebuilt via /load on each app create/delete
- **Google Chat SA key:** /opt/gemini-cli-service/chat-sa-key.json (gitignored)
- **DB migrations:** Apply with `sqlite3 data/registry.db < src/daemon/db/migrations/NNN-name.sql`
- **Harness infra:** `docker compose -f infra/harness/docker-compose.yml -p gemini-harness up -d`
- **Harness env files:** Written to /etc/harness/env.d/ — sourced by CLI spawner automatically
- **GEMINI.md sections:** Delimited with `<!-- HARNESS:appname:START/END -->` markers
