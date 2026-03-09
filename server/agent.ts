import {
	createSdkMcpServer,
	query,
	tool,
} from '@anthropic-ai/claude-agent-sdk';
import { createClaudeTools } from '@corsair/mcp';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, whatsappMessages } from './db';
import {
	cronAdapter,
	permissionAdapter,
	workflowAdapter,
} from './mcp-adapters';
import { corsair } from './corsair';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SimpleMessage = { role: 'user' | 'assistant'; text: string };

export type AgentOutput =
	| {
			type: 'needs_input';
			question: string;
			permissionId?: string;
	  }
	| {
			type: 'message';
			text: string;
	  }
	| {
			type: 'done'; // messages were already sent inline via send_message
			messages: string[];
	  };

export type AgentStreamChunk =
	| { type: 'text-delta'; delta: string }
	| { type: 'tool-call'; toolCallId: string; toolName: string }
	| { type: 'tool-result'; toolCallId: string; toolName: string }
	| { type: 'finish' }
	| { type: 'needs-input'; question: string; permissionId?: string };

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-6';
const MAX_TURNS = 30;

// ─────────────────────────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `
You are a personal automation assistant that helps users write, execute, and manage code and workflows with Corsair. The \`corsair\` client is available as a global — do NOT import it.

## Tone

Be friendly and conversational. Keep every message short — 1–3 sentences max. No walls of text.

**Always acknowledge a new request first** — call \`send_message\` with something brief before doing any work: "On it!", "Taking a look!", "Sure, give me a sec." Then use \`send_message\` again for notable updates while you work, and for your final reply.

## Tools

- **send_message**: Send a message to the user without pausing. Use for acknowledgments, progress updates, and final answers. Call it multiple times throughout a task.
- **ask_human**: Pause and wait for the user's reply. Use ONLY when you genuinely cannot proceed without input. Never ask in plain text — always use this tool. Include fetched options when you do ask.
- **request_permission**: Request approval for a protected endpoint. Call when a script logs \`[PERMISSION_REQUIRED]\`. Pass the exact endpoint, args, and a short description. Then call \`ask_human\` with the approval URL as the question — this pauses you until the user approves or declines.
- **manage_workflows**: List, create, update, or archive workflows. After writing and testing a workflow, call this with \`action: "create"\`. Once it returns success, **always** call \`send_message\` to confirm: the workflow name and when it runs.
- **get_conversation_history**: Fetch past messages for context. Start with a small limit (5) and increase if needed.
- **WebSearch**: Search the web for any general knowledge, current events, recommendations (restaurants, products, etc.), or real-time information. Use this freely for questions that don't require Corsair integrations.
- **WebFetch**: Fetch the contents of a specific URL. Use when you need to read a webpage directly.

## Writing and running code

For scripts: prepend \`import { corsair } from './server/corsair';\`
For workflows: at the top add \`declare const __event: unknown;\` (never \`const __event = null\` — the runtime injects the real value).

Write \`.ts\` temp files. Typecheck: \`npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck --allowImportingTsExtensions --esModuleInterop <file>\`. Run: \`npx tsx <file>\`. Delete temp files when done.

**Scripts:** Self-invoking \`main()\`, wrapped in try-catch.
**Workflows:** \`export async function <name>() { ... }\`. Cron: pass \`cronSchedule\`. Webhook: pass \`webhookTrigger: { plugin, action }\` where action is the dot-path. Event payload is in \`__event\` (cast as needed).

**Finding webhook triggers**: Read \`node_modules/corsair/dist/plugins/<plugin>/index.d.ts\` — the \`{plugin}WebhooksNested\` declaration lists every available trigger as nested keys; outer key + inner key form the dot-path action (e.g. \`issues: { create }\` → action \`"issues.create"\`). Event type names are shown inline; read \`node_modules/corsair/dist/plugins/<plugin>/webhooks/types.d.ts\` to get the full interface for casting \`__event\`.

Read \`server/seed/examples.ts\` or Grep by plugin name before writing code — examples show the right call shapes.

## Execution approach

Treat code as a REPL. Break multi-step tasks into phases:
1. **Research** — fetch and log what you need (IDs, names, addresses). Read the output before continuing.
2. **Act** — use the confirmed values from the research phase.

For workflows, run a one-off research script first to confirm all identifiers before writing the workflow.

## Deduction

Users describe things loosely. If an exact match fails: fetch the full list, look for close matches (casing, spacing, abbreviations), and proceed if obvious. Only ask when genuinely ambiguous — and share the fetched options when you do.

## Failures

Fix silently: read the error, understand the cause, fix it, retry. Never share raw errors or failing code with the user.

## Protected endpoints

When a script returns \`[PERMISSION_REQUIRED]\`:
1. Parse the endpoint and args.
2. Call \`request_permission\`.
3. Call \`ask_human\` with the approval URL as the question — this pauses you until the user approves or declines.
4. When approved, re-run the script.
5. If declined, use \`send_message\` to inform the user and stop.

## LLM in scripts

Use the \`ai\` package (\`generateText\`) with \`process.env.ANTHROPIC_API_KEY\` → anthropic, else openai.`;

