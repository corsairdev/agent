/**
 * Corsair SDK adapters for OpenAI Agents and Anthropic Claude.
 *
 * ── OpenAI Agents SDK (@openai/agents) ────────────────────────────────────
 *
 *   import { Agent, run, hostedMcpTool } from '@openai/agents';
 *   import { getCorsairMcp } from './server/sdk';
 *
 *   const agent = new Agent({
 *     name: 'My Agent',
 *     model: 'gpt-4o',
 *     instructions: 'You are a helpful assistant.',
 *     tools: [hostedMcpTool({ serverLabel: 'corsair', serverUrl: getCorsairMcp().serverUrl })],
 *   });
 *   const result = await run(agent, 'List my Slack channels');
 *   console.log(result.finalOutput);
 *
 * ── Anthropic Claude API — remote MCP (mcp_servers beta) ──────────────────
 *
 *   import Anthropic from '@anthropic-ai/sdk';
 *   import { getAnthropicMcpServer } from './server/sdk';
 *
 *   const anthropic = new Anthropic();
 *   const response = await (anthropic.beta as any).messages.create({
 *     model: 'claude-sonnet-4-6',
 *     max_tokens: 4096,
 *     mcp_servers: [getAnthropicMcpServer()],
 *     messages: [{ role: 'user', content: 'List my Slack channels' }],
 *   });
 *
 * ── Anthropic Claude Agent SDK — in-process MCP ───────────────────────────
 *
 *   See server/agent.ts — use buildMcpServer() which wires up the full
 *   agent tool suite (send_message, ask_human, manage_workflows, etc.) via
 *   createSdkMcpServer from @anthropic-ai/claude-agent-sdk.
 *
 *   For just the Corsair API tools (list_operations / get_schema / corsair_run),
 *   point the agent at the HTTP /mcp endpoint using getAnthropicMcpServer().
 */

export interface CorsairMcp {
	/** Required by Claude Agent SDK for HTTP MCP servers */
	type: 'http';
	/** MCP server URL — pass to hostedMcpTool({ serverUrl }) for OpenAI */
	url: string;
	/** Auth headers (empty by default) */
	headers: Record<string, string>;
}

/**
 * Returns the Corsair MCP config. Works with both SDKs:
 *
 * OpenAI Agents SDK:
 *   hostedMcpTool({ serverLabel: 'corsair', serverUrl: mcp.url, headers: mcp.headers })
 *
 * Claude Agent SDK:
 *   mcpServers: { corsair: mcp }
 *
 * Anthropic API (beta):
 *   mcp_servers: [{ type: 'url', name: 'corsair', url: mcp.url }]
 *
 * Configure via .env:
 *   BASE_URL=https://your-domain.com  (defaults to http://localhost:PORT)
 */
export function getCorsairMcp(): CorsairMcp {
	const baseUrl =
		process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
	return { type: 'http', url: `${baseUrl}/mcp`, headers: {} };
}

// ─────────────────────────────────────────────────────────────────────────────
// workflow — programmatic webhook & cron registration
//
// Usage:
//   import { workflow } from './server/sdk';
//
//   await workflow.webhook({
//     id: 'myWebhook',
//     trigger: { plugin: 'slack', action: 'messages.message' },
//     handler: async (event: any) => {
//       await corsair.slack.api.messages.post({ channel: 'C123', text: event.text });
//     },
//   });
//
//   await workflow.cron({
//     id: 'myReport',
//     schedule: '0 9 * * 1-5',
//     handler: async () => {
//       await corsair.slack.api.messages.post({ channel: 'C123', text: 'Morning!' });
//     },
//   });
//
// Note: handlers run inside the server process via tsx. `corsair` is injected
// automatically — import it in your script only for type safety, not for runtime.
// ─────────────────────────────────────────────────────────────────────────────

import {
	archiveWorkflow,
	findWorkflowByNameOrId,
	listWorkflows,
	storeWorkflow,
	updateWorkflowRecord,
} from './executor';
import { registerCronWorkflow } from './workflow-scheduler';

function serializeWebhookHandler(id: string, fn: (event: unknown) => Promise<void>): string {
	return [
		`export async function ${id}() {`,
		`  // Handles both Slack's { event: {...} } wrapper and flat payloads`,
		`  const __payload = (__event as any)?.event ?? __event;`,
		`  const __handler = ${fn.toString()};`,
		`  return __handler(__payload);`,
		`}`,
	].join('\n');
}

function serializeCronHandler(id: string, fn: () => Promise<void>): string {
	return [
		`export async function ${id}() {`,
		`  const __handler = ${fn.toString()};`,
		`  return __handler();`,
		`}`,
	].join('\n');
}

export const workflow = {
	/**
	 * Register or update a webhook-triggered workflow.
	 * The handler is serialized and stored in the DB. `corsair` is available as a global.
	 */
	async webhook<T = unknown>(opts: {
		id: string;
		description?: string;
		trigger: { plugin: string; action: string };
		handler: (event: T) => Promise<void>;
	}) {
		const code = serializeWebhookHandler(opts.id, opts.handler as (event: unknown) => Promise<void>);
		const existing = await findWorkflowByNameOrId(opts.id);
		if (existing) {
			const updated = await updateWorkflowRecord(opts.id, {
				code,
				description: opts.description,
				webhookTrigger: opts.trigger,
			});
			console.log(`[workflow] Updated webhook workflow "${opts.id}"`);
			return updated;
		}
		const stored = await storeWorkflow({
			type: 'workflow',
			workflowId: opts.id,
			code,
			description: opts.description,
			webhookTrigger: opts.trigger,
		});
		console.log(`[workflow] Registered webhook workflow "${opts.id}"`);
		return stored;
	},

	/**
	 * Register or update a cron-triggered workflow.
	 * The handler is serialized and stored in the DB. `corsair` is available as a global.
	 * Note: the cron scheduler in the running server picks up new workflows on restart.
	 */
	async cron(opts: {
		id: string;
		description?: string;
		schedule: string;
		handler: () => Promise<void>;
	}) {
		const code = serializeCronHandler(opts.id, opts.handler);
		const existing = await findWorkflowByNameOrId(opts.id);
		if (existing) {
			const updated = await updateWorkflowRecord(opts.id, {
				code,
				description: opts.description,
				cronSchedule: opts.schedule,
			});
			console.log(`[workflow] Updated cron workflow "${opts.id}" (${opts.schedule})`);
			return updated;
		}
		const stored = await storeWorkflow({
			type: 'workflow',
			workflowId: opts.id,
			code,
			description: opts.description,
			cronSchedule: opts.schedule,
		});
		if (stored) {
			registerCronWorkflow(stored.id, opts.id, code, opts.schedule);
		}
		console.log(`[workflow] Registered cron workflow "${opts.id}" (${opts.schedule})`);
		return stored;
	},

	/** List workflows. Optionally filter by type. */
	list(triggerType?: 'cron' | 'webhook' | 'manual' | 'all') {
		return listWorkflows(triggerType);
	},

	/** Archive (soft-delete) a workflow by name or ID. */
	delete(id: string) {
		return archiveWorkflow(id);
	},
};
