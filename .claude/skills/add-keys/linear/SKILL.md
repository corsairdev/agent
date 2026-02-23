---
name: add-keys/linear
description: Set up Linear credentials for Corsair. Use when the user wants to connect Linear to their agent.
---

# Linear Key Setup

Read `/add-keys` first if you haven't — it explains the key model.

Auth type: **`api_key`**
- Account level: `api_key` (Linear API key), `webhook_signature` (signing secret)

---

## 1. Get credentials from Linear

### API key (`api_key`)
1. Go to https://linear.app/settings/api
2. Click **Create new API key**
3. Name it "Corsair" → copy the key (starts with `lin_api_`)

### Signing secret (`webhook_signature`)
1. Go to https://linear.app/settings/api → **Webhooks**
2. Create or open your webhook → copy the **Signing secret**

---

## 2. Write and run the setup script

Ask the user to provide both values, then write `scripts/setup-linear.ts`:

```typescript
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { corsair } from '../server/corsair';
import { db } from '../server/db';
import { corsairAccounts, corsairIntegrations } from '../server/db/schema';

const PLUGIN = 'linear';
const TENANT_ID = 'default';
const API_KEY = 'lin_api_...';   // fill in
const SIGNING_SECRET = '...';    // fill in

async function main() {
  let [integration] = await db
    .select()
    .from(corsairIntegrations)
    .where(eq(corsairIntegrations.name, PLUGIN));

  if (!integration) {
    [integration] = await db
      .insert(corsairIntegrations)
      .values({ id: crypto.randomUUID(), name: PLUGIN })
      .returning();
    console.log(`✓ Created integration: ${PLUGIN}`);
  }

  await corsair.keys.linear.issue_new_dek();
  console.log('✓ Integration DEK ready');

  const [existing] = await db
    .select()
    .from(corsairAccounts)
    .where(
      and(
        eq(corsairAccounts.tenantId, TENANT_ID),
        eq(corsairAccounts.integrationId, integration!.id),
      ),
    );

  if (!existing) {
    await db.insert(corsairAccounts).values({
      id: crypto.randomUUID(),
      tenantId: TENANT_ID,
      integrationId: integration!.id,
    });
    console.log('✓ Created account');
  }

  await corsair.linear.keys.issue_new_dek();
  console.log('✓ Account DEK ready');

  await corsair.linear.keys.set_api_key(API_KEY);
  await corsair.linear.keys.set_webhook_signature(SIGNING_SECRET);

  const stored = await corsair.linear.keys.get_api_key();
  console.log(`✓ Linear configured. Key starts with: ${stored?.slice(0, 10)}...`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Run it:

```bash
docker compose exec agent pnpm tsx scripts/setup-linear.ts
```

Then delete the script:

```bash
rm scripts/setup-linear.ts
```
