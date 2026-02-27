---
name: add-keys/google
description: Common Google OAuth setup for Corsair. Contains shared steps used by all Google plugins (Gmail, Google Calendar, Google Drive). Read this when setting up any Google integration — then read the plugin-specific skill for the remaining steps.
---

# Google OAuth — Common Setup

Read `/add-keys` first if you haven't — it explains the key model.

Auth type: **`oauth_2`**
- Integration level: `client_id`, `client_secret`, `redirect_url` (your Google OAuth app — shared across all Google plugins)
- Account level: `access_token`, `refresh_token` (the user's grant — per-tenant)

Gmail, Google Calendar, and Google Drive share the same OAuth app (same client_id/client_secret), but they are **separate plugins** with separate token stores and separate OAuth flows. Set up only the plugin the user asked for. Tell the user upfront: "Google takes more steps than the others, but it's a one-time setup."

---

## 1. Create a Google Cloud project

1. Go to https://console.cloud.google.com
2. Click the project selector → **New Project** → name it "Corsair" → **Create**
3. Make sure the new project is selected before continuing

---

## 2. Configure OAuth consent screen

Go to **APIs & Services → OAuth consent screen**:
1. Choose **External** → **Create**
2. Fill in: App name "Corsair", user support email, developer contact email
3. Click **Save and Continue** through Scopes (skip)
4. On **Test users**, click **Add Users** → add their Google account email
5. **Save and Continue** → **Back to Dashboard**

---

## 3. Create OAuth credentials

Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
1. Application type: **Web application** → Name: "Corsair"
2. Under **Authorized redirect URIs** add: `http://localhost:3000/oauth/callback`
3. **Create** → copy the **Client ID** and **Client Secret**

---

## 4. Write and run the setup script

Ask the user for their Client ID and Client Secret. Fill in `PLUGIN` from the plugin-specific skill (`gmail`, `googlecalendar`, or `googledrive`).

Write `scripts/setup-google.ts`:

```typescript
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { corsair } from '../server/corsair';
import { db } from '../server/db';
import { corsairAccounts, corsairIntegrations } from '../server/db/schema';

const TENANT_ID = 'default';
const REDIRECT_URL = 'http://localhost:3000/oauth/callback';

// ── credentials (fill these in) ───────────────────────────────────────────────
const CLIENT_ID = '...';
const CLIENT_SECRET = '...';
// ─────────────────────────────────────────────────────────────────────────────

// Set to 'googlecalendar', 'googledrive', or 'gmail'
const PLUGIN = '...';

async function main() {
  console.log(`\nSetting up ${PLUGIN}...`);

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
    console.log(`  ✓ Created integration`);
  }

  // 2. Issue integration DEK and set OAuth app credentials
  const integrationKeys = corsair.keys[PLUGIN]!;

  await integrationKeys.issue_new_dek();
  await integrationKeys.set_client_id(CLIENT_ID);
  await integrationKeys.set_client_secret(CLIENT_SECRET);
  await integrationKeys.set_redirect_url(REDIRECT_URL);
  console.log(`  ✓ Integration credentials stored`);

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
    console.log(`  ✓ Created account`);
  }

  // 4. Issue account DEK (tokens come from OAuth flow)
  const accountKeys = corsair[PLUGIN]!.keys;

  await accountKeys.issue_new_dek();
  console.log(`  ✓ Account DEK ready`);

  console.log(`\n✓ Credentials stored. Now complete OAuth at http://localhost:3000/oauth/${PLUGIN}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Run it:

```bash
docker compose exec agent pnpm tsx scripts/setup-google.ts
```

Then delete the script:

```bash
rm scripts/setup-google.ts
```

---

## 5. Complete the OAuth flow

Tell the user to open the OAuth URL for the plugin they set up (listed in the plugin-specific skill). The flow will:
1. Redirect them to Google's consent screen
2. After they click Allow, redirect back to `/oauth/callback`
3. Automatically exchange the code for tokens and store both `access_token` and `refresh_token`
4. Show a success page

No copying tokens manually — the server handles everything.

---

## Notes

**Token refresh:** The plugin calls `getValidAccessToken()` internally on every request, using the stored `refresh_token` + `client_id` + `client_secret` to get a fresh access token.

**Token expiry (test mode):** Google OAuth refresh tokens for apps in test mode expire after 7 days of inactivity. To avoid this, publish the app: **OAuth consent screen → Publish App**. The unverified app warning during login is fine for personal use.

**Re-authorizing:** If tokens expire or are revoked, just visit the plugin's OAuth URL again (listed in the plugin-specific skill).
