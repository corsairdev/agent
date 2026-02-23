import type { ModelMessage, ToolModelMessage } from 'ai';
import { asc, desc, eq } from 'drizzle-orm';
import { runAgent } from '../agent';
import { db, threadMessages, threads, whatsappMessages } from '../db';

const POLL_INTERVAL_MS = 2000;

/** Pattern used to trigger the agent in group chats (e.g. @corsair) */
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

		// Check if the last assistant message has a pending (ask_human) state
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
			// Resume the paused conversation with the user's answer
			agentMessages = buildResumeMessages(
				pendingAssistant.pendingMessages as ModelMessage[],
				pendingAssistant.pendingToolCallId,
				pendingAssistant.pendingToolName,
				msg.content,
			);
			// Clear pending state
			await db
				.update(threadMessages)
				.set({
					pendingMessages: null,
					pendingToolCallId: null,
					pendingToolName: null,
				})
				.where(eq(threadMessages.id, pendingAssistant.id));
		} else {
			// Build context from the last 5 messages in the thread (oldest-first)
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
			await setTyping(msg.jid, true);
			const output = await runAgent(agentMessages, { jid: msg.jid });
			await setTyping(msg.jid, false);

			let replyText = '';

			if (output.type === 'needs_input') {
				replyText = output.question;

				// Save the assistant message with pending resume state
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

				// Link the permission to this thread if there was a request_permission call
				if (output.permissionId) {
					// Update permission to reference the thread's JID for WhatsApp resume
					// (handled in index.ts permission resolve via thread.source === 'whatsapp')
				}
			} else if (output.type === 'message') {
				replyText = output.text;
				await db.insert(threadMessages).values({
					threadId,
					role: 'assistant',
					text: replyText,
				});
			} else if (output.type === 'script') {
				if (output.error) {
					replyText = `Error: ${output.error}`;
				} else if (output.message) {
					replyText = output.message;
				} else {
					replyText = output.output?.trim() || 'Done.';
				}
				await db.insert(threadMessages).values({
					threadId,
					role: 'assistant',
					text: replyText,
				});
			} else if (output.type === 'workflow') {
				if (output.message) {
					replyText = output.message;
				} else if (output.cronSchedule) {
					replyText = `Workflow scheduled: ${output.cronSchedule}`;
				} else if (output.webhookTrigger) {
					replyText = `Webhook workflow registered for ${output.webhookTrigger.plugin}.${output.webhookTrigger.action}`;
				} else {
					replyText = 'Workflow stored.';
				}
				await db.insert(threadMessages).values({
					threadId,
					role: 'assistant',
					text: replyText,
				});
			}

			if (replyText) {
				await sendMessage(msg.jid, replyText);
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
