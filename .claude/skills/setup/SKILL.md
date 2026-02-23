---
name: setup
description: Run initial Corsair setup. Use when a user wants to install, configure, or get started with their Corsair agent for the first time. Triggers on "setup", "install", "get started", or first-time setup requests.
---

# Corsair Setup

## Credentials

**Never ask the user to paste a credential into chat.** Instead:

1. Run `pwd` to get the absolute project path — call it `$DIR`.
2. Tell the user to run this command, with a clear placeholder showing exactly what to replace:
   ```bash
   echo 'SOME_API_KEY=YOUR_KEY_HERE' >> $DIR/.env
   ```
3. In any setup script you write, read the value from `process.env` — never hardcode it:
   ```typescript
   const API_KEY = process.env.SOME_API_KEY!;
   ```
4. After the script runs successfully, delete each temp line from `.env` yourself. The `sed` command **must always include the absolute path to the file** — never run it without it:
   ```bash
   sed -i '' '/^SOME_API_KEY=/d' $DIR/.env
   ```
   Run one `sed` command per env var you added.

---

Run all steps automatically. Pause only when the user must take a manual action (entering a key, making a choice). When something is broken or missing, fix it yourself. Only ask the user when you genuinely need their input.

**Principle:** Do the exciting stuff first. Get their agent running and talking on WhatsApp before asking for any plugin keys. Each plugin key is an unlock — present them that way.

---

## Phase 1: Bootstrap

### 1a. Check prerequisites

The agent runs inside Docker, so the host Node version doesn't matter for running the server. However, `pnpm` on the host is still needed for IDE tooling (type completions, imports). Check Docker and pnpm:

```bash
docker --version && pnpm --version
```

- **Docker missing:** Ask the user if they'd like you to install it:
  - macOS: `brew install --cask docker` (if brew available), else direct to https://docker.com/products/docker-desktop
  - Linux: `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER`
- **Docker installed but not running:**
  - macOS: `open -a Docker`, wait ~15s, retry
  - Linux: `sudo systemctl start docker`, retry
- **pnpm missing:** `npm install -g pnpm` (only needed for IDE support — the container manages its own)

### 1b. Environment file

Check if `.env` exists. If not:

```bash
cp .env.example .env
```

### 1c. Generate security key

Generate a KEK and write it into `.env` automatically — the user doesn't need to do anything:

```bash
openssl rand -base64 32
```

Read `.env`, find the `CORSAIR_KEK` line, and replace its value with the generated string using a file edit (not sed). The line should look like: `CORSAIR_KEK="<generated-value>"`

### 1d. AI provider

Ask the user:

> "Which AI provider do you want to use? **OpenAI** (GPT) or **Anthropic** (Claude)?"

