import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '@corsair-dev/mcp';
import { corsair } from '../server/corsair';

// Initialize Corsair tools
const provider = new AnthropicProvider();
const tools = provider.build({ corsair });

const client = new Anthropic();

// Run with automatic tool loop
const message = await client.beta.messages.toolRunner({
	model: 'claude-opus-4-6',
	max_tokens: 4096,
	tools,
	messages: [
		{ role: 'user', content: 'list all slack channels, send test message to sdk-test channel' },
	],
});

for (const block of message.content) {
	if (block.type === 'text') process.stdout.write(block.text);
}
