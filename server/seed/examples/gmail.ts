import type { CodeExample } from './types';

export const gmailExamples: CodeExample[] = [
	{
		description:
			'List recent Gmail messages in the inbox and inspect subject lines, senders, and dates. Use this to give the user an overview of their recent emails or to find a specific message before reading or replying to it.',
		code: `async function main() {
  // List recent inbox messages (q filters like Gmail search: 'in:inbox', 'is:unread', etc.)
  const response = await corsair.gmail.api.messages.list({
    maxResults: 10,
    q: 'in:inbox',
  });

  console.log(
    'Message IDs found:',
    response.messages?.map((m) => m.id),
  );
  console.log('Total estimated count:', response.resultSizeEstimate);

  if (!response.messages?.length) {
    console.log('No messages found in inbox.');
    return;
  }

  // Fetch full details of the first message to inspect its structure
  const firstMessage = await corsair.gmail.api.messages.get({
    id: response.messages[0]!.id!,
    format: 'metadata',
    metadataHeaders: ['Subject', 'From', 'Date'],
  });

  const headers = firstMessage.payload?.headers;
  const subject = headers?.find((h) => h.name === 'Subject')?.value;
  const from = headers?.find((h) => h.name === 'From')?.value;
  const date = headers?.find((h) => h.name === 'Date')?.value;

  console.log('Most recent email:', { subject, from, date });
}
main().catch(console.error);`,
	},
	{
		description:
			'Search Gmail for messages matching a query string such as sender, subject, label, or date range. Returns a list of matching message IDs with metadata. Mirrors standard Gmail search syntax (from:, subject:, after:, label:, etc.).',
		code: `async function main() {
  // Use Gmail search syntax: from:, to:, subject:, label:, after:, before:, is:unread, etc.
  const searchQuery = 'from:newsletter@company.com subject:weekly';

  const response = await corsair.gmail.api.messages.list({
    maxResults: 20,
    q: searchQuery,
  });

  if (!response.messages?.length) {
    console.log(\`No messages found for query: "\${searchQuery}"\`);
    return;
  }

  console.log(
    \`Found \${response.resultSizeEstimate} messages matching "\${searchQuery}"\`,
  );

  // Fetch metadata for each result
  const messageDetails = await Promise.all(
    response.messages.slice(0, 5).map((m) =>
      corsair.gmail.api.messages.get({
        id: m.id!,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      }),
    ),
  );

  const summary = messageDetails.map((msg) => {
    const headers = msg.payload?.headers ?? [];
    return {
      id: msg.id,
      subject: headers.find((h) => h.name === 'Subject')?.value,
      from: headers.find((h) => h.name === 'From')?.value,
      date: headers.find((h) => h.name === 'Date')?.value,
    };
  });

  console.log('Search results:', summary);
}
main().catch(console.error);`,
	},
	{
		description:
			'Send an email using Gmail. Constructs an RFC 2822 formatted email message, base64url-encodes it, and sends it via the Gmail API. Use this to send emails on behalf of the authenticated user.',
		code: `async function main() {
  const to = 'recipient@example.com'; // Ask the user for the recipient if not specified
  const subject = 'Follow-up from our meeting';
  const body = 'Hi there,\\n\\nJust following up on the action items from our meeting yesterday. Let me know if you need anything!\\n\\nBest,\\nThe Agent';

  // Construct RFC 2822 message
  const emailLines = [
    \`To: \${to}\`,
    \`Subject: \${subject}\`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ];

  const rawEmail = emailLines.join('\\r\\n');

  // Base64url encode (required by Gmail API)
  const encodedEmail = Buffer.from(rawEmail)
    .toString('base64')
    .replace(/\\+/g, '-')
    .replace(/\\//g, '_')
    .replace(/=+$/, '');

  const sent = await corsair.gmail.api.messages.send({
    raw: encodedEmail,
  });

  console.log('Email sent:', { id: sent.id, threadId: sent.threadId });
}
main().catch(console.error);`,
	},
	{
		description:
			'List all Gmail labels in the account including system labels (INBOX, SENT, TRASH, SPAM) and custom user-created labels. Use this to discover label names and IDs before applying labels to messages or searching by label.',
		code: `async function main() {
  const response = await corsair.gmail.api.labels.list({});

  const systemLabels = response.labels
    ?.filter((l) => l.type === 'system')
    .map((l) => ({ id: l.id, name: l.name }));

  const userLabels = response.labels
    ?.filter((l) => l.type === 'user')
    .map((l) => ({ id: l.id, name: l.name }));

  console.log('System labels:', systemLabels);
  console.log('User-created labels:', userLabels);
}
main().catch(console.error);`,
	},
	{
		description:
			'Save an email as a Gmail draft without sending it. Constructs the message and creates a draft that can be reviewed and sent later. Use this when the user wants to prepare an email for review before sending.',
		code: `async function main() {
  const to = 'boss@example.com';
  const subject = 'Q1 Summary Report - Draft';
  const body = 'Hi,\\n\\nPlease find the Q1 summary below:\\n\\n[Report content here]\\n\\nBest regards';

  // Construct RFC 2822 message
  const emailLines = [
    \`To: \${to}\`,
    \`Subject: \${subject}\`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ];

  const rawEmail = emailLines.join('\\r\\n');

  const encodedEmail = Buffer.from(rawEmail)
    .toString('base64')
    .replace(/\\+/g, '-')
    .replace(/\\//g, '_')
    .replace(/=+$/, '');

  const draft = await corsair.gmail.api.drafts.create({
    message: {
      raw: encodedEmail,
    },
  });

  console.log('Draft created:', {
    id: draft.id,
    messageId: draft.message?.id,
  });
}
main().catch(console.error);`,
	},
	{
		description:
			'Apply or remove Gmail labels on a message to organize emails. First lists available labels to get IDs, then modifies the target message. Use this to mark emails as read, archive them, or move them to a specific label.',
		code: `async function main() {
  const messageId = 'MESSAGE_ID_HERE'; // Use messages.list with a search query to find this

  // List labels to find the ones we want to apply
  const labelsResponse = await corsair.gmail.api.labels.list({});
  console.log(
    'Available labels:',
    labelsResponse.labels?.map((l) => ({ id: l.id, name: l.name })),
  );

  // Find a specific label by name
  const targetLabelName = 'Important'; // User-created label
  const label = labelsResponse.labels?.find((l) => l.name === targetLabelName);

  if (!label) {
    console.log(
      \`Label "\${targetLabelName}" not found. Available labels:\`,
      labelsResponse.labels?.map((l) => l.name),
    );
    return;
  }

  // Apply the label and mark as read (remove UNREAD label)
  const modified = await corsair.gmail.api.messages.modify({
    id: messageId,
    addLabelIds: [label.id!],
    removeLabelIds: ['UNREAD'],
  });

  console.log('Message updated:', { id: modified.id, labels: modified.labelIds });
}
main().catch(console.error);`,
	},
];
