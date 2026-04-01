# @apps Extension Guide

You have access to the `@apps` extension for managing application containers. This guide tells you when and how to use it.

## Critical Rules

1. **ALWAYS use `@apps.exec` for shell commands inside containers.** Never use your native `run_shell_command` or `write_file` tools for code that belongs inside a project container. The user's applications run in isolated Docker containers, and your native tools operate on the host VM.

2. **ALWAYS use `@apps.create` before trying to run an application.** This creates a container, assigns a public URL, and starts the app.

3. **Use container names for inter-service communication**, not localhost or IP addresses. For example, if you create a "postgres" service and a "dashboard" service, the dashboard can reach postgres at `postgres:5432`.

4. **Never expose raw port numbers** in URLs you give to the user. Always use the URL returned by `@apps.create`.

## Available Tools

### @apps.create
Create and start a new application container.
```
@apps.create(name="dashboard", image="node:22-alpine", port=3000, start_command="npm start")
```
Returns a public URL like `https://dashboard.user.agent.example.com`

### @apps.exec
Execute commands inside a container. Use this for ALL file writes, package installs, and build commands.
```
@apps.exec(name="dashboard", command="npm install recharts")
@apps.exec(name="dashboard", command="cat src/App.tsx")
```

### @apps.stop / @apps.restart
Control container lifecycle.
```
@apps.stop(name="api-server")
@apps.restart(name="dashboard")
```

### @apps.list
Show all running and stopped applications.
```
@apps.list()
```

### @apps.logs
View recent container output.
```
@apps.logs(name="dashboard", lines=50)
```

### @apps.compose
Create multi-service projects (app + database, frontend + backend).
```
@apps.compose(name="myproject", services={
  "web": {"image": "node:22-alpine", "port": 3000, "command": "npm start"},
  "db": {"image": "postgres:16-alpine", "port": 5432, "env": {"POSTGRES_PASSWORD": "dev"}}
})
```

## Workflow Examples

### Building a React app
1. `@apps.create(name="dashboard", port=3000, start_command="npx vite --host")`
2. `@apps.exec(name="dashboard", command="npm create vite@latest . -- --template react-ts && npm install")`
3. Share the URL with the user
4. Use `@apps.exec` for all subsequent code changes

### App with database
1. `@apps.compose(name="myapp", services={...})`
2. Use `@apps.exec(name="myapp-web", command="...")` for app code
3. Database data persists across restarts

### Checking what's running
1. `@apps.list()` — shows all apps with URLs and status

## Context Management (Phase 2)

### Smart context retrieval
When you need to understand what an app looks like or debug an issue, use targeted retrieval — never read an entire project into context.

- **"Fix the settings page"** → `@apps.app_source(name="dashboard", file_pattern="*settings*")` then read specific files
- **"The API is returning errors"** → `@apps.app_render_text(name="api-server", url_path="/api/users")` then read the route handler
- **"The build is failing"** → `@apps.exec(name="dashboard", command="npm run build 2>&1 | tail -30")`
- **"Improve the design"** → `@apps.app_render_html(name="dashboard", url_path="/settings")` then read CSS/components

### @apps.app_render_text
Returns the rendered text content of a page (HTML stripped). Use when you need to know what the user sees.
```
@apps.app_render_text(app_name="dashboard", url_path="/settings")
```

### @apps.app_render_html
Returns the full HTML of a page. Use for design work where you need markup/CSS inspection.
```
@apps.app_render_html(app_name="dashboard", url_path="/")
```
⚠ Warns if response exceeds 50KB — consider `app_render_text` or `app_source` instead.

### @apps.app_source
Finds and reads source files matching a pattern. Automatically truncates large files (>500 lines) to prevent context flooding.
```
@apps.app_source(app_name="dashboard", file_pattern="App.tsx")
@apps.app_source(app_name="api-server", file_pattern="*.config.js")
```

### Project manifest
Maintain a `.gemini/project-map.md` inside each container — a living index of the file structure and what each component does. Update it as you build. When asked about a feature, consult the manifest first.
```
@apps.exec(name="dashboard", command="cat .gemini/project-map.md")
```

### Context budget rules
1. **Check file size before reading** — use `app_source` which auto-truncates
2. **Prefer targeted commands** over broad reads (`grep` for a function, not `cat` of entire file)
3. **Use app_render_text first** — switch to app_render_html only for design work
4. **Maintain the project manifest** — update it after significant changes
