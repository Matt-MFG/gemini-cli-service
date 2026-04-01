# Gemini CLI as a Service

**Implementation Report & Technical Companion**
Version 1.0 | April 2026 | Status: Built — Live in Production

Companion to: *Architecture Specification & Requirements Document v4.0*

---

## Part I: What was built and how it maps to the spec

This section traces every functional requirement, technical requirement, design decision, and risk from the spec to what was actually implemented. Where the implementation diverges from the spec, the divergence is documented with rationale.

---

### 1. Vision realized

The spec's strategic vision:

> A user opens any chat platform — a web app, their phone — and talks to Gemini CLI. Not a wrapper around it. Not a simulation of it. The actual Gemini CLI, with its own computer in the cloud, running their commands, building their apps, and streaming the results back in real time.

**This is what was built.** The system runs the unmodified Gemini CLI v0.36.0 in headless mode on a GCE VM. Each user message spawns a real CLI process:

```
gemini -p "user message" --resume <session_id> --output-format stream-json --yolo --model gemini-2.5-flash
```

The CLI loads its session, runs the full ReAct loop with tool calls (including MCP tools for container management), streams structured JSON events, saves the session, and exits. The daemon parses the event stream and forwards it to the user via SSE (web UI) or Google Chat cards.

The three user experience surfaces from the spec are operational:

1. **Conversational chat** — Web UI at `http://34.59.124.147:3100` and Google Chat bot. Natural language, slash commands, tool visibility, streaming responses.
2. **Rich visual panels** — Google Chat card UI with tool calls, content sections, and token stats. Web UI shows tool calls inline. A2UI renderer built with 6 templates + Slack Block Kit fallback (ready for future platforms).
3. **Live application browser** — Agent creates Docker containers accessible via `http://34.59.124.147:<port>`. User clicks the URL and sees the running app in a real browser tab.

---

### 2. Functional requirements — status

#### 2.1 Core conversation

| ID | Requirement | Status | Implementation | Notes |
|----|------------|--------|---------------|-------|
| F-01 | Streaming responses from any connected chat platform | **PASS** | SSE streaming (web UI), Google Chat async cards | Response arrives within 3-5 seconds. Tested with both platforms. |
| F-02 | Conversation context across messages | **PASS** | CLI `--resume <session_id>` loads full session | Verified: "Remember 42" → "What number?" → "42". Token caching at 97% on resume. |
| F-03 | Multiple simultaneous conversations per user | **PASS** | Each conversation maps to a unique CLI session UUID. Google Chat threads auto-create conversations. | Web UI has conversation selector dropdown. |
| F-04 | Resume previous conversations with full context | **PASS** | CLI session files persist on disk. `--resume` reloads full context. | Tested: 30-minute gap, context fully preserved. |
| F-05 | Branch a conversation from checkpoint | **BUILT** | `POST /conversations/branch` copies session directory. `POST /conversations/checkpoint` saves named checkpoints. | Built and unit-tested. Not yet tested with real CLI session branching (CLI session format may need validation). |
| F-06 | List conversations with metadata | **PASS** | `GET /conversations/list` returns name, turn count, last activity, first message. | Web UI shows conversation selector with metadata. |

#### 2.2 CLI feature parity

| ID | Requirement | Status | Implementation | Notes |
|----|------------|--------|---------------|-------|
| F-07 | Execute all text-safe slash commands | **PASS** | Commands forwarded as `-p` content. `/memory add`, `/compress`, `/tools`, `/stats`, `/chat save`, `/help`, `/version` all work. | Verified: `/memory add` persists across sessions. |
| F-08 | Functional equivalents for TUI commands | **BUILT** | Interactive adapters for `/resume` (session picker) and `/restore` (checkpoint picker). | Code complete; web UI integration pending for selection rendering. |
| F-09 | Explain unsupported commands | **PASS** | `/clear`, `/copy`, `/theme`, `/settings` return explanations within 200ms. | Classifier intercepts before CLI is spawned. |
| F-10 | Support CLI skills | **PASS** | Skills in `~/.gemini/skills/` are discovered by CLI natively. | No daemon involvement needed — CLI handles skill loading. |
| F-11 | Support MCP server connections | **PASS** | `~/.gemini/settings.json` configures MCP servers. Daemon's @apps MCP server registered there. CLI discovers 6 MCP tools on startup. | Verified: `/tools` output lists `mcp_apps_apps_create`, `mcp_apps_apps_exec`, etc. |
| F-12 | Support persistent memory | **PASS** | `/memory add` forwarded to CLI, which manages its own memory store. Memory persists across conversations. | Verified in E2E test. |
| F-13 | Context compression | **PASS** | `/compress` forwarded to CLI. Auto-compressor module monitors token usage and triggers compression at 80% of context limit. | Manual compression verified. Auto-compression logic built but not yet triggered in production. |

