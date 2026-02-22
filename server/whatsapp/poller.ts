import type { ModelMessage, ToolModelMessage } from 'ai';
import { asc, eq } from 'drizzle-orm';
import { runAgent } from '../agent';
import { db, whatsappMessages, whatsappSessions } from '../db';

const POLL_INTERVAL_MS = 2000;

/** Pattern used to trigger the agent in group chats (e.g. @corsair) */
function getBotMentionPattern(): RegExp {
	const botName = process.env.BOT_NAME || 'corsair';
	return new RegExp(`@${botName}`, 'i');
}

/**
 * Rebuild the message list needed to resume an agent session that was paused
 * by ask_human. Identical to the helper in server/index.ts but local here
 * to avoid a circular import.
 */
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
		// Skip bot's own messages (shouldn't be stored, but belt-and-suspenders)
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
		// if the server crashes mid-run. Agent errors send a reply to the user.
		await db
			.update(whatsappMessages)
			.set({ processed: true })
			.where(eq(whatsappMessages.id, msg.id));

		// Check for an existing pending session (ask_human multi-turn flow)
		const [session] = await db
			.select()
			.from(whatsappSessions)
			.where(eq(whatsappSessions.jid, msg.jid))
			.limit(1);

		let agentMessages: ModelMessage[];
		if (session) {
			// Resume: inject the user's answer as a tool result
			agentMessages = buildResumeMessages(
				session.messages as ModelMessage[],
				session.toolCallId,
				session.toolName,
				msg.content,
			);
			await db
				.delete(whatsappSessions)
				.where(eq(whatsappSessions.jid, msg.jid));
		} else {
			// Fresh conversation
			agentMessages = [{ role: 'user', content: msg.content }];
		}

		try {
			await setTyping(msg.jid, true);
			const output = await runAgent(agentMessages, { jid: msg.jid });
			await setTyping(msg.jid, false);

			if (output.type === 'needs_input') {
				// Agent asked a clarifying question — store session and send question
				await db
					.insert(whatsappSessions)
					.values({
						jid: msg.jid,
						messages: output.pendingMessages as any,
						toolCallId: output.toolCallId,
						toolName: output.toolName,
						question: output.question,
					})
					.onConflictDoUpdate({
						target: whatsappSessions.jid,
						set: {
							messages: output.pendingMessages as any,
							toolCallId: output.toolCallId,
							toolName: output.toolName,
							question: output.question,
						},
					});
				await sendMessage(msg.jid, output.question);
			} else if (output.type === 'message') {
				await sendMessage(msg.jid, output.text);
			} else if (output.type === 'script') {
				let reply: string;
				if (output.error) {
					reply = `Error: ${output.error}`;
				} else if (output.message) {
					reply = output.message;
				} else {
					reply = output.output?.trim() || 'Done.';
				}
				await sendMessage(msg.jid, reply);
			} else if (output.type === 'workflow') {
				let reply: string;
				if (output.message) {
					reply = output.message;
				} else if (output.cronSchedule) {
					reply = `Workflow scheduled: ${output.cronSchedule}`;
				} else if (output.webhookTrigger) {
					reply = `Webhook workflow registered for ${output.webhookTrigger.plugin}.${output.webhookTrigger.action}`;
				} else {
					reply = 'Workflow stored.';
				}
				await sendMessage(msg.jid, reply);
			}
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
