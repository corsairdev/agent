import { asc, desc, eq } from 'drizzle-orm';
import type { SimpleMessage } from '../agent';
import { runAgent } from '../agent';
import { db, threadMessages, threads, whatsappMessages } from '../db';

const POLL_INTERVAL_MS = 2000;

/** Pattern used to trigger the agent in group chats (e.g. @corsair) */
function getBotMentionPattern(): RegExp {
	const botName = process.env.BOT_NAME || 'corsair';
	return new RegExp(`@${botName}`, 'i');
}

/** Find or create a thread for a given WhatsApp JID. */
async function getOrCreateThread(jid: string): Promise<string> {
	const [existing] = await db
		.select({ id: threads.id })
		.from(threads)
		.where(eq(threads.jid, jid))
		.limit(1);

	if (existing) return existing.id;

	const [created] = await db
		.insert(threads)
		.values({ source: 'whatsapp', jid })
		.returning({ id: threads.id });

	return created!.id;
}

async function pollOnce(
	sendMessage: (jid: string, text: string) => Promise<void>,
	setTyping: (jid: string, isTyping: boolean) => Promise<void>,
): Promise<void> {
	const unprocessed = await db
		.select()
		.from(whatsappMessages)
		.where(eq(whatsappMessages.processed, false))
		.orderBy(asc(whatsappMessages.createdAt));

	for (const msg of unprocessed) {
		// Skip bot's own messages
		if (msg.isBot) {
			await db
				.update(whatsappMessages)
				.set({ processed: true })
				.where(eq(whatsappMessages.id, msg.id));
			continue;
		}

		// Groups: only trigger when @corsair (or BOT_NAME) is mentioned
		if (msg.isGroup) {
			const mentionPattern = getBotMentionPattern();
			if (!mentionPattern.test(msg.content)) {
				await db
					.update(whatsappMessages)
					.set({ processed: true })
					.where(eq(whatsappMessages.id, msg.id));
				continue;
			}
		}

		// Mark processed before calling the agent — prevents duplicate processing
		await db
			.update(whatsappMessages)
			.set({ processed: true })
			.where(eq(whatsappMessages.id, msg.id));

		// Get or create the thread for this JID
		const threadId = await getOrCreateThread(msg.jid);

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
			await setTyping(msg.jid, true);
			const output = await runAgent(msg.content, {
				sessionId: threadId,
				history,
				jid: msg.jid,
				onMessage: (text) => sendMessage(msg.jid, text),
			});
			await setTyping(msg.jid, false);

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
				await sendMessage(msg.jid, replyText);
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
				if (replyText) await sendMessage(msg.jid, replyText);
			}

			// Update thread timestamp
			await db
				.update(threads)
				.set({ updatedAt: new Date() })
				.where(eq(threads.id, threadId));
		} catch (err) {
			await setTyping(msg.jid, false).catch(() => {});
			console.error('[whatsapp] Agent error for message', msg.id, ':', err);
			await sendMessage(
				msg.jid,
				'Sorry, something went wrong. Please try again.',
			).catch(() => {});
		}
	}
}

/**
 * Start the 2-second poll loop.
 * Returns a stop function to gracefully shut down.
 */
export function startPoller(
	sendMessage: (jid: string, text: string) => Promise<void>,
	setTyping: (jid: string, isTyping: boolean) => Promise<void>,
): () => void {
	let running = true;

	async function loop(): Promise<void> {
		while (running) {
			try {
				await pollOnce(sendMessage, setTyping);
			} catch (err) {
				console.error('[whatsapp] Poller error:', err);
			}
			await new Promise<void>((resolve) =>
				setTimeout(resolve, POLL_INTERVAL_MS),
			);
		}
	}

	loop().catch(console.error);
	console.log('[whatsapp] Poller started (2s interval)');

	return () => {
		running = false;
	};
}
