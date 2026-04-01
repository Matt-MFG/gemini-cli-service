# Gemini CLI as a Service

Cloud-hosted Gemini CLI accessible from a web interface (and soon Google Chat). Users chat with Gemini, and the agent can build and run applications in Docker containers — accessible via clickable URLs.

**Live demo:** `http://34.59.124.147:3100` (API key required)

## Features

- **Streaming chat** — real-time SSE streaming from Gemini CLI
- **Multi-turn conversations** — context preserved across messages via `--resume`
- **Multi-conversation** — create, switch, branch, checkpoint conversations
- **App hosting** — agent creates Docker containers with unique port-mapped URLs
- **MCP tools** — `apps_create`, `apps_exec`, `apps_stop`, `apps_list`, `apps_logs` available to the agent
- **File browser** — browse VM filesystem from the web UI
- **Approval gate** — optional approve/reject flow for destructive tool calls
- **API key auth** — all endpoints secured (except health + landing page)
- **Token tracking** — per-conversation and total usage with cost estimates
- **Slash command classification** — text-safe, parameterized, unsupported categories

## Quick Start

### Prerequisites

- Node.js >= 22
- Docker Engine
- Gemini CLI installed (`git clone https://github.com/google-gemini/gemini-cli.git`)
- GCP project with Vertex AI API enabled (or a Gemini API key)

### Local Development

```bash
git clone https://github.com/Matt-MFG/gemini-cli-service.git
cd gemini-cli-service
npm install

# Configure
cp .env.example .env
# Edit .env with your settings (see Configuration section)

# Run
npm start

# Development (auto-reload)
npm run dev

# Tests
npm test
```

### Production Deployment

See [docs/deployment-runbook.md](docs/deployment-runbook.md) for full instructions.

```bash
# Quick version:
# 1. Provision VM (Terraform or manual)
# 2. Install Docker, Node.js 22, Gemini CLI
# 3. Clone repo, npm ci --omit=dev
# 4. Configure .env
# 5. node src/daemon/index.js
```

## Configuration

All configuration is via environment variables in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Daemon HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `API_KEY` | (none) | **Required in production.** API key for all endpoints |
| `CLI_PATH` | `gemini` | Path to Gemini CLI binary |
| `CLI_MODEL` | `gemini-2.5-flash` | Model to use for CLI invocations |
| `CLI_TIMEOUT_MS` | `600000` | Per-invocation timeout (10 min) |
| `SESSION_DIR` | `./data/sessions` | Session file storage |
| `DB_PATH` | `./data/registry.db` | SQLite database path |
| `LOG_LEVEL` | `info` | Pino log level |
| `DOMAIN_SUFFIX` | `agent.example.com` | Domain for app URLs (use `IP.nip.io` for free DNS) |
| `GOOGLE_GENAI_USE_VERTEXAI` | `false` | Enable Vertex AI authentication |
| `GOOGLE_CLOUD_PROJECT` | (none) | GCP project ID (for Vertex AI) |
| `GOOGLE_CLOUD_LOCATION` | `us-central1` | GCP region (for Vertex AI) |

### Gemini CLI Configuration

The CLI reads settings from `~/.gemini/settings.json`:

```json
{
  "GOOGLE_GENAI_USE_VERTEXAI": true,
  "GOOGLE_CLOUD_PROJECT": "your-project-id",
  "GOOGLE_CLOUD_LOCATION": "us-central1",
  "mcpServers": {
    "apps": {
      "command": "node",
      "args": ["/path/to/gemini-cli-service/src/daemon/mcp/stdio-server.mjs"],
      "env": {
        "DAEMON_URL": "http://localhost:3100",
        "GEMINI_USER_ID": "web-user"
      }
    }
  }
}
```

### Pinned CLI Version

The file `.gemini-cli-version` in the project root pins the expected CLI version. The daemon refuses to start if the installed CLI version doesn't match. Update this file when upgrading the CLI (see [docs/cli-upgrade-playbook.md](docs/cli-upgrade-playbook.md)).

## API Reference

### Authentication

All endpoints (except `GET /`, `GET /health`, `GET /ready`) require an API key:

```bash
# Via header (preferred)
curl -H "X-API-Key: YOUR_KEY" http://localhost:3100/conversations/list?user_id=matt

# Via query parameter (for EventSource/SSE)
curl http://localhost:3100/approvals/subscribe?api_key=YOUR_KEY
```

### Conversations

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/conversations/new` | Create conversation. Body: `{user_id, name?}` |
| `GET` | `/conversations/list?user_id=X` | List user's conversations |
| `POST` | `/conversations/branch` | Branch from checkpoint. Body: `{user_id, source_conversation_id, checkpoint_name?}` |
| `POST` | `/conversations/checkpoint` | Save checkpoint. Body: `{user_id, conversation_id, name}` |
| `DELETE` | `/conversations/:id?user_id=X` | Delete conversation |

### Messages

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/send` | Send message, stream response via SSE. Body: `{user_id, conversation_id, text}` |

The `/send` endpoint returns Server-Sent Events:
- `event: event` — CLI stream-json events (init, message, tool_use, tool_result, result)
- `event: error` — Error events
- `event: done` — Invocation complete

### Applications

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/apps/create` | Create container. Body: `{user_id, name, image?, port?, start_command?, env?}` |
| `GET` | `/apps?user_id=X` | List all apps |
| `GET` | `/apps/:name?user_id=X` | Get app details |
| `POST` | `/apps/:name/stop` | Stop container. Body: `{user_id}` |
| `POST` | `/apps/:name/restart` | Restart container. Body: `{user_id}` |
| `POST` | `/apps/:name/exec` | Execute command in container. Body: `{user_id, command}` |
| `GET` | `/apps/:name/logs?user_id=X` | Get container logs |
| `DELETE` | `/apps/:name?user_id=X` | Remove container |

### Files

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/files?path=X` | List directory contents |
| `GET` | `/files/read?path=X` | Read file contents (max 1MB) |

