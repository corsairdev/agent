/**
 * WhatsApp authentication via pairing code.
 * Run once during setup — not during normal server operation.
 *
 * Usage: pnpm whatsapp:auth --phone 14155551234
 *   Phone number: country code + digits, no + or spaces (e.g. 14155551234 for US +1 415 555 1234)
 *
 * Writes store/auth-status.txt so the /setup skill can read the pairing code
 * and poll for completion without blocking.
 */

import makeWASocket, {
	Browsers,
	DisconnectReason,
	makeCacheableSignalKeyStore,
	useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import fs from 'fs';
import P from 'pino';

const AUTH_DIR = './store/auth';
const STATUS_FILE = './store/auth-status.txt';

const logger = P({ level: 'warn' });

const phoneArg = process.argv.find((_, i, arr) => arr[i - 1] === '--phone');

if (!phoneArg) {
	console.error('Usage: pnpm whatsapp:auth --phone 14155551234');
	console.error(
		'Phone: country code + digits, no + or spaces (e.g. 14155551234)',
	);
	process.exit(1);
}

async function authenticate(
	phoneNumber: string,
	isReconnect = false,
): Promise<void> {
	const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

	// Already registered — nothing to do
	if (state.creds.registered && !isReconnect) {
		fs.writeFileSync(STATUS_FILE, 'already_authenticated');
		console.log(
			'Already authenticated. Delete store/auth/ to re-authenticate.',
		);
		process.exit(0);
	}

	const sock = makeWASocket({
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		},
		printQRInTerminal: false,
		logger,
		browser: Browsers.macOS('Chrome'),
	});

	// Request pairing code once the socket initialises
	if (!state.creds.me) {
		setTimeout(async () => {
			try {
				const code = await sock.requestPairingCode(phoneNumber);
				console.log(`\nPairing code: ${code}`);
				console.log('\n1. Open WhatsApp on your phone');
				console.log('2. Settings → Linked Devices → Link a Device');
				console.log('3. Tap "Link with phone number instead"');
				console.log(`4. Enter: ${code}\n`);
				// Write for skill polling
				fs.writeFileSync(STATUS_FILE, `pairing_code:${code}`);
			} catch (err: any) {
				console.error('Failed to get pairing code:', err.message);
				fs.writeFileSync(STATUS_FILE, 'failed:pairing_code_error');
				process.exit(1);
			}
		}, 3000);
	}

	sock.ev.on('connection.update', (update) => {
		const { connection, lastDisconnect } = update;

		if (connection === 'close') {
			const reason = (lastDisconnect?.error as any)?.output?.statusCode;
			if (reason === DisconnectReason.loggedOut) {
				fs.writeFileSync(STATUS_FILE, 'failed:logged_out');
				console.error('Logged out during auth.');
				process.exit(1);
			} else if (reason === 515) {
				// Stream error after pairing succeeds — reconnect to finish handshake
				console.log('Stream error (515) after pairing — reconnecting...');
				authenticate(phoneNumber, true).catch(console.error);
			} else {
				fs.writeFileSync(STATUS_FILE, `failed:${reason ?? 'unknown'}`);
				console.error(`Connection closed with reason: ${reason ?? 'unknown'}`);
				process.exit(1);
			}
		}

		if (connection === 'open') {
			fs.writeFileSync(STATUS_FILE, 'authenticated');
			console.log('\nAuthenticated! Credentials saved to store/auth/');
			console.log('You can now start the server with: pnpm dev\n');
			setTimeout(() => process.exit(0), 1000);
		}
	});

	sock.ev.on('creds.update', saveCreds);
}

// Clean up stale state from previous attempts
fs.mkdirSync(AUTH_DIR, { recursive: true });
try {
	fs.unlinkSync(STATUS_FILE);
} catch {}

authenticate(phoneArg!).catch((err) => {
	console.error('Auth failed:', err.message);
	process.exit(1);
});
