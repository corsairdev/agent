import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { TRPCProvider } from '../components/trpc-provider';

export const metadata: Metadata = {
	title: 'Corsair Agent',
	description: 'Personal automation assistant',
};

const NAV_LINKS = [
	{ href: '/workflows', label: 'Workflows' },
	{ href: '/executions', label: 'Executions' },
	{ href: '/keys', label: 'API Keys' },
];

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body>
				<TRPCProvider>
					<div style={{ display: 'flex', minHeight: '100vh' }}>
						{/* Sidebar */}
						<nav
							style={{
								width: 200,
								background: 'var(--surface)',
								borderRight: '1px solid var(--border)',
								padding: '24px 0',
								flexShrink: 0,
								display: 'flex',
								flexDirection: 'column',
								gap: 4,
							}}
						>
							<div
								style={{
									padding: '0 20px 20px',
									borderBottom: '1px solid var(--border)',
									marginBottom: 8,
								}}
							>
								<span style={{ fontWeight: 700, fontSize: 15 }}>
									⛵ Corsair
								</span>
								<div
									style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}
								>
									Personal Agent
								</div>
							</div>
							{NAV_LINKS.map(({ href, label }) => (
								<Link
									key={href}
									href={href}
									style={{
										display: 'block',
										padding: '8px 20px',
										color: 'var(--text)',
										fontSize: 13,
										borderRadius: 0,
									}}
								>
									{label}
								</Link>
							))}
						</nav>

						{/* Main content */}
						<main style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
							{children}
						</main>
					</div>
				</TRPCProvider>
			</body>
		</html>
	);
}
