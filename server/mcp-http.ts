import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import { createMcpServer } from './mcp-tools';

interface Session {
	server: McpServer;
	transport: StreamableHTTPServerTransport;
}

// In-memory session store — keyed by mcp-session-id header
const sessions = new Map<string, Session>();

function cleanup(sessionId: string) {
	const session = sessions.get(sessionId);
	if (session) {
		session.transport.close();
		session.server.close();
		sessions.delete(sessionId);
	}
}

export function createMcpRouter(): Router {
	const router = createRouter();

	// POST — initialize new session or dispatch to existing one
	router.post('/', async (req: Request, res: Response) => {
		const sessionId = req.headers['mcp-session-id'] as string | undefined;

		if (sessionId) {
			const session = sessions.get(sessionId);
			if (!session) {
				res.status(404).json({ error: 'Session not found' });
				return;
			}
			await session.transport.handleRequest(req, res, req.body);
			return;
		}

		// New session
		const server = createMcpServer();
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			onsessioninitialized: (id) => {
				sessions.set(id, { server, transport });
			},
		});

		res.on('close', () => {
			const id = transport.sessionId;
			if (id) {
				// Delay cleanup so the session stays available for follow-up requests
				setTimeout(() => cleanup(id), 60_000);
			}
		});

		await server.connect(transport);
		await transport.handleRequest(req, res, req.body);
	});

	// GET — SSE push channel for an existing session
	router.get('/', async (req: Request, res: Response) => {
		const sessionId = req.headers['mcp-session-id'] as string | undefined;
		if (!sessionId || !sessions.has(sessionId)) {
			res.status(400).json({ error: 'Missing or invalid mcp-session-id' });
			return;
		}
		const session = sessions.get(sessionId)!;
		await session.transport.handleRequest(req, res);
	});

	// DELETE — explicit session teardown
	router.delete('/', async (req: Request, res: Response) => {
		const sessionId = req.headers['mcp-session-id'] as string | undefined;
		if (sessionId) cleanup(sessionId);
		res.status(200).end();
	});

	return router;
}
