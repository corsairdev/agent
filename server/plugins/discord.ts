import type {
	BindEndpoints,
	CorsairEndpoint,
	CorsairPlugin,
	CorsairPluginContext,
} from 'corsair/core';

// ── Options ───────────────────────────────────────────────────────────────────

type DiscordOptions = {
	key: string;
};

// ── Schema ────────────────────────────────────────────────────────────────────

const DiscordSchema = { version: '1.0.0', entities: {} } as const;

// ── Context ───────────────────────────────────────────────────────────────────

type DiscordContext = CorsairPluginContext<
	typeof DiscordSchema,
	DiscordOptions
>;

// ── Response Types ─────────────────────────────────────────────────────────────

type User = {
	id: string;
	username: string;
	discriminator: string;
	global_name: string | null;
	avatar: string | null;
	bot?: boolean;
};

type GuildMember = {
	user?: User;
	nick: string | null;
	roles: string[];
	joined_at: string;
	premium_since: string | null;
	deaf: boolean;
	mute: boolean;
	flags: number;
	pending?: boolean;
};

type Embed = {
	title?: string;
	description?: string;
	url?: string;
	color?: number;
	fields?: { name: string; value: string; inline?: boolean }[];
	footer?: { text: string; icon_url?: string };
	image?: { url: string };
	thumbnail?: { url: string };
	author?: { name: string; url?: string; icon_url?: string };
	timestamp?: string;
};

type Message = {
	id: string;
	channel_id: string;
	author: User;
	content: string;
	timestamp: string;
	edited_timestamp: string | null;
	tts: boolean;
	mention_everyone: boolean;
	mentions: User[];
	attachments: unknown[];
	embeds: Embed[];
	reactions?: {
		count: number;
		me: boolean;
		emoji: { id: string | null; name: string };
	}[];
	pinned: boolean;
	type: number;
	flags?: number;
	message_reference?: {
		message_id?: string;
		channel_id?: string;
		guild_id?: string;
	};
	referenced_message?: Message | null;
};

type Channel = {
	id: string;
	type: number;
	guild_id?: string;
	name?: string;
	topic?: string | null;
	position?: number;
	parent_id?: string | null;
	last_message_id?: string | null;
};

type Guild = {
	id: string;
	name: string;
	icon: string | null;
	splash: string | null;
	owner_id: string;
	afk_timeout: number;
	verification_level: number;
	default_message_notifications: number;
	explicit_content_filter: number;
	roles: { id: string; name: string; permissions: string; position: number }[];
	features: string[];
	mfa_level: number;
	description: string | null;
	premium_tier: number;
	premium_subscription_count?: number;
	preferred_locale: string;
	approximate_member_count?: number;
	approximate_presence_count?: number;
};

// Partial guild returned by GET /users/@me/guilds
type PartialGuild = {
	id: string;
	name: string;
	icon: string | null;
	owner: boolean;
	permissions: string;
	features: string[];
	approximate_member_count?: number;
	approximate_presence_count?: number;
};

// ── HTTP Client ───────────────────────────────────────────────────────────────

const API_BASE = 'https://discord.com/api/v10';

