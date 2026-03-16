import 'dotenv/config';
import { Agent, run, tool } from '@openai/agents';
import { OpenAIAgentsProvider } from '@corsair-dev/mcp';
import { corsair } from '../server/corsair';

// Initialize Corsair tools for OpenAI Agents SDK
const provider = new OpenAIAgentsProvider();
const tools = provider.build({ corsair, tool });

// Create an agent with Corsair tools
const agent = new Agent({
	name: 'corsair-agent',
	model: 'gpt-4.1',
	instructions: 'You are a helpful assistant with access to Corsair tools. Use list_operations to discover available APIs, get_schema to understand required arguments, and corsair_run to execute them. When referencing resources (like channels), always use their ID, not their name. If a tool call fails, use get_schema to check the expected arguments and retry.',
	tools,
});

// Run the agent
const result = await run(agent, 'list all slack channels and send test message to sdk-test channel');
console.log(result.finalOutput);
