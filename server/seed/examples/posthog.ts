import type { CodeExample } from './types';

export const posthogExamples: CodeExample[] = [
	{
		description:
			'Track a custom event in PostHog for a specific user. Use this to record user actions such as button clicks, feature usage, form submissions, or any application-level event you want to analyze.',
		code: `async function main() {
  const result = await corsair.posthog.api.events.eventCreate({
    event: 'user_upgraded_plan',
    distinctId: 'user_12345', // The unique identifier for this user
    properties: {
      plan: 'pro',
      previousPlan: 'free',
      source: 'billing_page',
      amount: 49,
      currency: 'USD',
    },
  });

  console.log('PostHog event tracked:', result);
}
main().catch(console.error);`,
	},
	{
		description:
			'Identify a user in PostHog and set their profile properties such as name, email, and plan. Use this after a user signs up or logs in to associate events with a known identity and enrich their profile.',
		code: `async function main() {
  const result = await corsair.posthog.api.events.identityCreate({
    distinctId: 'user_12345', // Must match the distinctId used in event tracking
    traits: {
      email: 'jane@example.com',
      name: 'Jane Smith',
      company: 'Acme Corp',
      plan: 'pro',
      signupDate: new Date().toISOString(),
      isAdmin: false,
    },
  });

  console.log('PostHog user identified:', result);
}
main().catch(console.error);`,
	},
	{
		description:
			'Track a page view in PostHog for a specific user and URL. Use this to record when a user navigates to a page in a server-side context or single-page application where automatic page tracking is not set up.',
		code: `async function main() {
  const result = await corsair.posthog.api.events.trackPage({
    distinctId: 'user_12345',
    url: 'https://app.example.com/dashboard',
    properties: {
      title: 'Dashboard',
      referrer: 'https://app.example.com/login',
      screenWidth: 1440,
      screenHeight: 900,
    },
  });

  console.log('PostHog page view tracked:', result);
}
main().catch(console.error);`,
	},
	{
		description:
			'Create an alias in PostHog to link an anonymous ID to a known user ID. Use this after a user logs in to connect their pre-login anonymous events with their authenticated identity.',
		code: `async function main() {
  // When a user logs in, link their anonymous session ID to their known user ID
  const anonymousId = 'anon_abc123'; // The ID used before login
  const userId = 'user_12345'; // The authenticated user ID

  const result = await corsair.posthog.api.events.aliasCreate({
    distinctId: userId,
    alias: anonymousId,
  });

  console.log('PostHog alias created (anonymous → known user):', result);
}
main().catch(console.error);`,
	},
];
