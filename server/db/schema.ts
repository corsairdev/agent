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
	/** JID of the chat that created this workflow — used to send execution notifications */
	notifyJid: text('notify_jid'),
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

// ── Threads and messages ───────────────────────────────────────────────────────

export const threads = pgTable('threads', {
	id: uuid('id').primaryKey().defaultRandom(),
	/** Auto-generated title (first user message, truncated) or null */
	title: text('title'),
	/** Source channel */
	source: text('source', { enum: ['web', 'whatsapp', 'telegram'] })
		.notNull()
		.default('web'),
	/** WhatsApp chat JID — null for web threads */
	jid: text('jid'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const threadMessages = pgTable('thread_messages', {
	id: uuid('id').primaryKey().defaultRandom(),
	threadId: uuid('thread_id')
		.notNull()
		.references(() => threads.id, { onDelete: 'cascade' }),
	role: text('role', { enum: ['user', 'assistant'] }).notNull(),
	/** Main text content */
	text: text('text').notNull().default(''),
	/** Tool calls made during this assistant turn [{toolCallId, toolName, done}] */
	toolCalls: jsonb('tool_calls'),
	/** Full ModelMessage[] history serialised for agent resume (ask_human pause) */
	pendingMessages: jsonb('pending_messages'),
	/** toolCallId of the pausing ask_human call */
	pendingToolCallId: text('pending_tool_call_id'),
	/** Tool name of the pausing call (always 'ask_human') */
	pendingToolName: text('pending_tool_name'),
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

// ── Telegram tables ────────────────────────────────────────────────────────────

export const telegramMessages = pgTable('telegram_messages', {
	id: uuid('id').primaryKey().defaultRandom(),
	/** Numeric Telegram chat ID */
	chatId: text('chat_id').notNull(),
	/** Numeric sender ID */
	senderId: text('sender_id').notNull(),
	/** Display name of the sender */
	senderName: text('sender_name'),
	content: text('content').notNull(),
	/** When Telegram says the message was sent */
	sentAt: timestamp('sent_at').notNull(),
	/** True if this is a group or supergroup chat */
	isGroup: boolean('is_group').notNull().default(false),
	/** False = not yet handled by the agent poller */
	processed: boolean('processed').notNull().default(false),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const telegramChats = pgTable('telegram_chats', {
	chatId: text('chat_id').primaryKey(),
	name: text('name'),
	type: text('type', { enum: ['dm', 'group'] }).notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ── Permission requests (human-in-the-loop approval for protected endpoints) ──

export const permissions = pgTable('permissions', {
	id: uuid('id').primaryKey().defaultRandom(),
	/** Full endpoint path, e.g. "slack.messages.post" */
	endpoint: text('endpoint').notNull(),
	/** Plugin name, e.g. "slack" */
	plugin: text('plugin').notNull(),
	/** Operation within the plugin, e.g. "messages.post" */
	operation: text('operation').notNull(),
	/** The arguments the agent tried to pass — displayed on the approval page */
	args: jsonb('args'),
	/** Human-readable description of what the action will do */
	description: text('description').notNull(),
	status: text('status', {
		enum: ['pending', 'granted', 'declined', 'completed'],
	})
		.notNull()
		.default('pending'),
	/** Links to thread_messages.id — the assistant message that triggered this permission request */
	messageId: uuid('message_id'),
	/** The chat JID (e.g. tg:12345) so the resolve handler knows where to re-trigger the agent */
	jid: text('jid'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