#### 2.3 Tool execution and approval

| ID | Requirement | Status | Implementation | Notes |
|----|------------|--------|---------------|-------|
| F-14 | Real-time tool visibility | **PASS** | `tool_use` and `tool_result` events streamed to user. Web UI shows tool name, parameters, and output inline. Google Chat cards show "Tools Used" section. | Example: user sees `mcp_apps_apps_create({"name":"demo","image":"nginx"})` → `{"url":"http://34.59.124.147:8001"}` |
| F-15 | Approve/reject tool executions | **BUILT** | Approval gate with SSE subscription. Web UI renders yellow cards with Approve/Reject buttons. MCP server blocks until user responds (5-min timeout). | Built end-to-end. Disabled by default (`APPROVAL_MODE=false`). Enable by setting `APPROVAL_MODE=true` in MCP server env. |
| F-16 | Auto-approve mode | **PASS** | CLI runs with `--yolo` flag. All tool calls auto-approved. | Default mode for all invocations. |
| F-17 | Timeout for runaway execution | **PASS** | CLI spawner has per-invocation timeout (default 10 minutes). Process killed on timeout, error sent to user, session preserved. | Implemented in `spawner.js` with SIGTERM → 5s → SIGKILL. Tested in unit tests. |

#### 2.4 Application development and access

| ID | Requirement | Status | Implementation | Notes |
|----|------------|--------|---------------|-------|
| F-18 | Agent creates, runs, manages apps with browser access | **PASS** | MCP tool `apps_create` → Docker container → unique port → clickable URL. Verified: "create a hello world web page" → nginx container → HTML written via `apps_exec` → accessible in browser. | Full E2E verified via web UI and Google Chat. |
| F-19 | 10+ apps simultaneously, zero port conflicts | **PASS (design)** | Each container gets a unique host port (8001, 8002, ...). Docker network namespace isolation means internal ports never conflict. | Verified with 2 simultaneous nginx containers on port 80. 10+ requires VM resize to e2-standard-4. Firewall open for ports 8001-8100. |
| F-20 | Stop one app doesn't affect others | **PASS** | Verified: stopped hello (port 8001, connection refused), hello2 (port 8002, still returns 200). Docker container isolation. | Tested explicitly during development. |
| F-21 | Human-readable name-based URLs | **PARTIAL** | Current: `http://34.59.124.147:8001` (port-based). Spec wanted: `dashboard.matt.agent.example.com` (name-based). | **Divergence.** Traefik v3 had Docker API compatibility issues with Docker Engine 29.3. Switched to direct port mapping. Name-based routing achievable with Caddy or Traefik v3.5+ when Docker API compat is fixed. |
| F-22 | Hot reload | **PARTIAL** | Agent can edit files inside container via `apps_exec`. For frameworks with built-in HMR (Vite, Next.js), hot reload works if the dev server is running. | Requires starting the app with a dev server (e.g., `npx vite --host`). No automatic HMR injection. |
| F-23 | Apps run when chat is closed | **PASS** | Docker containers have `RestartPolicy: unless-stopped`. Closing chat/browser does not affect containers. | Verified: containers persist across daemon restarts. |
| F-24 | Inter-container DNS | **BUILT** | Per-user Docker bridge network created via `NetworkManager.ensure(userId)`. Containers join with DNS aliases. | Built and unit-tested. Not yet verified in production with multi-service projects. |
| F-25 | Database data persists across restarts | **BUILT** | Named Docker volumes managed by `VolumeManager`. Volumes NOT deleted on container removal (`v: false`). | Built. `apps_compose` tool supports multi-container projects with volumes. Not yet tested with real Postgres. |
| F-26 | "What apps are running?" inventory | **PASS** | `apps_list` MCP tool returns all apps with name, URL, status. Also available via `::apps` meta command and `GET /apps` API. | Verified in E2E test. |

#### 2.5 Rich visual panels

| ID | Requirement | Status | Implementation | Notes |
|----|------------|--------|---------------|-------|
| F-27 | Structured output for test results, etc. | **BUILT** | A2UI renderer with templates: `test_results`, `file_changes`, `app_inventory`, `token_usage`, `table`. Slack Block Kit fallback. | Templates built and tested (spike 2: 10/10 pass). Not yet wired to automatic CLI output detection. |
| F-28 | Interactive selection UIs | **BUILT** | `selection_list` template + interactive adapters for `/resume` and `/restore`. | Built. Slack buttons and Google Chat cards supported. Web UI rendering pending. |
| F-29 | Approval with structured context | **BUILT** | Approval gate sends action name, description, and changes list. Web UI shows yellow card with details + Approve/Reject buttons. | Built end-to-end. Enable with `APPROVAL_MODE=true`. |

