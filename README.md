# Corsair Agent

Your developer stack, automated. Trigger from WhatsApp or Telegram (or vibe code a light, local UI around it).

A persistent automation server that watches your tools and tells you what matters.

No MCP. No CLI access. Just typed API calls the agent writes.

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

## Quick start

Clone the repo. The setup skill handles everything else — just tell it to get started.

```bash
git clone https://github.com/corsairdev/agent.git corsair
cd corsair
```

Point your coding agent to /setup (in Claude Code, run `/setup`)

The skill walks you through:
1. Docker check and image build (Node 22, Postgres)
2. Choosing an AI provider
3. Running database migrations
4. Authenticating WhatsApp — so you have something working immediately
5. Plugin credentials one at a time, stored encrypted in the database

## Environment variables

`.env` holds three things and nothing else:

```bash
# AI provider — set one
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...

# Master encryption key — generated automatically during setup
CORSAIR_KEK=

# WhatsApp
WHATSAPP_ENABLED=false   # set to true after running /add-whatsapp
BOT_NAME=corsair         # trigger word in group chats (@corsair)
```

Plugin credentials (Slack, Linear, Google, etc.) are encrypted in Postgres — never in `.env`. The `/add-keys` skills handle storing them.

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
