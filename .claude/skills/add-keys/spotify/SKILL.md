---
name: add-keys/spotify
description: Set up Spotify OAuth credentials for Corsair. Use when the user wants to connect Spotify to their agent.
---

# Spotify Key Setup

Read `/add-keys` first if you haven't — it explains the key model.

Auth type: **`oauth_2`**
- Integration level: `client_id`, `client_secret`, `redirect_url` (your Spotify app — shared)
- Account level: `access_token`, `refresh_token`, `expires_at`, `scope` (per-tenant)

---

## 1. Create a Spotify app

1. Go to https://developer.spotify.com/dashboard
2. Log in and click **Create app**
3. Fill in:
   - **App name**: Corsair (or anything you like)
   - **App description**: (any)
   - **Redirect URI**: `http://localhost:3000/oauth/callback`
   - **APIs used**: check **Web API**
4. Agree to the terms → **Save**
5. Open the app → **Settings**
6. Copy the **Client ID** and **Client secret**

---

## 2. Write and run the setup script

Ask the user to provide the Client ID and Client Secret, then write `scripts/setup-spotify.ts`:

```typescript
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { corsair } from '../server/corsair';
import { db } from '../server/db';
import { corsairAccounts, corsairIntegrations } from '../server/db/schema';

const PLUGIN = 'spotify';
const TENANT_ID = 'default';
const REDIRECT_URL = 'http://localhost:3000/oauth/callback';

// ── credentials (fill these in) ───────────────────────────────────────────────
const CLIENT_ID = '...';
const CLIENT_SECRET = '...';
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nSetting up Spotify...');

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
    console.log('  ✓ Created integration');
  }

  // 2. Issue integration DEK and store OAuth app credentials
  await corsair.keys.spotify.issue_new_dek();
  await corsair.keys.spotify.set_client_id(CLIENT_ID);
  await corsair.keys.spotify.set_client_secret(CLIENT_SECRET);
  await corsair.keys.spotify.set_redirect_url(REDIRECT_URL);
  console.log('  ✓ Integration credentials stored');

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
    console.log('  ✓ Created account');
  }

  // 4. Issue account DEK (tokens come from OAuth flow)
  await corsair.spotify.keys.issue_new_dek();
  console.log('  ✓ Account DEK ready');

  console.log('\n✓ Credentials stored. Now complete OAuth at http://localhost:3000/oauth/spotify');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Run it:

```bash
docker compose exec agent pnpm tsx scripts/setup-spotify.ts
```

Then delete the script:

```bash
rm scripts/setup-spotify.ts
```

---

## 3. Complete the OAuth flow

Tell the user to open:

```
http://localhost:3000/oauth/spotify
```

This will:
1. Redirect them to Spotify's authorization page
2. After they click **Agree**, redirect back to `/oauth/callback`
3. Automatically exchange the code for tokens and store `access_token`, `refresh_token`, `expires_at`, and `scope`
4. Show a success page

No copying tokens manually — the server handles everything.

---

## 4. Verify

```bash
docker compose exec agent pnpm tsx -e "
import 'dotenv/config';
import { corsair } from './server/corsair';
corsair.spotify.keys.get_access_token().then(k => console.log('token:', k?.slice(0,8) + '...')).then(() => process.exit(0));
"
```

No restart needed — the agent reads from the DB on every request.

---

## Notes

**Token refresh:** The plugin calls `getValidAccessToken()` internally on every request, using the stored `refresh_token` + `client_id` + `client_secret` to get a fresh access token automatically.

**Re-authorizing:** If tokens expire or are revoked, just visit `http://localhost:3000/oauth/spotify` again.

**Scopes:** Spotify scopes are requested during the OAuth flow. If you need additional scopes (e.g. `playlist-modify-public`, `user-read-playback-state`), re-authorize at the OAuth URL above.
