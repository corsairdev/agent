import type { BaseCodeExample } from './types';

export const discordExamples: BaseCodeExample[] = [
	{
		description:
			'Send a message to a Discord channel by channel ID. Use this to post announcements, notifications, or any text to a channel. You need the channel ID, which you can get from Discord developer mode or by listing guild channels.',
		code: `async function main() {
  const channelId = '1234567890123456789'; // Replace with the target channel ID

  const message = await corsair.discord.api.messages.send({
    channel_id: channelId,
    content: 'Hello from the agent!',
  });

  console.log('Message sent:', message.id, message.content);
}
main().catch(console.error);`,
	},
	{
		description:
			'Reply to a specific Discord message in a channel. Fetches recent messages to find the one to reply to, then sends a reply that references the original message so Discord shows it as a thread reply.',
		code: `async function main() {
  const channelId = '1234567890123456789'; // Replace with the channel ID
  const targetMessageId = '9876543210987654321'; // Replace with the message ID to reply to

  const reply = await corsair.discord.api.messages.reply({
    channel_id: channelId,
    message_id: targetMessageId,
    content: 'Thanks for your message! I will look into it.',
  });

  console.log('Reply sent:', reply.id);
}
main().catch(console.error);`,
	},
	{
		description:
			'Add a reaction emoji to a Discord message. Pass a Unicode emoji (e.g. "👍") or a custom emoji in "name:id" format. Useful for acknowledging messages or running polls.',
		code: `async function main() {
  const channelId = '1234567890123456789';
  const messageId = '9876543210987654321';

  await corsair.discord.api.reactions.add({
    channel_id: channelId,
    message_id: messageId,
    emoji: '👍',
  });

  console.log('Reaction added successfully');
}
main().catch(console.error);`,
	},
	{
		description:
			'List recent messages in a Discord channel. Returns the last N messages (up to 100). Use this to read conversation history, find a specific message, or audit channel activity.',
		code: `async function main() {
  const channelId = '1234567890123456789'; // Replace with the channel ID

  const messages = await corsair.discord.api.messages.list({
    channel_id: channelId,
    limit: 20,
  });

  for (const msg of messages) {
    console.log(\`[\${msg.timestamp}] \${msg.author.username}: \${msg.content}\`);
  }

  console.log(\`Fetched \${messages.length} messages\`);
}
main().catch(console.error);`,
	},
	{
		description:
			'List all channels in a Discord guild (server) to find channel IDs by name. Returns text channels, voice channels, categories, threads, and forum channels with their types and positions.',
		code: `async function main() {
  const guildId = '1111111111111111111'; // Replace with your server/guild ID

  const channels = await corsair.discord.api.channels.list({ guild_id: guildId });

  // Type 0 = text channel, 5 = announcement, 15 = forum
  const textChannels = channels.filter((c) => c.type === 0 || c.type === 5);

  console.log('Text channels:', textChannels.map((c) => ({ id: c.id, name: c.name })));
}
main().catch(console.error);`,
	},
	{
		description:
			'Create a new thread in a Discord channel, either as a standalone thread or branching from an existing message. Threads keep discussions organized without cluttering the main channel.',
		code: `async function main() {
  const channelId = '1234567890123456789'; // Parent channel ID

  // Option A: standalone thread (no source message)
  const thread = await corsair.discord.api.threads.create({
    channel_id: channelId,
    name: 'Discussion: Q3 roadmap',
    auto_archive_duration: 1440, // archive after 24 hours of inactivity
  });

  // Post the opening message into the thread
  const message = await corsair.discord.api.messages.send({
    channel_id: thread.id,
    content: 'Let\'s discuss the Q3 roadmap here.',
  });

  console.log('Thread created:', thread.id, '— first message:', message.id);
}
main().catch(console.error);`,
	},
	{
		description:
			"List all Discord guilds (servers) the bot belongs to. Returns each guild's ID, name, icon, and the bot's permissions within it. Use this to discover what servers the bot has access to before querying guild-specific data.",
		code: `async function main() {
  const guilds = await corsair.discord.api.guilds.list({ with_counts: true });

  console.log('Bot is in these guilds:', guilds.map((g) => ({
    id: g.id,
    name: g.name,
    members: g.approximate_member_count,
  })));
}
main().catch(console.error);`,
	},
	{
		description:
			'Get detailed information about a specific Discord guild (server) by its ID. Returns the full guild object including roles, features, verification level, member count, and boost tier.',
		code: `async function main() {
  const guildId = '1111111111111111111'; // Replace with your guild ID

  const guild = await corsair.discord.api.guilds.get({
    guild_id: guildId,
    with_counts: true,
  });

  console.log('Guild info:', {
    name: guild.name,
    owner: guild.owner_id,
    members: guild.approximate_member_count,
    boostTier: guild.premium_tier,
    boosts: guild.premium_subscription_count,
    roles: guild.roles.map((r) => r.name),
  });
}
main().catch(console.error);`,
	},
	{
		description:
			'List members of a Discord guild (server) to find users by their username or user ID. Requires the GUILD_MEMBERS privileged intent to be enabled in the Discord developer portal.',
		code: `async function main() {
  const guildId = '1111111111111111111'; // Replace with your guild ID

  const members = await corsair.discord.api.members.list({
    guild_id: guildId,
    limit: 100,
  });

  const users = members.map((m) => ({
    id: m.user?.id,
    username: m.user?.username,
    nickname: m.nick,
    roles: m.roles,
    joinedAt: m.joined_at,
  }));

  console.log('Guild members:', users);
}
main().catch(console.error);`,
	},
];
