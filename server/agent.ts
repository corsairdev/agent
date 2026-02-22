import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import type { ModelMessage } from 'ai';
import { generateText, stepCountIs, streamText, tool, zodSchema } from 'ai';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, whatsappMessages } from './db';
import {
	archiveWorkflow,
	executeScript,
	listWorkflows,
	storeWorkflow,
	updateWorkflowRecord,
} from './executor';
import { searchCodeExamples } from './search';
import { typecheck } from './typecheck';

function getModel() {
	if (process.env.ANTHROPIC_API_KEY) return anthropic('claude-sonnet-4-5');
	return openai('gpt-4.1');
}

// ─────────────────────────────────────────────────────────────────────────────
// Result schemas
// ─────────────────────────────────────────────────────────────────────────────

export const AgentResultSchema = z.object({
	type: z.enum(['script', 'workflow']),
	workflowId: z.string().optional(),
	code: z.string(),
	description: z.string().optional(),
	cronSchedule: z.string().optional(),
	webhookTrigger: z
		.object({ plugin: z.string(), action: z.string() })
		.optional(),
	output: z.string().optional(),
	error: z.string().optional(),
	message: z.string().optional(),
});

export type AgentResult = z.infer<typeof AgentResultSchema>;

export type AgentOutput =
	| AgentResult
	| {
			type: 'needs_input';
			question: string;
			pendingMessages: ModelMessage[];
			toolCallId: string;
			toolName: string;
	  }
	| {
			type: 'message';
			text: string;
	  };

// ─────────────────────────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `

You are a personal automation assistant that helps users build automations with Corsair: one-off scripts, scheduled (cron) workflows, and webhook-triggered workflows. The \`corsair\` client is available as a global — do NOT import it.

## Tools

- **ask_human**: Pause and wait for a reply. REQUIRED when you need user input — never ask in plain text.
- **search_code_examples**: Find Corsair API patterns. Call before writing code.
- **write_and_execute_code**: Write TypeScript, typecheck, and run (scripts) or validate (workflows).
- **manage_workflows**: List, create, update, or archive workflows. After successfully writing a workflow with \`write_and_execute_code\`, call \`manage_workflows\` with \`action: "create"\` and the same workflowId, code, description, cronSchedule/webhookTrigger to store it so it runs on future triggers.
- **get_conversation_history** *(WhatsApp only)*: Fetch past messages from the current chat. Call this when you need more context about a previous request, an earlier decision, or anything the user may have mentioned before. Pick a \`limit\` that is just enough — start small (e.g. 5) and call again with a larger number if still unclear.

## Execution model

- Batch independent actions in one script. Use a REPL pattern (fetch → read → act) when steps depend on each other.
- Don't guess IDs or names — fetch first, then act.
- Use \`console.log\` to surface data you need for later steps.

## When to ask vs assume

Ask when the target is unspecified and critical (which channel, recipient). Assume when the value is singular or inferable. Don't ask when the user already specified it or you can resolve it in code.

## Handling failures

When code fails, **do not send the failing code or raw error to the user**. Instead:
1. Read the first few lines of the code to understand what it was trying to do.
2. Analyse the error and any output snippet to understand what went wrong.
3. Fix the issue and retry.

If the failure is a missing resource (channel, user, project, etc.): fetch the full list of available resources and look for a close match — the user may have used slightly different casing, spacing, or omitted punctuation. If you find a clear match, retry with the correct identifier.

Only ask the user (via \`ask_human\`) or report failure after you have investigated and cannot resolve it yourself. Don't make broad assumptions — if in doubt or no clear match exists, ask.

Always use \`ask_human\` — never ask in plain text. Include fetched options so the user can pick.

## Code shape

**Scripts:** Self-invoking \`main()\`. Call \`corsair.<plugin>.api.<resource>.<method>(...)\`. Wrap the body in try-catch so errors are logged as output rather than unhandled throws.

**Workflows:** \`export async function <name>() { ... }\`.
- Cron: pass \`cronSchedule\` (e.g. \`0 9 * * *\`).
- Webhook: pass \`webhookTrigger: { plugin, action }\`. Payload is in global \`__event\` (do not import; cast as needed). Examples: linear \`issues.create\`, slack \`messages.message\`, github \`starCreated\`.

Code examples from search are for patterns — don't reuse example IDs or names.

## LLM in scripts

Use the \`ai\` package (\`generateText\`) with \`process.env.ANTHROPIC_API_KEY\` → anthropic, else openai.

## Always reply to the user

After completing any task — running a script, creating a workflow, answering a question — always send a short, friendly message back. Confirm what happened, share a key detail or result if relevant, and keep it to 1–3 sentences. Never finish silently.`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const OUTPUT_SNIPPET_LINES = 30;

