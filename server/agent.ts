import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import type { ModelMessage } from 'ai';
import { generateText, stepCountIs, streamText, tool, zodSchema } from 'ai';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, permissions, whatsappMessages } from './db';
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
			/** Set when ask_human was triggered by a permission request */
			permissionId?: string;
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
- **request_permission**: Request approval for a protected endpoint. Call this when a script logs a \`[PERMISSION_REQUIRED]\` message. Pass the exact endpoint and args from the log, plus a friendly description. The user will review and approve or decline on a dedicated page.
- **search_code_examples**: Find Corsair API patterns. Call before writing code.
- **write_and_execute_code**: Write TypeScript, typecheck, and run (scripts) or validate (workflows). Use this not just to act, but to explore and confirm — it is your window into the outside world.
- **manage_workflows**: List, create, update, or archive workflows. After successfully writing a workflow with \`write_and_execute_code\`, call \`manage_workflows\` with \`action: "create"\` and the same workflowId, code, description, cronSchedule/webhookTrigger to store it so it runs on future triggers.
- **get_conversation_history** *(WhatsApp only)*: Fetch past messages from the current chat. Call this when you need more context about a previous request, an earlier decision, or anything the user may have mentioned before. Pick a \`limit\` that is just enough — start small (e.g. 5) and call again with a larger number if still unclear.

## Execution model

Treat \`write_and_execute_code\` as a REPL: a tool for both understanding the world and acting on it. For any task that touches real data, explore before you commit.

**For multi-step one-off scripts:**
Break the job into sequential phases. Each phase is its own \`write_and_execute_code\` call:
1. **Research phase** — fetch the data you need and \`console.log\` exactly what you'll use downstream: IDs, names, counts, content, addresses. Read the output before moving on.
2. **Action phase** — use the confirmed values from the research output to execute the action. If that action produces a result that drives the next step, log it and handle it in a third call.

Never collapse dependent steps into one script if the second step relies on reading the first step's output. For example, if a user asks to pull open tasks from a project and send a summary to a person, first fetch and log the tasks and the person's contact details. Then, using that confirmed data, compose and send the message.

**For workflows and cron jobs:**
You cannot interactively inspect output at runtime, so do your research upfront before writing the workflow:
1. Run a **one-off research script** first. Fetch and log every identifier you'll need — exact resource names, IDs, addresses, list names, project keys, etc. Confirm they exist.
2. Write the workflow using only the confirmed exact identifiers from step 1. Never hardcode a name or ID you haven't verified with a live API call.

For example, if a user wants a weekly digest sent to a mailing list, run a script first to list all mailing lists and log their exact names. Find the right one, then write the workflow using that confirmed name.

## Deduction and fuzzy matching

Never give up on a resource because an exact string match failed. Users describe things loosely — with different spacing, casing, punctuation, or shorthand. Before concluding something doesn't exist:
1. Fetch the full list of available resources of that type.
2. \`console.log\` the full list so you can read it.
3. Look for a close match: collapsed spaces, hyphens vs spaces, different capitalisation, common abbreviations, partial name matches.
4. If you find a clear match, proceed with the correct identifier — do not ask the user.

For example, if a user says to email "the design team" and no contact group by that exact name exists, fetch all contact groups and look for anything resembling "design" — it might be "Design Team", "design-team", or "designers". If it's obvious, use it.

Only escalate to \`ask_human\` after you have fetched and inspected the available options and genuinely cannot determine which one the user meant. When you do ask, include the fetched list so the user can pick.

## When to ask vs assume

Ask when the target is unspecified and critical (e.g. which account to send from when there are multiple). Assume when the value is singular or clearly inferable. Don't ask when the user already specified it or you can resolve it with a live lookup.

## Handling failures

When code fails, **do not send the failing code or raw error to the user**. Instead:
1. Read the first few lines of the code to understand what it was trying to do.
2. Analyse the error and any output snippet to understand what went wrong.
3. Fix the issue and retry.

If the failure is a missing resource: apply the deduction process above — fetch the full list, look for a close match, and retry with the correct identifier. Only report failure or ask after you have exhausted this.

Always use \`ask_human\` — never ask in plain text. Include fetched options so the user can pick.

## Code shape

**Scripts:** Self-invoking \`main()\`. Call \`corsair.<plugin>.api.<resource>.<method>(...)\`. Wrap the body in try-catch so errors are logged as output rather than unhandled throws.

**Workflows:** \`export async function <name>() { ... }\`.
- Cron: pass \`cronSchedule\` (e.g. \`0 9 * * *\`).
- Webhook: pass \`webhookTrigger: { plugin, action }\`. Payload is in global \`__event\` (do not import; cast as needed). Examples: linear \`issues.create\`, slack \`messages.message\`, github \`starCreated\`.

Code examples from search are for patterns — don't reuse example IDs or names.

## LLM in scripts

Use the \`ai\` package (\`generateText\`) with \`process.env.ANTHROPIC_API_KEY\` → anthropic, else openai.

## Handling protected endpoints

Some endpoints are protected and require explicit user approval before execution. When you run a script that calls a protected endpoint, the output will include a line like:

\`[PERMISSION_REQUIRED] endpoint=slack.messages.post args={"channel":"general","text":"Hello"} | This endpoint requires approval.\`

When you see this:
1. Parse the endpoint name and the args JSON from the message.
2. Call \`request_permission\` with the endpoint, args, and a friendly description.
3. The tool returns an approval URL. Call \`ask_human\` with a message like: "I need your permission to [description]. Please review and approve here: [URL]"
4. When the user approves, you will resume. Re-run the same script — the endpoint will now succeed.
5. If the user declines, do NOT retry. Inform the user that the action was cancelled.

Never bypass or skip the permission step. Never call the endpoint a second time without first getting approval via \`request_permission\`.

## Always reply to the user

After completing any task — running a script, creating a workflow, answering a question — always send a short, friendly message back. Confirm what happened, share a key detail or result if relevant, and keep it to 1–3 sentences. Never finish silently.`;

