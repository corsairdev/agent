# Corsair: fork this and make it yours

**An AI assistant wired into your services, running in containers. Sensitive actions require your explicit approval, and the agent is architecturally incapable of bypassing them.**

**Fork this repo and build your command center.**

---

The 🦞 craze is insane. I'm not excited to give it unrestricted access to my email, Slack, CRM, and calendar. The existing guardrails are all prompted and can be bypassed by the agent.

Corsair takes a different approach, because it uses an API.

The guardrails aren't instructions to the agent, but they're permissions built into the API layer itself. When you protect an endpoint, the code the agent writes hits a hard stop before that action executes. It doesn't matter what the agent was instructed to do. The action cannot proceed without a database-backed approval from you. You click Accept and then and only then does it continue.

## Quick Start

```bash
git clone https://https://github.com/corsairdev/agent corsair
cd corsair
claude setup
```

Claude Code handles everything: dependencies, database, Docker, credentials, and service configuration. You'll have a working Telegram or WhatsApp assistant before you close the terminal (<5 mins).

## Philosophy

**Built on an integration ORM.** Corsair is powered by [the Corsair SDK](https://github.com/corsairdev/corsair), a TypeScript SDK built for agents. Think of it as an ORM for your integrations: one consistent API across Slack, GitHub, Linear, Gmail, HubSpot, and everything else, with auth, rate limiting, webhooks, and local database sync handled automatically. That consistent layer is what makes everything below possible.

**Guardrails in the code, not the prompt.** Because every API call goes through the Corsair SDK, the agent cannot instruct its way around it, or decide it doesn't apply. It is structurally incapable of proceeding without your explicit sign-off. The sign-off is a temporarily-generated link that you receive in your messaging app. Click it, review the content, and approve or decline the agent's actions.

**APIs, not MCP.** The Corsair SDK exposes more functionality too: most services offer far more via their REST API than any MCP server covers, so the agent can do things MCP-based assistants simply can't. Also, MCP loads every available tool into the context window upfront, which means tokens are spent before the agent does anything. Instead, the agent interacts with the Corsair SDK the way a human would: by reading types, checking available methods, understanding the shape of a response before acting on it.

**Webhooks and schedules that just work.** API also allows for native webhooks. Simply tell Corsair to let you know when something happens, and it can do it seamlessly. If a workflow fails, Corsair diagnoses and repairs it on its own.

**Skills over features.** Want to add an integration, require approval for a new action, or wire in a different channel? Run a skill. Skills are markdown files — **no code to write**. Corsair modifies itself through conversation.

**Your dashboard, truly yours.** Most tools give you a fixed UI you configure around. Corsair comes wired up and you just describe the interface you want on top of it. Chat, buttons, triggers, alerts, tables, whatever makes sense for how you work. Every piece of data that moves through Corsair is persisted, so anything you build has full history to draw from. You're not customising someone else's product. You're building yours, but the hard parts are already done.

## What It Supports

- **Messenger I/O** — WhatsApp, Telegram, or the included, fully-customizable web UI
- **Pre-built integrations** — Slack, GitHub, Linear, Gmail, HubSpot, Resend, PostHog, Google Drive, Google Sheets, Google Calendar, Web Search. More via skills.
- **Webhook triggers** — React to real events: new PR, incoming email, deal created, issue updated, anything your connected services emit
- **Scheduled workflows** — Recurring tasks that run automatically and notify you when done
- **Approval gates** — Protect any endpoint. The agent cannot execute that action without your explicit sign-off.
- **Self-healing workflows** — When a scheduled or webhook workflow fails, Corsair diagnoses the error, completes the missed run, and patches the workflow code
- **Web access** — Search and fetch content from the web

## Usage

```
Send an email thanking Jim for his time today
```
Corsair drafts the email in your tone and sends it to you. Approve it in one click. The agent literally cannot send an email until you approve.

```
Send a summary of this week's open PRs to #engineering every Friday at 5pm
```
Corsair sets up the workflow. Every Friday it fetches the PRs, drafts the summary, and sends the message.

```
When a new HubSpot deal over $10k is created, message me with the details
```
Corsair wires the webhook. When it fires, it sends you a message.

```
Add a daily 9am briefing — open PRs, new Linear issues, anything urgent in Slack
```
Corsair builds the workflow, connects the sources, and schedules it. Every morning from then on, no further input is required.

## Customizing

Corsair uses skills for all customization. No code to write, no config files to edit.

- `Add my Notion workspace` → `/add-plugin`
- `Require approval before any email is sent` → `/add-protections`
- `Add a Telegram channel` → `/add-telegram`
- `Build me a dashboard for my workflows` → describe it, Corsair builds it
- `Always reply in under two sentences` → just tell it

Run `/customize` for guided changes. Claude Code modifies the codebase. You end up with exactly what you need.

## FAQ
<details>
<summary>**How is this different from OpenClaw?**</summary>
OpenClaw gives Claude access to your computer and connected services and lets it operate freely. Any guardrails are instructions to the agent, which means a sufficiently motivated or confused agent can work around them. Corsair operates in dedicated containers, which means it can't touch your filesystem. Also, using Corsair's native SDK, you can protect actions so they can't proceed without a database-backed approval token from you. 
No amount of instruction changes that. You also get more out of your integrations — OpenClaw's MCP-based tools cover a subset of what each service's API exposes, while Corsair works against the full API surface. 
The tradeoff is that Corsair is purpose-built for integrations, workflows, triggers, and cron jobs rather than general computer use.
</details>

<details>
<summary>**Do I need to write code?**</summary>
No. The agent writes all the code. You describe what you want and it builds it. Skills handle everything else.

</details>
<details>
<summary>**What if a workflow breaks?**</summary>
Corsair diagnoses it autonomously, completes the missed run, patches the workflow code, and notifies you. If it genuinely can't fix it without your input, it asks.

</details>
<details>
<summary>**Can I inspect the generated code?**</summary>
Yes. Every workflow is stored in the database. Ask Corsair to show you the code for any workflow, explain it, or modify it. The code is yours.

</details>
<details>
<summary>**What if I want to add an integration that isn't built in?**</summary>

Describe the API to Corsair or run `/add-plugin`. It writes the plugin, adds it to the SDK, seeds code examples, and makes it available immediately. Any REST API works.

## Requirements

- macOS or Linux
- Node.js 20+
- Docker
- [Claude Code](https://claude.ai/download)