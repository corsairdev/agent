import { Bot } from 'grammy';

export interface InboundTelegramMessage {
	chatId: number;
	senderId: number;
	senderName: string | null;
	content: string;
	isGroup: boolean;
	sentAt: Date;
}

export class TelegramConnection {
	private bot: Bot;

	constructor(
		token: string,
		private onMessage: (msg: InboundTelegramMessage) => Promise<void>,
	) {
		this.bot = new Bot(token);
		this.setupHandlers();
	}

	private setupHandlers(): void {
		// /chatid command — lets users discover their chat ID
		this.bot.command('chatid', async (ctx) => {
			await ctx.reply(`Chat ID: ${ctx.chat.id}`);
		});

		this.bot.on('message:text', async (ctx) => {
			const msg = ctx.message;
			const from = ctx.from;
			const chat = ctx.chat;

			// Skip messages the bot sent itself
			if (from?.is_bot) return;

			const firstName = from?.first_name ?? '';
			const lastName = from?.last_name ? ` ${from.last_name}` : '';
			const senderName = firstName + lastName || null;

			await this.onMessage({
				chatId: chat.id,
				senderId: from?.id ?? 0,
				senderName,
				content: msg.text,
				isGroup: chat.type === 'group' || chat.type === 'supergroup',
				sentAt: new Date(msg.date * 1000),
			});
		});
	}

	async start(): Promise<void> {
		// start() launches long polling — non-blocking, runs in background
		this.bot.start().catch((err) => {
			console.error('[telegram] Bot error:', err);
		});
		console.log('[telegram] Bot started (long polling)');
	}

	async stop(): Promise<void> {
		await this.bot.stop();
		console.log('[telegram] Bot stopped');
	}

	async sendMessage(chatId: number, text: string): Promise<void> {
		await this.bot.api.sendMessage(chatId, text);
	}

	async setTyping(chatId: number): Promise<void> {
		await this.bot.api.sendChatAction(chatId, 'typing').catch(() => {});
	}
}
