import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildMcpServer, runAgent } from './agent';

const main = async () => {
	// const res = await runAgent('hello', {
	// 	sessionId: '5d7798ad-4806-4817-ba6f-a278b1d6d685',
	// 	history: [],
	// });

	// console.log(res);

	const mcpServer = buildMcpServer({});

	for await (const message of query({
		prompt: 'say hi to the user',
		options: {
			env: process.env,
			systemPrompt: 'say hello',
			cwd: process.cwd(),
			model: 'claude-sonnet-4-6',
			permissionMode: 'bypassPermissions',
			allowDangerouslySkipPermissions: true,
			disallowedTools: ['Task'],
			includePartialMessages: true,
			maxTurns: 10,
			persistSession: false,
			mcpServers: { corsair: mcpServer },
		},
	})) {
		console.log(message);
	}
};

main();
