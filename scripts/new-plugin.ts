import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const pluginName = process.argv[2];

if (!pluginName) {
	console.error('Usage: npm run new-plugin <PluginName>');
	console.error('Example: npm run new-plugin Stripe');
	process.exit(1);
}

if (!/^[A-Z][a-zA-Z0-9]*$/.test(pluginName)) {
	console.error(
		`Plugin name must be PascalCase and start with an uppercase letter (e.g., "Stripe", "OpenAI", "Twilio")`,
	);
	process.exit(1);
}

const lowerName = pluginName.toLowerCase();
const pluginsDir = join(process.cwd(), 'server/plugins');
const pluginFile = join(pluginsDir, `${lowerName}.ts`);

if (existsSync(pluginFile)) {
	console.error(`Plugin file already exists at server/plugins/${lowerName}.ts`);
	process.exit(1);
}

if (!existsSync(pluginsDir)) {
	mkdirSync(pluginsDir, { recursive: true });
}

const content = `import type {
\tBindEndpoints,
\tCorsairEndpoint,
\tCorsairPlugin,
\tCorsairPluginContext,
} from 'corsair/core';

// ── Options ───────────────────────────────────────────────────────────────────

type ${pluginName}Options = {
\tkey: string;
};

// ── Schema ────────────────────────────────────────────────────────────────────
// Add Zod entities here if you want Corsair to persist data from this API

const ${pluginName}Schema = { version: '1.0.0', entities: {} } as const;

// ── Context ───────────────────────────────────────────────────────────────────

type ${pluginName}Context = CorsairPluginContext<typeof ${pluginName}Schema, ${pluginName}Options>;

// ── Response Types ────────────────────────────────────────────────────────────
// TODO: Replace with actual response types from the API docs

type ExampleItem = {
\tid: string;
\tname: string;
};

// ── HTTP Client ───────────────────────────────────────────────────────────────

const API_BASE = 'https://api.example.com'; // TODO: Update with the correct base URL

async function apiRequest<T>(
\tpath: string,
\tapiKey: string,
\toptions: {
\t\tmethod?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
\t\tbody?: Record<string, unknown>;
\t\tquery?: Record<string, string | number | boolean | undefined>;
\t} = {},
): Promise<T> {
\tconst { method = 'GET', body, query } = options;
\tconst url = new URL(\`\${API_BASE}/\${path}\`);

\tif (query) {
\t\tfor (const [k, v] of Object.entries(query)) {
\t\t\tif (v !== undefined) url.searchParams.set(k, String(v));
\t\t}
\t}

\tconst res = await fetch(url.toString(), {
\t\tmethod,
\t\theaders: {
\t\t\t// TODO: Update auth header to match the API's requirements
\t\t\t// Common patterns:
\t\t\t//   Authorization: \`Bearer \${apiKey}\`   — most common
\t\t\t//   'X-API-Key': apiKey
\t\t\t//   Authorization: \`Token \${apiKey}\`
\t\t\tAuthorization: \`Bearer \${apiKey}\`,
\t\t\t'Content-Type': 'application/json',
\t\t},
\t\tbody: body ? JSON.stringify(body) : undefined,
\t});

\tif (!res.ok) {
\t\tthrow new Error(\`${pluginName} API error: \${res.status} \${res.statusText}\`);
\t}

\t// 204 No Content
\tif (res.status === 204) return { success: true } as T;

\treturn res.json() as Promise<T>;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────
// TODO: Replace these example endpoints with the actual endpoints you need

const exampleGet: CorsairEndpoint<${pluginName}Context, { id: string }, ExampleItem> = async (
\tctx,
\tinput,
) => {
\treturn apiRequest<ExampleItem>(\`example/\${input.id}\`, ctx.key);
};

const exampleList: CorsairEndpoint<${pluginName}Context, { limit?: number }, { data: ExampleItem[] }> =
\tasync (ctx, input) => {
\t\treturn apiRequest<{ data: ExampleItem[] }>('example', ctx.key, {
\t\t\tquery: { limit: input.limit },
\t\t});
\t};

// ── Endpoint Tree ─────────────────────────────────────────────────────────────

const endpoints = {
\texample: {
\t\tget: exampleGet,
\t\tlist: exampleList,
\t},
} as const;

const webhooks = {} as const;

const defaultAuthType = 'api_key' as const;

// ── Plugin Types ──────────────────────────────────────────────────────────────

export type BoundEndpoints = BindEndpoints<typeof endpoints>;

export type ${pluginName}Plugin<PluginOptions extends ${pluginName}Options> = CorsairPlugin<
\t'${lowerName}',
\ttypeof ${pluginName}Schema,
\ttypeof endpoints,
\ttypeof webhooks,
\tPluginOptions,
\ttypeof defaultAuthType
>;

// ── Plugin ────────────────────────────────────────────────────────────────────

export function ${lowerName}<const PluginOptions extends ${pluginName}Options>(
\toptions: ${pluginName}Options & PluginOptions = {} as ${pluginName}Options & PluginOptions,
): ${pluginName}Plugin<PluginOptions> {
\treturn {
\t\tid: '${lowerName}',
\t\tschema: ${pluginName}Schema,
\t\toptions,
\t\tendpoints,
\t\tkeyBuilder: async (_ctx, source) => {
\t\t\tif (source === 'endpoint') return options.key;
\t\t\treturn '';
\t\t},
\t};
}
`;

writeFileSync(pluginFile, content);

console.log(`✅ Created server/plugins/${lowerName}.ts`);
console.log(`
Next steps:
  1. Update API_BASE to the correct base URL
  2. Update the auth header to match the API's requirements
  3. Replace ExampleItem and the example endpoints with actual types and endpoints
  4. Import and add the plugin to server/corsair.ts:
       import { ${lowerName} } from './plugins/${lowerName}';
       plugins: [..., ${lowerName}({ key: process.env.${pluginName.toUpperCase()}_API_KEY! })]
`);
