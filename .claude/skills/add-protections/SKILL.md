---
name: add-protections
description: Set up endpoint permission guards for the Corsair agent. Use when the user wants to control which agent actions require manual approval, add safeguards, restrict endpoints, or configure protections.
---

You are helping a user decide which Corsair agent actions should require manual approval before executing. This is a human-in-the-loop permission system — like 2FA for agent actions.

## How it works

When the agent calls a protected endpoint (e.g. `corsair.slack.api.messages.post()`), the before hook blocks execution and logs a `[PERMISSION_REQUIRED]` message. The agent then requests permission from the user via an approval page. The user reviews the action details (message content, recipients, etc.) and clicks Approve or Decline. Only then does the endpoint execute.

Each permission is single-use: approved once, used once, then marked completed.

## Step 1: Ask what to protect

Ask the user:

> What agent actions would you like to require approval for? Describe them in plain language — for example, "sending Slack messages", "creating Linear issues", "sending emails", "posting to Discord".

Wait for the user's response.

## Step 2: Map to endpoints

Based on the user's response, find the actual Corsair endpoints to protect. Look at `server/corsair.ts` to see which plugins are active.

For each action the user described, identify the matching endpoint path(s). Common mappings:

| User says | Endpoint path |
|-----------|--------------|
| "sending Slack messages" | `slack.messages.post` |
| "updating Slack messages" | `slack.messages.update` |
| "deleting Slack messages" | `slack.messages.delete` |
| "creating Slack channels" | `slack.channels.create` |
| "creating Linear issues" | `linear.issues.create` |
| "updating Linear issues" | `linear.issues.update` |
| "sending emails" (Resend) | `resend.emails.send` |
| "sending emails" (Gmail) | `gmail.messages.send` |
| "posting to Discord" | `discord.messages.create` |
| "uploading files" | `slack.files.upload` / `googledrive.files.upload` |
| "creating GitHub PRs" | `github.pullRequests.create` |

If unsure about an endpoint name, check the plugin source in the `corsair` package:
- Look at the `*Nested` endpoint tree in the plugin's `index.ts`
- The endpoint path is the dotted key path: `plugin.group.method`

## Step 3: Update corsair.ts

Open `server/corsair.ts` and write the `before` and `after` hooks **inline** for each protected endpoint. Do NOT use a generic helper — write each hook manually so it's fully typed by the SDK.

**Import the permission helpers** (if not already imported):

```typescript
import { checkPermission, completePermission } from './permissions';
```

**Add hooks to each plugin.** The hooks object mirrors the endpoint tree structure. Write the `before` and `after` hooks inline so TypeScript infers the correct parameter types from the plugin's endpoint definitions. For example, to protect `slack.messages.post` and `slack.channels.create`:

```typescript
slack({
  hooks: {
    messages: {
      post: {
        async before(ctx, args) {
          const granted = await checkPermission('slack.messages.post');
          if (!granted) {
            console.log(
              `[PERMISSION_REQUIRED] endpoint=slack.messages.post args=${JSON.stringify(args)} | This endpoint requires approval. Use the request_permission tool to request access.`,
            );
            return { ctx, args, continue: false };
          }
          return { ctx, args };
        },
        async after() {
          await completePermission('slack.messages.post');
        },
      },
    },
    channels: {
      create: {
        async before(ctx, args) {
          const granted = await checkPermission('slack.channels.create');
          if (!granted) {
            console.log(
              `[PERMISSION_REQUIRED] endpoint=slack.channels.create args=${JSON.stringify(args)} | This endpoint requires approval. Use the request_permission tool to request access.`,
            );
            return { ctx, args, continue: false };
          }
          return { ctx, args };
        },
        async after() {
          await completePermission('slack.channels.create');
        },
      },
    },
  },
}),
```

For Linear issues:

```typescript
linear({
  hooks: {
    issues: {
      create: {
        async before(ctx, args) {
          const granted = await checkPermission('linear.issues.create');
          if (!granted) {
            console.log(
              `[PERMISSION_REQUIRED] endpoint=linear.issues.create args=${JSON.stringify(args)} | This endpoint requires approval. Use the request_permission tool to request access.`,
            );
            return { ctx, args, continue: false };
          }
          return { ctx, args };
        },
        async after() {
          await completePermission('linear.issues.create');
        },
      },
    },
  },
}),
```

The hook path MUST match the endpoint tree structure from the plugin. The endpoint string passed to `checkPermission` / `completePermission` MUST be `<plugin>.<group>.<method>` — the exact dotted path.

## Step 4: Run the migration

The permissions table needs to exist in the database. Run:

```bash
npm run db:generate
npm run db:migrate
```

## Step 5: Confirm

Tell the user which endpoints are now protected and explain the flow:

1. When the agent tries to call a protected endpoint, it will pause and send a permission request
2. They'll receive a link to an approval page (via WhatsApp or the chat UI)
3. The approval page shows the full details of the action (message content, recipients, etc.)
4. They click Approve to continue or Decline to cancel
5. The agent resumes automatically

## Rules

- **Only protect write operations** — reads/lists don't need approval. Never protect `get`, `list`, `search`, or `getHistory` endpoints.
- **Write hooks inline** — do NOT use a generic helper function that returns `any`. Each hook must be written directly so TypeScript can type-check the `ctx`, `args`, and `res` parameters.
- **The endpoint string must be exact** — `slack.messages.post`, not `slack.messages.Post` or `messages.post`.
- **Don't remove existing hooks** — if a plugin already has hooks for other endpoints, add to them, don't replace.
- **Don't modify `server/permissions.ts`** — it's a shared module, not per-plugin.
- **Always run the migration** after adding the permissions table.
