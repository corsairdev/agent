---
name: add-telegram
description: Add Telegram as a messaging channel to the Corsair agent. Use when the user wants to chat with their agent via a Telegram bot instead of or alongside WhatsApp.
---

# Corsair Telegram Setup

Run all steps automatically. Pause only when the user must take a manual action (creating a bot, providing a token). Always run commands directly — never tell the user to run something you can do yourself.

The agent runs in Docker — use `docker compose exec agent <command>` for commands that need to run inside the container. Exception: `docker compose` commands themselves run on the host.

---

## 1. Verify the agent container is running

```bash
docker compose ps
```

The `agent` service should be running. If not:

```bash
docker compose up -d
```

---

## 2. Create the Telegram bot (BotFather)

> `grammy` ships pre-installed in Corsair's Docker image — no package installation step needed.

If the user doesn't already have a bot token, tell them:

> I need you to create a Telegram bot — it only takes 30 seconds:
>
> 1. Open Telegram and search for **`@BotFather`**
> 2. Send `/newbot`
> 3. Choose a display name (e.g. "My Assistant")
> 4. Choose a username — must end in `bot` (e.g. `my_assistant_bot`)
> 5. Copy the token it gives you (looks like `123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)
>
> Paste the token here when you have it.

Wait for the token before continuing.

---

## 4. Configure environment variables

Read `.env` (in the project root). Add these entries if not present:

```
# Required: enable the Telegram listener
TELEGRAM_ENABLED=true

# Bot token from BotFather
TELEGRAM_BOT_TOKEN=<their-token>

# Optional: bot username used as trigger in group chats (default: corsair)
BOT_NAME=corsair
```

Follow the **Credentials** convention: never ask for the token in chat. Instead, tell the user to run:

```bash
echo 'TELEGRAM_BOT_TOKEN=YOUR_TOKEN_HERE' >> /path/to/project/.env
```

Then update `TELEGRAM_ENABLED=true` yourself by editing `.env`.

---

## 5. Update the database schema

Open `server/db/schema.ts`. Make two changes:

### 5a. Add `'telegram'` to the threads source enum

Find the `threads` table definition. The `source` column currently lists `['web', 'whatsapp']`. Add `'telegram'`:

```typescript
source: text('source', { enum: ['web', 'whatsapp', 'telegram'] })
  .notNull()
  .default('web'),
```

### 5b. Add Telegram tables at the end of the file

```typescript
// ── Telegram tables ────────────────────────────────────────────────────────────

export const telegramMessages = pgTable('telegram_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Numeric Telegram chat ID */
  chatId: text('chat_id').notNull(),
  /** Numeric sender ID */
  senderId: text('sender_id').notNull(),
  /** Display name of the sender */
  senderName: text('sender_name'),
  content: text('content').notNull(),
  /** When Telegram says the message was sent */
  sentAt: timestamp('sent_at').notNull(),
  /** True if this is a group or supergroup chat */
  isGroup: boolean('is_group').notNull().default(false),
  /** False = not yet handled by the agent poller */
  processed: boolean('processed').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const telegramChats = pgTable('telegram_chats', {
  chatId: text('chat_id').primaryKey(),
  name: text('name'),
  type: text('type', { enum: ['dm', 'group'] }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

---

## 6. Create the Telegram channel files

Create a new directory `server/telegram/` with three files, mirroring the WhatsApp pattern.

### 6a. `server/telegram/connection.ts`

```typescript
import { Bot } from 'grammy';

export interface InboundTelegramMessage {
  chatId: number;
  senderId: number;
  senderName: string | null;
  content: string;
  isGroup: boolean;
  sentAt: Date;
}

export class TelegramConnection {
  private bot: Bot;

  constructor(
    token: string,
    private onMessage: (msg: InboundTelegramMessage) => Promise<void>,
  ) {
    this.bot = new Bot(token);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // /chatid command — lets users discover their chat ID
    this.bot.command('chatid', async (ctx) => {
      await ctx.reply(`Chat ID: ${ctx.chat.id}`);
    });

    this.bot.on('message:text', async (ctx) => {
      const msg = ctx.message;
      const from = ctx.from;
      const chat = ctx.chat;

      // Skip messages the bot sent itself
      if (from?.is_bot) return;

      const firstName = from?.first_name ?? '';
      const lastName = from?.last_name ? ` ${from.last_name}` : '';
      const senderName = firstName + lastName || null;

      await this.onMessage({
        chatId: chat.id,
        senderId: from?.id ?? 0,
        senderName,
        content: msg.text,
        isGroup:
          chat.type === 'group' ||
          chat.type === 'supergroup' ||
          chat.type === 'channel',
        sentAt: new Date(msg.date * 1000),
      });
    });
  }

  async start(): Promise<void> {
    // start() launches long polling — non-blocking, runs in background
    this.bot.start().catch((err) => {
      console.error('[telegram] Bot error:', err);
    });
    console.log('[telegram] Bot started (long polling)');
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    console.log('[telegram] Bot stopped');
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    await this.bot.api.sendMessage(chatId, text);
  }

  async setTyping(chatId: number): Promise<void> {
    await this.bot.api.sendChatAction(chatId, 'typing').catch(() => {});
  }
}
```

### 6b. `server/telegram/poller.ts`

```typescript
import type { ModelMessage, ToolModelMessage } from 'ai';
import { asc, desc, eq } from 'drizzle-orm';
import { runAgent } from '../agent';
import { db, telegramMessages, threadMessages, threads } from '../db';

const POLL_INTERVAL_MS = 2000;

/** tg:<chatId> — consistent JID format used in threads table */
function toJid(chatId: number | string): string {
  return `tg:${chatId}`;
}

function getBotMentionPattern(): RegExp {
  const botName = process.env.BOT_NAME || 'corsair';
  return new RegExp(`@${botName}`, 'i');
}

function buildResumeMessages(
  storedMessages: ModelMessage[],
  toolCallId: string,
  toolName: string,
  answer: string,
): ModelMessage[] {
  return [
    ...storedMessages,
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName,
          output: { type: 'text', value: answer },
        },
      ],
    } satisfies ToolModelMessage,
  ];
}

async function getOrCreateThread(jid: string): Promise<string> {
  const [existing] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(eq(threads.jid, jid))
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(threads)
    .values({ source: 'telegram', jid })
    .returning({ id: threads.id });

  return created!.id;
}

async function pollOnce(
  sendMessage: (chatId: number, text: string) => Promise<void>,
  setTyping: (chatId: number) => Promise<void>,
): Promise<void> {
  const unprocessed = await db
    .select()
    .from(telegramMessages)
    .where(eq(telegramMessages.processed, false))
    .orderBy(asc(telegramMessages.createdAt));

  for (const msg of unprocessed) {
    // Groups: only trigger when @botname is mentioned
    if (msg.isGroup) {
      const mentionPattern = getBotMentionPattern();
      if (!mentionPattern.test(msg.content)) {
        await db
          .update(telegramMessages)
          .set({ processed: true })
          .where(eq(telegramMessages.id, msg.id));
        continue;
      }
    }

    // Mark processed before calling the agent — prevents duplicate processing
    await db
      .update(telegramMessages)
      .set({ processed: true })
      .where(eq(telegramMessages.id, msg.id));

    const jid = toJid(msg.chatId);
    const chatIdNum = Number(msg.chatId);
    const threadId = await getOrCreateThread(jid);

    await db.insert(threadMessages).values({
      threadId,
      role: 'user',
      text: msg.content,
    });

    const recent = await db
      .select()
      .from(threadMessages)
      .where(eq(threadMessages.threadId, threadId))
      .orderBy(desc(threadMessages.createdAt))
      .limit(10);

    const pendingAssistant = recent.find(
      (m) => m.role === 'assistant' && m.pendingToolCallId,
    );

    let agentMessages: ModelMessage[];

    if (
      pendingAssistant?.pendingMessages &&
      pendingAssistant.pendingToolCallId &&
      pendingAssistant.pendingToolName
    ) {
      agentMessages = buildResumeMessages(
        pendingAssistant.pendingMessages as ModelMessage[],
        pendingAssistant.pendingToolCallId,
        pendingAssistant.pendingToolName,
        msg.content,
      );
      await db
        .update(threadMessages)
        .set({
          pendingMessages: null,
          pendingToolCallId: null,
          pendingToolName: null,
        })
        .where(eq(threadMessages.id, pendingAssistant.id));
    } else {
      const history = await db
        .select()
        .from(threadMessages)
        .where(eq(threadMessages.threadId, threadId))
        .orderBy(asc(threadMessages.createdAt))
        .limit(5);

      agentMessages = history.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.text || '',
      }));
    }

    try {
      await setTyping(chatIdNum);
      const output = await runAgent(agentMessages, { jid });

      let replyText = '';

      if (output.type === 'needs_input') {
        replyText = output.question;
        const pendingMsgs: ModelMessage[] = [
          ...agentMessages,
          ...output.pendingMessages.slice(agentMessages.length),
        ];
        await db.insert(threadMessages).values({
          threadId,
          role: 'assistant',
          text: replyText,
          pendingMessages: pendingMsgs,
          pendingToolCallId: output.toolCallId,
          pendingToolName: output.toolName,
        });
      } else if (output.type === 'message') {
        replyText = output.text;
        await db.insert(threadMessages).values({
          threadId,
          role: 'assistant',
          text: replyText,
        });
      } else if (output.type === 'script') {
        replyText = output.error
          ? `Error: ${output.error}`
          : output.message || output.output?.trim() || 'Done.';
        await db.insert(threadMessages).values({
          threadId,
          role: 'assistant',
          text: replyText,
        });
      } else if (output.type === 'workflow') {
        replyText = output.message
          ? output.message
          : output.cronSchedule
            ? `Workflow scheduled: ${output.cronSchedule}`
            : output.webhookTrigger
              ? `Webhook workflow registered for ${output.webhookTrigger.plugin}.${output.webhookTrigger.action}`
              : 'Workflow stored.';
        await db.insert(threadMessages).values({
          threadId,
          role: 'assistant',
          text: replyText,
        });
      }

      if (replyText) {
        await sendMessage(chatIdNum, replyText);
      }

      await db
        .update(threads)
        .set({ updatedAt: new Date() })
        .where(eq(threads.id, threadId));
    } catch (err) {
      console.error('[telegram] Agent error for message', msg.id, ':', err);
      await sendMessage(
        chatIdNum,
        'Sorry, something went wrong. Please try again.',
      ).catch(() => {});
    }
  }
}

export function startPoller(
  sendMessage: (chatId: number, text: string) => Promise<void>,
  setTyping: (chatId: number) => Promise<void>,
): () => void {
  let running = true;

  async function loop(): Promise<void> {
    while (running) {
      try {
        await pollOnce(sendMessage, setTyping);
      } catch (err) {
        console.error('[telegram] Poller error:', err);
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS),
      );
    }
  }

  loop().catch(console.error);
  console.log('[telegram] Poller started (2s interval)');

  return () => {
    running = false;
  };
}
```

### 6c. `server/telegram/index.ts`

```typescript
import { db, telegramChats, telegramMessages } from '../db';
import type { InboundTelegramMessage } from './connection';
import { TelegramConnection } from './connection';
import { startPoller } from './poller';

/**
 * Start the Telegram integration:
 *   1. Connect bot using TELEGRAM_BOT_TOKEN
 *   2. Store every inbound message to Postgres
 *   3. Start the 2-second poller that triggers the corsair agent
 *
 * Returns an async shutdown function.
 */
export async function startTelegram(): Promise<() => Promise<void>> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error(
      '[telegram] TELEGRAM_BOT_TOKEN is not set. Add it to .env and restart.',
    );
    return async () => {};
  }

  const connection = new TelegramConnection(token, handleInbound);

  async function handleInbound(msg: InboundTelegramMessage): Promise<void> {
    const chatId = String(msg.chatId);

    // Upsert chat record
    await db
      .insert(telegramChats)
      .values({
        chatId,
        name: msg.senderName,
        type: msg.isGroup ? 'group' : 'dm',
      })
      .onConflictDoNothing();

    // Store for poller
    await db.insert(telegramMessages).values({
      chatId,
      senderId: String(msg.senderId),
      senderName: msg.senderName,
      content: msg.content,
      sentAt: msg.sentAt,
      isGroup: msg.isGroup,
      processed: false,
    });

    console.log(
      `[telegram] Stored message from ${msg.senderName ?? msg.senderId} in chat ${chatId}`,
    );
  }

  await connection.start();

  const stopPoller = startPoller(
    (chatId, text) => connection.sendMessage(chatId, text),
    (chatId) => connection.setTyping(chatId),
  );

  return async () => {
    console.log('[telegram] Shutting down...');
    stopPoller();
    await connection.stop();
  };
}
```

---

## 7. Update `server/db/index.ts` (re-export new tables)

Open `server/db/index.ts`. Add `telegramMessages` and `telegramChats` to the exports from `./schema`. If the file uses `export * from './schema'`, no change is needed — they'll be exported automatically. If it has named exports, add the two new table names.

---

## 8. Wire Telegram into `server/index.ts`

Open `server/index.ts` and make three changes:

### 8a. Add import at the top

```typescript
import { startTelegram } from './telegram/index';
```

Also add `telegramMessages` to the destructured import from `'./db'`:

```typescript
import {
  db,
  permissions,
  telegramMessages,
  threadMessages,
  threads,
  whatsappMessages,
  workflows,
} from './db';
```

### 8b. Handle permission resume for Telegram threads

Find the block starting at `if (thread?.source === 'whatsapp' && thread.jid)` in the permission resolve handler. Extend it to also handle Telegram:

```typescript
if (
  (thread?.source === 'whatsapp' || thread?.source === 'telegram') &&
  thread.jid
) {
  if (thread.source === 'whatsapp') {
    // Insert a synthetic WhatsApp message so the poller picks it up
    await db.insert(whatsappMessages).values({
      jid: thread.jid,
      senderJid: 'system',
      senderName: 'Permission System',
      content: answer,
      sentAt: new Date(),
      isGroup: false,
      isBot: false,
      processed: false,
    });
  } else {
    // Insert a synthetic Telegram message so the poller picks it up
    const chatId = thread.jid.replace(/^tg:/, '');
    await db.insert(telegramMessages).values({
      chatId,
      senderId: 'system',
      senderName: 'Permission System',
      content: answer,
      sentAt: new Date(),
      isGroup: false,
      processed: false,
    });
  }
} else {
  // Web thread: resume agent and save result to the thread
  // ... existing web resume code ...
}
```

### 8c. Start Telegram after the server listens

Find the WhatsApp startup block at the bottom of `main()`:

```typescript
if (process.env.WHATSAPP_ENABLED === 'true') {
  console.log('[server] Starting WhatsApp listener...');
  startWhatsApp().catch((err) => {
    console.error('[server] WhatsApp startup failed:', err);
  });
}
```

Add immediately after it:

```typescript
if (process.env.TELEGRAM_ENABLED === 'true') {
  console.log('[server] Starting Telegram listener...');
  startTelegram().catch((err) => {
    console.error('[server] Telegram startup failed:', err);
  });
}
```

---

## 9. Push database migrations

The new tables need to exist in Postgres. Migrations run automatically on container restart, but trigger one now:

```bash
docker compose up -d agent
```

Follow the logs to confirm the migration ran:

```bash
docker compose logs agent | grep -E 'db:push|telegram|error' | head -20
```

---

## 10. Restart and verify

```bash
docker compose up -d agent
docker compose logs -f agent
```

Check for:
- `[telegram] Bot started (long polling)` — bot connected
- `[telegram] Poller started (2s interval)` — ready to receive messages

If you see `TELEGRAM_BOT_TOKEN is not set`, the env var didn't make it into the container. Run:

```bash
docker compose up -d agent   # (not restart — restart preserves old env)
```

---

## 11. Test the connection

Tell the user:

> 1. Open Telegram and search for your bot's username (e.g. `@my_assistant_bot`)
> 2. Tap **Start** or send any message
> 3. The agent should reply within a few seconds
>
> For groups: add the bot to a group, then send `@corsair <your message>` (using your `BOT_NAME`).
>
> To find your chat ID, send `/chatid` to the bot.

---

## 12. Groups: disable privacy mode (optional)

If the user wants the bot to see all group messages without being @mentioned, tell them:

> By default Telegram bots only see @mentions and commands in groups. To let the bot see all messages:
>
> 1. Open **@BotFather** → `/mybots` → select your bot
> 2. **Bot Settings** → **Group Privacy** → **Turn off**
> 3. Remove and re-add the bot to any existing groups (required for the change to take effect)

---

## How it works

```
Telegram message received
  → grammy long-polling receives it
  → Stored in postgres (telegram_messages, processed=false)
  → Poller queries every 2s
  → DMs: always trigger agent
  → Groups: only if @corsair (BOT_NAME) is in the message
  → runAgent() called → uses Corsair plugins to complete the task
  → Response sent back via Telegram
```

---

## Troubleshooting

**Bot not responding to messages:**
- Check `TELEGRAM_ENABLED=true` in `.env`
- Check `TELEGRAM_BOT_TOKEN` is set and correct
- Check `[telegram] Poller started` in logs: `docker compose logs agent | grep telegram`
- For groups: message must include `@corsair` (or `BOT_NAME`)

**`TELEGRAM_BOT_TOKEN is not set` error:**
- Run `docker compose up -d agent` (not `docker compose restart`) to pick up new `.env` values

**`grammy` not found / module resolution error:**
- grammy is pre-installed in the image. If you're seeing this, the named volume may contain a stale `node_modules` from before grammy was added. Clear it and rebuild:
  ```bash
  docker compose down && docker volume rm corsair-2_agent_node_modules && docker compose up --build -d
  ```
  (Adjust the volume name prefix if your project directory has a different name — check with `docker volume ls`.)

**`ERR_PNPM_UNEXPECTED_STORE` or similar pnpm errors:**
- Never run `pnpm add` inside a running container — the pnpm store paths conflict. Always edit `package.json` and do the volume-rm + rebuild sequence above.

**Verify bot token:**
```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getMe"
```

**Re-authenticate (new bot):** Just update `TELEGRAM_BOT_TOKEN` in `.env` and restart.
