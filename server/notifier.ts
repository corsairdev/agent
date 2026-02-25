// ─────────────────────────────────────────────────────────────────────────────
// Notifier — routes outbound notifications back to the originating chat channel.
//
// WhatsApp and Telegram index modules register their sendMessage functions here
// on startup. The scheduler and webhook dispatcher call notifyJid() after each
// workflow execution so the user is kept in the loop.
// ─────────────────────────────────────────────────────────────────────────────

type WhatsAppSender = (jid: string, text: string) => Promise<void>;
type TelegramSender = (chatId: number, text: string) => Promise<void>;

let waSend: WhatsAppSender | null = null;
let tgSend: TelegramSender | null = null;

export function registerWhatsAppSender(fn: WhatsAppSender) {
	waSend = fn;
}

export function registerTelegramSender(fn: TelegramSender) {
	tgSend = fn;
}

/** Send a notification to a user identified by their chat JID (e.g. "tg:12345" or a WhatsApp JID). */
export async function notifyJid(jid: string, text: string): Promise<void> {
	try {
		if (jid.startsWith('tg:')) {
			const chatId = Number(jid.replace(/^tg:/, ''));
			if (tgSend) {
				await tgSend(chatId, text);
			} else {
				console.warn(
					`[notifier] No Telegram sender registered, skipping notification to ${jid}`,
				);
			}
		} else {
			if (waSend) {
				await waSend(jid, text);
			} else {
				console.warn(
					`[notifier] No WhatsApp sender registered, skipping notification to ${jid}`,
				);
			}
		}
	} catch (err) {
		console.error(`[notifier] Failed to send notification to ${jid}:`, err);
	}
}
