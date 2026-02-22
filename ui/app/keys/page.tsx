'use client';

import { useCallback, useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Account = {
	id: string;
	tenant_id: string;
	integration_id: string;
	integration_name: string;
	created_at: string;
};

type Plugin = 'slack' | 'linear' | 'resend';

const PLUGINS: {
	id: Plugin;
	label: string;
	placeholder: string;
	helpText: string;
}[] = [
	{
		id: 'slack',
		label: 'Slack',
		placeholder: 'xoxb-...',
		helpText: 'Bot User OAuth Token from your Slack app settings.',
	},
	{
		id: 'linear',
		label: 'Linear',
		placeholder: 'lin_api_...',
		helpText: 'Personal API key from Linear → Settings → API.',
	},
	{
		id: 'resend',
		label: 'Resend',
		placeholder: 're_...',
		helpText: 'API key from Resend → Settings → API Keys.',
	},
];

export default function KeysPage() {
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [values, setValues] = useState<Partial<Record<Plugin, string>>>({});
	const [busy, setBusy] = useState<Plugin | null>(null);
	const [message, setMessage] = useState<{
		plugin: Plugin;
		text: string;
		ok: boolean;
	} | null>(null);

	const load = useCallback(async () => {
		const res = await fetch(`${API}/api/accounts`);
		const data = (await res.json()) as Account[];
		setAccounts(data);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	function hasAccount(plugin: Plugin) {
		return accounts.some((a) => a.integration_name?.toLowerCase() === plugin);
	}

	async function saveKey(plugin: Plugin) {
		const value = values[plugin]?.trim();
		if (!value) return;
		setBusy(plugin);
		setMessage(null);
		try {
			const res = await fetch(`${API}/api/keys/${plugin}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value }),
			});
			const json = (await res.json()) as { ok?: boolean; error?: string };
			if (json.ok) {
				setMessage({ plugin, text: 'Key saved successfully.', ok: true });
				setValues((v) => ({ ...v, [plugin]: '' }));
				await load();
			} else {
				setMessage({ plugin, text: json.error ?? 'Unknown error', ok: false });
			}
		} catch (e) {
			setMessage({ plugin, text: String(e), ok: false });
		} finally {
			setBusy(null);
		}
	}

	async function revokeKey(plugin: Plugin) {
		if (!confirm(`Revoke ${plugin} API key?`)) return;
		setBusy(plugin);
		setMessage(null);
		try {
			const res = await fetch(`${API}/api/keys/${plugin}`, {
				method: 'DELETE',
			});
			const json = (await res.json()) as { ok?: boolean; error?: string };
			if (json.ok) {
				setMessage({ plugin, text: 'Key revoked.', ok: true });
				await load();
			} else {
				setMessage({ plugin, text: json.error ?? 'Unknown error', ok: false });
			}
		} catch (e) {
			setMessage({ plugin, text: String(e), ok: false });
		} finally {
			setBusy(null);
		}
	}

	return (
		<div>
			<h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
				API Keys
			</h1>
			<p style={{ color: 'var(--muted)', marginBottom: 28, fontSize: 13 }}>
				Keys are encrypted and stored in Postgres via Corsair. The agent never
				reads them directly.
			</p>

			<div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
				{PLUGINS.map(({ id, label, placeholder, helpText }) => (
					<div
						key={id}
						style={{
							border: '1px solid var(--border)',
							borderRadius: 'var(--radius)',
							padding: 20,
							background: 'var(--surface)',
						}}
					>
						<div
							style={{
								display: 'flex',
								justifyContent: 'space-between',
								alignItems: 'flex-start',
								marginBottom: 10,
							}}
						>
							<div>
								<div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
								<div style={{ color: 'var(--muted)', fontSize: 12 }}>
									{helpText}
								</div>
							</div>
							{hasAccount(id) && (
								<span className="badge badge-green">Connected</span>
							)}
						</div>

						{message?.plugin === id && (
							<div
								style={{
									padding: '8px 12px',
									borderRadius: 'var(--radius)',
									marginBottom: 10,
									fontSize: 12,
									background: message.ok ? '#14532d' : '#7f1d1d',
									color: message.ok ? 'var(--success)' : 'var(--danger)',
								}}
							>
								{message.text}
							</div>
						)}

						<div style={{ display: 'flex', gap: 8 }}>
							<input
								type="password"
								placeholder={placeholder}
								value={values[id] ?? ''}
								onChange={(e) =>
									setValues((v) => ({ ...v, [id]: e.target.value }))
								}
								onKeyDown={(e) => {
									if (e.key === 'Enter') void saveKey(id);
								}}
								style={{ flex: 1 }}
							/>
							<button
								className="btn-primary"
								disabled={busy === id || !values[id]?.trim()}
								onClick={() => void saveKey(id)}
								style={{ whiteSpace: 'nowrap' }}
							>
								{busy === id ? 'Saving…' : 'Save Key'}
							</button>
							{hasAccount(id) && (
								<button
									className="btn-danger"
									disabled={busy === id}
									onClick={() => void revokeKey(id)}
									style={{ whiteSpace: 'nowrap' }}
								>
									Revoke
								</button>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
