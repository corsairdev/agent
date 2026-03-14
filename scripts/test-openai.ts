import 'dotenv/config';
import { Agent, run, tool } from '@openai/agents';
import { BaseProvider, type CorsairToolDef } from '@corsair-dev/mcp';
import { corsair } from '../server/corsair';
import { z } from 'zod';

class OpenAIAgentsProvider extends BaseProvider<ReturnType<typeof tool>> {
	readonly name = 'openai-agents';

	wrapTool(def: CorsairToolDef) {
		// OpenAI structured outputs requires:
		// 1. All properties in 'required' — convert optional fields to
		//    nullable-with-default so they satisfy that constraint.
		// 2. additionalProperties: false on every object — z.record(z.unknown())
		//    produces an open object schema which OpenAI rejects. Replace those
		//    fields with z.string() (JSON-encoded) and parse them back before
		//    invoking the handler.
		const recordKeys = new Set<string>();

		const normalizeSchema = (schema: z.ZodTypeAny): z.ZodTypeAny => {
			if (schema instanceof z.ZodOptional) {
				return normalizeSchema(schema.unwrap()).nullable().default(null);
			}
			if (schema instanceof z.ZodDefault) {
				const inner = schema._def.innerType;
				if (inner instanceof z.ZodRecord) {
					return z.string().default('{}').describe('JSON-encoded arguments object');
				}
				return schema;
			}
			if (schema instanceof z.ZodRecord) {
				return z.string().describe('JSON-encoded arguments object');
			}
			return schema;
		};

		const shape = Object.fromEntries(
			Object.entries(def.shape).map(([key, schema]) => {
				const inner = schema instanceof z.ZodDefault ? schema._def.innerType : schema;
				if (inner instanceof z.ZodRecord) recordKeys.add(key);
				return [key, normalizeSchema(schema)];
			}),
		);

		return tool({
			name: def.name,
			description: def.description,
			parameters: z.object(shape),
			execute: async (args) => {
				// Parse JSON-string fields back to objects for the handler.
				const handlerArgs = Object.fromEntries(
					Object.entries(args as Record<string, unknown>).map(([key, value]) => {
						if (recordKeys.has(key) && typeof value === 'string') {
							try { return [key, JSON.parse(value)]; } catch { return [key, {}]; }
						}
						return [key, value];
					}),
				);
				const result = await def.handler(handlerArgs);
				return result.content.map((c) => ('text' in c ? c.text : '')).join('\n');
			},
		});
	}
}

// Initialize Corsair tools
const provider = new OpenAIAgentsProvider();
const tools = provider.build({ corsair });

// Create agent with Corsair tools
const agent = new Agent({
	name: 'Corsair Agent',
	instructions: 'You are a helpful assistant with access to Corsair tools.',
	tools,
});

// Run the agent
const result = await run(
	agent,
	'list all slack channels, send test message to sdk-test channel',
);

console.log(result.finalOutput);
