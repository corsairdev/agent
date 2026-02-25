import { createCorsair, slack } from 'corsair';
import { pool } from './db';

export const corsair = createCorsair({
	plugins: [slack()],
	database: pool,
	kek: process.env.CORSAIR_KEK!,
	multiTenancy: false,
});
