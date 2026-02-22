---
name: add-keys/google
description: Set up Google OAuth credentials for Corsair. Use when the user wants to connect Google Calendar or Google Drive. Both plugins share the same OAuth app and credentials.
---

# Google Key Setup (Calendar + Drive)

Read `/add-keys` first if you haven't — it explains the key model.

Auth type: **`oauth_2`**
- Integration level: `client_id`, `client_secret`, `redirect_url` (your Google OAuth app — shared)
- Account level: `refresh_token` (the user's grant — per-tenant)

Google Calendar and Google Drive share the same OAuth app. Set up credentials once and the script wires both plugins. Tell the user upfront: "Google takes more steps than the others, but it's a one-time setup."

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

## 5. Get a refresh token via OAuth Playground

1. Go to https://developers.google.com/oauthplayground
2. Click the gear icon (⚙) → check **Use your own OAuth credentials** → paste Client ID and Client Secret
3. In Step 1, select the scopes needed:
   - Google Calendar: `https://www.googleapis.com/auth/calendar`
   - Google Drive: `https://www.googleapis.com/auth/drive`
4. Click **Authorize APIs** → sign in with the test user account → Allow
5. In **Step 2**, click **Exchange authorization code for tokens**
6. Copy the **refresh_token** from the response

**Troubleshooting:**
- "Access blocked" → confirm you added the signing-in Google account as a test user in step 3
- Refresh token missing from response → in Step 1 of OAuth Playground, click **Revoke tokens** first, then re-authorize

---

## 6. Write and run the setup script

Ask the user to provide Client ID, Client Secret, and Refresh Token. Then write `scripts/setup-google.ts`:

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
const REFRESH_TOKEN = '...';
// ─────────────────────────────────────────────────────────────────────────────

// Which Google plugins to set up (remove any you don't want)
const PLUGINS = ['googlecalendar', 'googledrive'] as const;

async function setupPlugin(plugin: string) {
  console.log(`\nSetting up ${plugin}...`);

  // 1. Ensure integration row exists
  let [integration] = await db
    .select()
    .from(corsairIntegrations)
    .where(eq(corsairIntegrations.name, plugin));

  if (!integration) {
    [integration] = await db
      .insert(corsairIntegrations)
      .values({ id: crypto.randomUUID(), name: plugin })
      .returning();
    console.log(`  ✓ Created integration`);
  }

  // 2. Issue integration DEK and set OAuth app credentials
  // (corsair.keys is typed per-plugin; access dynamically)
  const integrationKeys = (corsair.keys as Record<string, {
    issue_new_dek: () => Promise<void>;
    set_client_id: (v: string) => Promise<void>;
    set_client_secret: (v: string) => Promise<void>;
    set_redirect_url: (v: string) => Promise<void>;
  }>)[plugin]!;

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

  // 4. Issue account DEK and store refresh token
  const accountKeys = (corsair as Record<string, { keys: {
    issue_new_dek: () => Promise<void>;
    set_refresh_token: (v: string) => Promise<void>;
    get_refresh_token: () => Promise<string | null>;
  } }>)[plugin]!.keys;

  await accountKeys.issue_new_dek();
  await accountKeys.set_refresh_token(REFRESH_TOKEN);

  const stored = await accountKeys.get_refresh_token();
  console.log(`  ✓ Refresh token stored (${stored?.slice(0, 10)}...)`);
}

async function main() {
  for (const plugin of PLUGINS) {
    await setupPlugin(plugin);
  }
  console.log('\n✓ Google setup complete');
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

## Notes

**Token refresh:** The plugin's keyBuilder calls `getValidAccessToken()` internally, which uses the stored `refresh_token` + `client_id` + `client_secret` to get a fresh access token on every request. You don't need to store an access token manually.

**Token expiry (test mode):** Google OAuth refresh tokens for apps in test mode expire after 7 days of inactivity. To avoid this, publish the app: **OAuth consent screen → Publish App**. The unverified app warning during login is fine for personal use.
