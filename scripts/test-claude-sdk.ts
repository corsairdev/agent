import 'dotenv/config';
import { createSdkMcpServer, query } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeProvider } from '@corsair-dev/mcp';
import { corsair } from '../server/corsair';

// Initialize Corsair MCP tools
const provider = new ClaudeProvider();
const tools = await provider.build({ corsair });

// Create in-process MCP server
const server = createSdkMcpServer({ name: 'corsair', tools });

// Query Claude with MCP tools
const stream = query({
	prompt: 'list all slack channels, send test message to sdk-test channel',
	options: {
		model: 'claude-opus-4-6',
		permissionMode: 'bypassPermissions',
		allowDangerouslySkipPermissions: true,
		mcpServers: {
			corsair: server,
		},
	},
});

// Stream the response
for await (const event of stream) {
	if ('result' in event) {
		process.stdout.write(event.result);
	}
}
