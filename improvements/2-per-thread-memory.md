# Improvement 2: Per-Thread Memory via CLAUDE.md

## The Problem

The agent currently has no persistent memory system. Every conversation starts completely fresh. The agent builds context only from the last 10–20 messages passed in the system prompt (see improvement 1), and nothing carries forward across sessions.

This means:

**The agent relearns the same things repeatedly.** If you tell it your timezone, your GitHub org, your preferred Slack channel naming convention — it forgets all of that the moment the conversation ends. You end up re-stating context at the start of every session.

**There's no accumulated knowledge per chat.** Each WhatsApp DM, group, or Telegram chat has different people, different purposes, different conventions. None of that context survives a session boundary.

**The agent can't build a working model of you over time.** A genuinely useful assistant should remember that you hate verbose replies, that your Linear workspace is `acme`, that you always want PR notifications in `#engineering` not `#general`. Right now it can't.

## What the Improvement Looks Like

Each chat — every WhatsApp JID, Telegram chat, and web thread — gets its own directory with a `CLAUDE.md` file. The agent can read and update this file directly using the `Edit` and `Write` tools it already has.

```
agent/store/memory/
  whatsapp-1234567890/
    CLAUDE.md
  tg-987654321/
    CLAUDE.md
  web-<threadId>/
    CLAUDE.md
```

The `CLAUDE.md` is a plain markdown file. The agent writes to it in whatever format makes sense for that user:

```markdown
# Memory for this chat

## User preferences
- Prefers Slack notifications over email
- Works in PST timezone
- Refers to their repo as "the monorepo" (actual path: github.com/acme/platform)

## Configured workflows
- Daily standup summary: runs at 9am PST, posts to #engineering
- PR review reminder: fires on github.pull_requests.opened, pings @devs

## Past context
- Set up Linear integration on 2026-01-15, project ID is PLT-xxx
- Asked to never mention costs in responses
```

### How the agent uses it

The `CLAUDE.md` file is loaded natively by the Claude SDK when `cwd` points to the session directory (which already contains `.claude/` for session management — see improvement 1). The SDK automatically includes `CLAUDE.md` from the working directory as context.

The agent's system prompt gets a short instruction:

> You have a `CLAUDE.md` file in your working directory. Read it at the start of each conversation for context about this user. Update it when you learn something worth remembering — preferences, identifiers, workflow configs, things the user has asked you to remember. Keep it concise.

The agent then freely uses `Edit` (already an allowed tool) to update the file mid-conversation when it learns something important.

### Global memory

A second file at `agent/store/memory/global/CLAUDE.md` holds shared context that applies to all chats — system-wide configuration, owner preferences, integration notes. The agent loads this first, then the per-chat `CLAUDE.md` on top.

```
agent/store/memory/
  global/
    CLAUDE.md       ← always loaded, applies everywhere
  whatsapp-1234567890/
    CLAUDE.md       ← loaded only for this JID
```

### Integration with session management (improvement 1)

If both improvements are adopted, the session directory and the memory directory merge naturally:

```
agent/store/sessions/whatsapp-1234567890/
  CLAUDE.md         ← agent memory for this chat
  .claude/          ← SDK session files
  conversations/    ← archived transcripts
```

The `cwd` for `query()` becomes this directory, so the SDK picks up `CLAUDE.md` automatically without any extra injection code.

## Where It Lives

| What | Where |
|------|-------|
| Per-chat memory files | `agent/store/memory/<jid-hash>/CLAUDE.md` |
| Global memory | `agent/store/memory/global/CLAUDE.md` |
| Code changes | `server/agent.ts` (cwd, system prompt instruction) |
| Merged location (if using improvement 1) | `agent/store/sessions/<jid-hash>/CLAUDE.md` |

## User Experience Impact

**Before:** The agent has no memory between sessions. If you say "my timezone is PST" in one message, it's gone the next. Every session starts cold. You end up re-stating the same context repeatedly.

**After:** Memory is completely transparent. The user can ask the agent "what do you remember about me?" and it reads back exactly what's in `CLAUDE.md`. They can say "forget that I work at Acme" and the agent edits the file. They can say "always refer to my Slack workspace as the main workspace" and the agent adds that line.

More importantly, the agent becomes genuinely useful across sessions. It remembers that you called your GitHub repo "the platform repo", that you prefer DMs over group pings, that your Linear workspace ID is `acme-123`. These aren't things you want to repeat every conversation — they're things that should just always be there.
