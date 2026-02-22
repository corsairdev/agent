import { createCorsair, slack } from 'corsair';
import { pool } from './db';

export const corsair = createCorsair({
	plugins: [
		// example plugin. feel free to remove
		slack(),
	],
	database: pool,
	kek: process.env.CORSAIR_KEK!,
	multiTenancy: false,
});
