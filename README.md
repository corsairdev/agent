# Corsair Agent

Your developer stack, automated. Describe what you want from WhatsApp — Corsair writes TypeScript, runs it, and keeps it running forever.

Not a chatbot. A persistent automation server that watches your tools and tells you what matters, without you asking.

No MCP. No CLI access. Just typed API calls — code you can read, modify, and share.

## What it does

Send a message from WhatsApp:

> *"every morning at 9am tell me my open Linear issues, unread PRs, and Stripe MRR"*

Corsair writes TypeScript against the Corsair SDK, typechecks it, stores it as a workflow, and runs it on schedule — delivering results back to your WhatsApp. You never touch code.

Or trigger from events:

> *"whenever someone opens a GitHub issue, summarise it and post to #bugs in Slack"*

A webhook workflow is registered. It fires on the event, runs the code, and you're done.

**Three modes:**
- **Scripts** — run immediately, output returned to WhatsApp
- **Cron workflows** — run on a schedule, results delivered to WhatsApp
- **Webhook workflows** — fire on external events (GitHub, Stripe, Linear, Slack...)

## How it works

```
WhatsApp message
  → poller picks it up
  → agent searches code examples (semantic search)
  → agent writes TypeScript using Corsair SDK
  → typechecked before execution
  → runs immediately (script) or stored + scheduled (workflow)
  → output delivered back to WhatsApp
```

External events follow the same path in reverse:

```
Webhook arrives (GitHub star, Stripe payment, Linear issue...)
  → matched to stored webhook workflows
  → workflow executes
  → result sent to WhatsApp
```

## Stack

| Layer | Technology |
|-------|-----------|
| Interface | WhatsApp (Baileys) |
| Agent / LLM | Vercel AI SDK — Anthropic (default) or OpenAI |
| Integrations | Corsair SDK (Slack, Linear, GitHub, Gmail, Drive, Calendar, Discord, Resend...) |
| Memory | mem0 — persistent per-conversation context |
| Database | Postgres + Drizzle ORM |
| Scheduler | node-cron |
| Server | Express + tRPC on port 3001 |

## Quick start

Setup is handled by Claude Code. Clone the repo, open it in Claude Code, and run `/setup`. It walks through dependencies, environment variables, database setup, and WhatsApp authentication.

```bash
git clone https://github.com/your-org/corsair-agent
cd corsair-agent
claude
```

Then run `/setup`.

If you need an integration that isn't built in, tell Claude Code what API you want to add. It will write the plugin, add code examples to the search index, and wire it into the agent. Any API with a REST interface can become a Corsair integration.

For manual setup:

# 2. Copy and fill in environment variables
cp .env.example .env

# 3. Start Postgres
pnpm db:up

# 4. Run migrations + seed code examples
pnpm db:push && pnpm seed:code

# 5. Authenticate WhatsApp (scan QR code)
pnpm whatsapp:auth

# 6. Start the server
pnpm dev
```

Set `WHATSAPP_ENABLED=true` in `.env` to activate the WhatsApp listener.

## Environment variables

```bash
# LLM — set at least one (Anthropic preferred)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...          # fallback if Anthropic not set

# Postgres
DATABASE_URL=postgres://postgres:secret@localhost:5432/corsair

# WhatsApp
WHATSAPP_ENABLED=true
BOT_NAME=corsair               # trigger word in group chats (@corsair)
```

## Project structure

```
server/
  index.ts          # Express server, cron scheduler, webhook router
  agent.ts          # LLM orchestration — tools, system prompt, step loop
  executor.ts       # Runs scripts (tsx) and stores/executes workflows
  search.ts         # Semantic search over code examples
  typecheck.ts      # TypeScript compiler check before execution
  memory.ts         # Per-conversation memory via mem0
  db/               # Drizzle schema + migrations
  whatsapp/         # Baileys connection, auth, message poller
  seed/             # Code examples for the agent's semantic search
```

## Adding integrations

Corsair integrates via typed API calls — no MCP servers, no shell commands. Every integration is TypeScript code that calls a service's REST API directly.

To add an integration that isn't built in, open Claude Code and describe the API you want:

> *"Add a Notion integration so I can create pages and query databases from WhatsApp"*

Claude Code will write the plugin, add it to the Corsair SDK, seed code examples into the search index, and make it available to the agent immediately. Any API with a REST interface works.

## Contributing skills

Skills are Claude Code SKILL.md files that transform your Corsair installation — adding plugins, configuring auth, seeding example workflows. See `.claude/skills/` for examples.
