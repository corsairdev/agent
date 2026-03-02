---
name: add-keys/google-calendar
description: Set up Google Calendar for Corsair. Use when the user wants to connect Google Calendar, read events, create calendar events, or manage their schedule through the agent.
---

# Google Calendar Key Setup

Read `/add-keys` and `/add-keys/google` first — they cover the shared Google OAuth steps (create Cloud project, OAuth consent screen, OAuth credentials, setup script, OAuth flow).

**Plugin ID:** `googlecalendar`
**OAuth URL:** `http://localhost:3000/oauth/googlecalendar`

---

## 1. Enable the Google Calendar API

In your Google Cloud project, go to **APIs & Services → Library**:
- Search **Google Calendar API** → **Enable**

---

## 2. Register the plugin in server/corsair.ts

**Before running the setup script**, check that the plugin is registered. Read `server/corsair.ts` and verify `googlecalendar` is imported and included in the `plugins` array:

```typescript
import { createCorsair, googlecalendar, slack } from 'corsair';
export const corsair = createCorsair({
  plugins: [slack(), googlecalendar()],
  ...
});
```

If missing, add it now. The container will pick up the change automatically — no restart needed.

---

## 3. Run the common setup

Follow steps 4–5 from `/add-keys/google` with:
- `PLUGIN = 'googlecalendar'`
- OAuth URL: `http://localhost:3000/oauth/googlecalendar`

---

## 4. Webhook Setup (Optional)

Ask the user: "Would you like to set up webhooks so Corsair can trigger automations when your calendar events change? This requires a public HTTPS URL."

If no → done. Google Calendar is connected for reading/writing events.

If yes → continue below.

---

## 5. Get a public webhook URL

Ask: "Do you already have a public HTTPS URL for this Corsair server (e.g. from Railway, Render, or a VPS)?"

- If yes → the webhook endpoint is `{their-url}/api/webhook`. Skip to Step 7.
- If no → proceed to Step 6 (ngrok).

---

## 6. Set up ngrok

Install ngrok if needed:
- Mac: `brew install ngrok`
- Or download from https://ngrok.com/download

Authenticate:
1. Sign up at https://ngrok.com
2. Go to https://dashboard.ngrok.com/get-started/your-authtoken
3. Run: `ngrok config add-authtoken YOUR_TOKEN`

Start the tunnel (keep this terminal open):
```bash
ngrok http 3001
```

Copy the HTTPS forwarding URL (e.g. `https://abc123.ngrok-free.app`). The webhook endpoint is `{ngrok-url}/api/webhook`.

---

## 7. Register the watch channel

Write `scripts/setup-gcal-webhook.ts`, filling in `WEBHOOK_URL` with the full endpoint URL from the previous step:

```typescript
import 'dotenv/config';
import * as crypto from 'node:crypto';
import { corsair } from '../server/corsair';

const WEBHOOK_URL = 'REPLACE_WITH_WEBHOOK_URL'; // e.g. https://abc123.ngrok-free.app/api/webhook
const CALENDAR_ID = 'primary'; // or a specific calendar ID

const main = async () => {
  const [clientId, clientSecret, refreshToken] = await Promise.all([
    corsair.keys.googlecalendar.get_client_id(),
    corsair.keys.googlecalendar.get_client_secret(),
    corsair.googlecalendar.keys.get_refresh_token(),
  ]);

  if (!clientId || !clientSecret || !refreshToken) {
    console.error('Missing credentials — complete credential setup first.');
    process.exit(1);
  }

  // Get a fresh access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenRes.ok) {
    console.error('Token refresh failed:', await tokenRes.text());
    process.exit(1);
  }

  const { access_token } = (await tokenRes.json()) as { access_token: string };

  // Create the watch channel
  const channelId = crypto.randomUUID();

  const watchRes = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/' +
      encodeURIComponent(CALENDAR_ID) + '/events/watch',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: channelId, type: 'web_hook', address: WEBHOOK_URL }),
    },
  );

  if (!watchRes.ok) {
    console.error('Calendar watch failed:', await watchRes.text());
    process.exit(1);
  }

  const data = (await watchRes.json()) as {
    id: string;
    resourceId: string;
    expiration: string;
  };

  const expiration = new Date(Number(data.expiration)).toISOString();
  console.log('✓ Watch channel created');
  console.log('  Channel ID :', channelId);
  console.log('  Resource ID:', data.resourceId);
  console.log('  Expires    :', expiration);
  console.log('\nIMPORTANT: Re-run this script before the channel expires to renew it.');
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
```

