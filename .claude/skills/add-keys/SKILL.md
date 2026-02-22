---
name: add-keys
description: Explains Corsair's key management model. Read this before running any plugin key setup skill. Understand the two-level key system before writing any setup scripts.
---

# Corsair Key Management

## Credentials

**Never ask the user to paste a credential into chat.** Instead, run `pwd` to get the absolute project path, then tell the user to write it directly into `.env` via a shell command. Always show the exact command with the env var name and a clear placeholder:

```bash
echo 'SOME_API_KEY=YOUR_KEY_HERE' >> /absolute/path/to/.env
```

When writing setup scripts, read credentials from `process.env` rather than hardcoding them. For example:

```typescript
const API_KEY = process.env.SOME_API_KEY!;
```

After the script runs and the key is stored in the DB, remove the temp lines from `.env` yourself — run a shell command to delete any lines you added. For example, to remove a line containing `SOME_API_KEY`:

```bash
sed -i '' '/^SOME_API_KEY=/d' /absolute/path/to/.env
```

Do this for every env var you asked the user to add before moving on.

---

## Storage

Keys are **never stored in `.env`** long-term. The only things that permanently belong in `.env` are:
- `CORSAIR_KEK` — the Key Encryption Key (master key for envelope encryption)
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` — the AI provider key

Everything else (Slack tokens, Linear keys, Google OAuth credentials, etc.) is stored **encrypted in the database**. This means:
- No agent restart needed when setting or updating a key
- Keys are encrypted at rest using envelope encryption (DEK wrapped by KEK)
- Credentials never appear in environment variables or config files

---

## Two-level key model

Every plugin has two key managers:

### Integration level — `corsair.keys.[plugin]`
Provider/app credentials shared across all users. For OAuth2 plugins this holds the OAuth client credentials. For API key plugins these fields are empty (no shared credentials).

| Auth type | Integration fields |
|-----------|-------------------|
| `api_key` | *(none)* |
| `bot_token` | *(none)* |
| `oauth_2` | `client_id`, `client_secret`, `redirect_url` |

### Account level — `corsair.[plugin].keys`
Per-user credentials. For single-tenant setups the tenant ID is always `'default'`.

| Auth type | Account fields |
|-----------|---------------|
| `api_key` | `api_key`, `webhook_signature` |
| `bot_token` | `bot_token`, `webhook_signature` |
| `oauth_2` | `access_token`, `refresh_token`, `expires_at`, `scope`, `webhook_signature` |

Each level has auto-generated `get_<field>()` and `set_<field>()` methods.

---

## DB rows required

Before calling any `set_*` or `issue_new_dek()` method, two rows must exist:

1. A row in `corsair_integrations` with `name = '<plugin-id>'`
2. A row in `corsair_accounts` with `tenant_id = 'default'` and the matching `integration_id`

Then each level needs its DEK initialised via `issue_new_dek()` before any field can be encrypted.

---

## Script pattern

All key setup is done by writing a TypeScript script, running it once inside the container, then deleting it. The script handles both first-time setup and updates.

**Template for `api_key` plugins:**

```typescript
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { corsair } from '../server/corsair';
import { db } from '../server/db';
import { corsairAccounts, corsairIntegrations } from '../server/db/schema';

const PLUGIN = 'slack'; // plugin id
const TENANT_ID = 'default';

// ── credentials (fill these in) ───────────────────────────────────────────────
const API_KEY = 'xoxb-...';
const WEBHOOK_SIGNATURE = '...';
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Ensure integration row exists
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

  // 2. Issue (or rotate) integration-level DEK
  await corsair.keys.slack.issue_new_dek();
  console.log('✓ Integration DEK ready');

  // 3. Ensure account row exists
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

  // 4. Issue (or rotate) account-level DEK
  await corsair.slack.keys.issue_new_dek();
  console.log('✓ Account DEK ready');

  // 5. Store credentials
  await corsair.slack.keys.set_api_key(API_KEY);
  await corsair.slack.keys.set_webhook_signature(WEBHOOK_SIGNATURE);

  // 6. Verify
  const stored = await corsair.slack.keys.get_api_key();
  console.log(`✓ Done. Key starts with: ${stored?.slice(0, 8)}...`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**Template for `oauth_2` plugins** (e.g. Google) — needs both integration AND account credentials:

```typescript
// Integration level (provider/app credentials)
await corsair.keys.googlecalendar.issue_new_dek();
await corsair.keys.googlecalendar.set_client_id(CLIENT_ID);
await corsair.keys.googlecalendar.set_client_secret(CLIENT_SECRET);
await corsair.keys.googlecalendar.set_redirect_url('http://localhost:3000/oauth/callback');

// Account level (user tokens)
await corsair.googlecalendar.keys.issue_new_dek();
await corsair.googlecalendar.keys.set_refresh_token(REFRESH_TOKEN);
```

---

## Running a script

Write the script to `scripts/setup-<plugin>.ts`, run it, then delete it:

```bash
docker compose exec agent pnpm tsx scripts/setup-<plugin>.ts
```

No restart needed. The running agent reads keys from the DB on every request.

**Always delete the script after it runs** — it contains credentials in plaintext:

```bash
rm scripts/setup-<plugin>.ts
```

---

## Plugin sub-skills

Each plugin has its own skill with the exact script to run:

| Plugin | Auth type | Skill |
|--------|-----------|-------|
| Slack | `api_key` | `/add-keys/slack` |
| Linear | `api_key` | `/add-keys/linear` |
| Resend | `api_key` | `/add-keys/resend` |
| Discord | `api_key` | `/add-keys/discord` |
| Google Calendar | `oauth_2` | `/add-keys/google` |
| Google Drive | `oauth_2` | `/add-keys/google` (shares credentials with Calendar) |
