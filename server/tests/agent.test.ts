import { afterEach, describe, expect, it, vi } from 'vitest';
import * as executor from '../executor';
import * as typecheckModule from '../typecheck';

vi.mock('../search', () => ({
	searchCodeExamples: vi.fn().mockResolvedValue([]),
}));

import { snippetOutput, writeAndExecuteCodeTool } from '../agent';

const exec = writeAndExecuteCodeTool.execute!;
type ExecResult = Exclude<Awaited<ReturnType<typeof exec>>, AsyncIterable<any>>;

async function callTool(params: {
	type: 'script' | 'workflow';
	code: string;
	description?: string;
}): Promise<ExecResult> {
	return exec(params, {} as never) as Promise<ExecResult>;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// write_and_execute_code tool
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../executor', () => ({ executeScript: vi.fn() }));
vi.mock('../typecheck', () => ({ typecheck: vi.fn() }));

describe('writeAndExecuteCodeTool (script execution)', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('on script success: returns success and output snippet', async () => {
		const manyLines = Array.from(
			{ length: 50 },
			(_, i) => `stdout line ${i + 1}`,
		);
		vi.mocked(executor.executeScript).mockResolvedValue({
			success: true,
			output: manyLines.join('\n'),
		});
		vi.mocked(typecheckModule.typecheck).mockResolvedValue({
			valid: true,
			errors: '',
		});

		const result = await callTool({
			type: 'script',
			code: 'async function main() {}\nmain();',
			description: 'test',
		});

		expect(result.success).toBe(true);
		expect((result as { output?: string }).output).toBeDefined();
		expect((result as { output?: string }).output?.split('\n')).toHaveLength(
			30,
		);
		expect((result as { error?: string }).error).toBeUndefined();
	});

	it('on script failure: returns success false, errors, and optional outputSnippet', async () => {
		vi.mocked(executor.executeScript).mockResolvedValue({
			success: false,
			error: 'Process exited with code 1',
			output: 'stderr line 1\nstderr line 2',
		});
		vi.mocked(typecheckModule.typecheck).mockResolvedValue({
			valid: true,
			errors: '',
		});

		const result = await callTool({
			type: 'script',
			code: 'async function main() { throw new Error("x"); }\nmain();',
			description: '',
		});

		expect(result.success).toBe(false);
		expect((result as { error?: string }).error).toBe(
			'Script execution failed',
		);
		expect((result as { errors?: string }).errors).toBe(
			'Process exited with code 1',
		);
		expect((result as { outputSnippet?: string }).outputSnippet).toBe(
			'stderr line 1\nstderr line 2',
		);
	});

	it('on script failure with no output: returns errors only, no outputSnippet', async () => {
		vi.mocked(executor.executeScript).mockResolvedValue({
			success: false,
			error: 'Timeout',
		});
		vi.mocked(typecheckModule.typecheck).mockResolvedValue({
			valid: true,
			errors: '',
		});

		const result = await callTool({
			type: 'script',
			code: 'async function main() {}\nmain();',
			description: '',
		});

		expect(result.success).toBe(false);
		expect((result as { errors?: string }).errors).toBe('Timeout');
		expect(
			(result as { outputSnippet?: string }).outputSnippet,
		).toBeUndefined();
	});
});
