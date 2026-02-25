import 'dotenv/config';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { processWebhook } from 'corsair';
import { asc, eq } from 'drizzle-orm';
import express from 'express';
import type { SimpleMessage } from './agent';
import { runAgent, WORKFLOW_FAILURE_PROMPT } from './agent';
import { corsair } from './corsair';
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

	app.get('/oauth/google', async (req, res) => {
		try {
			const creds = await corsair.googlecalendar.keys.get_integration_credentials();
			if (!creds.client_id || !creds.redirect_url) {
				res.status(400).send('Google integration not configured. Run the setup script first.');
				return;
			}
			const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
			url.searchParams.set('client_id', creds.client_id);
			url.searchParams.set('redirect_uri', creds.redirect_url);
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar');
			url.searchParams.set('access_type', 'offline');
			url.searchParams.set('prompt', 'consent');
			console.log('[oauth] Redirecting to Google consent screen');
			res.redirect(url.toString());
		} catch (err) {
			console.error('[oauth] Failed to build auth URL:', err);
			res.status(500).send('OAuth setup error — check server logs.');
		}
	});

	app.get('/oauth/callback', async (req, res) => {
		const { code, error } = req.query as { code?: string; error?: string };

		if (error || !code) {
			res.status(400).setHeader('Content-Type', 'text/html').send(`
				<!DOCTYPE html><html><head><title>OAuth Error</title></head>
				<body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0a0a0a;color:#ef4444">
					<p>Authorization failed: ${error ?? 'no code returned'}.</p>
				</body></html>`);
			return;
		}

		try {
			const creds = await corsair.googlecalendar.keys.get_integration_credentials();
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

			await corsair.googlecalendar.keys.set_access_token(tokens.access_token);
			if (tokens.refresh_token) {
				await corsair.googlecalendar.keys.set_refresh_token(tokens.refresh_token);
			}

			console.log('[oauth] Google tokens stored successfully');

			res.setHeader('Content-Type', 'text/html').send(`
				<!DOCTYPE html>
				<html>
				<head><title>Google Connected</title></head>
				<body style="font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0a0a0a;color:#e8e8e8">
					<div style="text-align:center;background:#141414;border:1px solid #2a2a2a;border-radius:12px;padding:40px 48px;max-width:400px">
						<div style="font-size:48px;margin-bottom:16px">✅</div>
						<h1 style="margin:0 0 8px;font-size:20px">Google Calendar connected!</h1>
						<p style="color:#888;margin:0">You can close this tab. Your agent is ready to use Google Calendar.</p>
					</div>
				</body>
				</html>`);
		} catch (err) {
			console.error('[oauth] Callback error:', err);
			res.status(500).send('OAuth callback error — check server logs.');
		}
	});

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

		const FIELD_LABELS: Record<string, Record<string, string>> = {
			'messages.post': {
				channel: 'Channel',
				text: 'Message',
				thread_ts: 'Thread',
				reply_broadcast: 'Also send to channel',
			},
			'emails.send': {
				to: 'To',
				from: 'From',
				subject: 'Subject',
				html: 'Body',
				text: 'Body',
				cc: 'CC',
				bcc: 'BCC',
			},
			'issues.create': {
				title: 'Title',
				description: 'Description',
				teamId: 'Team',
				assigneeId: 'Assignee',
				priority: 'Priority',
				stateId: 'Status',
			},
		};
		const PLUGIN_COLORS: Record<string, string> = {
			slack: '#4a154b',
			linear: '#5e6ad2',
			discord: '#5865f2',
			github: '#333',
			resend: '#000',
			gmail: '#ea4335',
		};

		function esc(s: unknown) {
			return String(s ?? '')
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;');
		}
		function getLabel(op: string, key: string) {
			return FIELD_LABELS[op]?.[key] ?? key;
		}
		function renderArgVal(val: unknown): string {
			if (val === null || val === undefined)
				return `<span style="color:#666">—</span>`;
			if (typeof val === 'boolean') return val ? 'Yes' : 'No';
			if (typeof val === 'string') {
				if (val.length > 120 || val.includes('\n'))
					return `<pre style="margin:0;background:#111;border:1px solid #2a2a2a;border-radius:6px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.5">${esc(val)}</pre>`;
				return esc(val);
			}
			if (Array.isArray(val)) return esc(val.join(', '));
			return `<pre style="margin:0;background:#111;border:1px solid #2a2a2a;border-radius:6px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.4">${esc(JSON.stringify(val, null, 2))}</pre>`;
		}

		const isPending = perm.status === 'pending';
		const statusColor =
			perm.status === 'granted' || perm.status === 'completed'
				? '#22c55e'
				: perm.status === 'declined'
					? '#ef4444'
					: '#f59e0b';
		const badgeBg = PLUGIN_COLORS[perm.plugin] ?? '#141414';
		const args =
			perm.args && typeof perm.args === 'object'
				? (perm.args as Record<string, unknown>)
				: {};
		const argEntries = Object.entries(args);
		const ts = new Date(perm.createdAt).toLocaleString('en-US', {
			dateStyle: 'medium',
			timeStyle: 'short',
		});

		let statusBar = '';
		if (!isPending) {
			const bg =
				perm.status === 'granted' || perm.status === 'completed'
					? '#14532d'
					: '#7f1d1d';
			statusBar = `<div style="padding:10px 14px;border-radius:6px;background:${bg};color:${statusColor};font-size:13px;font-weight:600;margin-bottom:16px;text-align:center">This permission has been ${esc(perm.status)}.</div>`;
		}

		let argsHtml = '';
		if (argEntries.length > 0) {
			const rows = argEntries
				.map(
					([k, v]) =>
						`<div style="margin-bottom:14px"><div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">${esc(getLabel(perm.operation, k))}</div><div style="font-size:14px;color:#e8e8e8">${renderArgVal(v)}</div></div>`,
				)
				.join('');
			argsHtml = `<div style="background:#0a0a0a;border:1px solid #2a2a2a;border-radius:6px;padding:16px;margin-bottom:24px"><div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px;font-weight:600">Request details</div>${rows}</div>`;
		}

		const actions = isPending
			? `<form id="form" style="display:flex;gap:10px;justify-content:flex-end">
					<button type="button" onclick="resolve('decline')" style="cursor:pointer;border:1px solid #2a2a2a;background:#141414;color:#e8e8e8;border-radius:6px;padding:10px 24px;font-size:14px;font-weight:600">Decline</button>
					<button type="button" onclick="resolve('approve')" style="cursor:pointer;border:none;background:#22c55e;color:#fff;border-radius:6px;padding:10px 24px;font-size:14px;font-weight:600">Approve</button>
				</form>
				<div id="msg" style="display:none;text-align:center;margin-top:12px;font-size:13px;color:#666"></div>
				<script>
					function resolve(action) {
						document.querySelectorAll('button').forEach(b => b.disabled = true);
						fetch('/api/permissions/${id}/resolve', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ action }),
						})
						.then(r => r.json())
						.then(d => {
							document.getElementById('form').style.display = 'none';
							const msg = document.getElementById('msg');
							msg.style.display = 'block';
							msg.style.color = action === 'approve' ? '#22c55e' : '#ef4444';
							msg.textContent = d.message || (action === 'approve' ? 'Approved.' : 'Declined.');
						})
						.catch(() => {
							document.getElementById('msg').style.display = 'block';
							document.getElementById('msg').textContent = 'Something went wrong.';
						});
					}
				<\/script>`
			: '';

		res.setHeader('Content-Type', 'text/html');
		res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Permission Request</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0a; color: #e8e8e8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 24px; }
    .card { width: 100%; max-width: 520px; background: #141414; border: 1px solid #2a2a2a; border-radius: 12px; padding: 28px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="font-size:22px">&#x1f512;</span>
      <h1 style="font-size:18px;font-weight:700">Permission Request</h1>
    </div>
    ${statusBar}
    <p style="font-size:15px;line-height:1.6;margin-bottom:20px">${esc(perm.description)}</p>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px">
      <span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;background:${badgeBg};color:#fff;text-transform:capitalize">${esc(perm.plugin)}</span>
      <code style="font-size:12px;color:#666;background:#111;padding:2px 8px;border-radius:6px">${esc(perm.endpoint)}</code>
    </div>
    ${argsHtml}
    <p style="font-size:11px;color:#666;margin-bottom:20px">Requested ${esc(ts)}</p>
    ${actions}
  </div>
</body>
</html>`);
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
