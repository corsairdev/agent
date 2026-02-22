'use client';

import { useCallback, useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type ScriptRun = {
	id: string;
	code: string;
	stdout: string | null;
	stderr: string | null;
	exit_code: number | null;
	created_at: string;
};

export default function ExecutionsPage() {
	const [runs, setRuns] = useState<ScriptRun[]>([]);
	const [loading, setLoading] = useState(true);
	const [expanded, setExpanded] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await fetch(`${API}/api/script-runs`);
		const data = (await res.json()) as ScriptRun[];
		setRuns(data);
		setLoading(false);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

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
				<h1 style={{ fontSize: 20, fontWeight: 600 }}>Executions</h1>
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
			) : runs.length === 0 ? (
				<div
					style={{
						padding: 40,
						textAlign: 'center',
						color: 'var(--muted)',
						border: '1px dashed var(--border)',
						borderRadius: 'var(--radius)',
					}}
				>
					No script runs yet.
				</div>
			) : (
				<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
					{runs.map((run) => (
						<div
							key={run.id}
							style={{
								border: '1px solid var(--border)',
								borderRadius: 'var(--radius)',
								overflow: 'hidden',
							}}
						>
							{/* Header row */}
							<div
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 12,
									padding: '10px 14px',
									background: 'var(--surface)',
									cursor: 'pointer',
								}}
								onClick={() => setExpanded(expanded === run.id ? null : run.id)}
							>
								<span
									className={`badge ${run.exit_code === 0 ? 'badge-green' : 'badge-red'}`}
								>
									{run.exit_code === 0 ? 'OK' : `exit ${run.exit_code ?? '?'}`}
								</span>
								<span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
									{new Date(run.created_at).toLocaleString()}
								</span>
								<span style={{ color: 'var(--muted)', fontSize: 12 }}>
									{expanded === run.id ? '▾' : '▸'}
								</span>
							</div>

							{expanded === run.id && (
								<div
									style={{
										padding: 16,
										display: 'flex',
										flexDirection: 'column',
										gap: 12,
									}}
								>
									<div>
										<div
											style={{
												fontSize: 11,
												color: 'var(--muted)',
												marginBottom: 4,
												textTransform: 'uppercase',
												letterSpacing: '0.05em',
											}}
										>
											Code
										</div>
										<pre>{run.code}</pre>
									</div>
									{run.stdout && (
										<div>
											<div
												style={{
													fontSize: 11,
													color: 'var(--muted)',
													marginBottom: 4,
													textTransform: 'uppercase',
													letterSpacing: '0.05em',
												}}
											>
												Stdout
											</div>
											<pre style={{ borderColor: '#14532d' }}>{run.stdout}</pre>
										</div>
									)}
									{run.stderr && (
										<div>
											<div
												style={{
													fontSize: 11,
													color: 'var(--muted)',
													marginBottom: 4,
													textTransform: 'uppercase',
													letterSpacing: '0.05em',
												}}
											>
												Stderr
											</div>
											<pre style={{ borderColor: '#7f1d1d' }}>{run.stderr}</pre>
										</div>
									)}
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
