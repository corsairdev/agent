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
        .orderBy(desc(threadMessages.createdAt))
        .limit(10);

      agentMessages = history.reverse().map((m) => ({
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

