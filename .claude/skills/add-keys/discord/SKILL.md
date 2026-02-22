---
name: add-keys/discord
description: Set up Discord credentials for Corsair. Use when the user wants to connect Discord to their agent.
---

# Discord Key Setup

Read `/add-keys` first if you haven't — it explains the key model.

Auth type: **`api_key`**
- Account level: `api_key` (bot token), `webhook_signature` (public key for verifying interactions)

---

## 1. Get credentials from Discord

### Bot token (`api_key`)
1. Go to https://discord.com/developers/applications → **New Application**
2. Name it (e.g. "Corsair") → **Create**
3. Go to **Bot** → **Reset Token** → confirm → copy the token
4. Under **Privileged Gateway Intents**, enable **Message Content Intent**

### Public key (`webhook_signature`)
1. Go to **General Information**
2. Copy the **Public Key**

### Invite the bot to your server
1. Go to **OAuth2 → URL Generator** → select scope `bot`
2. Select permissions: **Send Messages**, **Read Message History**
3. Copy the URL, open it, choose your server, **Authorize**

---

## 2. Write and run the setup script

Ask the user to provide both values, then write `scripts/setup-discord.ts`:

```typescript
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { corsair } from '../server/corsair';
import { db } from '../server/db';
import { corsairAccounts, corsairIntegrations } from '../server/db/schema';

const PLUGIN = 'discord';
const TENANT_ID = 'default';
const BOT_TOKEN = '...';     // fill in
const PUBLIC_KEY = '...';    // fill in

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

  await corsair.keys.discord.issue_new_dek();
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

  await corsair.discord.keys.issue_new_dek();
  console.log('✓ Account DEK ready');

  await corsair.discord.keys.set_api_key(BOT_TOKEN);
  await corsair.discord.keys.set_webhook_signature(PUBLIC_KEY);

  const stored = await corsair.discord.keys.get_api_key();
  console.log(`✓ Discord configured. Token starts with: ${stored?.slice(0, 8)}...`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Run it:

```bash
docker compose exec agent pnpm tsx scripts/setup-discord.ts
```

Then delete the script:

```bash
rm scripts/setup-discord.ts
```
