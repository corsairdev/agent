'use client';

import { trpc } from './trpc';

export function ExampleComponent() {
	const { data: workflows, isLoading } = trpc.promptQuery.useQuery({
		input: 'hello',
	});

	return (
		<div>
			<h1>Workflows</h1>
			{isLoading ? <p>Loading...</p> : <ul>{workflows}</ul>}
		</div>
	);
}
