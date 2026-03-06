import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { corsair } from './corsair';

const inspect = corsair;

export function createMcpServer(): McpServer {
	const server = new McpServer({
		name: 'corsair',
		version: '1.0.0',
	});

	// ─────────────────────────────────────────────────────────────────────────
	// list_operations
	// ─────────────────────────────────────────────────────────────────────────

	server.tool(
		'list_operations',
		"List available Corsair operations. Without options returns all API endpoints across every plugin. Filter by plugin (e.g. 'slack') and/or type ('api' | 'webhooks' | 'db').",
		{
			plugin: z.string().optional().describe("Plugin ID to filter by, e.g. 'slack' or 'github'"),
			type: z
				.enum(['api', 'webhooks', 'db'])
				.optional()
				.describe("Operation type: 'api' (default), 'webhooks', or 'db'"),
		},
		async ({ plugin, type }) => {
			const result = inspect.list_operations({ plugin, type });
			return {
				content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	// ─────────────────────────────────────────────────────────────────────────
	// get_schema
	// ─────────────────────────────────────────────────────────────────────────

	server.tool(
		'get_schema',
		"Get the schema and metadata for a Corsair operation path. Accepts API paths ('slack.api.channels.list'), webhook paths ('slack.webhooks.messages.message'), or DB paths ('slack.db.messages.search').",
		{
			path: z
				.string()
				.describe("Full dot-path from list_operations, e.g. 'slack.api.channels.list'"),
		},
		async ({ path }) => {
			const result = inspect.get_schema(path);
			return {
				content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	// ─────────────────────────────────────────────────────────────────────────
	// corsair_run
	// ─────────────────────────────────────────────────────────────────────────

	server.tool(
		'corsair_run',
		"Execute any Corsair API endpoint by its dot-path. Use list_operations to discover paths and get_schema to understand required args. Example path: 'slack.api.channels.list'.",
		{
			path: z
				.string()
				.describe("Full API dot-path, e.g. 'slack.api.messages.post'"),
			args: z
				.record(z.unknown())
				.default({})
				.describe('Arguments object for the operation'),
		},
		async ({ path, args }) => {
			const parts = path.split('.');

			if (parts.length < 3) {
				return {
					isError: true,
					content: [
						{
							type: 'text',
							text: `Invalid path "${path}". Expected format: "plugin.api.group.method". Use list_operations to see valid paths.`,
						},
					],
				};
			}

			let fn: unknown = corsair;
			for (const part of parts) {
				if (typeof fn !== 'object' || fn === null) {
					fn = undefined;
					break;
				}
				fn = (fn as Record<string, unknown>)[part];
			}

			if (typeof fn !== 'function') {
				return {
					isError: true,
					content: [
						{
							type: 'text',
							text: `Path "${path}" is not a callable operation. Use list_operations to see valid paths.`,
						},
					],
				};
			}

			try {
				const result = await (fn as (args: unknown) => Promise<unknown>)(args);
				return {
					content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const extra = err instanceof Error && err.cause ? `\nCause: ${String(err.cause)}` : '';
				const full = JSON.stringify(err, Object.getOwnPropertyNames(err));
				console.error(`[corsair-mcp] corsair_run error for "${path}":`, err);
				return {
					isError: true,
					content: [{ type: 'text', text: `Error running "${path}": ${message}${extra}\n${full}` }],
				};
			}
		},
	);

	return server;
}