async function apiRequest<T>(
	path: string,
	apiKey: string,
	options: {
		method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
		body?: Record<string, unknown>;
		query?: Record<string, string | number | boolean | undefined>;
	} = {},
): Promise<T> {
	const { method = 'GET', body, query } = options;
	const url = new URL(`${API_BASE}/${path}`);

	if (query) {
		for (const [k, v] of Object.entries(query)) {
			if (v !== undefined) url.searchParams.set(k, String(v));
		}
	}

	const res = await fetch(url.toString(), {
		method,
		headers: {
			Authorization: `Bot ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: body ? JSON.stringify(body) : undefined,
	});

	if (!res.ok) {
		const errorText = await res.text().catch(() => res.statusText);
		throw new Error(`Discord API error: ${res.status} ${errorText}`);
	}

	// 204 No Content
	if (res.status === 204) return { success: true } as T;

	return res.json() as Promise<T>;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

// Messages

const messagesSend: CorsairEndpoint<
	DiscordContext,
	{ channel_id: string; content?: string; embeds?: Embed[]; tts?: boolean },
	Message
> = async (ctx, input) => {
	const { channel_id, ...body } = input;
	return apiRequest<Message>(`channels/${channel_id}/messages`, ctx.key, {
		method: 'POST',
		body,
	});
};

const messagesReply: CorsairEndpoint<
	DiscordContext,
	{
		channel_id: string;
		message_id: string;
		content?: string;
		embeds?: Embed[];
		fail_if_not_exists?: boolean;
	},
	Message
> = async (ctx, input) => {
	const { channel_id, message_id, fail_if_not_exists = true, ...rest } = input;
	return apiRequest<Message>(`channels/${channel_id}/messages`, ctx.key, {
		method: 'POST',
		body: {
			...rest,
			message_reference: {
				type: 0,
				message_id,
				channel_id,
				fail_if_not_exists,
			},
		},
	});
};

const messagesGet: CorsairEndpoint<
	DiscordContext,
	{ channel_id: string; message_id: string },
	Message
> = async (ctx, input) => {
	return apiRequest<Message>(
		`channels/${input.channel_id}/messages/${input.message_id}`,
		ctx.key,
	);
};

const messagesList: CorsairEndpoint<
	DiscordContext,
	{
		channel_id: string;
		limit?: number;
		before?: string;
		after?: string;
		around?: string;
	},
	Message[]
> = async (ctx, input) => {
	const { channel_id, ...query } = input;
	return apiRequest<Message[]>(`channels/${channel_id}/messages`, ctx.key, {
		query,
	});
};

const messagesEdit: CorsairEndpoint<
	DiscordContext,
	{
		channel_id: string;
		message_id: string;
		content?: string;
		embeds?: Embed[];
	},
	Message
> = async (ctx, input) => {
	const { channel_id, message_id, ...body } = input;
	return apiRequest<Message>(
		`channels/${channel_id}/messages/${message_id}`,
		ctx.key,
		{
			method: 'PATCH',
			body,
		},
	);
};

const messagesDelete: CorsairEndpoint<
	DiscordContext,
	{ channel_id: string; message_id: string },
	{ success: true }
> = async (ctx, input) => {
	return apiRequest<{ success: true }>(
		`channels/${input.channel_id}/messages/${input.message_id}`,
		ctx.key,
		{ method: 'DELETE' },
	);
};

// Threads

const threadsCreate: CorsairEndpoint<
	DiscordContext,
	{
		channel_id: string;
		name: string;
		auto_archive_duration?: number;
		type?: number;
	},
	Channel
> = async (ctx, input) => {
	const { channel_id, ...body } = input;
	return apiRequest<Channel>(`channels/${channel_id}/threads`, ctx.key, {
		method: 'POST',
		body,
	});
};

const threadsCreateFromMessage: CorsairEndpoint<
	DiscordContext,
	{
		channel_id: string;
		message_id: string;
		name: string;
		auto_archive_duration?: number;
	},
	Channel
> = async (ctx, input) => {
	const { channel_id, message_id, ...body } = input;
	return apiRequest<Channel>(
		`channels/${channel_id}/messages/${message_id}/threads`,
		ctx.key,
		{ method: 'POST', body },
	);
};

// Reactions

const reactionsAdd: CorsairEndpoint<
	DiscordContext,
	{ channel_id: string; message_id: string; emoji: string },
	{ success: true }
> = async (ctx, input) => {
	const encodedEmoji = encodeURIComponent(input.emoji);
	return apiRequest<{ success: true }>(
		`channels/${input.channel_id}/messages/${input.message_id}/reactions/${encodedEmoji}/@me`,
		ctx.key,
		{ method: 'PUT' },
	);
};

const reactionsRemove: CorsairEndpoint<
	DiscordContext,
	{ channel_id: string; message_id: string; emoji: string },
	{ success: true }
> = async (ctx, input) => {
	const encodedEmoji = encodeURIComponent(input.emoji);
	return apiRequest<{ success: true }>(
		`channels/${input.channel_id}/messages/${input.message_id}/reactions/${encodedEmoji}/@me`,
		ctx.key,
		{ method: 'DELETE' },
	);
};

const reactionsList: CorsairEndpoint<
	DiscordContext,
	{
		channel_id: string;
		message_id: string;
		emoji: string;
		limit?: number;
		after?: string;
	},
	User[]
> = async (ctx, input) => {
	const { channel_id, message_id, emoji, ...query } = input;
	const encodedEmoji = encodeURIComponent(emoji);
	return apiRequest<User[]>(
		`channels/${channel_id}/messages/${message_id}/reactions/${encodedEmoji}`,
		ctx.key,
		{ query },
	);
};

// Guilds

const guildsList: CorsairEndpoint<
	DiscordContext,
	{ before?: string; after?: string; limit?: number; with_counts?: boolean },
	PartialGuild[]
> = async (ctx, input) => {
	return apiRequest<PartialGuild[]>('users/@me/guilds', ctx.key, {
		query: input,
	});
};

const guildsGet: CorsairEndpoint<
	DiscordContext,
	{ guild_id: string; with_counts?: boolean },
	Guild
> = async (ctx, input) => {
	const { guild_id, ...query } = input;
	return apiRequest<Guild>(`guilds/${guild_id}`, ctx.key, { query });
};

// Channels

const channelsList: CorsairEndpoint<
	DiscordContext,
	{ guild_id: string },
	Channel[]
> = async (ctx, input) => {
	return apiRequest<Channel[]>(`guilds/${input.guild_id}/channels`, ctx.key);
};

// Members

const membersList: CorsairEndpoint<
	DiscordContext,
	{ guild_id: string; limit?: number; after?: string },
	GuildMember[]
> = async (ctx, input) => {
	const { guild_id, ...query } = input;
	return apiRequest<GuildMember[]>(`guilds/${guild_id}/members`, ctx.key, {
		query,
	});
};

const membersGet: CorsairEndpoint<
	DiscordContext,
	{ guild_id: string; user_id: string },
	GuildMember
> = async (ctx, input) => {
	return apiRequest<GuildMember>(
		`guilds/${input.guild_id}/members/${input.user_id}`,
		ctx.key,
	);
};

// ── Endpoint Tree ─────────────────────────────────────────────────────────────

const endpoints = {
	messages: {
		send: messagesSend,
		reply: messagesReply,
		get: messagesGet,
		list: messagesList,
		edit: messagesEdit,
		delete: messagesDelete,
	},
	threads: {
		create: threadsCreate,
		createFromMessage: threadsCreateFromMessage,
	},
	reactions: {
		add: reactionsAdd,
		remove: reactionsRemove,
		list: reactionsList,
	},
	guilds: {
		list: guildsList,
		get: guildsGet,
	},
	channels: {
		list: channelsList,
	},
	members: {
		list: membersList,
		get: membersGet,
	},
} as const;

const webhooks = {} as const;

const defaultAuthType = 'api_key' as const;

export type BoundEndpoints = BindEndpoints<typeof endpoints>;

export type DiscordPlugin<PluginOptions extends DiscordOptions> = CorsairPlugin<
	'discord',
	typeof DiscordSchema,
	typeof endpoints,
	typeof webhooks,
	PluginOptions,
	typeof defaultAuthType
>;

// ── Plugin ────────────────────────────────────────────────────────────────────

export function discord<const PluginOptions extends DiscordOptions>(
	options: DiscordOptions & PluginOptions = {} as DiscordOptions &
		PluginOptions,
): DiscordPlugin<PluginOptions> {
	return {
		id: 'discord',
		schema: DiscordSchema,
		options,
		endpoints,
		keyBuilder: async (_ctx, source) => {
			if (source === 'endpoint') return options.key;
			return '';
		},
	};
}
