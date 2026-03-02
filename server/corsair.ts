import { createCorsair, googlecalendar, slack, spotify } from 'corsair';
import { pool } from './db';

export const corsair = createCorsair({
	plugins: [slack(), spotify(), googlecalendar()],
	database: pool,
	kek: process.env.CORSAIR_KEK!,
	multiTenancy: false,
});
