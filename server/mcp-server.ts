import { config } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });
import { createBaseMcpServer } from '@corsair/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { corsair } from './corsair';
import {
	cronAdapter,
	permissionAdapter,
	workflowAdapter,
} from './mcp-adapters';

async function main() {
	const basePermissionUrl =
		process.env.BASE_PERMISSION_URL ??
		process.env.BASE_URL ??
		'http://localhost:3000';
	const server = createBaseMcpServer({
		corsair,
		workflows: workflowAdapter,
		cron: cronAdapter,
		permissions: permissionAdapter,
		basePermissionUrl,
	});
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error('[corsair-mcp] Server running on stdio');
}

main().catch((err) => {
	console.error('[corsair-mcp] Fatal:', err);
	process.exit(1);
});
