import { initTRPC } from '@trpc/server';
import type { UIMessage } from 'ai';
import { convertToModelMessages } from 'ai';
import z from 'zod';
import { createAgentStream } from '../agent';

// ─────────────────────────────────────────────────────────────────────────────
// tRPC initialization
// ─────────────────────────────────────────────────────────────────────────────

const t = initTRPC.context<{}>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// ─────────────────────────────────────────────────────────────────────────────
// Router definition
// ─────────────────────────────────────────────────────────────────────────────

export const appRouter = router({
	// ── Streaming chat ────────────────────────────────────────────────────────
	chat: publicProcedure
		.input(z.object({ messages: z.array(z.any()) }))
		.subscription(async function* ({ input }) {
			const modelMessages = await convertToModelMessages(
				input.messages as Omit<UIMessage, 'id'>[],
			);
			const result = createAgentStream(modelMessages);

			for await (const chunk of result.fullStream) {
				if (chunk.type === 'text-delta') {
					yield { type: 'text-delta' as const, delta: chunk.text };
				} else if (chunk.type === 'tool-call') {
					yield {
						type: 'tool-call' as const,
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
					};
				} else if (chunk.type === 'tool-result') {
					yield {
						type: 'tool-result' as const,
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
					};
				} else if (chunk.type === 'finish') {
					yield { type: 'finish' as const };
				}
			}
		}),
});

export type AppRouter = typeof appRouter;
