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
