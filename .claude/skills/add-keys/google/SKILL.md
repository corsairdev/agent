---
name: add-keys/google
description: Set up Google OAuth credentials for Corsair. Use when the user wants to connect Google Calendar or Google Drive. Both plugins share the same OAuth app and credentials.
---

# Google Key Setup (Calendar + Drive)

Read `/add-keys` first if you haven't — it explains the key model.

Auth type: **`oauth_2`**
- Integration level: `client_id`, `client_secret`, `redirect_url` (your Google OAuth app — shared)
- Account level: `access_token`, `refresh_token` (the user's grant — per-tenant)

Google Calendar and Google Drive share the same OAuth app (same client_id/client_secret), but they are **separate plugins** with separate token stores and separate OAuth flows. Set up only the plugin the user asked for. Tell the user upfront: "Google takes more steps than the others, but it's a one-time setup."

---

## 1. Create a Google Cloud project

1. Go to https://console.cloud.google.com
2. Click the project selector → **New Project** → name it "Corsair" → **Create**
3. Make sure the new project is selected before continuing

---

## 2. Enable APIs

Go to **APIs & Services → Library**:
- For Google Calendar: search **Google Calendar API** → **Enable**
- For Google Drive: search **Google Drive API** → **Enable**

---

## 3. Configure OAuth consent screen

Go to **APIs & Services → OAuth consent screen**:
1. Choose **External** → **Create**
2. Fill in: App name "Corsair", user support email, developer contact email
3. Click **Save and Continue** through Scopes (skip)
4. On **Test users**, click **Add Users** → add their Google account email
5. **Save and Continue** → **Back to Dashboard**

---

## 4. Create OAuth credentials

Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
1. Application type: **Web application** → Name: "Corsair"
2. Under **Authorized redirect URIs** add: `http://localhost:3000/oauth/callback`
3. **Create** → copy the **Client ID** and **Client Secret**

---

## 5. Register the plugin in server/corsair.ts

**Before running the setup script**, check that the plugin is registered in `server/corsair.ts`. Read the file and verify the plugin is imported and included in the `plugins` array.

For Google Calendar, it should look like:
```typescript
import { createCorsair, googlecalendar, slack } from 'corsair';
export const corsair = createCorsair({
  plugins: [slack(), googlecalendar()],
  ...
});
```

For Google Drive:
```typescript
import { createCorsair, googledrive, slack } from 'corsair';
export const corsair = createCorsair({
  plugins: [slack(), googledrive()],
  ...
});
```

If the plugin is missing, add it now. The container will pick up the change automatically (via hot reload) — no restart needed.

---

## 6. Write and run the setup script

Ask the user to provide Client ID and Client Secret. Determine which plugin to set up based on what the user asked for:
- Google Calendar → `PLUGIN = 'googlecalendar'`
- Google Drive → `PLUGIN = 'googledrive'`

Then write `scripts/setup-google.ts`:

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

// Set to 'googlecalendar' or 'googledrive' depending on what the user asked for
const PLUGIN = 'googledrive';

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
  const integrationKeys = (corsair.keys as any)[PLUGIN]!;

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
  const accountKeys = (corsair as any)[PLUGIN]!.keys;

  await accountKeys.issue_new_dek();
  console.log(`  ✓ Account DEK ready`);

  // 5. Print the correct OAuth URL for this plugin
  const oauthUrl = PLUGIN === 'googledrive'
    ? 'http://localhost:3000/oauth/googledrive'
    : 'http://localhost:3000/oauth/google';
  console.log(`\n✓ Credentials stored. Now complete OAuth at ${oauthUrl}`);
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

## 7. Complete the OAuth flow

Tell the user to open the correct URL for the plugin they set up:

| Plugin | OAuth URL |
|--------|-----------|
| Google Calendar | http://localhost:3000/oauth/google |
| Google Drive | http://localhost:3000/oauth/googledrive |

This will:
1. Redirect them to Google's consent screen
2. After they click Allow, redirect back to `/oauth/callback`
3. Automatically exchange the code for tokens and store both `access_token` and `refresh_token` for the correct plugin
4. Show a success page naming the correct plugin

No copying tokens manually — the server handles everything.

---

## Notes

**Token refresh:** The plugin calls `getValidAccessToken()` internally on every request, using the stored `refresh_token` + `client_id` + `client_secret` to get a fresh access token. However, it also requires an `access_token` to be stored — the OAuth flow at step 6 stores both.

**Token expiry (test mode):** Google OAuth refresh tokens for apps in test mode expire after 7 days of inactivity. To avoid this, publish the app: **OAuth consent screen → Publish App**. The unverified app warning during login is fine for personal use.

**Re-authorizing:** If tokens expire or are revoked, just visit http://localhost:3000/oauth/google again.
