import type {
	CronAdapter,
	PermissionAdapter,
	WorkflowAdapter,
	WorkflowListItem,
	WorkflowStored,
	WorkflowStoreInput,
	WorkflowUpdateFields,
} from '@corsair/mcp';
import { db, permissions } from './db';
import {
	archiveWorkflow,
	listWorkflows,
	storeWorkflow,
	updateWorkflowRecord,
} from './executor';
import {
	registerCronWorkflow,
	unregisterCronWorkflow,
} from './workflow-scheduler';

function toStored(
	row: {
		id: string;
		name: string;
		triggerType: 'manual' | 'cron' | 'webhook';
		status: string;
		code?: string;
		triggerConfig?: unknown;
	},
): WorkflowStored {
	const triggerConfig =
		row.triggerConfig != null &&
		typeof row.triggerConfig === 'object' &&
		!Array.isArray(row.triggerConfig)
			? (row.triggerConfig as Record<string, unknown>)
			: undefined;
	return {
		id: row.id,
		name: row.name,
		triggerType: row.triggerType,
		status: row.status,
		code: row.code,
		triggerConfig,
	};
}

export const workflowAdapter: WorkflowAdapter = {
	async listWorkflows(triggerType) {
		const rows = await listWorkflows(triggerType);
		return rows as WorkflowListItem[];
	},
	async storeWorkflow(input: WorkflowStoreInput) {
		const row = await storeWorkflow(input);
		return row ? toStored(row) : null;
	},
	async updateWorkflowRecord(nameOrId, updates: WorkflowUpdateFields) {
		const row = await updateWorkflowRecord(nameOrId, updates);
		return row ? toStored(row) : null;
	},
	async archiveWorkflow(nameOrId) {
		const row = await archiveWorkflow(nameOrId);
		return row ? toStored(row) : null;
	},
};

export const cronAdapter: CronAdapter = {
	registerCronWorkflow(dbId, name, code, schedule, notifyJid) {
		return registerCronWorkflow(dbId, name, code, schedule, notifyJid);
	},
	unregisterCronWorkflow(dbId) {
		unregisterCronWorkflow(dbId);
	},
};

export const permissionAdapter: PermissionAdapter = {
	async createPermissionRequest({ endpoint, args, description, jid }) {
		const [plugin, ...rest] = endpoint.split('.');
		const operation = rest.join('.');
		const [perm] = await db
			.insert(permissions)
			.values({
				endpoint,
				plugin: plugin!,
				operation,
				args,
				description,
				status: 'pending',
				jid: jid ?? null,
			})
			.returning({ id: permissions.id });
		const baseUrl = process.env.BASE_PERMISSION_URL ?? process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
		const approvalUrl = `${baseUrl}/permissions/${perm!.id}`;
		return { permissionId: perm!.id, approvalUrl };
	},
};
