# Improvement 1: Native SDK Session Management

## The Problem

Every time a user sends a message, `runAgent()` calls `buildSystemPromptWithHistory()` which manually serializes the last 10–20 messages into the system prompt as plain text:

```ts
// agent.ts
prompt += '\n\n## Conversation history\n\n';
for (const msg of history) {
  prompt += `**${msg.role}**: ${msg.text}\n\n`;
}
```

Then `query()` is called with `persistSession: false`.

This has three concrete problems:

1. **You re-send the same tokens on every turn.** If a conversation has 10 back-and-forth turns, you're paying for all 10 messages worth of history on every single new message. That cost compounds as conversations grow.

2. **History is hard-capped.** WhatsApp and Telegram pollers pass the last 10 messages. The web UI passes the last 20. Anything older is silently dropped. If you talked about something 25 messages ago, the agent has no idea it happened.

3. **No graceful handling when context fills.** With `persistSession: false`, there's no compaction. If a session approaches Claude's context window limit during a single long multi-turn run (up to 30 turns), behavior is undefined.

## What the Improvement Looks Like

The Claude Agent SDK supports native session persistence. When `persistSession: true` is set and a `cwd` pointing to a `.claude/` directory is provided, the SDK:

- Saves the full conversation transcript to disk after each turn
- Resumes from that transcript on the next call via a `sessionId`
- Automatically compacts the conversation when the context window approaches capacity, summarizing old turns and preserving the key content

The change involves:

**1. A per-JID session directory**

Each chat (WhatsApp JID, Telegram chat ID, or web thread) gets its own folder:

```
agent/store/sessions/
  whatsapp-1234567890/
    .claude/
      (SDK session files written here automatically)
  tg-987654321/
    .claude/
  web-<threadId>/
    .claude/
```

The JID is hashed or sanitized to a safe directory name. This folder is created on first message and reused on every subsequent message from that chat.

**2. `query()` changes in `agent.ts`**

```ts
// Before
query({
  prompt,
  options: {
    systemPrompt: buildSystemPromptWithHistory(opts.history),
    persistSession: false,
    cwd: process.cwd(),
    ...
  }
})

// After
query({
  prompt,
  options: {
    systemPrompt: SYSTEM_PROMPT, // no history appended
    persistSession: true,
    resume: opts.sessionId ?? undefined,
    cwd: sessionDir, // points to agent/store/sessions/<jid-hash>
    ...
  }
})
```

The SDK returns a `sessionId` in its output. That ID gets saved to the `threads` table (already exists) and passed back in as `resume` on the next call for that chat.

**3. Remove `buildSystemPromptWithHistory`**

The function goes away entirely. The system prompt becomes a fixed string. History is owned by the SDK.

**4. Remove history fetching from pollers**

The WhatsApp and Telegram pollers currently fetch `lastNMessages` and pass them to `runAgent`. That fetch and the `history` parameter on `runAgent` become unnecessary and get removed, simplifying the call sites.

**5. Add a pre-compact hook (optional but recommended)**

Before the SDK compacts a session, it can fire a hook. This is the right place to write the full conversation to an archive file before the older turns are summarized away:

```
agent/store/sessions/whatsapp-1234567890/
  conversations/
    2026-02-10-setup-slack-webhook.md
    2026-02-18-github-pr-summary.md
```

The agent can reference these files when the user asks "what did we do last week?"

## Where It Lives

| What | Where |
|------|-------|
| Session directories | `agent/store/sessions/<jid-hash>/` |
| SDK files (auto-written) | `agent/store/sessions/<jid-hash>/.claude/` |
| Session ID persistence | `threads.sessionId` column (new column) |
| Conversation archives | `agent/store/sessions/<jid-hash>/conversations/` |
| Code changes | `server/agent.ts`, `server/whatsapp/poller.ts`, `server/telegram/poller.ts`, `server/trpc/router.ts` |

## User Experience Impact

**Before:** The agent forgets anything said more than 10–20 messages ago. If you spent a whole session setting up a Slack workflow three days ago, it has no memory of how it was configured. Every session is effectively fresh after a short window.

**After:** The agent has a complete, persistent memory of every conversation it's ever had with that chat. A user can say "remember last month when you set up that daily GitHub report?" and the agent will have the full context. Sessions that run long automatically compact gracefully — the agent continues working without hitting a hard wall or dropping context.

The token cost also drops significantly. Instead of paying for 10–20 messages of history on every single API call, you pay only for the incremental new turns. For active users this can mean 30–60% fewer input tokens per message.
