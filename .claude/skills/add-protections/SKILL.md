---
name: add-protections
description: Set up endpoint permission guards for the Corsair agent. Use when the user wants to control which agent actions require manual approval, add safeguards, restrict endpoints, or configure protections.
---

You are helping a user add human-in-the-loop permission guards to Corsair agent actions. When a protected endpoint is called, execution is blocked until the user approves it via an approval page.

Each permission is single-use: approved once, used once, then marked completed.

## Step 1: Ask what to protect

Ask the user two things at once:
1. Which agent actions should require approval?
2. What information do they want to see on the approval page when reviewing each action?

For example: "Which actions should require approval, and what details would you like to see when approving them? For example, for a Slack message you might want to see the channel and message text; for a Linear issue you might want to see the title, description, and priority."

Wait for the user's response before continuing.

## Step 2: Map to endpoints

Look at `server/corsair.ts` to see which plugins are active. For each action the user described, identify the matching endpoint path(s).

Common mappings:

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

If unsure about an endpoint name, check the plugin's type definitions:
- `node_modules/corsair/dist/plugins/<plugin>/index.d.ts`
- Find the `*EndpointsNested` declaration — the dotted key path is the endpoint: e.g. `issues: { create }` → `linear.issues.create`

## Step 3: Update corsair.ts

Open `server/corsair.ts` and add `before` and `after` hooks inline for each protected endpoint.

**Import the permission helpers** (if not already imported):

```typescript
import { checkPermission, completePermission } from './permissions';
```

**Hook anatomy** — every protected endpoint follows this exact pattern:

```typescript
somePlugin({
  hooks: {
    group: {
      method: {
        async before(ctx, args) {
          const permissionId = await checkPermission('plugin.group.method', args);
          if (!permissionId) {
            console.log(
              `[PERMISSION_REQUIRED] endpoint=plugin.group.method args=${JSON.stringify(args)}

              This endpoint requires approval.

              <USER PREFERENCES: list the specific fields the user wants to see on the approval page, e.g. "The user wants to see the channel name and message text." Be explicit — the agent reading this log will use it to write the permission description.>

              Use the request_permission tool to request access.`,
            );
            return { ctx, args, continue: false };
          }
          return { ctx, args, continue: true, passToAfter: permissionId };
        },
        async after(_, __, passToAfter) {
          passToAfter && (await completePermission(passToAfter));
        },
      },
    },
  },
}),
```

### CRITICAL: The console.log message is the agent's only instruction

The `[PERMISSION_REQUIRED]` log is what the agent reads when it calls `request_permission`. The `description` it writes for the approval page comes entirely from parsing this message. **You must embed the user's display preferences directly in the log string.** If the user said they want to see the title, description, and priority — write that explicitly in the log. If you don't, the agent will have no idea what to include and will write a generic description.

Example for a Linear issue where the user wants title, description, and priority visible:

```typescript
linear({
  hooks: {
    issues: {
      create: {
        async before(ctx, args) {
          const permissionId = await checkPermission('linear.issues.create', args);
          if (!permissionId) {
            console.log(
              `[PERMISSION_REQUIRED] endpoint=linear.issues.create args=${JSON.stringify(args)}

              This endpoint requires approval.

              The user wants to see the issue title, description, and priority on the approval page.

              Use the request_permission tool to request access.`,
            );
            return { ctx, args, continue: false };
          }
          return { ctx, args, continue: true, passToAfter: permissionId };
        },
        async after(_, __, passToAfter) {
          passToAfter && (await completePermission(passToAfter));
        },
      },
    },
  },
}),
```

Example for Slack where the user wants channel and message text visible:

```typescript
slack({
  hooks: {
    messages: {
      post: {
        async before(ctx, args) {
          const permissionId = await checkPermission('slack.messages.post', args);
          if (!permissionId) {
            console.log(
              `[PERMISSION_REQUIRED] endpoint=slack.messages.post args=${JSON.stringify(args)}

              This endpoint requires approval.

              The user wants to see the channel and full message text on the approval page.

              Use the request_permission tool to request access.`,
            );
            return { ctx, args, continue: false };
          }
          return { ctx, args, continue: true, passToAfter: permissionId };
        },
        async after(_, __, passToAfter) {
          passToAfter && (await completePermission(passToAfter));
        },
      },
    },
  },
}),
```

### Hook mechanics (how it works)

- **`checkPermission(endpoint, args)`** — queries the DB for a granted permission matching this exact endpoint + args JSON. Returns the permission ID if found, `null` if not.
- **`continue: false`** — halts execution of the endpoint. The API call is never made.
- **`passToAfter: permissionId`** — threads the permission ID from `before` to `after` via the runtime. The `after` hook receives it as its third argument.
- **`after(_, __, passToAfter)`** — `_` is ctx, `__` is the API response. The third param is whatever was returned as `passToAfter` from `before`.
- **`completePermission(id)`** — marks the permission as `completed` by ID so it can't be reused.

### Hook structure rules

- The hooks object mirrors the endpoint tree exactly: `hooks.group.method.before/after`
- The endpoint string passed to `checkPermission` must be the full dotted path: `plugin.group.method`
- Do NOT modify `server/permissions.ts` — it's a shared module
- Do NOT protect `get`, `list`, `search`, or read-only endpoints — only writes
- If a plugin already has hooks for other endpoints, add to them, don't replace

## Step 4: Confirm

Tell the user which endpoints are now protected and explain the flow:

1. When the agent tries to call a protected endpoint, it will pause and log `[PERMISSION_REQUIRED]`
2. The agent calls `request_permission` and sends the user an approval URL
3. The user opens the approval page, sees the action details, and clicks Approve or Decline
4. If approved, the agent re-runs the action — this time `checkPermission` finds the granted record and proceeds
5. After the endpoint executes, `completePermission` marks it used so it can't be replayed
