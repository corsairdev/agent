'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

// Relative paths so requests go through the same origin.
// Next.js rewrites proxy /api/* to the Express backend.
const API_BASE = '';

type Permission = {
	id: string;
	endpoint: string;
	plugin: string;
	operation: string;
	args: Record<string, unknown> | null;
	description: string;
	status: 'pending' | 'granted' | 'declined' | 'completed';
	createdAt: string;
};

type ResolveState = 'idle' | 'loading' | 'done';

// ---------------------------------------------------------------------------
// Endpoint-aware arg display
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, Record<string, string>> = {
	'messages.post': {
		channel: 'Channel',
		text: 'Message',
		thread_ts: 'Thread',
		reply_broadcast: 'Also send to channel',
	},
	'emails.send': {
		to: 'To',
		from: 'From',
		subject: 'Subject',
		html: 'Body',
		text: 'Body',
		cc: 'CC',
		bcc: 'BCC',
	},
	'issues.create': {
		title: 'Title',
		description: 'Description',
		teamId: 'Team',
		assigneeId: 'Assignee',
		priority: 'Priority',
		stateId: 'Status',
	},
};

function getLabel(operation: string, key: string): string {
	return FIELD_LABELS[operation]?.[key] ?? key;
}

function isLongValue(val: unknown): boolean {
	if (typeof val !== 'string') return false;
	return val.length > 120 || val.includes('\n');
}

function ArgValue({ value }: { value: unknown }) {
	if (value === null || value === undefined) {
		return <span style={{ color: 'var(--muted)' }}>—</span>;
	}

	if (typeof value === 'boolean') {
		return <span>{value ? 'Yes' : 'No'}</span>;
	}

	if (typeof value === 'string') {
		if (isLongValue(value)) {
			return (
				<pre
					style={{
						margin: 0,
						background: '#111',
						border: '1px solid var(--border)',
						borderRadius: 'var(--radius)',
						padding: '10px 12px',
						whiteSpace: 'pre-wrap',
						wordBreak: 'break-word',
						fontSize: 13,
						lineHeight: 1.5,
					}}
				>
					{value}
				</pre>
			);
		}
		return <span>{value}</span>;
	}

	if (Array.isArray(value)) {
		return <span>{value.join(', ')}</span>;
	}

	if (typeof value === 'object') {
		return (
			<pre
				style={{
					margin: 0,
					background: '#111',
					border: '1px solid var(--border)',
					borderRadius: 'var(--radius)',
					padding: '10px 12px',
					whiteSpace: 'pre-wrap',
					wordBreak: 'break-word',
					fontSize: 12,
					lineHeight: 1.4,
				}}
			>
				{JSON.stringify(value, null, 2)}
			</pre>
		);
	}

	return <span>{String(value)}</span>;
}

