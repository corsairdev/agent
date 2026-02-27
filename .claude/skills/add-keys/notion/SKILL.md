---
name: add-keys/notion
description: Set up Notion credentials for Corsair. Use when the user wants to connect Notion to their agent.
---

# Notion Key Setup

Read `/add-keys` first if you haven't — it explains the key model.

Auth type: **`api_key`**
- Integration level: no credentials (api_key plugins have no shared provider secrets)
- Account level: `api_key` (Notion internal integration token), `webhook_signature` (webhook signing secret)

---

## 1. Get credentials from Notion

### Integration token (`api_key`)
1. Go to https://www.notion.so/profile/integrations
2. Click **New integration** (or select an existing one)
3. Give it a name and select the associated workspace
4. Under **Capabilities**, enable the permissions your agent needs (read/update/insert content)
5. Click **Save** and copy the **Internal Integration Secret** (starts with `secret_`)
6. Make sure to share the relevant Notion pages/databases with your integration (open a page → **...** menu → **Add connections** → select your integration)

### Webhook signing secret (`webhook_signature`) — only needed if using webhooks
1. In your Notion integration settings, find the **Webhooks** section
2. Add a webhook endpoint pointing to your `WEBHOOK_URL` (from your `.env`)
3. Copy the signing secret used to verify `x-notion-signature` on incoming requests

---

## 2. Write and run the setup script

Ask the user to provide the values, then write `scripts/setup-notion.ts`:

```typescript
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { corsair } from '../server/corsair';
import { db } from '../server/db';
import { corsairAccounts, corsairIntegrations } from '../server/db/schema';

const PLUGIN = 'notion';
const TENANT_ID = 'default';
const INTEGRATION_TOKEN = 'secret_...'; // fill in — from Notion integration settings
const WEBHOOK_SIGNATURE = '';           // fill in — leave empty string if not using webhooks

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

  await corsair.keys.notion.issue_new_dek();
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

  await corsair.notion.keys.issue_new_dek();
  console.log('✓ Account DEK ready');

  await corsair.notion.keys.set_api_key(INTEGRATION_TOKEN);
  if (WEBHOOK_SIGNATURE) {
    await corsair.notion.keys.set_webhook_signature(WEBHOOK_SIGNATURE);
  }

  const stored = await corsair.notion.keys.get_api_key();
  console.log(`✓ Notion configured. Token starts with: ${stored?.slice(0, 8)}...`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Run it:

```bash
docker compose exec agent pnpm tsx scripts/setup-notion.ts
```

Then delete the script:

```bash
rm scripts/setup-notion.ts
```

---

## 3. Verify

```bash
docker compose exec agent pnpm tsx -e "
import 'dotenv/config';
import { corsair } from './server/corsair';
corsair.notion.keys.get_api_key().then(k => console.log('key:', k?.slice(0,8) + '...')).then(() => process.exit(0));
"
```

No restart needed — the agent reads from the DB on every request.