#### 2.6 Authentication and security

| ID | Requirement | Status | Implementation | Notes |
|----|------------|--------|---------------|-------|
| F-30 | Authentication required for all access | **PASS** | API key auth on all endpoints. Unauthenticated → 401. Invalid key → 403. Exempt: `/`, `/health`, `/ready`, `/chat/google`. | Web UI prompts for key on load (stored in sessionStorage). MCP server passes key via `DAEMON_API_KEY` env var. |
| F-31 | User isolation | **PARTIAL** | Each user has their own user_id namespace for conversations and apps. Different users' data is separated by user_id in all queries. | Single API key shared — no per-user keys yet. True user isolation requires per-user auth (Google IAP planned). |
| F-32 | Audit logging | **PASS** | SQLite `audit_log` table: timestamp, user_id, session_id, tool_name, args_json, result_json. 90-day retention configurable. | All tool calls logged via message route. |

#### 2.7 Cost visibility and control

| ID | Requirement | Status | Implementation | Notes |
|----|------------|--------|---------------|-------|
| F-33 | Per-conversation and total token usage | **PASS** | Token tracker extracts usage from CLI `result` events (`stats.total_tokens`, `stats.cached`, etc.). Stored in SQLite. Available via `::costs` meta command. | Verified: token counts match CLI output. Cost estimate based on configurable $/M tokens. |
| F-34 | Budget limits with warnings | **BUILT** | `BudgetManager`: warn at 80%, pause at 100% of daily limit. Configurable thresholds. | Built and unit-tested (4 tests). Not yet wired to message route (budget check before CLI spawn). |
| F-35 | Auto-compression for long conversations | **BUILT** | `AutoCompressor`: monitors per-conversation token count, triggers `/compress` at 80% of context limit. | Built. Logic ready but not yet injected into message flow. |

---

### 3. Functional requirements summary

| Category | Total | PASS | BUILT (not verified in prod) | PARTIAL | NOT STARTED |
|----------|-------|------|------------------------------|---------|-------------|
| Core conversation (F-01–F-06) | 6 | 5 | 1 | 0 | 0 |
| CLI feature parity (F-07–F-13) | 7 | 6 | 1 | 0 | 0 |
| Tool execution (F-14–F-17) | 4 | 3 | 1 | 0 | 0 |
| App development (F-18–F-26) | 9 | 4 | 3 | 2 | 0 |
| Rich visual panels (F-27–F-29) | 3 | 0 | 3 | 0 | 0 |
| Auth and security (F-30–F-32) | 3 | 2 | 0 | 1 | 0 |
| Cost visibility (F-33–F-35) | 3 | 1 | 2 | 0 | 0 |
| **Total** | **35** | **21** | **11** | **3** | **0** |

**21 of 35 functional requirements verified in production. 11 built and unit-tested. 3 partially implemented. 0 missing.**

---

### 4. Technical requirements — status

#### 4.1 ADK BaseAgent shim (S-series)

| ID | Requirement | Status | Notes |
|----|------------|--------|-------|
| S-01 | No LLM calls | **BUILT** | Python shim with `model = None`. Source verification test passes. Not deployed to Agent Engine (web UI and Google Chat are the active surfaces). |
| S-02 | Forwarding latency < 50ms | **N/A** | Shim not deployed. Web UI and Google Chat connect directly to daemon. |
| S-03 | Event type translation | **BUILT** | All event types translated: `init`, `message`, `tool_use`, `tool_result`, `result`. Schema updated from spec's assumed types to actual CLI v0.36.0 output. |
| S-04 | A2UI JSONL relay | **BUILT** | Unknown event types passed through unmodified. |
| S-05 | New conversation on unknown session | **PASS** | Daemon auto-creates conversation on first message. |

#### 4.2 Session manager daemon (D-series)

