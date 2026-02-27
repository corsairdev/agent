---
name: add-keys/todoist
description: Set up Todoist credentials for Corsair. Use when the user wants to connect Todoist to their agent.
---

# Todoist Key Setup

Read `/add-keys` first if you haven't — it explains the key model.

Auth type: **`api_key`**
- Integration level: no credentials (api_key plugins have no shared provider secrets)
- Account level: `api_key` (Todoist API token), `webhook_signature` (webhook signing secret)

---

## 1. Get credentials from Todoist

### API token (`api_key`)
1. Go to https://app.todoist.com/app/settings/integrations/developer
2. Scroll to **API token** and copy it

### Webhook signing secret (`webhook_signature`) — only needed if using webhooks
1. In your Todoist app integration settings, find the webhook configuration
2. Copy the signing secret (used to verify `x-todoist-signature` header on incoming webhooks)
3. The webhook URL to register is stored in your `.env` as `WEBHOOK_URL`

---

## 2. Write and run the setup script

Ask the user to provide the values, then write `scripts/setup-todoist.ts`:

```typescript
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { corsair } from '../server/corsair';
import { db } from '../server/db';
import { corsairAccounts, corsairIntegrations } from '../server/db/schema';

const PLUGIN = 'todoist';
const TENANT_ID = 'default';
const API_TOKEN = '...';          // fill in — from Todoist settings → Integrations → Developer
const WEBHOOK_SIGNATURE = '...';  // fill in — leave empty string if not using webhooks

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

  await corsair.keys.todoist.issue_new_dek();
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

  await corsair.todoist.keys.issue_new_dek();
  console.log('✓ Account DEK ready');

  await corsair.todoist.keys.set_api_key(API_TOKEN);
  if (WEBHOOK_SIGNATURE) {
    await corsair.todoist.keys.set_webhook_signature(WEBHOOK_SIGNATURE);
  }

  const stored = await corsair.todoist.keys.get_api_key();
  console.log(`✓ Todoist configured. Token starts with: ${stored?.slice(0, 8)}...`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Run it:

```bash
docker compose exec agent pnpm tsx scripts/setup-todoist.ts
```

Then delete the script:

```bash
rm scripts/setup-todoist.ts
```

---

## 3. Verify

```bash
docker compose exec agent pnpm tsx -e "
import 'dotenv/config';
import { corsair } from './server/corsair';
corsair.todoist.keys.get_api_key().then(k => console.log('key:', k?.slice(0,8) + '...')).then(() => process.exit(0));
"
```

No restart needed — the agent reads from the DB on every request.
