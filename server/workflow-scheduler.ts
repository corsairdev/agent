import { eq } from 'drizzle-orm';
import cron from 'node-cron';
import { db, workflows } from './db';
import { createExecution, executeWorkflow, updateExecution } from './executor';
import { notifyJid as notify } from './notifier';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type EscalateFn = (params: {
	workflowId: string;
	workflowName: string;
	code: string;
	triggerType: 'cron';
	error: string;
}) => void;

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

/** In-memory registry: DB workflow UUID → running cron task */
const jobs = new Map<string, { stop: () => void; notifyJid?: string }>();

/** Injected by index.ts to avoid a circular dep */
let escalate: EscalateFn = () => {};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function setEscalationCallback(fn: EscalateFn): void {
	escalate = fn;
}

/**
 * Register (or re-register) a cron workflow.
 * Returns false if the cron expression is invalid.
 */
export function registerCronWorkflow(
	dbId: string,
	name: string,
	code: string,
	schedule: string,
	notifyJid?: string,
): boolean {
	if (!cron.validate(schedule)) {
		console.error(
			`[scheduler] Invalid cron expression "${schedule}" for workflow "${name}"`,
		);
		return false;
	}

	// Cancel existing task for this workflow if one is running
	jobs.get(dbId)?.stop?.();

	const task = cron.schedule(schedule, () => {
		runWorkflow(dbId, name, code, notifyJid).catch((err) => {
			console.error(`[scheduler] Unhandled error in workflow "${name}":`, err);
		});
	});

	jobs.set(dbId, { stop: () => task.stop(), notifyJid });
	console.log(`[scheduler] Registered cron workflow "${name}" → ${schedule}`);
	return true;
}

/** Stop and remove a cron workflow. */
export function unregisterCronWorkflow(dbId: string): void {
	const job = jobs.get(dbId);
	if (job) {
		job.stop();
		jobs.delete(dbId);
		console.log(`[scheduler] Unregistered workflow ${dbId}`);
	}
}

/** Load all active cron workflows from the DB and schedule them. Called on server start. */
export async function loadAllCronWorkflows(): Promise<void> {
	const rows = await db
		.select({
			id: workflows.id,
			name: workflows.name,
			code: workflows.code,
			triggerConfig: workflows.triggerConfig,
			status: workflows.status,
			notifyJid: workflows.notifyJid,
		})
		.from(workflows)
		.where(eq(workflows.triggerType, 'cron'));

	let registered = 0;
	for (const w of rows) {
		if (w.status !== 'active') continue;
		const config = w.triggerConfig as { cron?: string };
		if (
			config.cron &&
			registerCronWorkflow(
				w.id,
				w.name,
				w.code,
				config.cron,
				w.notifyJid ?? undefined,
			)
		) {
			registered++;
		}
	}

	console.log(
		`[scheduler] Loaded ${registered} of ${rows.length} cron workflow(s)`,
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal execution
// ─────────────────────────────────────────────────────────────────────────────

async function runWorkflow(
	dbId: string,
	name: string,
	code: string,
	notifyJidVal?: string,
): Promise<void> {
	console.log(`[cron] Executing workflow: ${name}`);
	const execution = await createExecution(dbId, 'cron', 'running');
	if (!execution) return;

	try {
		const result = await executeWorkflow(name, code);

		await db
			.update(workflows)
			.set({ lastRunAt: new Date() })
			.where(eq(workflows.id, dbId));

		if (result.success) {
			await updateExecution(execution.id, 'success', { output: result.output });
			console.log(`[cron] Workflow "${name}" succeeded`);
			if (notifyJidVal) {
				await notify(notifyJidVal, `Scheduled task ran: "${name}".`).catch(
					() => {},
				);
			}
		} else {
			await updateExecution(execution.id, 'failed', undefined, result.error);
			console.error(`[cron] Workflow "${name}" failed:`, result.error);
			escalate({
				workflowId: name,
				workflowName: name,
				code,
				triggerType: 'cron',
				error: result.error ?? 'Unknown error',
			});
		}
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		await updateExecution(execution.id, 'failed', undefined, error);
		await db
			.update(workflows)
			.set({ lastRunAt: new Date() })
			.where(eq(workflows.id, dbId));
		console.error(`[cron] Workflow "${name}" threw:`, error);
		escalate({
			workflowId: name,
			workflowName: name,
			code,
			triggerType: 'cron',
			error,
		});
	}
}