function ArgsDisplay({
	args,
	operation,
}: {
	args: Record<string, unknown>;
	operation: string;
}) {
	const entries = Object.entries(args);
	if (entries.length === 0) {
		return (
			<p style={{ color: 'var(--muted)', fontSize: 13 }}>
				No arguments provided.
			</p>
		);
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
			{entries.map(([key, val]) => (
				<div key={key}>
					<div
						style={{
							fontSize: 11,
							color: 'var(--muted)',
							textTransform: 'uppercase',
							letterSpacing: '0.05em',
							marginBottom: 4,
						}}
					>
						{getLabel(operation, key)}
					</div>
					<div style={{ fontSize: 14, color: 'var(--text)' }}>
						<ArgValue value={val} />
					</div>
				</div>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Plugin badges
// ---------------------------------------------------------------------------

const PLUGIN_COLORS: Record<string, string> = {
	slack: '#4a154b',
	linear: '#5e6ad2',
	discord: '#5865f2',
	github: '#333',
	resend: '#000',
	gmail: '#ea4335',
};

function PluginBadge({ plugin }: { plugin: string }) {
	const bg = PLUGIN_COLORS[plugin] ?? 'var(--surface)';
	return (
		<span
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: 5,
				padding: '3px 10px',
				borderRadius: 99,
				fontSize: 12,
				fontWeight: 600,
				background: bg,
				color: '#fff',
				textTransform: 'capitalize',
			}}
		>
			{plugin}
		</span>
	);
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PermissionPage() {
	const params = useParams();
	const id = params.id as string;

	const [perm, setPerm] = useState<Permission | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [resolveState, setResolveState] = useState<ResolveState>('idle');
	const [resultMessage, setResultMessage] = useState<string | null>(null);

	useEffect(() => {
		fetch(`${API_BASE}/api/permissions/${id}`)
			.then((r) => {
				if (!r.ok) throw new Error('Permission not found');
				return r.json();
			})
			.then(setPerm)
			.catch((e) => setError(e.message));
	}, [id]);

	async function resolve(action: 'approve' | 'decline') {
		setResolveState('loading');
		try {
			const res = await fetch(`${API_BASE}/api/permissions/${id}/resolve`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Failed');

			setPerm((p) =>
				p
					? {
							...p,
							status: action === 'approve' ? 'granted' : 'declined',
						}
					: p,
			);
			setResultMessage(data.message);
			setResolveState('done');
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Something went wrong');
			setResolveState('idle');
		}
	}

	// Loading
	if (!perm && !error) {
		return (
			<div style={containerStyle}>
				<div style={cardStyle}>
					<p style={{ color: 'var(--muted)', textAlign: 'center' }}>
						Loading...
					</p>
				</div>
			</div>
		);
	}

	// Error
	if (error) {
		return (
			<div style={containerStyle}>
				<div style={cardStyle}>
					<p style={{ color: 'var(--danger)', textAlign: 'center' }}>{error}</p>
				</div>
			</div>
		);
	}

	if (!perm) return null;

	const isPending = perm.status === 'pending';
	const statusColor =
		perm.status === 'granted' || perm.status === 'completed'
			? 'var(--success)'
			: perm.status === 'declined'
				? 'var(--danger)'
				: 'var(--warn)';

	return (
		<div style={containerStyle}>
			<div style={cardStyle}>
				{/* Header */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 10,
						marginBottom: 8,
					}}
				>
					<span style={{ fontSize: 22 }}>&#x1f512;</span>
					<h1 style={{ fontSize: 18, fontWeight: 700 }}>Permission Request</h1>
				</div>

				{/* Status */}
				{!isPending && (
					<div
						style={{
							padding: '10px 14px',
							borderRadius: 'var(--radius)',
							background:
								perm.status === 'granted' || perm.status === 'completed'
									? '#14532d'
									: '#7f1d1d',
							color: statusColor,
							fontSize: 13,
							fontWeight: 600,
							marginBottom: 16,
							textAlign: 'center',
						}}
					>
						{resultMessage ?? `This permission has been ${perm.status}.`}
					</div>
				)}

				{/* Description */}
				<p
					style={{
						fontSize: 15,
						lineHeight: 1.6,
						marginBottom: 20,
						color: 'var(--text)',
					}}
				>
					{perm.description}
				</p>

				{/* Endpoint info */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 8,
						marginBottom: 20,
					}}
				>
					<PluginBadge plugin={perm.plugin} />
					<code
						style={{
							fontSize: 12,
							color: 'var(--muted)',
							background: '#111',
							padding: '2px 8px',
							borderRadius: 'var(--radius)',
						}}
					>
						{perm.endpoint}
					</code>
				</div>

				{/* Args */}
				{perm.args && Object.keys(perm.args).length > 0 && (
					<div
						style={{
							background: 'var(--bg)',
							border: '1px solid var(--border)',
							borderRadius: 'var(--radius)',
							padding: '16px',
							marginBottom: 24,
						}}
					>
						<div
							style={{
								fontSize: 11,
								color: 'var(--muted)',
								textTransform: 'uppercase',
								letterSpacing: '0.05em',
								marginBottom: 12,
								fontWeight: 600,
							}}
						>
							Request details
						</div>
						<ArgsDisplay
							args={perm.args as Record<string, unknown>}
							operation={perm.operation}
						/>
					</div>
				)}

				{/* Timestamp */}
				<p
					style={{
						fontSize: 11,
						color: 'var(--muted)',
						marginBottom: 20,
					}}
				>
					Requested{' '}
					{new Date(perm.createdAt).toLocaleString(undefined, {
						dateStyle: 'medium',
						timeStyle: 'short',
					})}
				</p>

			{/* Actions */}
			{isPending && (
				<div
					style={{
						display: 'flex',
						gap: 10,
						justifyContent: 'flex-end',
					}}
				>
					<button
						className="btn-ghost"
						disabled={resolveState === 'loading'}
						onClick={() => resolve('decline')}
						style={{
							padding: '10px 24px',
							fontSize: 14,
							fontWeight: 600,
						}}
					>
						Decline
					</button>
					<button
						className="btn-primary"
						disabled={resolveState === 'loading'}
						onClick={() => resolve('approve')}
						style={{
							padding: '10px 24px',
							fontSize: 14,
							fontWeight: 600,
							background: 'var(--success)',
						}}
					>
						{resolveState === 'loading' ? 'Processing...' : 'Approve'}
					</button>
				</div>
			)}

			{resolveState === 'done' && (
				<div style={{ textAlign: 'center', marginTop: 8 }}>
					<a
						href="/"
						style={{
							color: 'var(--accent)',
							fontSize: 13,
							textDecoration: 'none',
						}}
					>
						Back to chat
					</a>
				</div>
			)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
	display: 'flex',
	justifyContent: 'center',
	alignItems: 'center',
	minHeight: '100vh',
	padding: 24,
};

const cardStyle: React.CSSProperties = {
	width: '100%',
	maxWidth: 520,
	background: 'var(--surface)',
	border: '1px solid var(--border)',
	borderRadius: 12,
	padding: 28,
};
