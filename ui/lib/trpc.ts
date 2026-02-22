import {
	createTRPCClient,
	httpBatchLink,
	httpSubscriptionLink,
	splitLink,
} from '@trpc/client';
import type { AppRouter } from '../../server/trpc/router';

const BASE_URL =
	process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const trpc = createTRPCClient<AppRouter>({
	links: [
		splitLink({
			condition: (op) => op.type === 'subscription',
			true: httpSubscriptionLink({ url: `${BASE_URL}/trpc` }),
			false: httpBatchLink({ url: `${BASE_URL}/trpc` }),
		}),
	],
});
