import { describe, expect, it } from 'vitest';
import { snippetOutput } from '../agent';

// ─────────────────────────────────────────────────────────────────────────────
// snippetOutput
// ─────────────────────────────────────────────────────────────────────────────

describe('snippetOutput', () => {
	it('returns first 30 non-empty trimmed lines', () => {
		const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
		const full = lines.join('\n');
		const out = snippetOutput(full);
		expect(out.split('\n')).toHaveLength(30);
		expect(out.startsWith('line 1')).toBe(true);
		expect(out.endsWith('line 30')).toBe(true);
	});

	it('trims and drops empty lines', () => {
		const full = '  a  \n\n  b  \n  c  ';
		expect(snippetOutput(full)).toBe('a\nb\nc');
	});

	it('returns empty string for empty input', () => {
		expect(snippetOutput('')).toBe('');
		expect(snippetOutput('   \n\n  ')).toBe('');
	});

	it('does not classify or match auth keywords — just returns snippet', () => {
		const outputWith401 = 'Something failed\n401 Unauthorized\nToken expired';
		expect(snippetOutput(outputWith401)).toBe(outputWith401);
	});
});
