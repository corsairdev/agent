---
name: add-keys/resend
description: Set up Resend credentials for Corsair. Use when the user wants to send emails from their agent.
---

# Resend Key Setup

Read `/add-keys` first if you haven't — it explains the key model.

Auth type: **`api_key`**
- Account level: `api_key` (Resend API key)

---

## 1. Get credentials from Resend

1. Go to https://resend.com and sign in (or create a free account)
2. In the sidebar go to **API Keys** → **Create API Key**
3. Name it "Corsair", choose **Full access** → copy the key (starts with `re_`)

---

## 2. Write and run the setup script

Ask the user to provide the key, then write `scripts/setup-resend.ts`:

```typescript
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { corsair } from '../server/corsair';
import { db } from '../server/db';
import { corsairAccounts, corsairIntegrations } from '../server/db/schema';

const PLUGIN = 'resend';
const TENANT_ID = 'default';
const API_KEY = 're_...';   // fill in

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

  await corsair.keys.resend.issue_new_dek();
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

  await corsair.resend.keys.issue_new_dek();
  console.log('✓ Account DEK ready');

  await corsair.resend.keys.set_api_key(API_KEY);

  const stored = await corsair.resend.keys.get_api_key();
  console.log(`✓ Resend configured. Key starts with: ${stored?.slice(0, 5)}...`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Run it:

```bash
docker compose exec agent pnpm tsx scripts/setup-resend.ts
```

Then delete the script:

```bash
rm scripts/setup-resend.ts
```
