import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../src/trpc/router';

export const trpcClient = createTRPCProxyClient<AppRouter>({
	links: [
		httpBatchLink({
			url: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/trpc',
		}),
	],
});
