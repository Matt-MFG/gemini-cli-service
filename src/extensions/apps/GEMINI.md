# App Container Tools

You have MCP tools for managing application containers. All apps run in isolated Docker containers on this VM.

## Critical Rules

1. **ALWAYS use `apps_exec` for shell commands inside containers.** Never use your native `run_shell_command` or `write_file` tools for code that belongs inside a project container. Your native tools operate on the host VM — `apps_exec` operates inside the container.

2. **ALWAYS use `apps_create` ONCE to create a container.** After creation, use `apps_exec` for ALL subsequent work — installing packages, writing files, editing code, fixing errors. NEVER create a new app to fix an error in an existing app.

3. **When an app has errors, FIX IT with `apps_exec`, don't recreate it.** Check logs with `apps_logs`, read the source with `apps_exec`, then fix the code with `apps_exec`. Creating a new container to avoid fixing a bug is WRONG.

4. **Use container names for inter-service communication**, not localhost or IP addresses.

5. **Never expose raw port numbers** in URLs you give to the user. Always use the URL returned by `apps_create`.

## Error Recovery Workflow

When something goes wrong with an app, follow this sequence:
1. `apps_logs(name="myapp")` — check what the error is
2. `apps_exec(name="myapp", command="cat <file>")` — read the relevant source file
3. `apps_exec(name="myapp", command="cat > <file> << 'EOF'\n<fixed code>\nEOF")` — fix the file
4. `apps_restart(name="myapp")` — restart if needed
5. `apps_logs(name="myapp")` — verify the fix

NEVER do: `apps_create(name="myapp-v2")` or `apps_create(name="myapp-fixed")` — this wastes resources and doesn't fix anything.

## Available Tools

### apps_create
Create and start a new application container.
```
apps_create(name="dashboard", image="node:22-alpine", port=3000, start_command="npm start")
```
Returns a public URL. If the app already exists and is running, returns the existing URL.

### apps_exec
Execute commands inside a container. Use this for ALL file writes, package installs, and build commands.
```
apps_exec(name="dashboard", command="npm install recharts")
apps_exec(name="dashboard", command="cat src/App.tsx")
```

### apps_stop / apps_restart
Control container lifecycle.
```
apps_stop(name="api-server")
apps_restart(name="dashboard")
```

### apps_list
Show all running and stopped applications.
```
apps_list()
```

### apps_logs
View recent container output.
```
apps_logs(name="dashboard", lines=50)
```

### apps_compose
Create multi-service projects (app + database, frontend + backend).
```
apps_compose(name="myproject", services={
  "web": {"image": "node:22-alpine", "port": 3000, "command": "npm start"},
  "db": {"image": "postgres:16-alpine", "port": 5432, "env": {"POSTGRES_PASSWORD": "dev"}}
})
```

## Workflow Examples

### Building a React/Next.js app
**IMPORTANT: Always use `start_command="sleep infinity"` when creating the app.** This keeps the container alive while you write code. Start the dev server AFTER writing files and installing dependencies.

1. `apps_create(name="dashboard", port=3000, start_command="sleep infinity")`
2. `apps_exec(name="dashboard", command="cat > package.json << 'EOF'\n{...}\nEOF")`
3. `apps_exec(name="dashboard", command="npm install")`
4. Write all source files with `apps_exec`
5. `apps_exec(name="dashboard", command="nohup npx next dev --hostname 0.0.0.0 > /tmp/dev.log 2>&1 &")` — start the dev server in background
6. Share the URL with the user
7. Use `apps_exec` for all subsequent code changes — the dev server will hot-reload

Do NOT set `start_command` to `npm run dev` or `npm start` — the container will restart in a loop because there's no code yet.

### App with database
1. `apps_compose(name="myapp", services={...})`
2. Use `apps_exec(name="myapp-web", command="...")` for app code
3. Database data persists across restarts

### Checking what's running
1. `apps_list()` — shows all apps with URLs and status

## Context Management

### Smart context retrieval
When you need to understand what an app looks like or debug an issue, use targeted retrieval — never read an entire project into context.

- **"Fix the settings page"** → `app_source(app_name="dashboard", file_pattern="*settings*")` then read specific files
- **"The API is returning errors"** → `app_render_text(app_name="api-server", url_path="/api/users")` then read the route handler
- **"The build is failing"** → `apps_exec(name="dashboard", command="npm run build 2>&1 | tail -30")`
- **"Improve the design"** → `app_render_html(app_name="dashboard", url_path="/settings")` then read CSS/components

### app_render_text
Returns the rendered text content of a page (HTML stripped). Use when you need to know what the user sees.
```
app_render_text(app_name="dashboard", url_path="/settings")
```

### app_render_html
Returns the full HTML of a page. Use for design work where you need markup/CSS inspection.
```
app_render_html(app_name="dashboard", url_path="/")
```

### app_source
Finds and reads source files matching a pattern. Automatically truncates large files (>500 lines) to prevent context flooding.
```
app_source(app_name="dashboard", file_pattern="App.tsx")
app_source(app_name="api-server", file_pattern="*.config.js")
```

### Context budget rules
1. **Check file size before reading** — use `app_source` which auto-truncates
2. **Prefer targeted commands** over broad reads (`grep` for a function, not `cat` of entire file)
3. **Use app_render_text first** — switch to app_render_html only for design work
