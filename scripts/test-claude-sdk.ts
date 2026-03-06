import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getCorsairMcp } from '../server/sdk';

const mcp = getCorsairMcp();

for await (const event of query({
	prompt: 'list all slack channels, send test message to #sdk-test channel',
	options: {
		model: 'claude-sonnet-4-6',
		permissionMode: 'bypassPermissions',
		mcpServers: { corsair: mcp },
	},
})) {
	if (event.type === 'result' && event.subtype === 'success') {
		process.stdout.write(event.result);
	}
}