/** Trims, splits, returns first N non-empty lines. */
export function snippetOutput(full: string): string {
	const lines = full
		.trim()
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	return lines.slice(0, OUTPUT_SNIPPET_LINES).join('\n');
}

function getWorkflowFunctionName(code: string): string | null {
	const match = code.match(/export\s+async\s+function\s+(\w+)\s*\(/);
	return match ? match[1]! : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────────────────────

const agentTools = {
	search_code_examples: tool({
		description: 'Search Corsair API code examples by query.',
		inputSchema: zodSchema(z.object({ query: z.string() })),
		execute: async ({ query }) => {
			const examples = await searchCodeExamples(query, 5);
			return {
				examples: examples.map((ex) => ({
					description: ex.description,
					code: ex.code,
					similarity: ex.similarity,
				})),
			};
		},
	}),

	write_and_execute_code: tool({
		description:
			'Write TypeScript, typecheck, and run (scripts) or validate (workflows). Returns errors for retry.',
		inputSchema: zodSchema(
			z.object({
				type: z.enum(['script', 'workflow']),
				code: z.string(),
				description: z.string().optional(),
				cronSchedule: z.string().optional(),
				webhookTrigger: z
					.object({ plugin: z.string(), action: z.string() })
					.optional(),
			}),
		),
		execute: async ({
			type,
			code,
			description,
			cronSchedule,
			webhookTrigger,
		}) => {
			const { valid, errors } = await typecheck(code);
			if (!valid) {
				return {
					success: false,
					error: 'TypeScript compilation failed',
					errors,
				};
			}

			try {
				if (type === 'script') {
					const result = await executeScript(code);
					if (result.success) {
						return {
							success: true,
							type: 'script',
							code,
							output: result.output ? snippetOutput(result.output) : undefined,
							description: description?.trim() || undefined,
						};
					}
					return {
						success: false,
						error: 'Script execution failed',
						errors: result.error,
						...(result.output && {
							outputSnippet: snippetOutput(result.output),
						}),
					};
				}

				const workflowId = getWorkflowFunctionName(code);
				if (!workflowId) {
					return {
						success: false,
						error:
							'Workflow must export one async function, e.g. "export async function myWorkflow() { ... }"',
					};
				}

				return {
					success: true,
					type: 'workflow',
					code,
					workflowId,
					description: description?.trim() || undefined,
					cronSchedule: cronSchedule?.trim() || undefined,
					webhookTrigger,
				};
			} catch (error) {
				return {
					success: false,
					error: 'Execution failed',
					errors: error instanceof Error ? error.message : String(error),
				};
			}
		},
	}),

	manage_workflows: tool({
		description:
			'List (optional triggerType filter), create (store a new workflow), update (workflowId + fields), or archive (workflowId) workflows.',
		inputSchema: zodSchema(
			z.object({
				action: z.enum(['list', 'create', 'update', 'delete']),
				triggerType: z.enum(['cron', 'webhook', 'manual', 'all']).optional(),
				workflowId: z.string().optional(),
				code: z.string().optional(),
				description: z.string().optional(),
				cronSchedule: z.string().optional(),
				webhookTrigger: z
					.object({ plugin: z.string(), action: z.string() })
					.optional(),
				status: z.enum(['active', 'paused', 'archived']).optional(),
			}),
		),
		execute: async ({
			action,
			triggerType,
			workflowId,
			code,
			description,
			cronSchedule,
			webhookTrigger,
			status,
		}) => {
			if (action === 'list') {
				return { workflows: await listWorkflows(triggerType) };
			}

			if (action === 'create') {
				if (!workflowId || !code) {
					return {
						success: false,
						error: 'workflowId and code are required for create',
					};
				}
				const stored = await storeWorkflow({
					type: 'workflow',
					workflowId,
					code,
					description: description?.trim() || undefined,
					cronSchedule: cronSchedule?.trim() || undefined,
					webhookTrigger,
				});
				return {
					success: true,
					workflow: {
						id: stored.id,
						name: stored.name,
						triggerType: stored.triggerType,
						status: stored.status,
					},
				};
			}

			if (!workflowId) {
				return {
					success: false,
					error: `workflowId is required for ${action}`,
				};
			}

			if (action === 'delete') {
				const archived = await archiveWorkflow(workflowId);
				if (!archived)
					return {
						success: false,
						error: `Workflow "${workflowId}" not found`,
					};
				return {
					success: true,
					message: `Workflow "${archived.name}" archived`,
				};
			}

			if (code) {
				const { valid, errors } = await typecheck(code);
				if (!valid) {
					return {
						success: false,
						error: 'TypeScript compilation failed',
						errors,
					};
				}
			}

			const updated = await updateWorkflowRecord(workflowId, {
				code,
				description,
				cronSchedule,
				webhookTrigger,
				status,
			});
			if (!updated) {
				return {
					success: false,
					error: `Workflow "${workflowId}" not found`,
				};
			}

			return {
				success: true,
				workflow: {
					id: updated.id,
					name: updated.name,
					triggerType: updated.triggerType,
					status: updated.status,
				},
			};
		},
	}),

	ask_human: tool({
		description:
			'Ask the user one clarifying question. Pauses the session until the user replies. Include any fetched options.',
		inputSchema: zodSchema(z.object({ question: z.string() })),
	}),
};

/** Exported for unit tests. */
export const writeAndExecuteCodeTool = agentTools.write_and_execute_code;

/**
 * Returns the get_conversation_history tool.
 * The jid is captured in a closure; when undefined (non-WhatsApp contexts) the
 * tool returns an informative error so the agent can handle it gracefully.
 */
function makeHistoryTool(jid: string | undefined) {
	return tool({
		description:
			'Fetch past messages from the current WhatsApp chat. Use when you need more context about what the user said earlier. Start with a small limit and call again with a larger one if needed.',
		inputSchema: zodSchema(
			z.object({
				limit: z
					.number()
					.int()
					.min(1)
					.max(20)
					.describe('How many recent messages to retrieve (newest first).'),
			}),
		),
		execute: async ({ limit }) => {
			if (!jid) {
				return {
					error: 'Conversation history is only available in WhatsApp chats.',
				};
			}

			const rows = await db
				.select({
					senderName: whatsappMessages.senderName,
					senderJid: whatsappMessages.senderJid,
					content: whatsappMessages.content,
					sentAt: whatsappMessages.sentAt,
					isBot: whatsappMessages.isBot,
				})
				.from(whatsappMessages)
				.where(eq(whatsappMessages.jid, jid))
				.orderBy(desc(whatsappMessages.sentAt))
				.limit(limit);

			// Return oldest-first so the agent reads chronologically
			return {
				messages: rows.reverse().map((r) => ({
					sender: r.isBot ? 'bot' : (r.senderName ?? r.senderJid),
					content: r.content,
					sentAt: r.sentAt,
				})),
			};
		},
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming entry point (chat UI)
// ─────────────────────────────────────────────────────────────────────────────

export function createAgentStream(messages: ModelMessage[]) {
	const model = getModel();

	const webSearchTool = process.env.ANTHROPIC_API_KEY
		? anthropic.tools.webSearch_20250305({})
		: openai.tools.webSearchPreview({});

	return streamText({
		model,
		system: SYSTEM_PROMPT,
		messages,
		tools: {
			...agentTools,
			web_search: webSearchTool,
		},
		stopWhen: stepCountIs(10),
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Main agent
// ─────────────────────────────────────────────────────────────────────────────

export async function runAgent(
	messages: ModelMessage[],
	context?: { jid?: string },
): Promise<AgentOutput> {
	const model = getModel();

	const webSearchTool = process.env.ANTHROPIC_API_KEY
		? anthropic.tools.webSearch_20250305({})
		: openai.tools.webSearchPreview({});

	const result = await generateText({
		model,
		system: SYSTEM_PROMPT,
		messages,
		tools: {
			...agentTools,
			web_search: webSearchTool,
			get_conversation_history: makeHistoryTool(context?.jid),
		},
		stopWhen: stepCountIs(10),
	});

	// ask_human has no execute fn — the SDK stops with finishReason 'tool-calls'
	if (result.finishReason === 'tool-calls') {
		const askCall = result.staticToolCalls.find(
			(tc) => tc.toolName === 'ask_human',
		);
		if (askCall) {
			return {
				type: 'needs_input',
				question: askCall.input.question,
				pendingMessages: [...messages, ...result.response.messages],
				toolCallId: askCall.toolCallId,
				toolName: askCall.toolName,
			};
		}
	}

	// Find the last successful code execution across all steps (agent may retry)
	const allToolResults = result.steps.flatMap((s) => s.staticToolResults);
	const agentMessage = result.text || undefined;

	for (let i = allToolResults.length - 1; i >= 0; i--) {
		const r = allToolResults[i]!;
		if (r.toolName !== 'write_and_execute_code') continue;
		if (!r.output.success) continue;

		if (r.output.type === 'script') {
			return {
				type: 'script',
				code: r.output.code,
				description: r.output.description,
				output: r.output.output,
				message: agentMessage,
			};
		}

		return {
			type: 'workflow',
			workflowId: r.output.workflowId,
			code: r.output.code || '',
			description: r.output.description,
			cronSchedule: r.output.cronSchedule,
			webhookTrigger: r.output.webhookTrigger,
			message: agentMessage,
		};
	}

	if (result.finishReason === 'stop' && result.text) {
		return { type: 'message', text: result.text };
	}

	throw new Error(
		`Agent did not produce a result. Finish reason: ${result.finishReason}`,
	);
}
