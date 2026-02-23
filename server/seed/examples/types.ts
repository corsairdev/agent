// ─────────────────────────────────────────────────────────────────────────────
// Shared types for code examples
// ─────────────────────────────────────────────────────────────────────────────

export interface BaseCodeExample {
	description: string;
	code: string;
}

export interface CodeExample extends BaseCodeExample {
	plugin: string;
}
