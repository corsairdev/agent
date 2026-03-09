import 'dotenv/config';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { processWebhook } from 'corsair';
import { asc, eq } from 'drizzle-orm';
import express from 'express';
import { corsairPermissions, type PermissionLike } from '@corsair/ui';
import type { SimpleMessage } from './agent';
import { runAgent, WORKFLOW_FAILURE_PROMPT } from './agent';
import { createBaseMcpServer, createMcpRouter } from '@corsair/mcp';
import { corsair } from './corsair';
import {
	cronAdapter,
	permissionAdapter,
	workflowAdapter,
} from './mcp-adapters';
import {
	db,
	permissions,
	telegramMessages,
	threadMessages,
	threads,
	whatsappMessages,
} from './db';
import {
	createExecution,
	executeWorkflow,
	getWebhookWorkflows,
	updateExecution,
} from './executor';
import {
	loadAllCronWorkflows,
	setEscalationCallback,
} from './workflow-scheduler';
import { notifyJid } from './notifier';
import { startTelegram } from './telegram/index';
import { appRouter } from './trpc/router';
import { startWhatsApp } from './whatsapp/index';

// ─────────────────────────────────────────────────────────────────────────────
// Workflow failure escalation
// ─────────────────────────────────────────────────────────────────────────────

async function escalateWorkflowFailure(params: {
	workflowId: string;
	workflowName: string;
	code: string;
	triggerType: 'cron' | 'webhook';
	error: string;
	eventPayload?: unknown;
}) {
	const { workflowId, workflowName, code, triggerType, error, eventPayload } =
		params;

	const payloadSection = eventPayload
		? `\nEvent payload that triggered this run:\n${JSON.stringify(eventPayload, null, 2)}\n`
		: '';

	const prompt =
		`A ${triggerType} workflow failed and needs your attention.\n\n` +
		`Workflow ID: ${workflowId}\n` +
		`Workflow name: ${workflowName}\n` +
		`Trigger type: ${triggerType}\n\n` +
		`Error:\n${error}\n` +
		payloadSection +
		`\nWorkflow code:\n\`\`\`typescript\n${code}\n\`\`\`\n\n` +
		`Please:\n` +
		`1. Diagnose the error — read the code and the error to understand the root cause.\n` +
		`2. Fix the missed run — write and execute a one-off script that performs what the workflow was supposed to do for this specific failed invocation${eventPayload ? ', using the event payload above' : ''}.\n` +
		`3. Fix and update the workflow — correct the underlying issue and update it via manage_workflows so it won't fail again.`;

	console.log(`[escalation] Escalating failure for workflow: ${workflowId}`);

	runAgent(prompt, {
		sessionId: workflowId,
		history: [],
		systemExtra: WORKFLOW_FAILURE_PROMPT,
	}).catch((err) => {
		console.error(
			`[escalation] Agent escalation failed for ${workflowId}:`,
			err,
		);
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook workflow dispatcher
// ─────────────────────────────────────────────────────────────────────────────

async function dispatchWebhookWorkflows(
	plugin: string,
	action: string,
	eventPayload: unknown,
) {
	const matchingWorkflows = await getWebhookWorkflows(plugin, action);

	if (matchingWorkflows.length === 0) return;

	console.log(
		`[webhook] Dispatching ${matchingWorkflows.length} workflow(s) for ${plugin}.${action}`,
	);

	for (const workflow of matchingWorkflows) {
		console.log(`[webhook] Executing webhook workflow: ${workflow.workflowId}`);

		const execution = await createExecution(workflow.id, 'webhook', 'running');

		if (!execution) continue;

		try {
			const result = await executeWorkflow(
				workflow.name,
				workflow.code,
				eventPayload,
			);

			if (result.success) {
				await updateExecution(execution.id, 'success', {
					output: result.output,
				});
				console.log(
					`[webhook] Workflow ${workflow.workflowId} executed successfully`,
				);
				if (workflow.notifyJid) {
					notifyJid(
						workflow.notifyJid,
						`Workflow ran: "${workflow.name}".`,
					).catch(() => {});
				}
			} else {
				await updateExecution(execution.id, 'failed', undefined, result.error);
				console.error(
					`[webhook] Workflow ${workflow.workflowId} failed:`,
					result.error,
				);
				escalateWorkflowFailure({
					workflowId: workflow.workflowId,
					workflowName: workflow.name,
					code: workflow.code,
					triggerType: 'webhook',
					error: result.error ?? 'Unknown error',
					eventPayload,
				});
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			await updateExecution(execution.id, 'failed', undefined, errorMessage);
			console.error(
				`[webhook] Error executing workflow ${workflow.workflowId}:`,
				error,
			);
			escalateWorkflowFailure({
				workflowId: workflow.workflowId,
				workflowName: workflow.name,
				code: workflow.code,
				triggerType: 'webhook',
				error: errorMessage,
				eventPayload,
			});
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// App bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	const app = express();

	app.use(express.json());

	// ── CORS (for UI on port 3001) ──────────────────────────────────────────
	app.use((req, res, next) => {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader(
			'Access-Control-Allow-Methods',
			'GET, POST, PUT, PATCH, DELETE, OPTIONS',
		);
		res.setHeader(
			'Access-Control-Allow-Headers',
			'Content-Type, Authorization',
		);
		if (req.method === 'OPTIONS') {
			res.sendStatus(200);
			return;
		}
		next();
	});

	app.post('/api/webhook', async (req, res) => {
		const webhookResponse = await processWebhook(
			corsair,
			req.headers,
			req.body,
		);

		// Respond immediately — webhook senders expect a fast 200 OK
		res.json(webhookResponse.response);

		// Dispatch to any stored webhook-triggered workflows (fire and forget)
		if (webhookResponse.plugin && webhookResponse.action) {
			dispatchWebhookWorkflows(
				webhookResponse.plugin,
				webhookResponse.action,
				webhookResponse.body,
			).catch((err) => console.error('[webhook] Dispatch error:', err));
		}
	});

	// ── Google OAuth flow ─────────────────────────────────────────────────────

	const GOOGLE_PLUGIN_CONFIG = {
		googlecalendar: {
			scope: 'https://www.googleapis.com/auth/calendar',
			label: 'Google Calendar',
		},
		googledrive: {
			scope: 'https://www.googleapis.com/auth/drive',
			label: 'Google Drive',
		},
	} as const;

	async function startGoogleOAuth(
		plugin: keyof typeof GOOGLE_PLUGIN_CONFIG,
		res: import('express').Response,
	) {
		try {
			const pluginKeys = (corsair as unknown as Record<string, { keys: { get_integration_credentials: () => Promise<{ client_id?: string; redirect_url?: string; client_secret?: string }>; set_access_token: (t: string) => Promise<void>; set_refresh_token: (t: string) => Promise<void> } }>)[plugin].keys;
			const creds = await pluginKeys.get_integration_credentials();
			if (!creds.client_id || !creds.redirect_url) {
				res.status(400).send(`${plugin} not configured. Run the setup script first.`);
				return;
			}
			const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
			url.searchParams.set('client_id', creds.client_id);
			url.searchParams.set('redirect_uri', creds.redirect_url);
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', GOOGLE_PLUGIN_CONFIG[plugin].scope);
			url.searchParams.set('access_type', 'offline');
			url.searchParams.set('prompt', 'consent');
			url.searchParams.set('state', plugin);
			console.log(`[oauth] Redirecting to Google consent screen for ${plugin}`);
			res.redirect(url.toString());
		} catch (err) {
			console.error('[oauth] Failed to build auth URL:', err);
			res.status(500).send('OAuth setup error — check server logs.');
		}
	}

	app.get('/oauth/googlecalendar', (req, res) => startGoogleOAuth('googlecalendar', res));
	app.get('/oauth/googledrive', (req, res) => startGoogleOAuth('googledrive', res));

	app.get('/oauth/callback', async (req, res) => {
		const { code, error, state } = req.query as { code?: string; error?: string; state?: string };

		if (error || !code) {
			res.status(400).setHeader('Content-Type', 'text/html').send(`
				<!DOCTYPE html><html><head><title>OAuth Error</title></head>
				<body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0a0a0a;color:#ef4444">
					<p>Authorization failed: ${error ?? 'no code returned'}.</p>
				</body></html>`);
			return;
		}

		const plugin = (state && state in GOOGLE_PLUGIN_CONFIG)
			? (state as keyof typeof GOOGLE_PLUGIN_CONFIG)
			: 'googlecalendar';
		const { label } = GOOGLE_PLUGIN_CONFIG[plugin];

		try {
			const pluginKeys = (corsair as unknown as Record<string, { keys: { get_integration_credentials: () => Promise<{ client_id?: string; redirect_url?: string; client_secret?: string }>; set_access_token: (t: string) => Promise<void>; set_refresh_token: (t: string) => Promise<void> } }>)[plugin].keys;
			const creds = await pluginKeys.get_integration_credentials();
			if (!creds.client_id || !creds.client_secret || !creds.redirect_url) {
				res.status(400).send('Missing integration credentials.');
				return;
			}

			// Exchange code for tokens
			const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					code,
					client_id: creds.client_id,
					client_secret: creds.client_secret,
					redirect_uri: creds.redirect_url,
					grant_type: 'authorization_code',
				}),
			});

			if (!tokenRes.ok) {
				const err = await tokenRes.text();
				console.error('[oauth] Token exchange failed:', err);
				res.status(500).send(`Token exchange failed: ${err}`);
				return;
			}

			const tokens = await tokenRes.json() as {
				access_token: string;
				refresh_token?: string;
				expires_in: number;
			};

			await pluginKeys.set_access_token(tokens.access_token);
			if (tokens.refresh_token) {
				await pluginKeys.set_refresh_token(tokens.refresh_token);
			}

			console.log(`[oauth] ${label} tokens stored successfully`);

			res.setHeader('Content-Type', 'text/html').send(`
				<!DOCTYPE html>
				<html>
				<head><title>${label} Connected</title></head>
				<body style="font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0a0a0a;color:#e8e8e8">
					<div style="text-align:center;background:#141414;border:1px solid #2a2a2a;border-radius:12px;padding:40px 48px;max-width:400px">
						<div style="font-size:48px;margin-bottom:16px">✅</div>
						<h1 style="margin:0 0 8px;font-size:20px">${label} connected!</h1>
						<p style="color:#888;margin:0">You can close this tab. Your agent is ready to use ${label}.</p>
					</div>
				</body>
				</html>`);
		} catch (err) {
			console.error('[oauth] Callback error:', err);
			res.status(500).send('OAuth callback error — check server logs.');
		}
	});

	// ── MCP HTTP server (OpenAI / Anthropic agent integration) ───────────────
	const basePermissionUrl =
		process.env.BASE_PERMISSION_URL ??
		process.env.BASE_URL ??
		`http://localhost:${process.env.PORT ?? 3000}`;
	app.use(
		'/mcp',
		createMcpRouter(() =>
			createBaseMcpServer({
				corsair,
				workflows: workflowAdapter,
				cron: cronAdapter,
				permissions: permissionAdapter,
				basePermissionUrl,
			}),
		),
	);

	// ── tRPC router ───────────────────────────────────────────────────────────
	app.use(
		'/trpc',
		createExpressMiddleware({
			router: appRouter,
			createContext: () => ({}),
		}),
	);

	// ── Permission approval endpoints ────────────────────────────────────────

	app.get('/hello', (req, res) => {
		res.setHeader('Content-Type', 'text/html');
		res.send(`
			<!DOCTYPE html>
			<html>
				<head>
					<title>Hello Page</title>
					<style>
						body { font-family: sans-serif; background: #f8f8fa; margin: 32px; }
						.card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px #0001; padding: 2em 3em; max-width: 500px; margin: 0 auto; }
						h1 { margin-top: 0; color: #222; }
						footer { margin-top: 2em; color: #888; font-size: .95em; }
					</style>
				</head>
				<body>
					<div class="card">
						<h1>Hello!</h1>
						<p>This is a sample /hello endpoint for testing.</p>
						<div>hi dev</div>
						<footer>Agent server is running 🎉</footer>
					</div>
				</body>
			</html>
		`);
	});

	app.get('/permissions/:id', async (req, res) => {
		const id = req.params.id!;

		const [perm] = await db
			.select()
			.from(permissions)
			.where(eq(permissions.id, id))
			.limit(1);

		if (!perm) {
			res
				.status(404)
				.setHeader('Content-Type', 'text/html')
				.send(
					`<!DOCTYPE html><html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0a0a0a;color:#ef4444"><p>Permission not found.</p></body></html>`,
				);
			return;
		}

		const permissionLike: PermissionLike = {
			id: perm.id,
			plugin: perm.plugin,
			endpoint: perm.operation ?? perm.endpoint,
			operation: perm.operation,
			description: perm.description,
			status: perm.status as PermissionLike['status'],
			args:
				perm.args && typeof perm.args === 'object'
					? (perm.args as Record<string, unknown>)
					: {},
			createdAt: perm.createdAt,
		};

		const onApproval = () => ({
			method: 'POST' as const,
			url: `/api/permissions/${id}/resolve`,
		});

		const onDenial = () => ({
			method: 'POST' as const,
			url: `/api/permissions/${id}/resolve`,
		});

		const html = corsairPermissions(permissionLike, onApproval, onDenial);

		res.setHeader('Content-Type', 'text/html');
		res.send(html);
	});

	app.get('/api/permissions/:id', async (req, res) => {
		const [perm] = await db
			.select()
			.from(permissions)
			.where(eq(permissions.id, req.params.id!))
			.limit(1);

		if (!perm) return res.status(404).json({ error: 'Permission not found' });
		return res.json(perm);
	});

	app.post('/api/permissions/:id/resolve', async (req, res) => {
		const { action } = req.body as { action: 'approve' | 'decline' };

		if (action !== 'approve' && action !== 'decline') {
			return res
				.status(400)
				.json({ error: 'action must be "approve" or "decline"' });
		}

		const [perm] = await db
			.select()
			.from(permissions)
			.where(eq(permissions.id, req.params.id!))
			.limit(1);

		if (!perm) return res.status(404).json({ error: 'Permission not found' });
		if (perm.status !== 'pending') {
			return res
				.status(400)
				.json({ error: `Permission already ${perm.status}` });
		}

		const newStatus = action === 'approve' ? 'granted' : 'declined';
		await db
			.update(permissions)
			.set({ status: newStatus, updatedAt: new Date() })
			.where(eq(permissions.id, perm.id));

		const answer =
			action === 'approve'
				? 'Permission granted. Proceed with the action.'
				: 'Permission declined. Do not proceed with this action.';

		// Resume the agent via the linked thread message
		if (perm.messageId) {
			const [msg] = await db
				.select()
				.from(threadMessages)
				.where(eq(threadMessages.id, perm.messageId))
				.limit(1);

			console.log(
				`[permissions] Found thread message: ${msg?.id}, pendingToolName=${msg?.pendingToolName}`,
			);

			if (msg?.pendingToolName === 'ask_human') {
				// Determine source from the thread
				const [thread] = await db
					.select({ source: threads.source, jid: threads.jid })
					.from(threads)
					.where(eq(threads.id, msg.threadId))
					.limit(1);

				console.log(
					`[permissions] Thread source=${thread?.source}, jid=${thread?.jid}`,
				);

				if (
					(thread?.source === 'whatsapp' || thread?.source === 'telegram') &&
					thread.jid
				) {
					// For Telegram/WhatsApp, insert a synthetic message and let the
					// poller resume the agent naturally via conversation history.
					if (thread.source === 'whatsapp') {
						await db.insert(whatsappMessages).values({
							jid: thread.jid,
							senderJid: 'system',
							senderName: 'Permission System',
							content: answer,
							sentAt: new Date(),
							isGroup: false,
							isBot: false,
							processed: false,
						});
					} else {
						const chatId = thread.jid.replace(/^tg:/, '');
						await db.insert(telegramMessages).values({
							chatId,
							senderId: 'system',
							senderName: 'Permission System',
							content: answer,
							sentAt: new Date(),
							isGroup: false,
							processed: false,
						});
					}
					console.log(
						`[permissions] Synthetic message inserted for ${thread.source}`,
					);
				} else {
					// Web thread: clear pending state and resume agent directly
					await db
						.update(threadMessages)
						.set({
							pendingMessages: null,
							pendingToolCallId: null,
							pendingToolName: null,
						})
						.where(eq(threadMessages.id, msg.id));

					// Fetch history from DB (includes the ask_human question)
					const historyRows = await db
						.select()
						.from(threadMessages)
						.where(eq(threadMessages.threadId, msg.threadId))
						.orderBy(asc(threadMessages.createdAt))
						.limit(20);

					const history: SimpleMessage[] = historyRows.map((m) => ({
						role: m.role as 'user' | 'assistant',
						text: m.text || '',
					}));

					runAgent(answer, { sessionId: msg.threadId, history })
						.then(async (output) => {
							const text =
								output.type === 'done'
									? (output.messages.at(-1) ?? '')
									: output.type === 'message'
										? output.text
										: output.question;

							await db.insert(threadMessages).values({
								threadId: msg.threadId,
								role: 'assistant',
								text,
							});
							await db
								.update(threads)
								.set({ updatedAt: new Date() })
								.where(eq(threads.id, msg.threadId));
						})
						.catch((err) => {
							console.error('[permissions] Agent resume failed:', err);
						});
				}
			}
		} else if (perm.jid) {
			// Agent paused via ask_human (or sent the URL inline) — resume by
			// inserting a synthetic message into the originating chat so the poller
			// re-runs the agent with the outcome.
			const syntheticContent =
				action === 'approve'
					? `Permission has been granted for: ${perm.description}. You MUST proceed using these exact args (do not re-resolve or change any values, as approval is only valid for these exact args): ${JSON.stringify(perm.args)}`
					: `Permission has been declined for: ${perm.description}. Please inform the user and stop.`;

			if (perm.jid.startsWith('tg:')) {
				const chatId = perm.jid.replace(/^tg:/, '');
				await db.insert(telegramMessages).values({
					chatId,
					senderId: 'system',
					senderName: 'Permission System',
					content: syntheticContent,
					sentAt: new Date(),
					isGroup: false,
					processed: false,
				});
			} else {
				await db.insert(whatsappMessages).values({
					jid: perm.jid,
					senderJid: 'system',
					senderName: 'Permission System',
					content: syntheticContent,
					sentAt: new Date(),
					isGroup: false,
					isBot: false,
					processed: false,
				});
			}
		}

		return res.json({
			success: true,
			status: newStatus,
			message:
				action === 'approve'
					? 'Permission granted — agent will continue.'
					: 'Permission declined — action cancelled.',
		});
	});

	// ── Cron scheduler ────────────────────────────────────────────────────────
	// Wire the escalation callback before loading workflows so failures are handled
	// biome-ignore lint/nursery/noMisusedPromises: ignore for now
	setEscalationCallback(escalateWorkflowFailure);
	await loadAllCronWorkflows();

	// ─────────────────────────────────────────────────────────────────────────
	const PORT = Number(process.env.PORT ?? 3000);
	app.listen(PORT, () => {
		console.log(`[server] Listening on http://localhost:${PORT}`);
	});

	// ── WhatsApp listener ─────────────────────────────────────────────────────
	if (process.env.WHATSAPP_ENABLED === 'true') {
		console.log('[server] Starting WhatsApp listener...');
		startWhatsApp().catch((err) => {
			console.error('[server] WhatsApp startup failed:', err);
		});
	}

	if (process.env.TELEGRAM_ENABLED === 'true') {
		console.log('[server] Starting Telegram listener...');
		startTelegram().catch((err) => {
			console.error('[server] Telegram startup failed:', err);
		});
	}
}

main().catch((e) => {
	console.error('[server] Fatal:', e);
	process.exit(1);
});
