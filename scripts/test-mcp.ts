import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { getCorsairMcp } from '../server/sdk';

const anthropic = new Anthropic();
const mcp = getCorsairMcp();

const response = await anthropic.beta.messages.create({
	model: 'claude-sonnet-4-6',
	max_tokens: 4096,
	mcp_servers: [{ type: 'url', name: 'corsair', url: mcp.url }],
	messages: [{ role: 'user', content: 'List all available operations' }],
	betas: ['mcp-client-2025-04-04'],
});

console.log(response.content);
