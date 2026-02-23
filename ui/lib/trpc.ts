import {
	createTRPCClient,
	httpBatchLink,
	httpSubscriptionLink,
	splitLink,
} from '@trpc/client';
import type { AppRouter } from '../../server/trpc/router';

// Empty string → relative URL (/trpc) → flows through Next.js rewrite proxy.
// Set NEXT_PUBLIC_API_URL to override (e.g. direct cloudflared server URL).
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export const trpc = createTRPCClient<AppRouter>({
	links: [
		splitLink({
			condition: (op) => op.type === 'subscription',
			true: httpSubscriptionLink({ url: `${BASE_URL}/trpc` }),
			false: httpBatchLink({ url: `${BASE_URL}/trpc` }),
		}),
	],
});