### Approvals

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/approvals/request` | Request approval (used by MCP server). Body: `{user_id, action, description}` |
| `POST` | `/approvals/:id/approve` | Approve pending request |
| `POST` | `/approvals/:id/reject` | Reject pending request |
| `GET` | `/approvals/pending?user_id=X` | List pending approvals |
| `GET` | `/approvals/subscribe` | SSE stream of approval events |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Daemon status (no auth required) |
| `GET` | `/ready` | Readiness check (no auth required) |

## Approval Gate

The approval gate lets you review and approve/reject tool calls before they execute. This is the equivalent of Gemini CLI's interactive approval mode vs `--yolo`.

### Enabling Approval Mode

Update `~/.gemini/settings.json` on the VM:

```json
{
  "mcpServers": {
    "apps": {
      "env": {
        "DAEMON_URL": "http://localhost:3100",
        "GEMINI_USER_ID": "web-user",
        "APPROVAL_MODE": "true"
      }
    }
  }
}
```

When enabled:
1. Agent calls `apps_create`, `apps_exec`, or `apps_stop`
2. MCP server sends approval request to daemon
3. Daemon pushes request to web UI via SSE
4. User sees yellow card with **Approve** / **Reject** buttons
5. MCP server blocks until user responds (5-minute timeout)
6. On approval: tool executes normally
7. On rejection: tool returns rejection message to agent

### Disabling Approval Mode

Remove `APPROVAL_MODE` from the env (or set to `false`). Tools execute immediately without user confirmation.

## Architecture

```
User (Browser/Chat) → Daemon (Fastify) → Gemini CLI (headless) → Gemini API (Vertex AI)
                                       ↕
                                  MCP Server ←→ Docker containers
                                       ↕
                                  SQLite (registry, tokens, audit)
```

### Message Lifecycle

1. User sends message from web UI
2. Daemon classifies input (slash command / meta command / passthrough)
3. Routes through per-conversation queue (prevents concurrent `--resume`)
4. Spawns `gemini -p "text" --resume <session_id> --output-format stream-json --yolo --model gemini-2.5-flash`
5. CLI loads session, runs ReAct loop, calls tools (including MCP tools for @apps)
6. stream-json events flow from stdout → daemon parses → pushes to client via SSE
7. CLI completes, saves session, exits

### Key Components

| Component | Path | Purpose |
|-----------|------|---------|
| Stream parser | `src/daemon/cli/stream-parser.js` | Parses CLI's JSON output, skips malformed lines |
| CLI spawner | `src/daemon/cli/spawner.js` | Spawns headless CLI with timeout |
| Session manager | `src/daemon/cli/session-manager.js` | Maps conversations to CLI sessions |
| Concurrency queue | `src/daemon/queue/conversation-queue.js` | Serial execution per conversation |
| Command classifier | `src/daemon/router/classifier.js` | Routes slash/meta/unsupported commands |
| MCP server | `src/daemon/mcp/stdio-server.mjs` | Tools for CLI to manage Docker containers |
| Approval gate | `src/daemon/mcp/approval-gate.js` | Hold/release tool calls pending user approval |
| Container manager | `src/daemon/docker/container-manager.js` | Docker API wrapper for app lifecycle |
| App registry | `src/daemon/db/registry.js` | SQLite persistence for apps, tokens, audit |
| Token tracker | `src/daemon/tokens/tracker.js` | Per-conversation usage tracking |
| Web UI | `src/daemon/routes/web.js` | Chat interface with file browser |

## Testing

```bash
# All unit tests (86 tests)
npm run test:unit

# Integration tests (16 tests)
npm run test:integration

# Spike tests
node --test tests/spikes/spike-2-a2ui.test.js

# E2E acceptance (requires running system)
RUN_E2E=true DAEMON_URL=http://34.59.124.147:3100 npm run test:e2e

# Coverage
npm run coverage
```

## CLI Upgrade Process

See [docs/cli-upgrade-playbook.md](docs/cli-upgrade-playbook.md) for the full process. Key points:

1. Test new CLI version in isolation
2. Run integration suite
3. Validate stream-json event schema
4. Update `.gemini-cli-version`
5. Deploy with 48-hour rollback window

## Project Structure

```
gemini-cli-service/
├── src/daemon/           # Node.js Fastify server
│   ├── cli/              # Stream parser, spawner, session manager
│   ├── router/           # Slash command classifier + registry
│   ├── queue/            # Per-conversation concurrency queue
│   ├── mcp/              # MCP server + approval gate
│   ├── docker/           # Container, network, volume managers
│   ├── db/               # SQLite schema + registry
│   ├── tokens/           # Token tracker, budget, auto-compress
│   ├── a2ui/             # Structured output renderer
│   ├── routes/           # HTTP routes (messages, apps, files, etc.)
│   ├── middleware/        # Auth middleware
│   └── lib/              # Logger, constants, errors
├── src/shim/             # Python ADK BaseAgent (for Agent Engine)
├── src/extensions/apps/  # @apps CLI extension guidance
├── infra/                # Terraform, Traefik, Docker Compose
├── tests/                # Unit, integration, E2E, spike tests
├── docs/                 # Deployment runbook, CLI upgrade playbook
├── .github/workflows/    # CI pipeline
└── .env.example          # Configuration template
```

## License

MIT
