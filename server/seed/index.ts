import 'dotenv/config';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { eq } from 'drizzle-orm';
import { codeExamples, db } from '../db';

import { codeExamples as examples } from './examples';

// ─────────────────────────────────────────────────────────────────────────────
// Seed script — upserts code examples into the vector DB
//
// Strategy (keyed on description):
//   - NEW:    description not in DB → embed + insert
//   - UPDATE: description matches but code changed → update code only (no re-embed)
//   - DELETE: DB row whose description is no longer in the source files → delete
//   - SKIP:   description + code both match → do nothing
// ─────────────────────────────────────────────────────────────────────────────

async function seed() {
	console.log('[seed] Starting seed process...');
	console.log(`[seed] Found ${examples.length} code examples in source files`);

	if (!process.env.OPENAI_API_KEY) {
		throw new Error('OPENAI_API_KEY environment variable is required');
	}

	const embeddingModel = openai.embedding('text-embedding-3-small');

	// Fetch all existing DB rows up front
	const dbRows = await db.select().from(codeExamples);
	console.log(`[seed] Found ${dbRows.length} existing examples in database`);

	// Index DB rows by description for O(1) lookup
	const dbByDescription = new Map(dbRows.map((row) => [row.description, row]));

	// Track which descriptions still exist locally (for deletion detection)
	const localDescriptions = new Set(examples.map((e) => e.description));

	let added = 0;
	let updated = 0;
	let skipped = 0;

	// ── Process each local example ─────────────────────────────────────────────

	for (const example of examples) {
		const dbRow = dbByDescription.get(example.description);

		if (!dbRow) {
			// New example — generate embedding and insert
			console.log(`[seed] [NEW]    ${example.description.substring(0, 70)}...`);

			const { embedding } = await embed({
				model: embeddingModel,
				value: example.description,
			});

			await db.insert(codeExamples).values({
				vector: embedding,
				description: example.description,
				code: example.code,
			});

			added++;
		} else if (dbRow.code !== example.code) {
			// Code changed, description unchanged — update code only (keep existing embedding)
			console.log(`[seed] [UPDATE] ${example.description.substring(0, 70)}...`);

			await db
				.update(codeExamples)
				.set({ code: example.code, updatedAt: new Date() })
				.where(eq(codeExamples.id, dbRow.id));

			updated++;
		} else {
			// Nothing changed
			skipped++;
		}
	}

	// ── Delete rows no longer present in source files ──────────────────────────

	const toDelete = dbRows.filter(
		(row) => !localDescriptions.has(row.description),
	);

	for (const row of toDelete) {
		console.log(`[seed] [DELETE] ${row.description.substring(0, 70)}...`);
		await db.delete(codeExamples).where(eq(codeExamples.id, row.id));
	}

	console.log(
		`[seed] Done — added: ${added}, updated: ${updated}, deleted: ${toDelete.length}, skipped: ${skipped}`,
	);
	process.exit(0);
}

seed().catch((error) => {
	console.error('[seed] Fatal error:', error);
	process.exit(1);
});
