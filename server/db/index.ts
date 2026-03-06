import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import * as schema from './schema';

// Load env as early as possible (import order matters with ESM).
// Use an absolute path so this works regardless of cwd (e.g. when spawned by Claude Desktop MCP).
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

// ─────────────────────────────────────────────────────────────────────────────
// Connection (shared with Corsair)
// ─────────────────────────────────────────────────────────────────────────────

const connectionString =
	process.env.DATABASE_URL ??
	'postgres://postgres:secret@localhost:5432/corsair';

export const pool: Pool = new Pool({
	connectionString,
});

export const db = drizzle(pool, { schema });

export type DB = typeof db;

// Re-export schema for convenience
export * from './schema';
