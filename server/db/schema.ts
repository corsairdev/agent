import {
	boolean,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core';

// ── Corsair base tables ───────────────────────────────────────────────────────

export const corsairIntegrations = pgTable('corsair_integrations', {
	id: text('id').primaryKey(),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	name: text('name').notNull(),
	config: jsonb('config'),
	dek: text('dek'),
});

export const corsairAccounts = pgTable('corsair_accounts', {
	id: text('id').primaryKey(),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	tenantId: text('tenant_id').notNull(),
	integrationId: text('integration_id')
		.notNull()
		.references(() => corsairIntegrations.id),
	config: jsonb('config'),
	dek: text('dek'),
});

export const corsairEntities = pgTable('corsair_entities', {
	id: text('id').primaryKey(),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	accountId: text('account_id')
		.notNull()
		.references(() => corsairAccounts.id),
	entityId: text('entity_id').notNull(),
	entityType: text('entity_type').notNull(),
	version: text('version').notNull(),
	data: jsonb('data'),
});

export const corsairEvents = pgTable('corsair_events', {
	id: text('id').primaryKey(),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	accountId: text('account_id')
		.notNull()
		.references(() => corsairAccounts.id),
	eventType: text('event_type').notNull(),
	payload: jsonb('payload'),
	status: text('status'),
});

// ── Agent tables ────────────────────────────────────────────────────────────
export const workflows = pgTable('workflows', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	description: text('description'),
	code: text('code').notNull(),
	triggerType: text('trigger_type', {
		enum: ['manual', 'cron', 'webhook'],
	}).notNull(),
	triggerConfig: jsonb('trigger_config').notNull().default({}),
	nextRunAt: timestamp('next_run_at'),
	lastRunAt: timestamp('last_run_at'),
	status: text('status', { enum: ['active', 'paused', 'archived'] })
		.notNull()
		.default('active'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const workflowExecutions = pgTable('workflow_executions', {
	id: uuid('id').primaryKey().defaultRandom(),
	workflowId: uuid('workflow_id')
		.notNull()
		.references(() => workflows.id, { onDelete: 'cascade' }),
	status: text('status', {
		enum: ['running', 'success', 'failed', 'cancelled'],
	})
		.notNull()
		.default('running'),
	triggeredBy: text('triggered_by', {
		enum: ['cron', 'webhook', 'manual'],
	}).notNull(),
	triggerPayload: jsonb('trigger_payload'),
	logs: text('logs'),
	result: jsonb('result'),
	error: text('error'),
	startedAt: timestamp('started_at').notNull().defaultNow(),
	finishedAt: timestamp('finished_at'),
});

// ── Human-in-the-loop pending sessions ────────────────────────────────────────
export const pendingSessions = pgTable('pending_sessions', {
	id: uuid('id').primaryKey().defaultRandom(),
	/** Full CoreMessage[] conversation history serialised as JSON */
	messages: jsonb('messages').notNull(),
	/** The toolCallId of the pausing tool call, needed to inject the human answer */
	toolCallId: text('tool_call_id').notNull(),
	/** The name of the pausing tool (e.g. 'ask_human'), needed for ToolResultPart */
	toolName: text('tool_name').notNull(),
	/** Which agent owns this session — used by the supervisor to route resumes */
	agentType: text('agent_type').notNull().default('main'),
	/** For setup sessions: the plugin being configured (e.g. 'googlecalendar') */
	plugin: text('plugin'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const memoryHistory = pgTable('memory_history', {
	id: uuid('id').primaryKey().defaultRandom(),
	memoryId: uuid('memory_id').notNull(),
	previousValue: text('previous_value'),
	newValue: text('new_value'),
	action: text('action', { enum: ['add', 'update', 'delete'] }).notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
	isDeleted: integer('is_deleted').default(0),
});

// ── WhatsApp tables ────────────────────────────────────────────────────────────

export const whatsappMessages = pgTable('whatsapp_messages', {
	id: uuid('id').primaryKey().defaultRandom(),
	/** The chat JID — group JID for groups, sender JID for DMs */
	jid: text('jid').notNull(),
	/** The actual sender's JID (in groups, differs from chat jid) */
	senderJid: text('sender_jid').notNull(),
	/** Display name pushed by the sender */
	senderName: text('sender_name'),
	content: text('content').notNull(),
	/** When WhatsApp says the message was sent */
	sentAt: timestamp('sent_at').notNull(),
	/** True if this is a group chat */
	isGroup: boolean('is_group').notNull().default(false),
	/** True if sent by the bot itself */
	isBot: boolean('is_bot').notNull().default(false),
	/** False = not yet handled by the agent poller */
	processed: boolean('processed').notNull().default(false),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const whatsappChats = pgTable('whatsapp_chats', {
	jid: text('jid').primaryKey(),
	name: text('name'),
	type: text('type', { enum: ['dm', 'group'] }).notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** One pending agent session per chat JID (for multi-turn ask_human flows) */
export const whatsappSessions = pgTable('whatsapp_sessions', {
	jid: text('jid').primaryKey(),
	/** Full ModelMessage[] conversation history — used to resume the agent */
	messages: jsonb('messages').notNull(),
	/** The toolCallId of the pausing ask_human call */
	toolCallId: text('tool_call_id').notNull(),
	/** Tool name (always 'ask_human') */
	toolName: text('tool_name').notNull(),
	/** The question the agent asked — also sent to the user via WhatsApp */
	question: text('question').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ── Code examples for agent ────────────────────────────────────────────────────
export const codeExamples = pgTable('code_examples', {
	id: uuid('id').primaryKey().defaultRandom(),
	vector: jsonb('vector').notNull(), // Embedding vector as JSON array
	description: text('description').notNull(), // Raw text description
	code: text('code').notNull(), // TypeScript code example
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
