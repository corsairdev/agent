import type { BaseCodeExample } from './types';

export const slackExamples: BaseCodeExample[] = [
	{
		description:
			'List all Slack channels in the workspace to discover available channels and inspect their names and IDs. Use this before posting a message or reading history so you know what channels exist.',
		code: `async function main() {
  const response = await corsair.slack.api.channels.list({});

  const channels = response.channels?.map((channel) => ({
    id: channel.id,
    name: channel.name,
    isPrivate: channel.is_private,
    memberCount: channel.num_members,
  }));

  console.log('Available Slack channels:', channels);
}
main().catch(console.error);`,
	},
	{
		description:
			'Post a message to a Slack channel by channel name. First lists all channels to look up the channel ID, logs available channels if the target channel is not found, and asks the user to confirm before proceeding.',
		code: `async function main() {
  const channelName = 'engineering'; // Do not assume the channel name — ask the user if unsure

  const response = await corsair.slack.api.channels.list({});

  const channel = response.channels?.find((c) => c.name === channelName);

  if (!channel) {
    const available = response.channels?.map((c) => c.name);
    console.log(
      \`Channel "\${channelName}" not found. Available channels:\`,
      available,
    );
    return;
  }

  const message = await corsair.slack.api.messages.post({
    channel: channel.id,
    text: 'Hello from the agent!',
  });

  console.log('Message posted:', message);
}
main().catch(console.error);`,
	},
	{
		description:
			'Read the recent message history of a Slack channel. Fetches the last N messages from a channel by looking up the channel ID first, then logging message content, authors, and timestamps.',
		code: `async function main() {
  const channelName = 'general'; // Replace with the actual channel name

  const channelsResponse = await corsair.slack.api.channels.list({});
  const channel = channelsResponse.channels?.find((c) => c.name === channelName);

  if (!channel?.id) {
    const available = channelsResponse.channels?.map((c) => c.name);
    console.log(
      \`Channel "\${channelName}" not found. Available channels:\`,
      available,
    );
    return;
  }

  const history = await corsair.slack.api.channels.getHistory({
    channel: channel.id,
    limit: 20,
  });

  const messages = history.messages?.map((msg) => ({
    user: msg.user,
    text: msg.text,
    timestamp: msg.ts,
  }));

  console.log(\`Recent messages in #\${channelName}:\`, messages);
}
main().catch(console.error);`,
	},
	{
		description:
			'Search Slack messages across all channels by keyword or phrase. Returns matching messages with the channel, user, and text. Use this to find conversations or threads about a specific topic.',
		code: `async function main() {
  const query = 'deployment failed'; // Replace with the search term

  const results = await corsair.slack.api.messages.search({
    query,
    count: 10,
  });

  const matches = results.messages?.matches?.map((match) => ({
    channel: match.channel?.name,
    user: match.username,
    text: match.text,
    timestamp: match.ts,
    permalink: match.permalink,
  }));

  console.log(\`Search results for "\${query}":\`, matches);

  if (!matches || matches.length === 0) {
    console.log('No messages found matching the query.');
  }
}
main().catch(console.error);`,
	},
	{
		description:
			'List all users in a Slack workspace to find a user by name or email. Logs user IDs, display names, and email addresses. Use this before sending a direct message or when you need to identify a user.',
		code: `async function main() {
  const response = await corsair.slack.api.users.list({});

  const users = response.members
    ?.filter((member) => !member.is_bot && !member.deleted)
    .map((member) => ({
      id: member.id,
      name: member.name,
      displayName: member.profile?.display_name,
      email: member.profile?.email,
      realName: member.profile?.real_name,
    }));

  console.log('Slack workspace users:', users);

  // Example: find a specific user by email
  const targetEmail = 'jane@example.com';
  const found = users?.find((u) => u.email === targetEmail);

  if (!found) {
    console.log(
      \`User with email "\${targetEmail}" not found. All users:\`,
      users?.map((u) => u.email),
    );
    return;
  }

  console.log('Found user:', found);
}
main().catch(console.error);`,
	},
	{
		description:
			'Add an emoji reaction to a specific Slack message in a channel. Looks up the channel by name, then adds a reaction using the message timestamp. Use this to acknowledge or respond to a message non-verbally.',
		code: `async function main() {
  const channelName = 'general';
  const messageTimestamp = '1234567890.123456'; // The ts field of the message to react to
  const reactionEmoji = 'thumbsup'; // Emoji name without colons

  const channelsResponse = await corsair.slack.api.channels.list({});
  const channel = channelsResponse.channels?.find((c) => c.name === channelName);

  if (!channel?.id) {
    const available = channelsResponse.channels?.map((c) => c.name);
    console.log('Channel not found. Available channels:', available);
    return;
  }

  const reaction = await corsair.slack.api.reactions.add({
    channel: channel.id,
    timestamp: messageTimestamp,
    name: reactionEmoji,
  });

  console.log('Reaction added:', reaction);
}
main().catch(console.error);`,
	},
	{
		description:
			'Send a Slack direct message to a user by their email address. Lists workspace users to find the user ID, opens a DM channel, then posts the message. Logs available users if the target email is not found.',
		code: `async function main() {
  const targetEmail = 'john@example.com'; // Ask the user for the recipient email if unsure
  const messageText = 'Hey! Just checking in on the status of the PR.';

  const usersResponse = await corsair.slack.api.users.list({});
  const user = usersResponse.members?.find(
    (m) => m.profile?.email === targetEmail,
  );

  if (!user?.id) {
    const emails = usersResponse.members
      ?.filter((m) => !m.is_bot)
      .map((m) => m.profile?.email);
    console.log(
      \`User with email "\${targetEmail}" not found. Available emails:\`,
      emails,
    );
    return;
  }

  // Open a DM channel with the user
  const dmChannel = await corsair.slack.api.channels.open({
    users: user.id,
  });

  const channelId = dmChannel.channel?.id;
  if (!channelId) {
    console.log('Could not open DM channel with user:', user.id);
    return;
  }

  const message = await corsair.slack.api.messages.post({
    channel: channelId,
    text: messageText,
  });

  console.log('DM sent:', message);
}
main().catch(console.error);`,
	},
];