export const WORKFLOW_FAILURE_PROMPT = `
## Workflow failure escalation

You have been invoked because a workflow failed. You will receive the workflow ID, code, error, trigger type (cron or webhook), and — for webhook failures — the event payload that triggered the run.

Your job is to act autonomously without asking the user:
1. **Diagnose** — read the code and the error carefully to understand the root cause. Do not skim; the fix depends on the exact cause.
2. **Fix the missed run** — write and execute a one-off script that performs what the workflow was supposed to do for this specific failed invocation. For webhook failures, use the event payload to reconstruct what should have happened. Do not skip this step — the missed action needs to be completed.
3. **Fix and update the workflow** — correct the underlying issue in the code, then call \`manage_workflows\` with \`action: "update"\` to persist the fixed version so the same failure does not recur.

Apply the same research discipline as for any other task: if the failure is caused by a wrong identifier, unknown resource, or changed API shape, fetch the current state of those resources before writing the fix.

Only use \`ask_human\` if you have diagnosed the failure and genuinely cannot determine the correct fix without more information from the user.
`;

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
		description:
			'Search Corsair API code examples by plugin name or keyword. Pass a plugin name (e.g. "slack", "github", "linear") or a keyword (e.g. "channels", "messages", "issues").',
		inputSchema: zodSchema(z.object({ query: z.string() })),
		execute: ({ query }) => {
			const examples = searchCodeExamples(query, 5);
			return {
				examples: examples.map((ex) => ({
					plugin: ex.plugin,
					description: ex.description,
					code: ex.code,
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

	request_permission: tool({
		description:
			'Request permission from the user to execute a protected endpoint. Call this when a script returns a [PERMISSION_REQUIRED] message. Returns an approval URL. After calling this, call ask_human with the approval URL so the user can review and approve.',
		inputSchema: zodSchema(
			z.object({
				endpoint: z
					.string()
					.describe(
						'Full endpoint path from the PERMISSION_REQUIRED message, e.g. "slack.messages.post"',
					),
				args: z
					.record(z.unknown())
					.describe(
						'The arguments object from the PERMISSION_REQUIRED message',
					),
				description: z
					.string()
					.describe(
						'Short human-readable summary of what this action will do, e.g. "Post a message to #general in Slack"',
					),
			}),
		),
		execute: async ({ endpoint, args, description }) => {
			const [plugin, ...rest] = endpoint.split('.');
			const operation = rest.join('.');

			const [perm] = await db
				.insert(permissions)
				.values({
					endpoint,
					plugin: plugin!,
					operation,
					args,
					description,
					status: 'pending',
				})
				.returning({ id: permissions.id });

			const baseUrl = process.env.BASE_PERMISSION_URL; // WEBHOOK URL
			const approvalUrl = `${baseUrl}/permissions/${perm!.id}`;

			return {
				permissionId: perm!.id,
				approvalUrl,
				message: `Permission request created. Ask the user to approve at: ${approvalUrl}`,
			};
		},
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
	context?: { jid?: string; systemExtra?: string },
): Promise<AgentOutput> {
	const model = getModel();

	const webSearchTool = process.env.ANTHROPIC_API_KEY
		? anthropic.tools.webSearch_20250305({})
		: openai.tools.webSearchPreview({});

	const system = context?.systemExtra
		? SYSTEM_PROMPT + '\n' + context.systemExtra
		: SYSTEM_PROMPT;

	const result = await generateText({
		model,
		system,
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
			// Check if ask_human was preceded by a request_permission call
			const allResults = result.steps.flatMap((s) => s.staticToolResults);
			const permResult = allResults
				.slice()
				.reverse()
				.find(
					(r: { toolName: string }) => r.toolName === 'request_permission',
				) as { output: Record<string, unknown> } | undefined;

			return {
				type: 'needs_input',
				question: askCall.input.question,
				pendingMessages: [...messages, ...result.response.messages],
				toolCallId: askCall.toolCallId,
				toolName: askCall.toolName,
				permissionId: permResult?.output?.permissionId as string | undefined,
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
