'use client';

import { useCallback, useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Workflow = {
	id: string;
	workflow_id: string;
	status: 'active' | 'paused' | 'deleted';
	code: string;
	created_at: string;
	updated_at: string;
};

function statusBadge(status: string) {
	const cls =
		status === 'active'
			? 'badge badge-green'
			: status === 'paused'
				? 'badge badge-yellow'
				: 'badge badge-red';
	return <span className={cls}>{status}</span>;
}

export default function WorkflowsPage() {
	const [workflows, setWorkflows] = useState<Workflow[]>([]);
	const [loading, setLoading] = useState(true);
	const [expanded, setExpanded] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await fetch(`${API}/api/workflows`);
		const data = (await res.json()) as Workflow[];
		setWorkflows(data);
		setLoading(false);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function updateStatus(
		id: string,
		status: 'active' | 'paused' | 'deleted',
	) {
		setBusy(id);
		await fetch(`${API}/api/workflows/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status }),
		});
		await load();
		setBusy(null);
	}

	return (
		<div>
			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
					marginBottom: 24,
				}}
			>
				<h1 style={{ fontSize: 20, fontWeight: 600 }}>Workflows</h1>
				<button
					className="btn-ghost"
					onClick={() => void load()}
					style={{ fontSize: 12 }}
				>
					↻ Refresh
				</button>
			</div>

			{loading ? (
				<p style={{ color: 'var(--muted)' }}>Loading…</p>
			) : workflows.length === 0 ? (
				<div
					style={{
						padding: 40,
						textAlign: 'center',
						color: 'var(--muted)',
						border: '1px dashed var(--border)',
						borderRadius: 'var(--radius)',
					}}
				>
					No workflows yet. Use the agent prompt endpoint to create one.
				</div>
			) : (
				<div
					style={{
						border: '1px solid var(--border)',
						borderRadius: 'var(--radius)',
						overflow: 'hidden',
					}}
				>
					<table>
						<thead>
							<tr>
								<th>ID</th>
								<th>Status</th>
								<th>Created</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{workflows.map((wf) => (
								<>
									<tr key={wf.id}>
										<td>
											<button
												className="btn-ghost"
												style={{ fontSize: 12, padding: '2px 8px' }}
												onClick={() =>
													setExpanded(expanded === wf.id ? null : wf.id)
												}
											>
												{expanded === wf.id ? '▾' : '▸'}
											</button>{' '}
											<code style={{ fontSize: 12 }}>{wf.workflow_id}</code>
										</td>
										<td>{statusBadge(wf.status)}</td>
										<td style={{ color: 'var(--muted)', fontSize: 12 }}>
											{new Date(wf.created_at).toLocaleString()}
										</td>
										<td>
											<div style={{ display: 'flex', gap: 6 }}>
												{wf.status === 'active' ? (
													<button
														className="btn-ghost"
														style={{ fontSize: 11 }}
														disabled={busy === wf.id}
														onClick={() => void updateStatus(wf.id, 'paused')}
													>
														Pause
													</button>
												) : wf.status === 'paused' ? (
													<button
														className="btn-primary"
														style={{ fontSize: 11 }}
														disabled={busy === wf.id}
														onClick={() => void updateStatus(wf.id, 'active')}
													>
														Resume
													</button>
												) : null}
												<button
													className="btn-danger"
													style={{ fontSize: 11 }}
													disabled={busy === wf.id}
													onClick={() => void updateStatus(wf.id, 'deleted')}
												>
													Delete
												</button>
											</div>
										</td>
									</tr>
									{expanded === wf.id && (
										<tr key={`${wf.id}-code`}>
											<td
												colSpan={4}
												style={{ background: '#111', padding: 0 }}
											>
												<pre
													style={{
														margin: 0,
														borderRadius: 0,
														border: 'none',
														padding: '16px 20px',
													}}
												>
													{wf.code}
												</pre>
											</td>
										</tr>
									)}
								</>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
