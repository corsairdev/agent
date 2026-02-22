---
name: add-plugin
description: Add a new plugin. Use when user wants to add a plugin that Corsair does not natively support.
---

You are helping a developer add a new custom plugin to their Corsair integration so they can call a third-party API through Corsair's pipeline.

## Step 1: Gather Requirements

Ask the developer two questions before doing anything else:

1. **What API/service do you want to integrate?** (e.g., "Stripe", "Twilio", "Notion", "OpenAI")
2. **What do you want to be able to do with it?** List specific actions (e.g., "create customers and charge them", "send SMS messages", "read and update pages")

## Step 2: Research the API

Use WebSearch or WebFetch to look up the API documentation. Find:
- The API base URL (e.g., `https://api.stripe.com/v1`)
- How authentication works (Bearer token, X-API-Key header, etc.)
- The exact endpoints the developer needs: URL paths, HTTP methods, request body/query fields, and response shape

## Step 3: Scaffold the Plugin

Run the scaffold command from the `agent/` directory:

```bash
npm run new-plugin <PluginName>
```

Use PascalCase (e.g., `Stripe`, `Twilio`, `OpenAI`). This creates `server/plugins/<pluginname>.ts` with a single-file boilerplate.

## Step 4: Implement the Plugin

Open the generated file and fill it in based on the API docs:

**1. Update `API_BASE`** to the correct base URL.

**2. Update the auth header** to match the API:
```typescript
// Bearer token (most common)
Authorization: `Bearer ${apiKey}`,

// API key in header
'X-API-Key': apiKey,

// Basic auth
Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
```

**3. Replace response types** with actual shapes from the API docs:
```typescript
type Customer = {
  id: string;
  email: string;
  name: string | null;
  created: number;
};
```

**4. Replace the example endpoints** with the ones the developer needs:
```typescript
const customersGet: CorsairEndpoint<StripeContext, { id: string }, Customer> = async (ctx, input) => {
  return apiRequest<Customer>(`customers/${input.id}`, ctx.key);
};

const customersCreate: CorsairEndpoint<StripeContext, { email: string; name?: string }, Customer> = async (ctx, input) => {
  return apiRequest<Customer>('customers', ctx.key, {
    method: 'POST',
    body: { email: input.email, name: input.name },
  });
};
```

**5. Update the endpoint tree** to group related endpoints:
```typescript
const endpoints = {
  customers: {
    get: customersGet,
    create: customersCreate,
    list: customersList,
  },
  charges: {
    create: chargesCreate,
  },
} as const;
```

**6. Update the plugin function name and id** to match your plugin name.

The full structure of a complete single-file plugin looks like this:

```typescript
import type {
  BindEndpoints,
  CorsairEndpoint,
  CorsairPlugin,
  CorsairPluginContext,
} from 'corsair/core';

type StripeOptions = { key: string };

const StripeSchema = { version: '1.0.0', entities: {} } as const;

type StripeContext = CorsairPluginContext<typeof StripeSchema, StripeOptions>;

type Customer = { id: string; email: string; name: string | null };

const API_BASE = 'https://api.stripe.com/v1';

async function apiRequest<T>(
  path: string,
  apiKey: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> {
  const { method = 'GET', body, query } = options;
  const url = new URL(`${API_BASE}/${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Stripe API error: ${res.status} ${res.statusText}`);
  }
  // 204 No Content
  if (res.status === 204) return { success: true } as T;
  return res.json() as Promise<T>;
}

const customersGet: CorsairEndpoint<StripeContext, { id: string }, Customer> = async (ctx, input) => {
  return apiRequest<Customer>(`customers/${input.id}`, ctx.key);
};

const endpoints = {
  customers: { get: customersGet },
} as const;

const webhooks = {} as const;

const defaultAuthType = 'api_key' as const;

// ── Plugin Types ──────────────────────────────────────────────────────────────

export type BoundEndpoints = BindEndpoints<typeof endpoints>;

export type StripePlugin<PluginOptions extends StripeOptions> = CorsairPlugin<
  'stripe',
  typeof StripeSchema,
  typeof endpoints,
  typeof webhooks,
  PluginOptions,
  typeof defaultAuthType
>;

export function stripe<const PluginOptions extends StripeOptions>(
  options: StripeOptions & PluginOptions = {} as StripeOptions & PluginOptions,
): StripePlugin<PluginOptions> {
  return {
    id: 'stripe',
    schema: StripeSchema,
    options,
    endpoints,
    keyBuilder: async (_ctx, source) => {
      if (source === 'endpoint') return options.key;
      return '';
    },
  };
}
```

## Step 5: Register the Plugin in Corsair

Open `server/corsair.ts` and add the plugin import and registration:

```typescript
import { createCorsair, googlecalendar, linear, resend, slack } from 'corsair';
import { stripe } from './plugins/stripe'; // add this
import { pool } from './db';

export const corsair = createCorsair({
  plugins: [slack(), linear(), resend(), googlecalendar(), stripe({ key: process.env.STRIPE_API_KEY! })], // add plugin here
  database: pool,
  kek: process.env.CORSAIR_MASTER_KEY!,
  multiTenancy: false,
});
```

Remind the developer to add the API key environment variable (e.g., `STRIPE_API_KEY`) to their `.env` file.

## Step 6: Add Seed Examples

Open `server/seed/examples.ts` and add 2–3 examples showing how to use the new plugin. These are used by the AI agent to understand how to write code against this API.

Each example has a `description` (plain English, used for search) and `code` (a runnable async function):

```typescript
{
  description:
    'Get a Stripe customer by their ID. Returns customer details including email, name, and metadata.',
  code: `async function main() {
  const customer = await corsair.stripe.api.customers.get({ id: 'cus_xxx' });
  console.log(customer);
}
main().catch(console.error);`,
},
{
  description:
    'Create a new Stripe customer with an email address.',
  code: `async function main() {
  const customer = await corsair.stripe.api.customers.create({
    email: 'user@example.com',
    name: 'Jane Doe',
  });
  console.log(customer.id);
}
main().catch(console.error);`,
},
```

The API call pattern is always: `corsair.<pluginId>.api.<endpointGroup>.<method>(input)`

After adding examples, regenerate the seed embeddings:

```bash
npm run seed:code
```

## Key Rules

- **All plugin code lives in a single file** (`server/plugins/<name>.ts`). No subdirectories.
- **The developer passes the API key directly**: `stripe({ key: process.env.STRIPE_API_KEY! })`. No key manager needed.
- **Use `ctx.key` inside endpoint implementations** — Corsair populates it from the `keyBuilder`.
- **Keep types simple** — inline response types are fine. No need for complex generics or separate type files.
- **The `id` field in the plugin must be a unique string** (lowercase, no spaces). It becomes the property name on `corsair.*`.
