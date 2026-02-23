import { initTRPC } from '@trpc/server';
import type { ModelMessage, ToolModelMessage } from 'ai';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import z from 'zod';
import { createAgentStream } from '../agent';
import { db, permissions, threadMessages, threads } from '../db';

// ─────────────────────────────────────────────────────────────────────────────
// tRPC initialization
// ─────────────────────────────────────────────────────────────────────────────

const t = initTRPC.context<object>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Router definition
// ─────────────────────────────────────────────────────────────────────────────

export const appRouter = router({
	// ── Thread management ────────────────────────────────────────────────────
	threads: router({
		list: publicProcedure.query(async () => {
			return db
				.select({
					id: threads.id,
					title: threads.title,
					source: threads.source,
					createdAt: threads.createdAt,
					updatedAt: threads.updatedAt,
				})
				.from(threads)
				.where(eq(threads.source, 'web'))
				.orderBy(desc(threads.updatedAt));
		}),

		messages: publicProcedure
			.input(z.object({ threadId: z.string() }))
			.query(async ({ input }) => {
				return db
					.select({
						id: threadMessages.id,
						role: threadMessages.role,
						text: threadMessages.text,
						toolCalls: threadMessages.toolCalls,
						hasPending: threadMessages.pendingToolCallId,
						createdAt: threadMessages.createdAt,
					})
					.from(threadMessages)
					.where(eq(threadMessages.threadId, input.threadId))
					.orderBy(asc(threadMessages.createdAt));
			}),

		create: publicProcedure.mutation(async () => {
			const [thread] = await db
				.insert(threads)
				.values({ source: 'web' })
				.returning({ id: threads.id });
			return { threadId: thread!.id };
		}),
	}),

	// ── Streaming chat ────────────────────────────────────────────────────────
	chat: publicProcedure
		.input(
			z.object({
				threadId: z.string().optional(),
				message: z.string(),
			}),
		)
		.subscription(async function* ({ input }) {
			// 1. Find or create thread
			let threadId = input.threadId;
			if (!threadId) {
				const [thread] = await db
					.insert(threads)
					.values({ source: 'web' })
					.returning({ id: threads.id });
				threadId = thread!.id;
			}

			yield { type: 'thread-id' as const, threadId };

			// 2. Save user message
			await db.insert(threadMessages).values({
				threadId,
				role: 'user',
				text: input.message,
			});

			// 3. Find the most recent assistant message with pending (ask_human) state
			const allRecent = await db
				.select()
				.from(threadMessages)
				.where(eq(threadMessages.threadId, threadId))
				.orderBy(desc(threadMessages.createdAt))
				.limit(10);

			const pendingAssistant = allRecent.find(
				(m) => m.role === 'assistant' && m.pendingToolCallId,
			);

			let modelMessages: ModelMessage[];

			if (
				pendingAssistant?.pendingMessages &&
				pendingAssistant.pendingToolCallId &&
				pendingAssistant.pendingToolName
			) {
				// Resume from the paused ask_human state
				modelMessages = buildResumeMessages(
					pendingAssistant.pendingMessages as ModelMessage[],
					pendingAssistant.pendingToolCallId,
					pendingAssistant.pendingToolName,
					input.message,
				);
				// Clear pending state so it's not resumed again
				await db
					.update(threadMessages)
					.set({
						pendingMessages: null,
						pendingToolCallId: null,
						pendingToolName: null,
					})
					.where(eq(threadMessages.id, pendingAssistant.id));
			} else {
				// Build context from thread history (last 20 messages, oldest-first)
				const history = await db
					.select()
					.from(threadMessages)
					.where(eq(threadMessages.threadId, threadId))
					.orderBy(asc(threadMessages.createdAt))
					.limit(20);

				modelMessages = history.map((m) => ({
					role: m.role as 'user' | 'assistant',
					content: m.text || '',
				}));
			}

			// 4. Stream the agent
			const streamResult = createAgentStream(modelMessages);

			const collectedToolCalls: Array<{
				toolCallId: string;
				toolName: string;
				done: boolean;
			}> = [];
			let collectedText = '';
			let askHumanCall: {
				question: string;
				toolCallId: string;
				toolName: string;
			} | null = null;
			let capturedPermissionId: string | null = null;

			for await (const chunk of streamResult.fullStream) {
				if (chunk.type === 'text-delta') {
					collectedText += chunk.text;
					yield { type: 'text-delta' as const, delta: chunk.text };
				} else if (chunk.type === 'tool-call') {
					if (chunk.toolName === 'ask_human') {
						askHumanCall = {
							question: (chunk.input as { question: string }).question,
							toolCallId: chunk.toolCallId,
							toolName: chunk.toolName,
						};
					}
					collectedToolCalls.push({
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						done: false,
					});
					yield {
						type: 'tool-call' as const,
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
					};
				} else if (chunk.type === 'tool-result') {
					const idx = collectedToolCalls.findIndex(
						(t) => t.toolCallId === chunk.toolCallId,
					);
					if (idx >= 0) collectedToolCalls[idx]!.done = true;

					if (chunk.toolName === 'request_permission') {
						const result = (
							chunk as unknown as { result: { permissionId?: string } }
						).result;
						if (result?.permissionId) {
							capturedPermissionId = result.permissionId;
						}
					}

					yield {
						type: 'tool-result' as const,
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
					};
				} else if (chunk.type === 'finish') {
					if (askHumanCall) {
						// Emit the ask_human question as visible text if the model
						// didn't produce any text-delta chunks before calling the tool.
						if (!collectedText) {
							collectedText = askHumanCall.question;
							yield {
								type: 'text-delta' as const,
								delta: askHumanCall.question,
							};
						}

						const response = await streamResult.response;
						const pendingMsgs: ModelMessage[] = [
							...modelMessages,
							...response.messages,
						];

						// Use permissionId captured from the tool result; fall back to DB query
						let permissionId = capturedPermissionId;
						if (!permissionId) {
							const [recentPerm] = await db
								.select({ id: permissions.id })
								.from(permissions)
								.where(
									and(
										eq(permissions.status, 'pending'),
										isNull(permissions.messageId),
									),
								)
								.orderBy(desc(permissions.createdAt))
								.limit(1);
							permissionId = recentPerm?.id ?? null;
						}

						const [savedMsg] = await db
							.insert(threadMessages)
							.values({
								threadId,
								role: 'assistant',
								text: collectedText,
								toolCalls: collectedToolCalls,
								pendingMessages: pendingMsgs,
								pendingToolCallId: askHumanCall.toolCallId,
								pendingToolName: askHumanCall.toolName,
							})
							.returning({ id: threadMessages.id });

						if (permissionId && savedMsg) {
							await db
								.update(permissions)
								.set({ messageId: savedMsg.id })
								.where(eq(permissions.id, permissionId));
						}

						yield {
							type: 'needs-input' as const,
							question: askHumanCall.question,
							permissionId,
						};
					} else {
						// Normal finish — save assistant message
						await db.insert(threadMessages).values({
							threadId,
							role: 'assistant',
							text: collectedText,
							toolCalls: collectedToolCalls,
						});
					}

					// Update thread updatedAt and auto-title from first user message
					const [currentThread] = await db
						.select({ title: threads.title })
						.from(threads)
						.where(eq(threads.id, threadId))
						.limit(1);

					await db
						.update(threads)
						.set({
							updatedAt: new Date(),
							...(currentThread && !currentThread.title
								? { title: input.message.slice(0, 60) }
								: {}),
						})
						.where(eq(threads.id, threadId));

					yield { type: 'finish' as const };
				}
			}
		}),
});

export type AppRouter = typeof appRouter;
