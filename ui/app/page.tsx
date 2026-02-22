'use client';

import { useEffect, useRef, useState } from 'react';
import { trpc } from '../lib/trpc';

const TOOL_LABELS: Record<string, string> = {
	write_and_execute_code: 'Writing & running code',
	search_code_examples: 'Searching examples',
	manage_workflows: 'Managing workflows',
	web_search: 'Searching the web',
	ask_human: 'Waiting for input',
	get_conversation_history: 'Reading history',
};

type ToolCall = { toolCallId: string; toolName: string; done: boolean };

type Message =
	| { role: 'user'; text: string }
	| { role: 'assistant'; text: string; toolCalls: ToolCall[] };

// The shape we send to the tRPC subscription (matches UIMessage without id)
type OutboundMessage = { role: 'user' | 'assistant'; parts: { type: 'text'; text: string }[] };

function toOutbound(msgs: Message[]): OutboundMessage[] {
	return msgs.map((m) => ({
		role: m.role,
		parts: [{ type: 'text' as const, text: m.text }],
	}));
}

export default function ChatPage() {
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState('');
	// pendingMessages is set when the user submits; drives the subscription
	const [pendingMessages, setPendingMessages] = useState<OutboundMessage[] | null>(null);
	const [streamingText, setStreamingText] = useState('');
	const [streamingTools, setStreamingTools] = useState<ToolCall[]>([]);
	const bottomRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const isStreaming = pendingMessages !== null;

	// Auto-scroll on new content
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages, streamingText, streamingTools]);

	// Start/restart the tRPC subscription whenever pendingMessages changes
	useEffect(() => {
		if (!pendingMessages) return;

		setStreamingText('');
		setStreamingTools([]);

		const sub = trpc.chat.subscribe(
			{ messages: pendingMessages },
			{
				onData(chunk) {
					if (chunk.type === 'text-delta') {
						setStreamingText((prev) => prev + chunk.delta);
					} else if (chunk.type === 'tool-call') {
						setStreamingTools((prev) => [
							...prev,
							{ toolCallId: chunk.toolCallId, toolName: chunk.toolName, done: false },
						]);
					} else if (chunk.type === 'tool-result') {
						setStreamingTools((prev) =>
							prev.map((t) =>
								t.toolCallId === chunk.toolCallId ? { ...t, done: true } : t,
							),
						);
					} else if (chunk.type === 'finish') {
						setMessages((prev) => {
							const finalText = streamingTextRef.current;
							const finalTools = streamingToolsRef.current;
							return [
								...prev,
								{ role: 'assistant', text: finalText, toolCalls: finalTools },
							];
						});
						setStreamingText('');
						setStreamingTools([]);
						setPendingMessages(null);
					}
				},
				onError(err) {
					console.error('[chat] subscription error:', err);
					setPendingMessages(null);
				},
			},
		);

		return () => sub.unsubscribe();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pendingMessages]);

	// Keep refs in sync so the finish handler can read the latest streaming state
	const streamingTextRef = useRef('');
	const streamingToolsRef = useRef<ToolCall[]>([]);
	useEffect(() => { streamingTextRef.current = streamingText; }, [streamingText]);
	useEffect(() => { streamingToolsRef.current = streamingTools; }, [streamingTools]);

	function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		const trimmed = input.trim();
		if (!trimmed || isStreaming) return;

		const userMsg: Message = { role: 'user', text: trimmed };
		const next = [...messages, userMsg];
		setMessages(next);
		setInput('');
		if (textareaRef.current) textareaRef.current.style.height = 'auto';
		setPendingMessages(toOutbound(next));
	}

	function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			onSubmit(e as unknown as React.FormEvent);
		}
	}

	const showThinking =
		isStreaming && streamingText === '' && streamingTools.length === 0;

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				height: '100vh',
				background: 'var(--bg)',
			}}
		>
			{/* Header */}
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
				<span style={{ fontSize: 18 }}>⛵</span>
				<span style={{ fontWeight: 700, fontSize: 15 }}>Corsair</span>
				<span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 2 }}>
					Personal Agent
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
					{messages.length === 0 && !isStreaming && (
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
							<p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>
								What can I automate for you?
							</p>
							<p style={{ fontSize: 13, textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
								Ask me to run scripts, create scheduled workflows, or set up webhook
								automations.
							</p>
						</div>
					)}

					{/* Committed messages */}
					{messages.map((m, i) => (
						<MessageBubble key={i} message={m} />
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

							{/* Tool pills */}
							{streamingTools.length > 0 && (
								<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
						style={{ height: 40, paddingLeft: 18, paddingRight: 18, flexShrink: 0 }}
					>
						{isStreaming ? '…' : 'Send'}
					</button>
				</form>
			</div>
		</div>
	);
}

function MessageBubble({ message }: { message: Message }) {
	const isUser = message.role === 'user';
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

			{message.role === 'assistant' && message.toolCalls.length > 0 && (
				<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
					{message.toolCalls.map((tc) => (
						<ToolPill key={tc.toolCallId} tool={tc} />
					))}
				</div>
			)}

			{message.text && (
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
					{message.text}
				</div>
			)}
		</div>
	);
}

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
