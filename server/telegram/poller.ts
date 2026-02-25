import { asc, desc, eq } from 'drizzle-orm';
import type { SimpleMessage } from '../agent';
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

		// Save the incoming user message to the thread
		await db.insert(threadMessages).values({
			threadId,
			role: 'user',
			text: msg.content,
		});

		// Fetch last 10 messages for history (includes the just-saved user message)
		const recent = await db
			.select()
			.from(threadMessages)
			.where(eq(threadMessages.threadId, threadId))
			.orderBy(desc(threadMessages.createdAt))
			.limit(10);

		// Check if there's a pending ask_human state and clear it
		const pendingAssistant = recent.find(
			(m) => m.role === 'assistant' && m.pendingToolName === 'ask_human',
		);

		if (pendingAssistant) {
			await db
				.update(threadMessages)
				.set({
					pendingMessages: null,
					pendingToolCallId: null,
					pendingToolName: null,
				})
				.where(eq(threadMessages.id, pendingAssistant.id));
		}

		// Build history oldest-first, excluding the current user message (it's the prompt)
		const historyRows = recent.slice(0, -1).reverse();
		const history: SimpleMessage[] = historyRows.map((m) => ({
			role: m.role as 'user' | 'assistant',
			text: m.text || '',
		}));

		try {
			await setTyping(chatIdNum);
			const output = await runAgent(msg.content, {
				sessionId: threadId,
				history,
				jid,
				onMessage: (text) => sendMessage(chatIdNum, text),
			});

			if (output.type === 'needs_input') {
				const replyText = output.question;
				await db.insert(threadMessages).values({
					threadId,
					role: 'assistant',
					text: replyText,
					pendingMessages: null,
					pendingToolCallId: 'ask_human',
					pendingToolName: 'ask_human',
				});
				await sendMessage(chatIdNum, replyText);
			} else if (output.type === 'done') {
				// Messages were already sent inline; save the last one to DB for history
				const lastMsg = output.messages.at(-1) ?? '';
				if (lastMsg) {
					await db.insert(threadMessages).values({
						threadId,
						role: 'assistant',
						text: lastMsg,
					});
				}
			} else {
				const replyText = output.text;
				await db.insert(threadMessages).values({
					threadId,
					role: 'assistant',
					text: replyText,
				});
				if (replyText) await sendMessage(chatIdNum, replyText);
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
