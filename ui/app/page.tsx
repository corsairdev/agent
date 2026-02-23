'use client';

import { useEffect, useRef, useState } from 'react';
import { trpc } from '../lib/trpc';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
	write_and_execute_code: 'Writing & running code',
	search_code_examples: 'Searching examples',
	manage_workflows: 'Managing workflows',
	web_search: 'Searching the web',
	ask_human: 'Waiting for input',
	get_conversation_history: 'Reading history',
	request_permission: 'Requesting permission',
};

type ToolCall = { toolCallId: string; toolName: string; done: boolean };

type DbMessage = {
	id: string;
	role: 'user' | 'assistant';
	text: string;
	toolCalls: ToolCall[] | null;
	hasPending: string | null;
	createdAt: Date;
};

type Thread = {
	id: string;
	title: string | null;
	source: string;
	createdAt: Date;
	updatedAt: Date;
};

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ChatPage() {
	const [threads, setThreads] = useState<Thread[]>([]);
	const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
	const [dbMessages, setDbMessages] = useState<DbMessage[]>([]);
	const [input, setInput] = useState('');

	// Streaming state
	const [isStreaming, setIsStreaming] = useState(false);
	const [streamingText, setStreamingText] = useState('');
	const [streamingTools, setStreamingTools] = useState<ToolCall[]>([]);
	const [pendingPermissionId, setPendingPermissionId] = useState<string | null>(
		null,
	);

	const bottomRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const streamingTextRef = useRef('');
	const streamingToolsRef = useRef<ToolCall[]>([]);
	const pendingPermIdRef = useRef<string | null>(null);

	// Keep refs in sync
	useEffect(() => {
		streamingTextRef.current = streamingText;
	}, [streamingText]);

	// Auto-scroll
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [dbMessages, streamingText, streamingTools]);

	// Poll permission status so the UI refreshes when the user approves/declines
	useEffect(() => {
		if (!pendingPermissionId || isStreaming) return;

		const interval = setInterval(async () => {
			try {
				const res = await fetch(`/api/permissions/${pendingPermissionId}`);
				if (!res.ok) return;
				const perm = await res.json();
				if (perm.status !== 'pending') {
					setPendingPermissionId(null);
					pendingPermIdRef.current = null;
					if (activeThreadId) loadMessages(activeThreadId);
				}
			} catch {}
		}, 3000);

		return () => clearInterval(interval);
	}, [pendingPermissionId, isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

	// Load thread list on mount
	useEffect(() => {
		loadThreads();
	}, []);

	// Load messages when active thread changes
	useEffect(() => {
		if (!activeThreadId) {
			setDbMessages([]);
			return;
		}
		loadMessages(activeThreadId);
	}, [activeThreadId]);

	async function loadThreads() {
		try {
			const result = await trpc.threads.list.query();
			// @ts-expect-error string vs date mismatch causing error
			setThreads(result as Thread[]);
		} catch (err) {
			console.error('[threads] Failed to load threads:', err);
		}
	}

	async function loadMessages(threadId: string) {
		try {
			const result = await trpc.threads.messages.query({ threadId });
			// @ts-expect-error string vs date mismatch causing error
			setDbMessages(result as DbMessage[]);
		} catch (err) {
			console.error('[threads] Failed to load messages:', err);
		}
	}

	async function createNewThread() {
		const { threadId } = await trpc.threads.create.mutate();
		const newThread: Thread = {
			id: threadId,
			title: null,
			source: 'web',
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		setThreads((prev) => [newThread, ...prev]);
		setActiveThreadId(threadId);
		setDbMessages([]);
		setInput('');
	}

	function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		const trimmed = input.trim();
		if (!trimmed || isStreaming) return;

		setInput('');
		if (textareaRef.current) textareaRef.current.style.height = 'auto';

		// Optimistically add user message to view
		const optimisticUserMsg: DbMessage = {
			id: `optimistic-${Date.now()}`,
			role: 'user',
			text: trimmed,
			toolCalls: null,
			hasPending: null,
			createdAt: new Date(),
		};
		setDbMessages((prev) => [...prev, optimisticUserMsg]);

		setIsStreaming(true);
		setStreamingText('');
		setStreamingTools([]);
		setPendingPermissionId(null);
		pendingPermIdRef.current = null;
		streamingToolsRef.current = [];

		const threadId = activeThreadId ?? undefined;

		const sub = trpc.chat.subscribe(
			{ threadId, message: trimmed },
			{
				onData(chunk) {
					if (chunk.type === 'thread-id') {
						const tid = chunk.threadId;
						setActiveThreadId(tid);
						// If this was a new thread, update threads list
						setThreads((prev) => {
							const exists = prev.find((t) => t.id === tid);
							if (!exists) {
								const newT: Thread = {
									id: tid,
									title: trimmed.slice(0, 60),
									source: 'web',
									createdAt: new Date(),
									updatedAt: new Date(),
								};
								return [newT, ...prev];
							}
							return prev;
						});
					} else if (chunk.type === 'text-delta') {
						setStreamingText((prev) => prev + chunk.delta);
					} else if (chunk.type === 'tool-call') {
						setStreamingTools((prev) => [
							...prev,
							{
								toolCallId: chunk.toolCallId,
								toolName: chunk.toolName,
								done: false,
							},
						]);
					} else if (chunk.type === 'tool-result') {
						const updated = streamingToolsRef.current.map((t) =>
							t.toolCallId === chunk.toolCallId ? { ...t, done: true } : t,
						);
						streamingToolsRef.current = updated;
						setStreamingTools(updated);
					} else if (chunk.type === 'needs-input') {
						pendingPermIdRef.current = chunk.permissionId ?? null;
						setPendingPermissionId(chunk.permissionId ?? null);
					} else if (chunk.type === 'finish') {
						const finalText = streamingTextRef.current;
						const finalTools = streamingToolsRef.current;
						const assistantMsg: DbMessage = {
							id: `streaming-${Date.now()}`,
							role: 'assistant',
							text: finalText,
							toolCalls: finalTools.length > 0 ? finalTools : null,
							hasPending: pendingPermIdRef.current,
							createdAt: new Date(),
						};
						setDbMessages((prev) => [...prev, assistantMsg]);
						setStreamingText('');
						setStreamingTools([]);
						setIsStreaming(false);

						// Reload threads list to update titles/timestamps
						loadThreads();
					}
				},
				onError(err) {
					console.error('[chat] subscription error:', err);
					setIsStreaming(false);
				},
			},
		);

		// Cleanup subscription if component unmounts mid-stream
		return () => sub.unsubscribe();
	}

	function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			onSubmit(e as unknown as React.FormEvent);
		}
	}

	const showThinking =
		isStreaming && streamingText === '' && streamingTools.length === 0;

	const activeThread = threads.find((t) => t.id === activeThreadId);

	return (
		<div
			style={{
				display: 'flex',
				height: '100vh',
				background: 'var(--bg)',
				overflow: 'hidden',
			}}
		>
			{/* ── Sidebar ─────────────────────────────────────────────────── */}
			<div
				style={{
					width: 260,
					flexShrink: 0,
					borderRight: '1px solid var(--border)',
					background: 'var(--surface)',
					display: 'flex',
					flexDirection: 'column',
					overflow: 'hidden',
				}}
			>
				{/* Sidebar header */}
				<div
					style={{
						padding: '16px 14px 12px',
						borderBottom: '1px solid var(--border)',
						display: 'flex',
						alignItems: 'center',
						gap: 8,
					}}
				>
					<span style={{ fontSize: 18 }}>⛵</span>
					<span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>
						Corsair
					</span>
				</div>

				{/* New chat button */}
				<div style={{ padding: '10px 10px 6px' }}>
					<button
						className="btn-ghost"
						onClick={createNewThread}
						style={{
							width: '100%',
							textAlign: 'left',
							padding: '8px 10px',
							fontSize: 13,
							display: 'flex',
							alignItems: 'center',
							gap: 7,
						}}
					>
						<span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
						New chat
					</button>
				</div>

				{/* Thread list */}
				<div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
					{threads.length === 0 ? (
						<p
							style={{
								color: 'var(--muted)',
								fontSize: 12,
								padding: '8px 8px',
							}}
						>
							No chats yet
						</p>
					) : (
						threads.map((thread) => (
							<ThreadItem
								key={thread.id}
								thread={thread}
								active={thread.id === activeThreadId}
								onClick={() => setActiveThreadId(thread.id)}
							/>
						))
					)}
				</div>
			</div>

			{/* ── Chat area ──────────────────────────────────────────────── */}
			<div
				style={{
					flex: 1,
					display: 'flex',
					flexDirection: 'column',
					overflow: 'hidden',
				}}
			>
				{/* Chat header */}
				<div
					style={{
						padding: '14px 24px',
						borderBottom: '1px solid var(--border)',
						background: 'var(--surface)',
						display: 'flex',
						alignItems: 'center',
						gap: 10,
						flexShrink: 0,
					}}
				>
					<span style={{ fontWeight: 600, fontSize: 14 }}>
						{activeThread?.title ?? 'Personal Agent'}
					</span>
					<span style={{ color: 'var(--muted)', fontSize: 12 }}>
						{activeThread ? '' : 'Start a new chat or select one'}
					</span>
				</div>

				{/* Messages */}
				<div
					style={{
						flex: 1,
						overflowY: 'auto',
						padding: '32px 24px',
						display: 'flex',
						flexDirection: 'column',
						gap: 24,
					}}
				>
					<div
						style={{
							maxWidth: 760,
							width: '100%',
							margin: '0 auto',
							display: 'flex',
							flexDirection: 'column',
							gap: 24,
						}}
					>
						{/* Empty state */}
						{dbMessages.length === 0 && !isStreaming && (
							<div
								style={{
									display: 'flex',
									flexDirection: 'column',
									alignItems: 'center',
									color: 'var(--muted)',
									gap: 12,
									paddingTop: 80,
								}}
							>
								<span style={{ fontSize: 40 }}>⛵</span>
								<p
									style={{
										fontSize: 15,
										fontWeight: 500,
										color: 'var(--text)',
									}}
								>
									What can I automate for you?
								</p>
								<p
									style={{
										fontSize: 13,
										textAlign: 'center',
										maxWidth: 360,
										lineHeight: 1.6,
									}}
								>
									Ask me to run scripts, create scheduled workflows, or set up
									webhook automations.
								</p>
							</div>
						)}

						{/* Committed messages */}
						{dbMessages.map((m) => (
							<MessageBubble
								key={m.id}
								role={m.role}
								text={m.text}
								toolCalls={(m.toolCalls as ToolCall[] | null) ?? undefined}
								pendingPermissionId={
									m.hasPending ? (m.hasPending as string) : undefined
								}
							/>
						))}

						{/* Streaming assistant message */}
						{isStreaming && (
							<div
								style={{
									display: 'flex',
									flexDirection: 'column',
									alignItems: 'flex-start',
									gap: 6,
								}}
							>
								<span
									style={{
										fontSize: 11,
										color: 'var(--muted)',
										textTransform: 'uppercase',
										letterSpacing: '0.05em',
										paddingLeft: 4,
									}}
								>
									Corsair
								</span>

								{streamingTools.length > 0 && (
									<div
										style={{
											display: 'flex',
											flexDirection: 'column',
											gap: 4,
										}}
									>
										{streamingTools.map((tc) => (
											<ToolPill key={tc.toolCallId} tool={tc} />
										))}
									</div>
								)}

								{showThinking ? (
									<div
										style={{
											padding: '10px 14px',
											background: 'var(--surface)',
											border: '1px solid var(--border)',
											borderRadius: '14px 14px 14px 4px',
											color: 'var(--muted)',
											fontSize: 13,
										}}
									>
										Thinking…
									</div>
								) : streamingText ? (
									<div
										style={{
											maxWidth: '85%',
											padding: '10px 14px',
											background: 'var(--surface)',
											border: '1px solid var(--border)',
											borderRadius: '14px 14px 14px 4px',
											color: 'var(--text)',
											fontSize: 14,
											lineHeight: 1.6,
											whiteSpace: 'pre-wrap',
											wordBreak: 'break-word',
										}}
									>
										{streamingText}
									</div>
								) : null}
							</div>
						)}

						<div ref={bottomRef} />
					</div>
				</div>

				{/* Input bar */}
				<div
					style={{
						borderTop: '1px solid var(--border)',
						background: 'var(--surface)',
						padding: '16px 24px',
						flexShrink: 0,
					}}
				>
					<form
						onSubmit={onSubmit}
						style={{
							display: 'flex',
							gap: 10,
							maxWidth: 760,
							margin: '0 auto',
							alignItems: 'flex-end',
						}}
					>
						<textarea
							ref={textareaRef}
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={onKeyDown}
							placeholder="Message Corsair… (Enter to send, Shift+Enter for newline)"
							rows={1}
							disabled={isStreaming}
							style={{
								flex: 1,
								resize: 'none',
								minHeight: 40,
								maxHeight: 200,
								overflowY: 'auto',
								padding: '9px 12px',
								lineHeight: 1.5,
								fontSize: 14,
								background: 'var(--bg)',
								border: '1px solid var(--border)',
								borderRadius: 'var(--radius)',
								color: 'var(--text)',
								fontFamily: 'var(--font)',
								outline: 'none',
							}}
							onInput={(e) => {
								const el = e.currentTarget;
								el.style.height = 'auto';
								el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
							}}
						/>
						<button
							type="submit"
							disabled={isStreaming || !input.trim()}
							className="btn-primary"
							style={{
								height: 40,
								paddingLeft: 18,
								paddingRight: 18,
								flexShrink: 0,
							}}
						>
							{isStreaming ? '…' : 'Send'}
						</button>
					</form>
				</div>
			</div>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Thread item in sidebar
// ─────────────────────────────────────────────────────────────────────────────

function ThreadItem({
	thread,
	active,
	onClick,
}: {
	thread: Thread;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			style={{
				width: '100%',
				textAlign: 'left',
				padding: '8px 10px',
				borderRadius: 'var(--radius)',
				background: active ? 'var(--border)' : 'transparent',
				border: 'none',
				color: active ? 'var(--text)' : 'var(--muted)',
				fontSize: 13,
				cursor: 'pointer',
				display: 'block',
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				whiteSpace: 'nowrap',
				transition: 'background 0.1s',
			}}
			onMouseEnter={(e) => {
				if (!active) e.currentTarget.style.background = '#222';
			}}
			onMouseLeave={(e) => {
				if (!active) e.currentTarget.style.background = 'transparent';
			}}
		>
			{thread.title ?? 'New chat'}
		</button>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Message bubble
// ─────────────────────────────────────────────────────────────────────────────

function MessageBubble({
	role,
	text,
	toolCalls,
	pendingPermissionId,
}: {
	role: 'user' | 'assistant';
	text: string;
	toolCalls?: ToolCall[];
	pendingPermissionId?: string;
}) {
	const isUser = role === 'user';

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: isUser ? 'flex-end' : 'flex-start',
				gap: 6,
			}}
		>
			<span
				style={{
					fontSize: 11,
					color: 'var(--muted)',
					textTransform: 'uppercase',
					letterSpacing: '0.05em',
					paddingLeft: isUser ? 0 : 4,
					paddingRight: isUser ? 4 : 0,
				}}
			>
				{isUser ? 'You' : 'Corsair'}
			</span>

			{!isUser && toolCalls && toolCalls.length > 0 && (
				<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
					{toolCalls.map((tc) => (
						<ToolPill key={tc.toolCallId} tool={tc} />
					))}
				</div>
			)}

			{text && (
				<div
					style={{
						maxWidth: '85%',
						padding: '10px 14px',
						borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
						background: isUser ? 'var(--accent)' : 'var(--surface)',
						border: isUser ? 'none' : '1px solid var(--border)',
						color: isUser ? '#fff' : 'var(--text)',
						fontSize: 14,
						lineHeight: 1.6,
						whiteSpace: 'pre-wrap',
						wordBreak: 'break-word',
					}}
				>
					{text}
				</div>
			)}

			{!isUser && pendingPermissionId && (
				<a
					href={`/permissions/${pendingPermissionId}`}
					target="_blank"
					rel="noopener noreferrer"
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: 8,
						padding: '8px 14px',
						background: '#713f12',
						border: '1px solid var(--warn)',
						borderRadius: 'var(--radius)',
						color: 'var(--warn)',
						fontSize: 13,
						fontWeight: 500,
						textDecoration: 'none',
					}}
				>
					<span>&#x1f512;</span>
					Review & approve permission
				</a>
			)}
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool pill
// ─────────────────────────────────────────────────────────────────────────────

function ToolPill({ tool }: { tool: ToolCall }) {
	return (
		<div
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: 6,
				padding: '4px 10px',
				background: 'var(--surface)',
				border: '1px solid var(--border)',
				borderRadius: 99,
				fontSize: 11,
				color: 'var(--muted)',
			}}
		>
			<span
				style={{
					width: 6,
					height: 6,
					borderRadius: '50%',
					background: tool.done ? 'var(--success)' : 'var(--warn)',
					flexShrink: 0,
				}}
			/>
			{TOOL_LABELS[tool.toolName] ?? tool.toolName}
		</div>
	);
}
