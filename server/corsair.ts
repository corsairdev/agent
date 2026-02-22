import {
	createCorsair,
	googlecalendar,
	googledrive,
	linear,
	resend,
	slack,
} from 'corsair';
import { pool } from './db';
import { discord } from './plugins/discord';

export const corsair = createCorsair({
	plugins: [
		slack(),
		linear(),
		resend({ key: process.env.RESEND_API_KEY }),
		googlecalendar(),
		googledrive(),
		discord({ key: process.env.DISCORD_BOT_TOKEN! }),
	],
	database: pool,
	kek: process.env.CORSAIR_MASTER_KEY!,
	multiTenancy: false,
});
