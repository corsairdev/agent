import 'dotenv/config';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import type { ModelMessage, ToolModelMessage } from 'ai';
import { processWebhook } from 'corsair';
import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import express from 'express';
import cron from 'node-cron';
import type { AgentOutput } from './agent';
import { runAgent } from './agent';
import { corsair } from './corsair';
import { db, pendingSessions, workflows } from './db';
import {
	createExecution,
	executeWorkflow,
	getWebhookWorkflows,
	getWorkflowsToRun,
	updateExecution,
	updateWorkflowNextRun,
} from './executor';
import { appRouter } from './trpc/router';
import { startWhatsApp } from './whatsapp/index';

// ─────────────────────────────────────────────────────────────────────────────
// Agent output handler + resume helper
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

async function handleAgentOutput(output: AgentOutput, res: Response) {
	if (output.type === 'needs_input') {
		const [session] = await db
			.insert(pendingSessions)
			.values({
				messages: output.pendingMessages,
				toolCallId: output.toolCallId,
				toolName: output.toolName,
				agentType: 'main',
				plugin: null,
			})
			.returning({ id: pendingSessions.id });

		return res.json({
			type: 'needs_input',
			question: output.question,
			sessionId: session!.id,
		});
	}

	if (output.type === 'message') {
		return res.json({ type: 'message', text: output.text });
	}

	if (output.type === 'script') {
		if (output.error) {
			return res
				.status(500)
				.json({ type: 'script', success: false, error: output.error });
		}
		return res.json({
			type: 'script',
			success: true,
			output: output.output ?? '',
			message: output.message,
		});
	}

	// workflow — agent already stored it via manage_workflows create
	let fallbackMessage: string;
	if (output.webhookTrigger) {
		fallbackMessage = `Webhook workflow "${output.workflowId}" registered — fires on ${output.webhookTrigger.plugin}.${output.webhookTrigger.action}`;
	} else if (output.cronSchedule) {
		fallbackMessage = `Workflow scheduled with cron: ${output.cronSchedule}`;
	} else {
		fallbackMessage = 'Workflow stored (manual trigger)';
	}

	return res.json({
		type: 'workflow',
		workflowId: output.workflowId,
		cronSchedule: output.cronSchedule,
		webhookTrigger: output.webhookTrigger,
		message: output.message ?? fallbackMessage,
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
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			await updateExecution(execution.id, 'failed', undefined, errorMessage);
			console.error(
				`[webhook] Error executing workflow ${workflow.workflowId}:`,
				error,
			);
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// App bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	const app = express();

	app.use(express.json());

	// ── CORS (for UI on port 3000) ──────────────────────────────────────────
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

	// ── Agent trigger endpoint ──────────────────────────────────────────────
	app.post('/trigger', async (req, res) => {
		console.log('[server] /trigger endpoint called');

		try {
			const { prompt } = req.body;

			if (!prompt || typeof prompt !== 'string') {
				return res.status(400).json({ error: 'Missing or invalid prompt' });
			}

			console.log(`[server] Received prompt: ${prompt.substring(0, 80)}`);

			const output = await runAgent([{ role: 'user', content: prompt }]);
			return handleAgentOutput(output, res);
		} catch (error) {
			console.error('[server] Error processing request:', error);
			return res.status(500).json({
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	});

	// ── Resume endpoint (human answered the agent's question) ──────────────
	app.post('/trigger/resume', async (req, res) => {
		console.log('[server] /trigger/resume endpoint called');

		try {
			const { sessionId, answer } = req.body;

			if (!sessionId || typeof sessionId !== 'string') {
				return res.status(400).json({ error: 'Missing or invalid sessionId' });
			}
			if (!answer || typeof answer !== 'string') {
				return res.status(400).json({ error: 'Missing or invalid answer' });
			}

			const [session] = await db
				.select()
				.from(pendingSessions)
				.where(eq(pendingSessions.id, sessionId))
				.limit(1);

			if (!session) {
				return res.status(404).json({ error: 'Session not found' });
			}

			console.log(
				`[server] Resuming session ${sessionId} with answer: "${answer.substring(0, 80)}"`,
			);

			const resumeMessages = buildResumeMessages(
				session.messages as ModelMessage[],
				session.toolCallId,
				session.toolName,
				answer,
			);

			// Clean up before calling the agent so a crash doesn't leave a stale session
			await db.delete(pendingSessions).where(eq(pendingSessions.id, sessionId));

			const output = await runAgent(resumeMessages);
			return handleAgentOutput(output, res);
		} catch (error) {
			console.error('[server] Error resuming session:', error);
			return res.status(500).json({
				error: error instanceof Error ? error.message : 'Unknown error',
			});
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

	// ── Cron scheduler (runs every minute) ────────────────────────────────────
	cron.schedule('* * * * *', async () => {
		try {
			const workflowsToRun = await getWorkflowsToRun();

			for (const workflow of workflowsToRun) {
				console.log(`[cron] Executing workflow: ${workflow.workflowId}`);

				// Create execution record
				const execution = await createExecution(workflow.id, 'cron', 'running');

				if (!execution) continue;

				try {
					// Execute the workflow
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
					}

					// Update next run time
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
		console.log(
			`[server] Trigger agent with: curl -X POST http://localhost:${PORT}/trigger -H "Content-Type: application/json" -d '{"prompt":"your prompt here"}'`,
		);
	});

	// ── WhatsApp listener ─────────────────────────────────────────────────────
	// Set WHATSAPP_ENABLED=true in .env to activate.
	// On first run a QR code is printed to the terminal — scan it with WhatsApp.
	if (process.env.WHATSAPP_ENABLED === 'true') {
		console.log('[server] Starting WhatsApp listener...');
		startWhatsApp().catch((err) => {
			console.error('[server] WhatsApp startup failed:', err);
		});
	}
}

main().catch((e) => {
	console.error('[server] Fatal:', e);
	process.exit(1);
});
