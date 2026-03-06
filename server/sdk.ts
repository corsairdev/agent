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
