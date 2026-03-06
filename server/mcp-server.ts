import { config } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
// config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-tools';

async function main() {
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error('[corsair-mcp] Server running on stdio');
}

main().catch((err) => {
	console.error('[corsair-mcp] Fatal:', err);
	process.exit(1);
});