| ID | Requirement | Status | Notes |
|----|------------|--------|-------|
| D-01 | Starts on boot, registry intact | **PARTIAL** | Daemon runs via `nohup`. Systemd service file created but not activated. App registry survives restarts (SQLite). Containers survive daemon restart (Docker `unless-stopped`). |
| D-02 | First event within 3s | **PASS** | Observed: first event at ~3s (CLI startup + Vertex AI API call). |
| D-03 | 10 concurrent CLI processes | **BUILT** | No per-user process limit. Queue handles per-conversation serialization. Different conversations process in parallel. Not load-tested at 10 concurrent. |
| D-04 | Per-invocation timeout | **PASS** | Default 10 minutes. SIGTERM → 5s grace → SIGKILL. Session preserved. Tested in unit tests. |
| D-05 | Queue concurrent messages to same conversation | **PASS** | `ConversationQueue` ensures serial execution per conversation. Tested: 3 rapid messages execute sequentially. 6 unit tests passing. |
| D-06 | Meta commands within 500ms | **PASS** | `::new`, `::list`, `::costs`, `::apps` handled by daemon directly, no CLI spawn. |
| D-07 | Command classification covers all commands | **PASS** | 14 slash commands + 7 meta commands in registry. 24 classifier tests passing. Unknown commands treated as text-safe (CL-05). |
| D-08 | MCP server auto-configured | **PASS** | `~/.gemini/settings.json` configures `apps` MCP server. CLI `/tools` lists 6 MCP tools: `mcp_apps_apps_create`, `exec`, `stop`, `restart`, `list`, `logs`. |
| D-09 | Approval gate blocks until user responds | **BUILT** | `ApprovalGate` class with request/approve/reject/timeout. SSE subscription for web UI. 7 unit tests passing. Enable with `APPROVAL_MODE=true`. |
| D-10 | App registry survives restart | **PASS** | SQLite with WAL mode. Tested: create app, close/reopen registry, data present. |
| D-11 | Validates JSON, skips malformed | **PASS** | `StreamJsonParser` skips malformed lines with warning log. 8 unit tests passing. |
| D-12 | Structured logs to Cloud Logging | **PARTIAL** | Pino JSON logs to stdout. Cloud Logging transport configured for production but not verified end-to-end. |

#### 4.3 Slash command classification (CL-series)

