import { db, telegramChats, telegramMessages } from '../db';
import { registerTelegramSender } from '../notifier';
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

  registerTelegramSender((chatId, text) => connection.sendMessage(chatId, text));

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
