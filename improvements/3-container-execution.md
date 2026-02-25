# Improvement 3: Container Isolation for Code Execution

## The Problem

When the agent writes a workflow or one-off script, `executor.ts` runs it like this:

```ts
const tmpPath = join(process.cwd(), `.tmp-workflow-${Date.now()}.ts`);
writeFileSync(tmpPath, wrappedCode, 'utf8');

const { stdout, stderr } = await execAsync(`npx tsx "${tmpPath}"`, {
  cwd: process.cwd(),
  env: { ...process.env },  // ← full server environment
});
```

The generated code executes in the same process environment as the server with full access to:

- `process.env` — including `ANTHROPIC_API_KEY`, `CORSAIR_KEK`, `DATABASE_URL`, and every other secret
- The server's entire filesystem at `process.cwd()` — source code, config files, the Drizzle schema, migration files
- The ability to write, delete, or overwrite any file the server process can access
- The ability to make outbound network calls to any destination without restriction

The agent itself also runs with `permissionMode: 'bypassPermissions'` and has access to Bash. The `disallowedTools` list in `agent.ts` blocks `TeamCreate`, `TeamDelete`, `SendMessage`, `TodoWrite`, and `Skill` — but not `Bash` itself. A workflow that imports and calls arbitrary packages, or a malformed agent-generated script, runs with the same trust level as the server.

This is fine today because you're the only user. But it becomes a meaningful risk as the agent handles more complex tasks, and it means any mistake in agent-generated code — even accidental — can affect your live server.

## What the Improvement Looks Like

Workflow execution moves into a minimal Docker container. The container has exactly what it needs to run Corsair API calls and nothing else.

### The execution container

A `Dockerfile.runner` in the agent root:

```dockerfile
FROM node:22-slim

WORKDIR /app

# Install tsx globally — the only runtime needed
RUN npm install -g tsx

# The corsair SDK and its dependencies are pre-installed here
# (copied from the main project's node_modules at build time)
COPY packages/corsair /app/corsair
COPY agent/server/corsair.ts /app/server/corsair.ts

USER 1000  # non-root
```

### The execution flow

```
server (executor.ts)
  │
  ├─ write code to /tmp/<uuid>/workflow.ts
  ├─ write env vars to /tmp/<uuid>/.env  (just the plugin keys needed)
  │
  ├─ docker run --rm \
  │    -v /tmp/<uuid>:/workspace:ro \
  │    --env-file /tmp/<uuid>/.env \
  │    --network=host \           (or a named bridge network)
  │    --memory=256m \            (resource limit)
  │    corsair-runner \
  │    npx tsx /workspace/workflow.ts
  │
  ├─ capture stdout/stderr
  ├─ delete /tmp/<uuid>/   (including the .env)
  └─ return { success, output }
```

The container:
- Can only see `/workspace` — the single directory mounted for this execution
- Has no access to `agent/server/`, the database connection, or other env vars
- Runs as a non-root user
- Is ephemeral (`--rm`) — destroyed immediately after the script exits
- Has resource limits to prevent runaway scripts

### What the container can access

The `corsair` client still works because the container has the Corsair SDK pre-installed and the credentials it needs are passed via `--env-file`. The generated workflow code can call `corsair.slack.api.channels.list()` exactly as before — that API still works the same way. The only thing that changes is the security boundary around the execution.

### Fallback: Node.js vm module (lighter weight)

If Docker is not available or the overhead is unacceptable, a lighter option is Node.js's built-in `vm` module with a restricted context:

```ts
const ctx = vm.createContext({
  corsair,           // only the corsair client
  console,           // stdout/stderr capture
  process: { env: {} },  // no real env
});
vm.runInContext(compiledCode, ctx, { timeout: 30_000 });
```

This doesn't provide OS-level isolation but does prevent access to `process.env` and the filesystem from within the script. It's a meaningful improvement with zero infrastructure changes.

### Alignment with nanoclaw's model

Nanoclaw runs the entire agent (not just the scripts) inside a container. That's a stronger security posture, but it's also a bigger architectural change that requires rebuilding the agent entry point as a container image.

For this project, the right initial scope is narrower: keep the agent running in-process (it's already doing the right thing with `disallowedTools`), and move only the *user-defined workflow execution* into a container. This is the part that runs arbitrary generated code and is the actual risk surface.

## Where It Lives

| What | Where |
|------|-------|
| Runner Dockerfile | `agent/Dockerfile.runner` |
| Execution logic | `agent/server/executor.ts` (replace `execAsync` with docker spawn) |
| Temp execution directories | `/tmp/corsair-exec-<uuid>/` (auto-deleted) |
| Container image build | Added to `docker-compose.yml` as a `build` target |

## User Experience Impact

**Before:** A buggy workflow that accidentally does `writeFileSync('/app/server/corsair.ts', '')` would wipe a source file. A workflow that logs `process.env.ANTHROPIC_API_KEY` would expose the key in the execution output. These are unlikely but possible failure modes.

**After:** The worst a misbehaving workflow can do is crash itself. The server, its source code, and its credentials are completely invisible to the execution environment. The agent can be given more autonomy — the user doesn't need to be as careful about what they ask it to build.

More practically: it makes the project safe to share or run for others. Right now the single-user assumption is load-bearing. Containerized execution removes that constraint.
