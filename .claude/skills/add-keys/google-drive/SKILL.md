---
name: add-keys/google-drive
description: Set up Google Drive for Corsair. Use when the user wants to connect Google Drive, read files, upload files, or manage their drive through the agent.
---

# Google Drive Key Setup

Read `/add-keys` and `/add-keys/google` first — they cover the shared Google OAuth steps (create Cloud project, OAuth consent screen, OAuth credentials, setup script, OAuth flow).

**Plugin ID:** `googledrive`
**OAuth URL:** `http://localhost:3000/oauth/googledrive`

---

## 1. Enable the Google Drive API

In your Google Cloud project, go to **APIs & Services → Library**:
- Search **Google Drive API** → **Enable**

---

## 2. Register the plugin in server/corsair.ts

**Before running the setup script**, check that the plugin is registered. Read `server/corsair.ts` and verify `googledrive` is imported and included in the `plugins` array:

```typescript
import { createCorsair, googledrive, slack } from 'corsair';
export const corsair = createCorsair({
  plugins: [slack(), googledrive()],
  ...
});
```

If missing, add it now. The container will pick up the change automatically — no restart needed.

---

## 3. Run the common setup

Follow steps 4–5 from `/add-keys/google` with:
- `PLUGIN = 'googledrive'`
- OAuth URL: `http://localhost:3000/oauth/googledrive`
