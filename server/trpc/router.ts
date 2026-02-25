import { initTRPC } from '@trpc/server';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import z from 'zod';
import type { SimpleMessage } from '../agent';
import { createAgentStream } from '../agent';
import { db, permissions, threadMessages, threads } from '../db';

// ─────────────────────────────────────────────────────────────────────────────
// tRPC initialization
// ─────────────────────────────────────────────────────────────────────────────

const t = initTRPC.context<object>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

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

			// 3. Fetch recent messages to detect pending state and build history
			const allRecent = await db
				.select()
				.from(threadMessages)
				.where(eq(threadMessages.threadId, threadId))
				.orderBy(desc(threadMessages.createdAt))
				.limit(20);

			const pendingAssistant = allRecent.find(
				(m) => m.role === 'assistant' && m.pendingToolName === 'ask_human',
			);

			// Clear pending state if present
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
			const historyRows = allRecent.slice(0, -1).reverse();
			const history: SimpleMessage[] = historyRows.map((m) => ({
				role: m.role as 'user' | 'assistant',
				text: m.text || '',
			}));

			// 4. Stream the agent
			const collectedToolCalls: Array<{
				toolCallId: string;
				toolName: string;
				done: boolean;
			}> = [];
			let collectedText = '';

			for await (const chunk of createAgentStream(input.message, {
				sessionId: threadId,
				history,
			})) {
				if (chunk.type === 'text-delta') {
					collectedText += chunk.delta;
					yield { type: 'text-delta' as const, delta: chunk.delta };
				} else if (chunk.type === 'tool-call') {
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
					yield {
						type: 'tool-result' as const,
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
					};
				} else if (chunk.type === 'needs-input') {
					// Emit the ask_human question as visible text if no text was streamed
					if (!collectedText) {
						collectedText = chunk.question;
						yield { type: 'text-delta' as const, delta: chunk.question };
					}

					// Look up any recently created pending permission
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
					const permissionId = recentPerm?.id ?? null;

					const [savedMsg] = await db
						.insert(threadMessages)
						.values({
							threadId,
							role: 'assistant',
							text: collectedText,
							toolCalls: collectedToolCalls,
							pendingMessages: null,
							pendingToolCallId: 'ask_human',
							pendingToolName: 'ask_human',
						})
						.returning({ id: threadMessages.id });

					if (permissionId && savedMsg) {
						await db
							.update(permissions)
							.set({ messageId: savedMsg.id })
							.where(eq(permissions.id, permissionId));
					}

					// Update thread
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

					yield {
						type: 'needs-input' as const,
						question: chunk.question,
						permissionId,
					};
				} else if (chunk.type === 'finish') {
					// Normal finish — save assistant message
					await db.insert(threadMessages).values({
						threadId,
						role: 'assistant',
						text: collectedText,
						toolCalls: collectedToolCalls,
					});

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
