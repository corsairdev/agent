---
name: add-whatsapp
description: Set up WhatsApp for the Corsair agent. Use when the user wants to connect WhatsApp, authenticate with a pairing code, configure the bot trigger, run the DB migration, or start receiving WhatsApp messages.
---

# Corsair WhatsApp Setup

Run all steps automatically. Pause only when the user must take a manual action (entering the pairing code in WhatsApp). Always run commands directly — never tell the user to run something you can do yourself.

The agent runs in Docker — use `docker compose exec agent <command>` instead of running commands directly. Exception: `docker compose` commands themselves run on the host.

---

## 1. Verify the agent container is running

```bash
docker compose ps
```

The `agent` service should be running. If not, start it:

```bash
docker compose up -d
```

Dependencies are pre-installed in the Docker image. No manual `pnpm install` needed.

---

## 2. Configure environment variables

Read `.env`. Add these entries if not present:

```
# Required: enable the WhatsApp listener
WHATSAPP_ENABLED=true

# Optional: trigger word for group chats (default: corsair)
# In groups, users type @corsair to trigger the agent
BOT_NAME=corsair
```

Ask the user what trigger word they want if they have a preference. Default is `corsair`.

---

## 3. Run the database migration

Migrations run automatically when the container starts. If tables are missing, trigger a restart:

```bash
docker compose up -d agent
```

Then verify with `docker compose logs agent` — look for the `db:push` output before the server starts.

---

## 4. Authenticate with WhatsApp (pairing code)

**Skip this step if `store/auth/creds.json` already exists** — credentials are already saved.

### 4a. Get phone number

Ask the user: "What phone number is linked to the WhatsApp account you want to connect? (Include country code, no + or spaces — e.g. 14155551234 for US +1 415-555-1234)"

### 4b. Start auth in background, wait for pairing code

Run (replace NUMBER with their phone number):

```bash
docker compose exec -d agent pnpm whatsapp:auth --phone NUMBER
```

Then poll for the pairing code (the auth script writes its status to `store/auth-status.txt`, which is on the host since the source directory is mounted):

```bash
for i in $(seq 1 20); do
  if [ -f store/auth-status.txt ]; then
    STATUS=$(cat store/auth-status.txt)
    if [[ "$STATUS" == pairing_code:* ]]; then
      CODE="${STATUS#pairing_code:}"
      echo "PAIRING_CODE:$CODE"
      break
    elif [[ "$STATUS" == already_authenticated ]]; then
      echo "ALREADY_AUTHENTICATED"
      break
    elif [[ "$STATUS" == failed:* ]]; then
      echo "FAILED:${STATUS#failed:}"
      break
    fi
  fi
  sleep 1
done
```

(Bash timeout: 30000ms)

**Parse the output:**
- `ALREADY_AUTHENTICATED` → skip to step 5
- `PAIRING_CODE:XXXX-XXXX` → proceed to 4c with that code
- `FAILED:*` → diagnose and fix (see Troubleshooting), then re-run

### 4c. Show the pairing code and wait for confirmation

Tell the user:

> Your WhatsApp pairing code is: **[CODE]**
>
> On your phone:
> 1. Open WhatsApp
> 2. Settings → Linked Devices → Link a Device
> 3. Tap **"Link with phone number instead"**
> 4. Enter the code above
>
> Let me know once you've entered it.

### 4d. Poll for completion

Once the user confirms they entered it, run (use AUTH_PID from 4b):

```bash
for i in $(seq 1 60); do
  if [ -f store/auth-status.txt ]; then
    STATUS=$(cat store/auth-status.txt)
    case "$STATUS" in
      authenticated|already_authenticated)
        echo "STATUS:success"
        break
        ;;
      failed:*)
        echo "STATUS:failed:${STATUS#failed:}"
        break
        ;;
    esac
  fi
  sleep 2
done
wait $AUTH_PID 2>/dev/null || true
```

(Bash timeout: 150000ms)

**If `STATUS:success`** → credentials saved to `store/auth/`, continue to step 5.

**If `STATUS:failed:515`** → stream error during pairing handshake, this is normal. The auth script reconnects automatically. Re-run the poll loop.

**If `STATUS:failed:logged_out`** → delete `store/auth/` and re-run from step 4a.

**If timeout** → ask user if they entered the code. Re-run from step 4b.

---

## 5. Restart the server

```bash
docker compose up -d agent
```

This recreates the container so it picks up the new `WHATSAPP_ENABLED` value from `.env`. (Plain `docker compose restart` preserves the old environment and won't work here.)

Then follow the logs:

```bash
docker compose logs -f agent
```

Check for:
- `[whatsapp] Auth credentials found, connecting...` — connecting with saved creds
- `[whatsapp] Connected to WhatsApp` — socket open
- `[whatsapp] Poller started (2s interval)` — ready to receive messages

If it logs `No auth credentials found`, auth didn't save correctly — re-run step 4.

---

## 6. Test

**Which number did you connect?**

Ask the user: "Is the number you just connected your own personal WhatsApp number, or a separate number dedicated to the bot?"

**If it's their own number (self-chat setup):**
Tell them:
> Since you connected your own number, you interact with the bot by messaging yourself in WhatsApp.
>
> On your phone: open WhatsApp → New Chat → search for your own name or number → open that chat → type a message.
> On newer WhatsApp versions there's a "Message yourself" shortcut at the top of the contacts list.
>
> The bot's replies will appear prefixed with "Corsair: " so you can tell them apart from your own messages.

**If it's a dedicated bot number:**
> Send a direct message to that number from your personal WhatsApp. Any message triggers the agent.

**Group test (either setup):** Add the number to a group. Send a message containing `@corsair` (or your `BOT_NAME`). The agent should respond.

---

## How it works

```
WhatsApp message received
  → Stored in postgres (whatsapp_messages, processed=false)
  → Poller queries every 2s
  → DMs: always trigger agent
  → Groups: only if @corsair is in the message
  → runAgent() called → uses Corsair plugins to complete the task
  → Response sent back via WhatsApp
```

**Multi-turn:** If the agent needs clarification it sends a question to WhatsApp and stores the session. The user's next message resumes the conversation automatically.

---

## Troubleshooting

**`pnpm whatsapp:auth` fails with "Failed to get pairing code":**
The number format may be wrong. Verify: country code + digits only, no `+`, no spaces, no dashes. E.g. `14155551234` not `+1-415-555-1234`.

**Auth completes but `pnpm dev` says "No auth credentials found":**
Check that `store/auth/creds.json` exists: `ls store/auth/`. If missing, re-run step 4.

**No response to messages:**
- Check `WHATSAPP_ENABLED=true` is in `.env`
- Ensure `TELEGRAM_ENABLED=false` in `.env`
- Check `[whatsapp] Poller started` in server logs
- For groups: message must contain `@corsair` (or `BOT_NAME`)

**Re-authenticate (e.g. WhatsApp session expired):**
```bash
rm -rf store/auth
docker compose exec -d agent pnpm whatsapp:auth --phone NUMBER
```
Then restart: `docker compose restart agent`.