Run it:
```bash
docker compose exec agent pnpm tsx scripts/setup-gcal-webhook.ts
```

Then delete the script:
```bash
rm scripts/setup-gcal-webhook.ts
```

Report the Channel ID, Resource ID, and expiration to the user. Webhook events will now arrive at `/api/webhook` and trigger any workflows configured with `plugin: 'googlecalendar'`.

---

## 8. Auto-renewal cron workflow

Google Calendar watch channels expire after ~7 days. Set up a cron workflow that renews the channel every 6 days automatically. The workflow reads credentials from the DB (via `corsair`) and fetches the current ngrok URL from the docker-compose ngrok service at `http://ngrok:4040`.

Write `scripts/setup-gcal-renewal-workflow.ts`:

```typescript
import 'dotenv/config';
import { registerCronWorkflow } from '../server/workflow-scheduler';
import { storeWorkflow } from '../server/executor';

const WORKFLOW_NAME = 'renewGoogleCalendarWatch';
const CALENDAR_ID = 'primary';

const code = `
async function ${WORKFLOW_NAME}() {
  // Fetch the current ngrok public URL from the docker-compose ngrok service
  const tunnelsRes = await fetch('http://ngrok:4040/api/tunnels');
  if (!tunnelsRes.ok) throw new Error('Could not reach ngrok API');
  const { tunnels } = await tunnelsRes.json() as { tunnels: Array<{ public_url: string; proto: string }> };
  const tunnel = tunnels.find(t => t.proto === 'https');
  if (!tunnel) throw new Error('No HTTPS ngrok tunnel found');
  const webhookUrl = tunnel.public_url + '/api/webhook';

  // Get credentials
  const [clientId, clientSecret, refreshToken] = await Promise.all([
    corsair.keys.googlecalendar.get_client_id(),
    corsair.keys.googlecalendar.get_client_secret(),
    corsair.googlecalendar.keys.get_refresh_token(),
  ]);
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Missing Google credentials');

  // Refresh access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  if (!tokenRes.ok) throw new Error('Token refresh failed: ' + await tokenRes.text());
  const { access_token } = await tokenRes.json() as { access_token: string };

  // Register new watch channel
  const channelId = crypto.randomUUID();
  const watchRes = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent('${CALENDAR_ID}') + '/events/watch',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: channelId, type: 'web_hook', address: webhookUrl }),
    },
  );
  if (!watchRes.ok) throw new Error('Calendar watch failed: ' + await watchRes.text());
  const data = await watchRes.json() as { id: string; resourceId: string; expiration: string };
  console.log('✓ Watch channel renewed');
  console.log('  Channel ID :', channelId);
  console.log('  Resource ID:', data.resourceId);
  console.log('  Expires    :', new Date(Number(data.expiration)).toISOString());
  console.log('  Webhook URL:', webhookUrl);
}
`;

async function main() {
  // Every 6 days at 00:00 (safe margin before 7-day expiry)
  const cronSchedule = '0 0 */6 * *';

  const workflow = await storeWorkflow({
    type: 'workflow',
    workflowId: WORKFLOW_NAME,
    code,
    description: 'Renews the Google Calendar watch channel every 6 days',
    cronSchedule,
  });

  registerCronWorkflow(workflow!.id, WORKFLOW_NAME, code, cronSchedule);
  console.log(`✓ Cron workflow "${WORKFLOW_NAME}" registered (${cronSchedule})`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Run it:
```bash
docker compose exec agent pnpm tsx scripts/setup-gcal-renewal-workflow.ts
```

Then delete the script:
```bash
rm scripts/setup-gcal-renewal-workflow.ts
```

The workflow is now stored in the DB and will be loaded automatically on every server restart. It renews the watch channel 6 days after the last renewal, keeping webhooks alive indefinitely.
