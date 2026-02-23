import { codeExamples } from './seed/examples';

// ─────────────────────────────────────────────────────────────────────────────
// Search code examples by plugin name or keyword
// ─────────────────────────────────────────────────────────────────────────────

export interface CodeExampleResult {
	plugin: string;
	description: string;
	code: string;
}

/**
 * Search for code examples by plugin name or keyword.
 *
 * Matches against `plugin` first (exact or partial), then falls back to
 * searching `description` for the query terms. Returns up to `limit` results.
 *
 * @param query - Plugin name (e.g. "slack") or keyword (e.g. "channels")
 * @param limit - Maximum number of results to return (default: 5)
 */
export function searchCodeExamples(
	query: string,
	limit = 5,
): CodeExampleResult[] {
	const q = query.toLowerCase().trim();

	console.log(`[search] Searching code examples for: "${q}"`);

	const pluginMatches = codeExamples.filter((e) =>
		e.plugin.toLowerCase().includes(q),
	);

	if (pluginMatches.length > 0) {
		console.log(
			`[search] Found ${pluginMatches.length} plugin matches, returning up to ${limit}`,
		);
		return pluginMatches.slice(0, limit).map(({ plugin, description, code }) => ({
			plugin,
			description,
			code,
		}));
	}

	// Fall back to description keyword search
	const terms = q.split(/\s+/).filter(Boolean);
	const descriptionMatches = codeExamples.filter((e) => {
		const desc = e.description.toLowerCase();
		return terms.every((term) => desc.includes(term));
	});

	console.log(
		`[search] Found ${descriptionMatches.length} description matches, returning up to ${limit}`,
	);

	return descriptionMatches
		.slice(0, limit)
		.map(({ plugin, description, code }) => ({ plugin, description, code }));
}