export const WORKFLOW_FAILURE_PROMPT = `
## Workflow failure escalation

You have been invoked because a workflow failed. You receive the workflow ID, code, error, trigger type (cron or webhook), and — for webhook failures — the event payload.

Act autonomously without asking the user:
1. **Diagnose** — read the code and error carefully to find the root cause.
2. **Fix the missed run** — write and run a one-off script to complete what the workflow was supposed to do. For webhook failures, use the event payload. Do not skip this step.
3. **Fix the workflow** — correct the issue in the code, then call \`manage_workflows\` with \`action: "update"\` to persist the fix.

If the failure is a bad identifier or changed API shape, fetch the current state first. Only use \`ask_human\` if you genuinely cannot fix it without user input.
`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Trims, splits, returns first N non-empty lines. */
export function snippetOutput(full: string): string {
	const lines = full
		.trim()
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	return lines.slice(0, 30).join('\n');
}

function buildSystemPromptWithHistory(
	history: SimpleMessage[],
	systemExtra?: string,
): string {
	let prompt = SYSTEM_PROMPT;
	if (systemExtra) prompt += '\n\n' + systemExtra;
	if (history.length > 0) {
		prompt += '\n\n## Conversation history\n\n';
		for (const msg of history) {
			prompt += `**${msg.role === 'user' ? 'User' : 'Assistant'}**: ${msg.text}\n\n`;
		}
	}
	return prompt;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-process MCP server
// ─────────────────────────────────────────────────────────────────────────────

export async function buildMcpServer(context?: {
	jid?: string;
	onMessage?: (text: string) => Promise<void>;
	onAskHuman?: (question: string) => void;
}) {
	const basePermissionUrl =
		process.env.BASE_PERMISSION_URL ??
		process.env.BASE_URL ??
		`http://localhost:${process.env.PORT ?? 3000}`;
	const corsairTools = await createClaudeTools({
		corsair,
		workflows: workflowAdapter,
		cron: cronAdapter,
		permissions: permissionAdapter,
		basePermissionUrl,
		context,
	});
	const sendMessageTool = tool(
		'send_message',
		'Send a message to the user without pausing. Use for acknowledgments ("On it!"), progress updates, and final answers. You can call it multiple times.',
		{
			message: z.string().describe('The message to send'),
		},
		async ({ message }) => {
			console.log(`[agent:send_message] ${message.slice(0, 120)}`);
			await context?.onMessage?.(message);
			return { content: [{ type: 'text' as const, text: 'sent' }] };
		},
	);

	const askHumanTool = tool(
		'ask_human',
		'Pause and ask the user a question. Only use when you genuinely cannot proceed without their input. Include any fetched options so they can choose.',
		{
			question: z.string().describe('The question to ask the user'),
		},
		async ({ question }) => {
			// Fire immediately so the abort is set before the SDK can dispatch the
			// next model turn. The outer loop detection is kept as a fallback but
			// this is the reliable interception point.
			context?.onAskHuman?.(question);
			return { content: [{ type: 'text', text: '(waiting for response)' }] };
		},
	);

	const getConversationHistoryTool = tool(
		'get_conversation_history',
		'Fetch past messages from the current WhatsApp chat. Use when you need more context about what the user said earlier. Start with a small limit and call again with a larger one if needed.',
		{
			limit: z
				.number()
				.int()
				.min(1)
				.max(20)
				.describe('How many recent messages to retrieve (newest first).'),
		},
		async ({ limit }) => {
			if (!context?.jid) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error:
									'Conversation history is only available in WhatsApp chats.',
							}),
						},
					],
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
				.where(eq(whatsappMessages.jid, context.jid))
				.orderBy(desc(whatsappMessages.sentAt))
				.limit(limit);

			const result = {
				messages: rows.reverse().map((r) => ({
					sender: r.isBot ? 'bot' : (r.senderName ?? r.senderJid),
					content: r.content,
					sentAt: r.sentAt,
				})),
			};
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result) }],
			};
		},
	);

	return createSdkMcpServer({
		name: 'corsair',
		version: '1.0.0',
		tools: [
			...corsairTools,
			sendMessageTool,
			askHumanTool,
			getConversationHistoryTool,
		],
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Main agent (non-streaming, used by WhatsApp/Telegram/escalation)
// ─────────────────────────────────────────────────────────────────────────────

export async function runAgent(
	prompt: string,
	opts: {
		sessionId: string;
		history: SimpleMessage[];
		systemExtra?: string;
		jid?: string;
		onMessage?: (text: string) => Promise<void>;
	},
): Promise<AgentOutput> {
	const sentMessages: string[] = [];
	const onMessage = async (text: string) => {
		sentMessages.push(text);
		await opts.onMessage?.(text);
	};

	const systemPrompt = buildSystemPromptWithHistory(
		opts.history,
		opts.systemExtra,
	);
	const abortController = new AbortController();
	let askHumanQuestion: string | null = null;
	const mcpServer = await buildMcpServer({
		jid: opts.jid,
		onMessage,
		onAskHuman: (question) => {
			askHumanQuestion = question;
			process.nextTick(() => abortController.abort());
		},
	});
	let lastAssistantText = '';
	let turnCount = 0;

	console.log(
		`[agent] runAgent: prompt="${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}"`,
	);

	try {
		for await (const msg of query({
			prompt,
			options: {
				env: { ...process.env, CLAUDECODE: undefined },
				abortController,
				systemPrompt,
				cwd: process.cwd(),
				model: MODEL,
				disallowedTools: [
					'TeamCreate',
					'TeamDelete',
					'SendMessage',
					'TodoWrite',
					'Skill',
				],
				permissionMode: 'bypassPermissions',
				includePartialMessages: true,
				maxTurns: MAX_TURNS,
				persistSession: false,
				mcpServers: { corsair: mcpServer },
			},
		})) {
			if (msg.type === 'assistant') {
				turnCount++;
				for (const block of msg.message.content) {
					if (block.type === 'text') {
						lastAssistantText = block.text;
					}
					if (block.type === 'tool_use') {
						const inputPreview = JSON.stringify(block.input).slice(0, 120);
						console.log(
							`[agent] turn ${turnCount} tool_use: ${block.name} ${inputPreview}`,
						);
					}
				}
			}
			if (abortController.signal.aborted) break;
		}
	} catch (err) {
		if (!abortController.signal.aborted) throw err;
	}

	console.log(
		`[agent] runAgent done: turns=${turnCount} sentMessages=${sentMessages.length} askHuman=${!!askHumanQuestion} lastText=${lastAssistantText.length > 0}`,
	);

	if (askHumanQuestion) {
		return { type: 'needs_input', question: askHumanQuestion };
	}

	if (sentMessages.length > 0) {
		return { type: 'done', messages: sentMessages };
	}

	if (lastAssistantText) {
		return { type: 'message', text: lastAssistantText };
	}

	throw new Error('Agent did not produce a result');
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming entry point (chat UI)
// ─────────────────────────────────────────────────────────────────────────────

export async function* createAgentStream(
	prompt: string,
	opts: {
		sessionId: string;
		history: SimpleMessage[];
	},
): AsyncGenerator<AgentStreamChunk> {
	const systemPrompt = buildSystemPromptWithHistory(opts.history);
	const abortController = new AbortController();
	let askHumanQuestion: string | null = null;
	const mcpServer = await buildMcpServer({
		onAskHuman: (question) => {
			askHumanQuestion = question;
			process.nextTick(() => abortController.abort());
		},
	});
	const pendingToolCalls = new Map<string, string>();

	try {
		for await (const msg of query({
			prompt,
			options: {
				env: { ...process.env, CLAUDECODE: undefined },
				abortController,
				systemPrompt,
				cwd: process.cwd(),
				model: MODEL,
				permissionMode: 'bypassPermissions',
				disallowedTools: ['Task'],
				includePartialMessages: true,
				maxTurns: MAX_TURNS,
				persistSession: false,
				mcpServers: { corsair: mcpServer },
			},
		})) {
			if (msg.type === 'stream_event') {
				const event = msg.event;
				if (event.type === 'content_block_delta') {
					const delta = event.delta satisfies { type: string; text?: string };
					if (delta.type === 'text_delta' && delta.text) {
						yield { type: 'text-delta', delta: delta.text };
					}
				} else if (event.type === 'content_block_start') {
					const block = event.content_block satisfies {
						type: string;
						id?: string;
						name?: string;
					};
					if (block.type === 'tool_use' && block.id && block.name) {
						pendingToolCalls.set(block.id, block.name);
						yield {
							type: 'tool-call',
							toolCallId: block.id,
							toolName: block.name,
						};
					}
				}
			} else if (msg.type === 'user') {
				const content = msg.message.content;
				if (Array.isArray(content)) {
					for (const block of content) {
						if (
							typeof block === 'object' &&
							block !== null &&
							'type' in block &&
							block.type === 'tool_result' &&
							'tool_use_id' in block
						) {
							const toolName =
								pendingToolCalls.get(block.tool_use_id) ?? 'unknown';
							yield {
								type: 'tool-result',
								toolCallId: block.tool_use_id,
								toolName,
							};
						}
					}
				}

				if (abortController.signal.aborted) break;
			}
		}
	} catch (err) {
		if (!abortController.signal.aborted) throw err;
	}

	if (askHumanQuestion) {
		yield { type: 'needs-input', question: askHumanQuestion };
	} else {
		yield { type: 'finish' };
	}
}
