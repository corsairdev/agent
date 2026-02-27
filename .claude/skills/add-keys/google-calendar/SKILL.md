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