Direct the user to get their key (OpenAI: https://platform.openai.com/api-keys, Anthropic: https://console.anthropic.com/settings/keys). Give them the exact `echo '...' >> .env` command following the **Credentials** convention above. Then update `server/agent.ts` to use the chosen provider if it isn't already set.

### 1e. Install host dependencies (for IDE support only)

```bash
pnpm install
```

This installs packages on the host purely for editor intellisense and type checking. The agent itself runs in Docker on Node 22 — the host Node version doesn't affect it.

If this fails due to native module build errors, it's non-critical. Skip it and continue — the agent will run fine, the user just loses some IDE type hints.

### 1f. Build and start everything

```bash
docker compose up --build -d
```

This builds all images and starts the full stack:

| Service | URL | Purpose |
|---|---|---|
| Agent (server) | http://localhost:3000 | tRPC API + webhook receiver |
| UI (Next.js) | http://localhost:3001 | Web chat interface |
| Drizzle Studio | http://localhost:4983 | Database browser |
| cloudflared | see logs | Public tunnel to the agent |

The first build takes a couple of minutes. Subsequent starts are instant since Docker caches the dependency layers.

Database migrations run automatically at container startup before the server starts — no manual migration step needed.

Both the agent server (`tsx watch`) and the UI (`next dev`) hot-reload on file changes. `node_modules` is managed entirely by the container; the host version is never used at runtime.

If Docker isn't running, start it and wait for it to be ready:
- macOS: `open -a Docker`
- Linux: `sudo systemctl start docker`

Then poll until it's actually up before retrying:
```bash
until docker info &>/dev/null 2>&1; do sleep 2; done
```

**Get the cloudflared public URL** (needed for webhooks):
```bash
docker compose logs cloudflared 2>&1 | grep -o 'https://[^ ]*\.trycloudflare\.com'
```

This URL is how external services (WhatsApp, Slack, etc.) reach the agent. It changes on every restart unless you configure a named Cloudflare tunnel.

To follow the agent logs:
```bash
docker compose logs -f agent
```

### 1g. Seed code context

Once the containers are up and healthy, run:

```bash
docker compose exec agent pnpm run seed:code
```

This seeds the agent's code context into the database so it can reason about its own codebase. Wait for it to complete before moving on.

---

## Phase 2: Choose plugins

Run:

```bash
docker compose exec agent pnpm available-plugins
```

Show the output to the user. Then ask:

> "Which of these do you want to enable? These are the integrations your agent will be able to use. You can always add more later — just pick what you need right now."

Note their selection. Then update `server/corsair.ts`:
- Keep only the plugins they selected in the `plugins` array
- Remove the imports and entries for plugins they didn't choose
- Leave all selected plugins with empty options for now — e.g. `slack()` — keys come in Phase 4

---

## Phase 3: WhatsApp

Tell the user:

> "Now let's get your agent live on WhatsApp. Once this is done, you'll be able to message it directly. The plugin keys can wait — let's get you something working first."

Start the `/add-whatsapp` skill now. Return here when it's complete.

---

## Phase 4: Keys

The agent is now running. Phase 4 unlocks each plugin the user selected.

**No restarts needed.** Keys are stored encrypted in the database and the agent reads them on every request. Each plugin sub-skill writes a temporary script, runs it, and deletes it.

Read `/add-keys` for a full explanation of how Corsair's key model works before starting.

Work through the selected plugins one at a time. For each plugin, start the corresponding sub-skill listed below. After each one completes, ask:

> "**[Plugin]** is connected! Want to set up **[Next Plugin]** now, or try your agent out first?"

This lets the user exit at any point and return later — each sub-skill can be run independently at any time.

| Plugin | Skill to start |
|--------|---------------|
| Slack | `/add-keys/slack` |
| Linear | `/add-keys/linear` |
| Resend | `/add-keys/resend` |
| Discord | `/add-keys/discord` |
| Google Calendar | `/add-keys/google` |
| Google Drive | `/add-keys/google` (same credentials as Calendar) |

> Google Calendar and Google Drive share the same OAuth app. If the user selected both, run `/add-keys/google` once and it covers both.

---

## Phase 5: Custom integrations

Ask the user:

> "Are there any other tools or APIs you want your agent to be able to use? For example: Stripe, Notion, Airtable, GitHub, Twilio — anything at all."

If yes, start the `/add-plugin` skill for each one. If no, continue.

---

## Phase 6: Launch

All services are already running from step 1f. If any were restarted during plugin setup, confirm the stack is healthy:

```bash
docker compose ps
docker compose logs --tail=30 agent
```

Check for:
- All services status: `running`
- `[whatsapp] Connected to WhatsApp` — if WhatsApp was set up
- No plugin errors or crashes

Get the cloudflared URL and share it with the user:
```bash
docker compose logs cloudflared 2>&1 | grep -o 'https://[^ ]*\.trycloudflare\.com'
```

Tell the user to send a test message on WhatsApp and confirm the agent responds. Let them know the web UI is at http://localhost:3001 and Drizzle Studio at http://localhost:4983.

Congratulate them — their agent is live.

**Useful commands to share with the user:**
```bash
docker compose logs -f agent        # follow agent logs
docker compose logs -f ui           # follow UI logs
docker compose logs cloudflared     # get the public tunnel URL
docker compose up -d agent          # restart agent and pick up .env changes
docker compose down                 # stop everything
docker compose up -d                # start everything again
docker compose up --build -d        # rebuild after package.json changes
```

> **Note:** Use `docker compose up -d <service>` (not `restart`) whenever `.env` changes — `restart` preserves the old environment from container creation.

---

## Troubleshooting

**`docker compose up --build` fails during image build:** Usually a network issue or missing build tools. Check Docker is running. If it fails on `pnpm install` inside the container, check `Dockerfile.dev` (agent) or `Dockerfile.ui.dev` (UI) — the `apt-get` step in `Dockerfile.dev` installs build tools needed by baileys.

**No cloudflared URL in logs:** Wait ~10s after startup, then retry `docker compose logs cloudflared`. If the `cloudflared` container exited, check `docker compose ps` and restart it: `docker compose up -d cloudflared`. The URL changes on every restart.

**Agent crashes on startup:** Run `docker compose logs agent`. Common causes:
- Missing `CORSAIR_KEK` in `.env`
- Missing AI provider key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`)
- Migration failure — check logs for `db:push` errors; usually means Postgres isn't healthy yet. Run `docker compose logs postgres` to diagnose, then `docker compose up -d` to retry.

**Plugin throws key error:** Make sure the plugin's env var is in `.env` and is being passed to the plugin function in `server/corsair.ts`. Then `docker compose restart agent`.

**WhatsApp not responding:** See the `/add-whatsapp` skill's troubleshooting section.

**Added a new npm package:** Run `docker compose up --build -d` to rebuild the image with the new dependency.

**Want to add a plugin later:** Come back and run setup again, or run the `/add-plugin` skill directly.