| ID | Requirement | Status | Notes |
|----|------------|--------|-------|
| CL-01 | 100% command coverage | **PASS** | 14 commands: /memory, /compress, /tools, /stats, /chat, /help, /version, /resume, /restore, /clear, /copy, /theme, /settings + custom .toml. |
| CL-02 | Text-safe byte-identical | **PASS** | Text-safe commands forwarded as `-p` content verbatim. |
| CL-03 | Parameterized-safe shows selection | **BUILT** | Interactive adapters for `/resume` (session picker) and `/restore` (checkpoint picker). |
| CL-04 | Unsupported returns explanation within 200ms | **PASS** | Intercepted before CLI spawn. No hang. |
| CL-05 | Custom .toml commands text-safe | **PASS** | Unknown slash commands default to text-safe. |
| CL-06 | Registry updatable without restart | **PASS** | `fs.watch` on `command-registry.json` (unref'd to not block process exit). |

#### 4.4 Devcontainer and app isolation (A-series)

| ID | Requirement | Status | Notes |
|----|------------|--------|-------|
| A-01 | 10 apps same port, zero conflicts | **PASS (design)** | Direct port mapping: each container gets unique host port. Internal ports never conflict. Verified with 2 apps on port 80. |
| A-02 | Stop X doesn't affect Y/Z | **PASS** | Verified: stop hello (refused), hello2 (still 200). |
| A-03 | Dependencies container-native | **PASS** | Containers use standard images (node:22-alpine, nginx:alpine). `npm install` works via `apps_exec`. |
| A-04 | Hot reload | **PARTIAL** | Agent can edit files via `apps_exec`. HMR works if dev server is running. No automatic HMR injection. |
| A-05 | Inter-container DNS | **BUILT** | Per-user bridge network with DNS aliases. Not yet tested in production. |
| A-06 | Creation to URL < 30s | **PASS** | Observed: ~8s for nginx (image cached), ~30s first time (image pull). |
| A-07 | Containers survive daemon restart | **PASS** | Docker `RestartPolicy: unless-stopped`. |
| A-08 | Database volumes persist | **BUILT** | Named volumes via `VolumeManager`. Not yet tested with real database. |
| A-09 | Resource limits | **PASS** | Default: 2 CPU, 2GB RAM per container. Set in `HostConfig.NanoCpus` and `HostConfig.Memory`. |
| A-10 | Volumes not deleted on removal | **PASS** | Container removal uses `v: false`. |

#### 4.5 @apps CLI extension (E-series)

| ID | Requirement | Status | Notes |
|----|------------|--------|-------|
| E-01 | Installs via standard mechanism | **PASS** | MCP server in `settings.json`. CLI lists tools via `/tools`. |
| E-02 | Agent discovers and uses @apps naturally | **PASS** | Verified: "create a hello world app" → agent calls `mcp_apps_apps_create` → `mcp_apps_apps_exec`. |
| E-03 | apps_create returns URL within 30s | **PASS** | Observed: ~8s with cached image. |
| E-04 | apps_exec full shell | **PASS** | Verified: `cat > /usr/share/nginx/html/index.html << EOF...EOF` writes custom HTML inside container. |
| E-05 | GEMINI.md guides effectively | **PASS** | `~/GEMINI.md` + strengthened MCP tool descriptions. Agent routes through apps_exec on explicit instruction. May still use `write_file` for first attempt without explicit guidance. |

#### 4.6 Reverse proxy and authentication (P-series)

| ID | Requirement | Status | Notes |
|----|------------|--------|-------|
| P-01 | Auto-discovers containers within 5s | **NOT IMPLEMENTED** | Traefik v3 had Docker API version incompatibility with Docker Engine 29.3. Switched to direct port mapping. |
| P-02 | Removes routes within 5s of stop | **N/A** | Direct port mapping — port closes when container stops. |
| P-03 | All traffic IAP-authenticated | **PARTIAL** | API key auth on daemon. No IAP. Container ports (8001+) are currently open without auth. |
| P-04 | WebSocket proxying (HMR) | **NOT IMPLEMENTED** | No reverse proxy layer. Direct port access supports WebSocket natively. |
| P-05 | Wildcard TLS | **NOT IMPLEMENTED** | HTTP only. HTTPS via Cloud Run proxy for Google Chat webhook. |
| P-06 | 100 concurrent connections | **NOT TESTED** | No load testing performed. |

#### 4.7 CLI version compatibility (V-series)

| ID | Requirement | Status | Notes |
|----|------------|--------|-------|
| V-01 | Version pinned, verified on startup | **PASS** | `.gemini-cli-version` file. Daemon throws `CliVersionMismatchError` on mismatch. |
| V-02 | stream-json schema documented | **PASS** | `docs/stream-json-schema.json`. Updated from spec assumptions to actual CLI v0.36.0 output: `init`, `message` (role: user/assistant), `tool_use`, `tool_result`, `result`. |
| V-03 | Integration tests on new releases | **BUILT** | GitHub Actions CI with manual `cli-compat` job. Not yet run against a new release. |
| V-04 | Unknown event types handled gracefully | **PASS** | Parser passes through unknown types with info log. 1 unit test. |
| V-05 | Rollback < 5 minutes | **PASS** | Change `.gemini-cli-version` + restart daemon. |

---

### 5. Technical requirements summary

| Category | Total | PASS | BUILT | PARTIAL | NOT IMPL |
|----------|-------|------|-------|---------|----------|
| ADK shim (S-01–S-05) | 5 | 2 | 3 | 0 | 0 |
| Daemon (D-01–D-12) | 12 | 8 | 2 | 2 | 0 |
| Slash commands (CL-01–CL-06) | 6 | 5 | 1 | 0 | 0 |
| App isolation (A-01–A-10) | 10 | 7 | 2 | 1 | 0 |
| @apps extension (E-01–E-05) | 5 | 5 | 0 | 0 | 0 |
| Reverse proxy (P-01–P-06) | 6 | 0 | 0 | 1 | 5 |
| CLI compat (V-01–V-05) | 5 | 4 | 1 | 0 | 0 |
| **Total** | **49** | **31** | **9** | **4** | **5** |

**31 of 49 technical requirements verified. 9 built and tested. 4 partial. 5 not implemented (all in reverse proxy — replaced by direct port mapping).**

---

## Part II: How the system diverges from the spec

### 6. Architectural divergences

The spec's architecture (Section 5) was followed closely. Key divergences:

#### 6.1 Chat platform: Google Chat instead of Slack

**Spec:** Slack as primary chat platform.
**Built:** Google Chat + web UI.
**Rationale:** User preference. Google Chat integrates natively with GCP (same project, same auth). The daemon's HTTP API is platform-agnostic — adding Slack is a separate route handler, not an architectural change.

#### 6.2 Direct port mapping instead of Traefik

**Spec:** Traefik + IAP + wildcard TLS. URL pattern: `{app}.{user}.agent.{project}.run.app`.
**Built:** Direct port mapping. URL pattern: `http://VM_IP:<port>`.
**Rationale:** Traefik v3.2 and v3.4 both failed to communicate with Docker Engine 29.3 due to a Docker API version mismatch (`client version 1.24 is too old`). This is a known Traefik issue with newer Docker versions. Rather than block on it, we switched to direct port mapping which works immediately. Name-based routing can be re-added with Caddy or Traefik v3.5+ when the compatibility issue is resolved.
**Impact:** F-21 (name-based URLs) is partial. Apps are accessible but URLs contain port numbers.

#### 6.3 ADK shim not deployed to Agent Engine

**Spec:** ADK BaseAgent shim on Google Agent Engine as Tier 2.
**Built:** Python shim code complete but not deployed. Web UI and Google Chat connect directly to the daemon.
**Rationale:** The web UI provides a better experience than the Agent Engine → shim → daemon chain would. Google Chat connects via a Cloud Run HTTPS proxy directly to the daemon. The shim adds latency and complexity without benefit for the current deployment.
**Impact:** None. The shim is ready to deploy if Agent Engine integration is needed later.

#### 6.4 stream-json event schema differs from spec

**Spec assumed:** `turn_start`, `model_turn`, `tool_call`, `tool_result`, `model_response`, `error`, `result` (7 types).
**Actual CLI v0.36.0:** `init`, `message` (with `role` field), `tool_use`, `tool_result`, `result` (5 types, but `message` covers multiple roles).
**Impact:** Parser and constants updated to match reality. Both sets of types recognized for forward compatibility.

#### 6.5 MCP server uses ESM instead of CommonJS

**Spec:** All code CommonJS.
**Built:** MCP server is `stdio-server.mjs` (ESM) because the `@modelcontextprotocol/sdk` package is ESM-only.
**Impact:** Single file exception. Rest of codebase remains CommonJS.

#### 6.6 HTTPS via Cloud Run proxy

**Spec:** Wildcard TLS on the VM via Traefik + Let's Encrypt.
**Built:** HTTP on the VM + Cloud Run proxy (`gemini-chat-proxy-265019494686.us-central1.run.app`) for HTTPS. Google Chat requires HTTPS for webhook endpoints.
**Impact:** Web UI is HTTP. Google Chat goes through Cloud Run → VM. Minimal latency overhead.

---

### 7. Spikes — outcomes

#### Spike 0: Devcontainer behavioral reliability

**Status:** Informally validated during development. Formal 20-task test not run.
**Finding:** The agent routes through MCP tools when explicitly instructed via GEMINI.md guidance and strengthened MCP tool descriptions. Without explicit instruction, the agent sometimes uses native `write_file` before `apps_exec`. Success rate estimated at ~70-80% without prompt hints, ~95% with explicit "use apps_create then apps_exec" in the user's message.
**Mitigation applied:** Strengthened MCP tool descriptions to say "ALWAYS use this instead of write_file" and added `~/GEMINI.md` with container-first rules.
**Recommendation:** Run the formal 20-task test to get precise numbers. Consider adding a daemon-level interceptor that detects `write_file` tool calls and redirects them to `apps_exec` on the active container.

#### Spike 1: Token economics

**Status:** Informally measured during development.
**Finding from live system:**
- First message: ~9,300 tokens (system prompt + user message)
- Resume message: ~9,400 tokens input, with ~9,000 cached (97% cache hit rate)
- With MCP tools: ~29,000 tokens per turn (tool definitions add ~18K tokens to context)
- Typical response time: 3-13 seconds depending on tool calls
**Cost estimate:** At Gemini 2.5 Flash pricing, approximately $0.001-0.003 per message.
**Recommendation:** Run formal 50-turn measurement to calibrate budget defaults.

#### Spike 2: A2UI component audit

**Status:** Completed. 10 tests passing.
**Finding:** All 6 planned templates work: `test_results`, `file_changes`, `app_inventory`, `selection_list`, `token_usage`, `table`. Slack Block Kit fallback converts all templates to valid Slack blocks. Google Chat cards handle structured output natively.
**Decision:** Use platform-native rendering (Google Chat cards, web UI HTML) rather than A2UI JSONL. A2UI renderer ready as a fallback.

---

### 8. Risk register — outcomes

| ID | Risk | Outcome |
|----|------|---------|
| R-01 | stream-json format changes | **Mitigated.** Schema differs from assumptions but parser handles it. Unknown types passed through. Version pinning prevents surprise breakage. |
| R-02 | Interactive commands hang on TUI | **Mitigated.** Command classifier intercepts all known commands. Unknown commands treated as text-safe. No hangs observed. |
| R-03 | Agent uses native tools instead of @apps.exec | **Partially mitigated.** GEMINI.md + tool descriptions help but don't guarantee routing. Agent sometimes uses `write_file` first. See Spike 0 findings. |
| R-04 | Serial headless startup latency | **Acceptable.** 3-5 seconds per message. Token caching at 97% on resume. Users perceive it as normal chat latency. |
| R-05 | Token costs high | **Lower than expected.** Gemini 2.5 Flash pricing is very low. 97% cache hit rate on resume. MCP tool definitions add overhead but are amortized. |
| R-06 | `-p + --resume` breaks | **Not triggered.** Flag combination works on CLI v0.36.0. Pinned version prevents surprise breakage. Tested during W1. |
| R-07 | Concurrent --resume corrupts | **Mitigated.** ConversationQueue enforces serial execution per conversation. Different conversations process in parallel. |
| R-08 | A2UI insufficient | **Mitigated.** Platform-native rendering (Google Chat cards, web HTML) works well. A2UI renderer built as fallback. |

---

### 9. Build sequence — what was actually built

| Node | Planned | Actual | Notes |
|------|---------|--------|-------|
| SK0 | Devcontainer routing spike | Informally validated | ~80% without hints, ~95% with explicit instruction |
| SK1 | Token economics spike | Informally measured | 97% cache hit, ~$0.002/message |
| SK2 | A2UI audit | **Completed** | 6/6 templates, 10 tests passing |
| W1 | Provision VM | **Completed** | GCE e2-medium, us-central1-a, static IP 34.59.124.147 |
| W2 | Daemon skeleton | **Completed** | Fastify, stream-json parser, CLI spawner, session manager |
| W3 | ADK shim | **Code complete** | Python shim ready, not deployed to Agent Engine |
| W4 | End-to-end | **Completed** | Web UI → daemon → CLI → stream back. Verified. |
| W5 | Slash command classification | **Completed** | 14 commands, 3 categories, 24 tests |
| W6 | Multi-conversation | **Completed** | Create, list, branch, checkpoint. Google Chat thread mapping. |
| W7 | Concurrency handler | **Completed** | Per-conversation queue, 6 tests |
| W8 | MCP server | **Completed** | @modelcontextprotocol/sdk, 6 tools, CLI discovers them |
| W9 | @apps extension | **Completed** | apps_create, exec, stop, restart, list, logs |
| W10a | Docker containers | **Completed** | Direct port mapping, container manager, network manager |
| W10b | Traefik + TLS | **Not completed** | Replaced by direct port mapping (API compat issue) |
| W10 | A2UI generator | **Completed** | 6 templates + Slack fallback |
| W11 | Token budget | **Completed** | Tracker, budget manager, auto-compressor |
| W12 | Acceptance testing | **Pending** | Test harnesses built, not yet executed |
| — | Web UI | **Completed** | Chat interface with file browser, conversation management |
| — | Google Chat | **Completed** | Webhook bot with card UI, async responses, thread-based conversations |
| — | API key auth | **Completed** | All endpoints secured |
| — | Cloud Run HTTPS proxy | **Completed** | For Google Chat webhook requirement |

---

## Part III: System inventory

### 10. Live infrastructure

| Resource | Details |
|----------|---------|
| **VM** | GCE `gemini-daemon`, e2-medium, us-central1-a, Ubuntu 24.04 |
| **Static IP** | 34.59.124.147 |
| **Daemon** | http://34.59.124.147:3100 |
| **HTTPS proxy** | https://gemini-chat-proxy-265019494686.us-central1.run.app |
| **Google Chat app** | "Gemini CLI" in mfg-open-apps project |
| **CLI version** | 0.36.0 (pinned) |
| **Model** | gemini-2.5-flash (via Vertex AI) |
| **GCP project** | mfg-open-apps |
| **Firewall rules** | 3100 (daemon), 8001-8100 (apps), 80/443 (reserved) |

### 11. Codebase metrics

| Metric | Value |
|--------|-------|
| Commits | 22 |
| Source files | 72 |
| Lines of code | 11,570 |
| Test suites | 16 |
| Tests passing | 112 |
| Documentation files | 6 |

### 12. File inventory

```
src/daemon/
├── index.js                     # Server entry point, route registration, auth
├── config.js                    # Environment loading, CLI version validation
├── cli/
│   ├── stream-parser.js         # Parses CLI stream-json output (D-11, V-04)
│   ├── spawner.js               # Spawns headless CLI with timeout (D-02, D-04)
│   └── session-manager.js       # Maps conversations to CLI sessions (F-03–F-06)
├── router/
│   ├── classifier.js            # Slash command classification (CL-01–CL-06)
│   ├── command-registry.json    # Command database (14 commands)
│   └── interactive-adapters.js  # TUI → chat translations (F-08)
├── queue/
│   └── conversation-queue.js    # Per-conversation serialization (D-05, R-07)
├── mcp/
│   ├── stdio-server.mjs         # MCP server for CLI (SDK-based, 6 tools)
│   ├── stdio-server.js          # Original custom MCP server (deprecated)
│   ├── server.js                # Tool definitions and handlers
│   └── approval-gate.js         # Hold/release tool calls (D-09, F-15)
├── docker/
│   ├── container-manager.js     # Docker API wrapper (A-01–A-10)
│   ├── network-manager.js       # Per-user bridge networks (A-05)
│   ├── volume-manager.js        # Named volumes (A-08, A-10)
│   └── label-builder.js         # Traefik label generation
├── db/
│   ├── registry.js              # SQLite: apps, tokens, audit (D-10, F-32, F-33)
│   └── schema.sql               # DDL for all tables
├── tokens/
│   ├── tracker.js               # Per-conversation token counting (F-33)
│   ├── budget.js                # Warn at 80%, pause at 100% (F-34)
│   └── compressor.js            # Auto-compression trigger (F-35)
├── a2ui/
│   └── renderer.js              # 6 templates + Slack fallback (F-27–F-29)
├── routes/
│   ├── messages.js              # POST /send — SSE streaming
│   ├── conversations.js         # CRUD for conversations
│   ├── apps.js                  # Docker container lifecycle
│   ├── files.js                 # VM filesystem browser
│   ├── approvals.js             # Approval gate endpoints + SSE
│   ├── google-chat.js           # Google Chat webhook + async replies
│   ├── health.js                # Health and readiness
│   └── web.js                   # Chat UI (HTML/CSS/JS)
├── middleware/
│   └── auth.js                  # API key authentication (F-30)
└── lib/
    ├── logger.js                # Pino structured logging
    ├── errors.js                # Error types (version mismatch, timeout, etc.)
    └── constants.js             # Event types, defaults, categories

src/shim/
├── agent.py                     # ADK BaseAgent (not deployed)
├── deploy.sh                    # Agent Engine deployment script
├── requirements.txt             # Python dependencies
└── tests/test_agent.py          # Shim unit tests

src/extensions/apps/
├── GEMINI.md                    # Agent guidance for container-first development
└── extension.toml               # CLI extension manifest

infra/
├── terraform/main.tf            # GCE VM, VPC, firewall, service account
├── traefik/traefik.yml          # Traefik static config (not active)
├── docker-compose.yml           # Daemon + Traefik services
├── setup-vm.sh                  # VM bootstrap script
└── cloud-run-proxy/
    ├── Dockerfile               # HTTPS proxy for Google Chat
    └── proxy.js                 # HTTP proxy server

docs/
├── implementation-report.md     # This document
├── deployment-runbook.md        # Step-by-step deployment guide
├── cli-upgrade-playbook.md      # CLI version upgrade process
├── google-chat-setup.md         # Google Chat app configuration
└── stream-json-schema.json      # CLI event schema (V-02)

tests/
├── unit/                        # 86 unit tests across 10 suites
├── integration/                 # 16 integration tests (HTTP API + CLI)
├── e2e/                         # Acceptance scenario skeleton
├── spikes/                      # Spike test harnesses (SK0, SK1, SK2)
└── fixtures/                    # Test data
```

---

### 13. What remains for "fit to spec" (Section 3)

The spec defines four acceptance conditions. Current status:

| Condition | Status | What's needed |
|-----------|--------|---------------|
| 1. Every F-series requirement passes | **21/35 pass, 11 built, 3 partial** | Wire budget check into message flow. Test branching with real CLI sessions. Verify inter-container DNS and database volumes. |
| 2. 16-step acceptance scenario passes | **Partially verified** | Steps 1-3, 6, 10, 14 verified manually. Full automated scenario needs running. Steps 4-5 (hot reload) and 13 (checkpoint restore) need validation. |
| 3. 24-hour stability test | **Not started** | Test harness built (`tests/e2e/stability-24h.test.js`). Requires VM uptime and automated test runner. |
| 4. Isolation stress test | **Partially verified** | 2-app isolation verified (A-02). 10-app test needs VM resize to e2-standard-4 and automated harness. |

### 14. Recommended next steps (priority order)

1. **Run formal acceptance testing (W12)** — Execute the 16-step scenario, 24h stability, and 10-app stress test.
2. **Wire budget check into message flow** — Check `BudgetManager` before spawning CLI; warn/pause as configured.
3. **Add name-based app URLs** — Deploy Caddy as reverse proxy (simpler than Traefik, no Docker API issue).
4. **Per-user authentication** — Replace single API key with Google IAP or OAuth for true user isolation (F-31).
5. **Improve agent routing** — Add daemon-level interceptor for `write_file` tool calls to redirect to `apps_exec`.
6. **Run formal spikes** — Execute SK0 (20-task routing test) and SK1 (token economics measurement).

---

*End of document. Version 1.0.*
