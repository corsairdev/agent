import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider, type CorsairToolDef } from '@corsair-dev/mcp';
import { corsair } from '../server/corsair';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

type BetaRunnableTool = {
	type: 'custom';
	name: string;
	description: string;
	input_schema: { type: 'object'; [key: string]: unknown };
	run: (args: Record<string, unknown>) => Promise<string>;
	parse: (content: unknown) => Record<string, unknown>;
};

class AnthropicProvider extends BaseProvider<BetaRunnableTool> {
	readonly name = 'anthropic';

	wrapTool(def: CorsairToolDef): BetaRunnableTool {
		const schema = zodToJsonSchema(z.object(def.shape), { target: 'openApi3' });
		return {
			type: 'custom',
			name: def.name,
			description: def.description,
			input_schema: schema as { type: 'object'; [key: string]: unknown },
			run: async (args) => {
				const result = await def.handler(args);
				return result.content.map((c) => ('text' in c ? c.text : '')).join('\n');
			},
			parse: (content) => z.object(def.shape).parse(content) as Record<string, unknown>,
		};
	}
}

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
