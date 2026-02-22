import { existsSync } from 'fs';
import path from 'path';
import { db, whatsappChats, whatsappMessages } from '../db';
import type { InboundMessage } from './connection';
import { defaultAuthDir, WhatsAppConnection } from './connection';
import { startPoller } from './poller';

/**
 * Start the WhatsApp integration:
 *   1. Connect Bailey socket using saved credentials (must have run `pnpm whatsapp:auth` first)
 *   2. Store every inbound message to Postgres
 *   3. Start the 2-second poller that triggers the corsair agent
 *
 * Returns an async shutdown function. Returns a no-op if auth credentials don't exist.
 */
export async function startWhatsApp(): Promise<() => Promise<void>> {
	const authDir = defaultAuthDir();

	// Only connect if credentials already exist — auth is a separate setup step
	const credsPath = path.join(authDir, 'creds.json');
	if (!existsSync(credsPath)) {
		console.log(
			'[whatsapp] No auth credentials found. Run `pnpm whatsapp:auth --phone <number>` to authenticate first.',
		);
		return async () => {};
	}

	console.log('[whatsapp] Auth credentials found, connecting...');

	const connection = new WhatsAppConnection(handleInbound, authDir);

	async function handleInbound(msg: InboundMessage): Promise<void> {
		// Skip messages the bot sent — detected by the "Corsair: " prefix.
		// We don't use fromMe because in self-chat (bot shares user's number)
		// both user messages and bot responses have fromMe: true.
		if (msg.isBot) return;

		// Upsert chat record (type is set on first message, never changes)
		await db
			.insert(whatsappChats)
			.values({
				jid: msg.jid,
				name: null,
				type: msg.isGroup ? 'group' : 'dm',
			})
			.onConflictDoNothing();

		// Store the inbound message for the poller to pick up
		await db.insert(whatsappMessages).values({
			jid: msg.jid,
			senderJid: msg.senderJid,
			senderName: msg.senderName,
			content: msg.content,
			sentAt: msg.sentAt,
			isGroup: msg.isGroup,
			isBot: false,
			processed: false,
		});

		console.log(
			`[whatsapp] Stored message from ${msg.senderName ?? msg.senderJid} in ${msg.jid}`,
		);
	}

	// Connects using saved credentials (fast — no QR or pairing needed)
	await connection.connect();

	const stopPoller = startPoller(
		(jid, text) => connection.sendMessage(jid, text),
		(jid, isTyping) => connection.setTyping(jid, isTyping),
	);

	return async () => {
		console.log('[whatsapp] Shutting down...');
		stopPoller();
		await connection.disconnect();
	};
}
