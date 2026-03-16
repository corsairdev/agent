import 'dotenv/config';
import { Agent, run, tool } from '@openai/agents';
import { OpenAIAgentsProvider } from '@corsair-dev/mcp';
import { corsair } from '../server/corsair';

// Initialize Corsair tools
const provider = new OpenAIAgentsProvider();
const tools = provider.build({ corsair }, tool);

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
