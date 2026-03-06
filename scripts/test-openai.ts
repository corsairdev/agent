import 'dotenv/config';
import { Agent, run, hostedMcpTool } from '@openai/agents';
import { getCorsairMcp } from '../server/sdk';

const mcp = getCorsairMcp();

const agent = new Agent({
	name: 'Corsair Agent',
	model: 'gpt-4.1',
	instructions: 'You are a helpful assistant with access to Corsair tools.',
	tools: [
		hostedMcpTool({
			serverLabel: 'corsair',
			serverUrl: mcp.url,
		}),
	],
});

const result = await run(agent, 'list all slack channels');
console.log(result.finalOutput);
