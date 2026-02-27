---
name: add-keys/gmail
description: Set up Gmail for Corsair. Use when the user wants to connect Gmail, read emails, send emails, or manage their inbox through the agent.
---

# Gmail Key Setup

Read `/add-keys` and `/add-keys/google` first — they cover the shared Google OAuth steps (create Cloud project, OAuth consent screen, OAuth credentials, setup script, OAuth flow).

**Plugin ID:** `gmail`
**OAuth URL:** `http://localhost:3000/oauth/gmail`

---

## 1. Enable the Gmail API

In your Google Cloud project, go to **APIs & Services → Library**:
- Search **Gmail API** → **Enable**

---

## 2. Register the plugin in server/corsair.ts

**Before running the setup script**, check that the plugin is registered. Read `server/corsair.ts` and verify `gmail` is imported and included in the `plugins` array:

```typescript
import { createCorsair, gmail, slack } from 'corsair';
export const corsair = createCorsair({
  plugins: [slack(), gmail()],
  ...
});
```

If missing, add it now. The container will pick up the change automatically — no restart needed.

---

## 3. Run the common setup

Follow steps 4–5 from `/add-keys/google` with:
- `PLUGIN = 'gmail'`
- OAuth URL: `http://localhost:3000/oauth/gmail`
