# Gemini CLI as a Service

## Overview
Cloud service wrapping Google's Gemini CLI in headless mode, accessible from chat platforms (Slack, web, mobile). Each user message becomes a serial CLI invocation with `--resume` for session continuity.

## Running Tests
```bash
# All unit tests
node --test tests/unit/**/*.test.js

# Individual suites
node --test tests/unit/cli/stream-parser.test.js
node --test tests/unit/cli/session-manager.test.js
node --test tests/unit/queue/conversation-queue.test.js
node --test tests/unit/router/classifier.test.js
node --test tests/unit/db/registry.test.js
node --test tests/unit/tokens/tracker.test.js
node --test tests/unit/tokens/budget.test.js
node --test tests/unit/docker/label-builder.test.js
```

## Architecture
- **src/daemon/** — Node.js Fastify server (CommonJS)
  - **cli/** — Stream parser, CLI spawner, session manager
  - **router/** — Slash command classifier + registry
  - **queue/** — Per-conversation concurrency queue
  - **mcp/** — MCP server tools for CLI to call (@apps, approvals, A2UI)
  - **docker/** — Container, network, volume managers (dockerode)
  - **db/** — SQLite app registry + token usage + audit log
  - **tokens/** — Token tracker, budget manager, auto-compressor
  - **routes/** — HTTP routes (messages, conversations, apps, health)
- **src/shim/** — Python ADK BaseAgent (protocol adapter, no LLM)
- **src/extensions/apps/** — @apps CLI extension (GEMINI.md + extension.toml)
- **infra/** — Terraform, Traefik, Docker Compose, VM setup

## Key Design Decisions
- CommonJS only (no ESM)
- Fastify for HTTP + SSE streaming
- SQLite (better-sqlite3) for persistence
- Each user message = fresh CLI process with `--resume`
- Conversations are session files on disk, not processes in memory
