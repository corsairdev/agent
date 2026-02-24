import 'dotenv/config';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import type { ModelMessage, ToolModelMessage } from 'ai';
import { processWebhook } from 'corsair';
import { eq } from 'drizzle-orm';
import express from 'express';
import cron from 'node-cron';
import { runAgent, WORKFLOW_FAILURE_PROMPT } from './agent';
import { corsair } from './corsair';
import {
	db,
	permissions,
	telegramMessages,
	threadMessages,
	threads,
	whatsappMessages,
	workflows,
} from './db';
import {
	createExecution,
	executeWorkflow,
	getWebhookWorkflows,
	getWorkflowsToRun,
	updateExecution,
	updateWorkflowNextRun,
} from './executor';
import { appRouter } from './trpc/router';
import { startTelegram } from './telegram/index';
import { startWhatsApp } from './whatsapp/index';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildResumeMessages(
	storedMessages: ModelMessage[],
	toolCallId: string,
	toolName: string,
	answer: string,
) {
	return [
		...storedMessages,
		{
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId,
					toolName,
					output: { type: 'text', value: answer },
				},
			],
		} satisfies ToolModelMessage,
	];
}

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

	runAgent([{ role: 'user', content: prompt }], {
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

			if (
				msg?.pendingMessages &&
				msg.pendingToolCallId &&
				msg.pendingToolName
			) {
				// Determine source from the thread
				const [thread] = await db
					.select({ source: threads.source, jid: threads.jid })
					.from(threads)
					.where(eq(threads.id, msg.threadId))
					.limit(1);

				if (
					(thread?.source === 'whatsapp' || thread?.source === 'telegram') &&
					thread.jid
				) {
					// For messaging sources, insert a synthetic message so the poller
					// picks it up. Do NOT clear pending state here — the poller will find
					// the pending assistant and build the proper resume context itself.
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

					const resumeMessages = buildResumeMessages(
						msg.pendingMessages as ModelMessage[],
						msg.pendingToolCallId,
						msg.pendingToolName,
						answer,
					);

					runAgent(resumeMessages)
						.then(async (output) => {
							let text = '';
							if (output.type === 'message') text = output.text;
							else if (output.type === 'script')
								text = output.message || output.output || '';
							else if (output.type === 'workflow')
								text =
									output.message ||
									`Workflow ${output.workflowId ?? ''} updated`;
							else if (output.type === 'needs_input') text = output.question;

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

	// ── Cron scheduler (runs every minute) ────────────────────────────────────
	cron.schedule('* * * * *', async () => {
		try {
			const workflowsToRun = await getWorkflowsToRun();

			for (const workflow of workflowsToRun) {
				console.log(`[cron] Executing workflow: ${workflow.workflowId}`);

				const execution = await createExecution(workflow.id, 'cron', 'running');

				if (!execution) continue;

				try {
					const result = await executeWorkflow(workflow.name, workflow.code);

					if (result.success) {
						await updateExecution(execution.id, 'success', {
							output: result.output,
						});
						console.log(
							`[cron] Workflow ${workflow.workflowId} executed successfully`,
						);
					} else {
						await updateExecution(
							execution.id,
							'failed',
							undefined,
							result.error,
						);
						console.error(
							`[cron] Workflow ${workflow.workflowId} failed:`,
							result.error,
						);
						escalateWorkflowFailure({
							workflowId: workflow.workflowId,
							workflowName: workflow.name,
							code: workflow.code,
							triggerType: 'cron',
							error: result.error ?? 'Unknown error',
						});
					}

					const workflowRecord = await db
						.select()
						.from(workflows)
						.where(eq(workflows.id, workflow.id))
						.limit(1);

					if (
						workflowRecord[0]?.triggerConfig &&
						typeof workflowRecord[0].triggerConfig === 'object'
					) {
						const triggerConfig = workflowRecord[0].triggerConfig as {
							cron?: string;
						};
						if (triggerConfig.cron) {
							await updateWorkflowNextRun(workflow.id, triggerConfig.cron);
						}
					}
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					await updateExecution(
						execution.id,
						'failed',
						undefined,
						errorMessage,
					);
					console.error(
						`[cron] Error executing workflow ${workflow.workflowId}:`,
						error,
					);
					escalateWorkflowFailure({
						workflowId: workflow.workflowId,
						workflowName: workflow.name,
						code: workflow.code,
						triggerType: 'cron',
						error: errorMessage,
					});
				}
			}
		} catch (error) {
			console.error('[cron] Error in cron scheduler:', error);
		}
	});

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
