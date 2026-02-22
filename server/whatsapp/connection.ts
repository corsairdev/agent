import type { WASocket } from '@whiskeysockets/baileys';
import makeWASocket, {
	Browsers,
	DisconnectReason,
	makeCacheableSignalKeyStore,
	useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import P from 'pino';

// Suppress Baileys internal noise — it's very chatty
const logger = P({ level: 'silent' });

export interface InboundMessage {
	/** Chat JID — group JID for groups, sender JID for DMs */
	jid: string;
	/** Actual sender JID (differs from jid in groups) */
	senderJid: string;
	senderName: string | null;
	content: string;
	sentAt: Date;
	isGroup: boolean;
	/** True if this message was sent by the bot itself (detected via bot prefix) */
	isBot: boolean;
}

/** The prefix prepended to all outbound bot messages, e.g. "Corsair: Done!" */
function getBotPrefix(): string {
	return process.env.BOT_NAME || 'Corsair';
}

export type OnMessage = (msg: InboundMessage) => void | Promise<void>;

export class WhatsAppConnection {
	private sock!: WASocket;
	private connected = false;
	private outgoingQueue: Array<{ jid: string; text: string }> = [];
	private flushing = false;

	private onMessage: OnMessage;
	private authDir: string;

	constructor(onMessage: OnMessage, authDir: string) {
		this.onMessage = onMessage;
		this.authDir = authDir;
	}

	async connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			this._connect(resolve).catch(reject);
		});
	}

	private async _connect(onOpen?: () => void): Promise<void> {
		fs.mkdirSync(this.authDir, { recursive: true });

		const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

		this.sock = makeWASocket({
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(state.keys, logger),
			},
			printQRInTerminal: false,
			logger,
			browser: Browsers.macOS('Chrome'),
		});

		this.sock.ev.on('connection.update', (update) => {
			const { connection, lastDisconnect } = update;

			if (connection === 'close') {
				this.connected = false;
				const reason = (lastDisconnect?.error as any)?.output?.statusCode;
				const shouldReconnect = reason !== DisconnectReason.loggedOut;

				if (shouldReconnect) {
					console.log('[whatsapp] Connection closed, reconnecting...');
					this._connect().catch((err) => {
						console.error('[whatsapp] Reconnect failed, retrying in 5s:', err);
						setTimeout(() => this._connect().catch(console.error), 5000);
					});
				} else {
					console.log(
						'[whatsapp] Logged out. Delete store/auth/ and restart to re-authenticate.',
					);
					process.exit(0);
				}
			} else if (connection === 'open') {
				this.connected = true;
				console.log('[whatsapp] Connected to WhatsApp');
				// Announce availability so WhatsApp delivers subsequent presence updates
				this.sock.sendPresenceUpdate('available').catch(() => {});
				this._flushOutgoing().catch(console.error);
				if (onOpen) {
					onOpen();
					onOpen = undefined;
				}
			}
		});

		this.sock.ev.on('creds.update', saveCreds);

		this.sock.ev.on('messages.upsert', async ({ messages }) => {
			for (const msg of messages) {
				if (!msg.message) continue;
				const rawJid = msg.key.remoteJid;
				if (!rawJid || rawJid === 'status@broadcast') continue;

				const content =
					msg.message?.conversation ||
					msg.message?.extendedTextMessage?.text ||
					msg.message?.imageMessage?.caption ||
					msg.message?.videoMessage?.caption ||
					'';

				if (!content) continue;

				const isGroup = rawJid.endsWith('@g.us');
				// In groups, participant is the sender; in DMs, remoteJid is the sender
				const senderJid =
					(isGroup ? msg.key.participant : msg.key.remoteJid) ?? '';
				const senderName = msg.pushName ?? null;
				const sentAt = new Date(Number(msg.messageTimestamp) * 1000);

				// Detect bot messages by their prefix rather than fromMe.
				// This works whether the bot shares the user's number (self-chat)
				// or has its own dedicated number.
				const prefix = getBotPrefix();
				const isBot = content.startsWith(`${prefix}: `);

				await this.onMessage({
					jid: rawJid,
					senderJid,
					senderName,
					content,
					sentAt,
					isGroup,
					isBot,
				});
			}
		});
	}

	async sendMessage(jid: string, text: string): Promise<void> {
		// Prefix every outbound message so the bot can identify its own replies
		// when they come back through the messages.upsert event (especially in
		// self-chat, where fromMe is true for both user and bot messages).
		const prefixed = `${getBotPrefix()}: ${text}`;

		if (!this.connected) {
			this.outgoingQueue.push({ jid, text: prefixed });
			return;
		}
		try {
			await this.sock.sendMessage(jid, { text: prefixed });
		} catch (err) {
			// Queue for retry on next reconnect
			this.outgoingQueue.push({ jid, text: prefixed });
			console.warn('[whatsapp] Send failed, queued for retry:', err);
		}
	}

	async setTyping(jid: string, isTyping: boolean): Promise<void> {
		try {
			await this.sock.sendPresenceUpdate(
				isTyping ? 'composing' : 'paused',
				jid,
			);
		} catch {
			// Best-effort — don't crash if presence update fails
		}
	}

	isConnected(): boolean {
		return this.connected;
	}

	async disconnect(): Promise<void> {
		this.connected = false;
		this.sock?.end(undefined);
	}

	private async _flushOutgoing(): Promise<void> {
		if (this.flushing || this.outgoingQueue.length === 0) return;
		this.flushing = true;
		try {
			console.log(
				`[whatsapp] Flushing ${this.outgoingQueue.length} queued message(s)`,
			);
			while (this.outgoingQueue.length > 0) {
				const item = this.outgoingQueue.shift()!;
				// Items are already prefixed when queued — send as-is
				await this.sock.sendMessage(item.jid, { text: item.text });
			}
		} finally {
			this.flushing = false;
		}
	}
}

/** Default auth directory (relative to cwd, which is the agent/ directory) */
export function defaultAuthDir(): string {
	return process.env.WA_AUTH_DIR ?? path.join(process.cwd(), 'store', 'auth');
}
