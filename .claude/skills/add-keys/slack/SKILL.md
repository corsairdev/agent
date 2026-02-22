---
name: add-keys/slack
description: Set up Slack credentials for Corsair. Use when the user wants to connect Slack to their agent.
---

# Slack Key Setup

Read `/add-keys` first if you haven't — it explains the key model.

Auth type: **`api_key`**
- Integration level: no credentials (api_key plugins have no shared provider secrets)
- Account level: `api_key` (bot token), `webhook_signature` (signing secret)

---

## 1. Get credentials from Slack

### Bot token (`api_key`)
1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. Name it (e.g. "Corsair"), choose your workspace → **Create App**
3. Go to **OAuth & Permissions** → add bot token scopes: `channels:read`, `chat:write`, `users:read`
4. Click **Install to Workspace** → Allow
5. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### Signing secret (`webhook_signature`)
1. Go to **Basic Information** → **App Credentials**
2. Copy the **Signing Secret**

---

## 2. Write and run the setup script

Ask the user to provide both values, then write `scripts/setup-slack.ts`:

```typescript
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { corsair } from '../server/corsair';
import { db } from '../server/db';
import { corsairAccounts, corsairIntegrations } from '../server/db/schema';

const PLUGIN = 'slack';
const TENANT_ID = 'default';
const BOT_TOKEN = 'xoxb-...';       // fill in
const SIGNING_SECRET = '...';       // fill in

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

  await corsair.keys.slack.issue_new_dek();
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

  await corsair.slack.keys.issue_new_dek();
  console.log('✓ Account DEK ready');

  await corsair.slack.keys.set_api_key(BOT_TOKEN);
  await corsair.slack.keys.set_webhook_signature(SIGNING_SECRET);

  const stored = await corsair.slack.keys.get_api_key();
  console.log(`✓ Slack configured. Token starts with: ${stored?.slice(0, 8)}...`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Run it:

```bash
docker compose exec agent pnpm tsx scripts/setup-slack.ts
```

Then delete the script:

```bash
rm scripts/setup-slack.ts
```

---

## 3. Verify

```bash
docker compose exec agent pnpm tsx -e "
import 'dotenv/config';
import { corsair } from './server/corsair';
corsair.slack.keys.get_api_key().then(k => console.log('key:', k?.slice(0,8) + '...')).then(() => process.exit(0));
"
```

No restart needed — the agent reads from the DB on every request.
