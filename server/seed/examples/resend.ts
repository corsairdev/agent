import type { BaseCodeExample } from './types';

export const resendExamples: BaseCodeExample[] = [
	{
		description:
			'Send a transactional email using Resend with a plain text body. Logs the email ID on success. Use this to send confirmation emails, notifications, or alerts programmatically.',
		code: `async function main() {
		// If the user has specified the domain, skip this step
		// If the user has not specified, then list domains first to confirm a verified sending domain is available
		// It's likely that the user doesn't have this scope on their API key. Wrap this in a try-catch so that we can catch the auth error
		// Then ask the user what domain we're sending from
		let domainString;
		try {
			const domainsResponse = await corsair.resend.api.domains.list({});
			console.log(
				'Available sending domains:',
				domainsResponse.data?.map((d) => ({ name: d.name, status: d.status })),
			);

			const verifiedDomain = domainsResponse.data?.find(
				(d) => d.status === 'verified',
			);

			if (!verifiedDomain) {
				console.log(
					'No verified sending domain found. Please verify a domain in Resend before sending.',
					domainsResponse.data,
				);
				return;
			}

			domainString = verifiedDomain.name;
		} catch (e) {
			console.log(
				'Failed checking the domain. Revert to asking the user what the domain should be',
			);
		}

		const result = await corsair.resend.api.emails.send({
			from: \`noreply@\${domainString}\`,
			to: ['user@example.com'], // Ask the user for the recipient if not specified
			subject: 'Your account has been created',
			text: 'Welcome! Your account has been successfully created. You can now log in at https://app.example.com',
		});

		console.log('Email sent:', { id: result.id });
	}
	main().catch(console.error);`,
	},
	{
		description:
			'Send an HTML email using Resend with rich formatting. Supports both html and plain text fallback. Use this for styled transactional emails like welcome messages, password resets, or receipts.',
		code: `async function main() {
  const to = 'customer@example.com'; // Recipient — ask user if not specified
  const customerName = 'Alex'; // Personalize if you have the name

  const result = await corsair.resend.api.emails.send({
    from: 'onboarding@yourcompany.com',
    to: [to],
    subject: \`Welcome to the platform, \${customerName}!\`,
    html: \`
      <html>
        <body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #333;">Welcome, \${customerName}! 👋</h1>
          <p>Thanks for signing up. Your account is ready to go.</p>
          <p>
            <a href="https://app.example.com/login"
               style="background: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
              Get Started
            </a>
          </p>
          <p style="color: #666; font-size: 12px;">
            If you didn't sign up, you can safely ignore this email.
          </p>
        </body>
      </html>
    \`,
    text: \`Welcome, \${customerName}! Your account is ready. Visit https://app.example.com/login to get started.\`,
  });

  console.log('HTML email sent:', { id: result.id });
}
main().catch(console.error);`,
	},
	{
		description:
			'List all configured Resend sending domains and check their verification status. Use this to confirm available domains before sending emails, or to diagnose issues with email deliverability.',
		code: `async function main() {
  const response = await corsair.resend.api.domains.list({});

  if (!response.data?.length) {
    console.log('No domains configured in Resend. Add and verify a domain first.');
    return;
  }

  const domains = response.data.map((domain) => ({
    id: domain.id,
    name: domain.name,
    status: domain.status, // 'verified' | 'pending' | 'failed'
    region: domain.region,
    createdAt: domain.created_at,
  }));

  console.log('Resend domains:', domains);

  const unverified = domains.filter((d) => d.status !== 'verified');
  if (unverified.length > 0) {
    console.log('Domains pending verification:', unverified.map((d) => d.name));
  }
}
main().catch(console.error);`,
	},
	{
		description:
			'Send a Resend email to multiple recipients in a batch. Use this to send a notification or announcement to a list of email addresses at once.',
		code: `async function main() {
  const recipients = [
    'alice@example.com',
    'bob@example.com',
    'charlie@example.com',
  ];

  // Confirm domains are available
  const domainsResponse = await corsair.resend.api.domains.list({});
  const verifiedDomain = domainsResponse.data?.find((d) => d.status === 'verified');

  if (!verifiedDomain) {
    console.log('No verified sending domain available.', domainsResponse.data);
    return;
  }

  const result = await corsair.resend.api.emails.send({
    from: \`team@\${verifiedDomain.name}\`,
    to: recipients,
    subject: 'Scheduled maintenance notice: Sunday 2am-4am UTC',
    text: [
      'Hi team,',
      '',
      'We have scheduled maintenance this Sunday from 2am to 4am UTC.',
      'The platform may be unavailable during this window.',
      '',
      'Thanks for your patience.',
    ].join('\\n'),
  });

  console.log(\`Email sent to \${recipients.length} recipients:\`, { id: result.id });
}
main().catch(console.error);`,
	},
];
