# Improvement 4: Browser Automation

## The Problem

The agent currently has `WebSearch` and `WebFetch` for retrieving information from the web. Both are read-only and stateless:

- `WebSearch` — calls a search engine, returns snippets
- `WebFetch` — fetches static HTML from a URL, converts to markdown

A large category of useful tasks requires more than this:

- **Logging into a service** — most APIs require OAuth or session cookies. If a service doesn't have a Corsair plugin (and most won't at first), there's no other path.
- **Interacting with JavaScript-heavy pages** — `WebFetch` gets the initial HTML, not the rendered content. SPAs, dashboards, and dynamic pages return nothing useful.
- **Filling forms** — booking a restaurant, submitting a ticket, completing a signup flow.
- **Taking screenshots** — confirming what a page looks like, extracting visual data.
- **Scraping paginated data** — clicking through pages, handling infinite scroll.
- **Anything behind authentication** — Google Search Console, ad dashboards, internal tools.

These represent a significant fraction of what users actually want a personal automation assistant to do. Nanoclaw covers all of them via a `agent-browser` CLI running Chromium inside its container.

## What the Improvement Looks Like

A `browser` tool added to the agent's MCP server. Under the hood it drives a headless Chromium instance via Playwright. Browser state (cookies, local storage, logged-in sessions) persists per JID in `agent/store/browser/<jid-hash>/`.

### The tool surface

Five operations cover the vast majority of use cases:

**`browser_navigate(url)`**
Opens a URL. Returns a text snapshot of the visible page content — not raw HTML, but a clean rendering of what a human would see: headings, buttons, form fields, links, text. Each interactive element gets a short reference like `@e1`, `@e2` that other tools can use.

**`browser_click(@e3)`**
Clicks an element by its reference. Used to press buttons, follow links, open menus, select options.

**`browser_fill(@e5, value)`**
Types into an input field. Works for text boxes, textareas, search bars, form inputs.

**`browser_screenshot()`**
Takes a screenshot of the current page state and returns it as an image. The agent can describe what it sees, report success/failure visually, or use it to debug a stuck interaction.

**`browser_extract(instruction)`**
Runs a natural language extraction over the current page. "Get all product names and prices from this table." Returns structured data.

### Session persistence

Browser sessions are stored per JID:

```
agent/store/browser/
  whatsapp-1234567890/
    chromium-profile/
      Default/
        Cookies
        Local Storage/
        ...
```

When the agent logs into a service for a user the first time (LinkedIn, Google, an internal tool), those credentials persist in the Chromium profile. The next time a task requires that service, the browser is already authenticated. The user never has to log in again.

### How authentication works

For a new service the agent asks the user to authenticate:

1. Agent navigates to the login page and takes a screenshot
2. Sends it to the user: "Here's the login page for X — can you send me your credentials, or I can walk you through the login?"
3. User provides credentials (or the agent uses the `ask_human` flow to get them)
4. Agent fills and submits the form
5. Session is saved

For subsequent tasks: the browser loads the profile with the saved session and proceeds directly.

### What the tool looks like from the agent's perspective

The agent doesn't call Playwright directly — it calls the MCP tool. The MCP tool manages the browser session. The interaction looks like:

```
User: "Book a table at Nobu for Friday at 8pm, party of 2"

Agent:
  1. browser_navigate("https://www.exploretock.com/nobu")
     → page snapshot: shows date picker, time selector, party size
  2. browser_click(@e4)  → opens date picker
  3. browser_click(@e12) → selects Friday
  4. browser_fill(@e18, "8:00 PM")
  5. browser_fill(@e22, "2")
  6. browser_click(@e31) → "Find a Table" button
     → page snapshot: shows available 8:15pm slot
  7. browser_click(@e8)  → selects the slot
  8. browser_screenshot() → confirmation page visible
  9. send_message("Booked! Table for 2 at 8:15pm on Friday. Confirmation screenshot attached.")
```

### Implementation approach

Playwright is the right library — it's well-maintained, has first-class TypeScript support, and handles headless Chromium reliably. The browser instance runs inside the execution container (improvement 3) so it doesn't share the server process.

If container execution is not yet implemented, the browser can run as a separate long-lived subprocess managed by a `BrowserManager` class in the server. One browser instance per JID, launched on first use, idle-killed after 10 minutes of inactivity.

```ts
// server/browser.ts
class BrowserManager {
  private browsers = new Map<string, BrowserSession>();

  async getSession(jid: string): Promise<BrowserSession> {
    if (!this.browsers.has(jid)) {
      const session = await BrowserSession.launch({
        profileDir: `agent/store/browser/${slugify(jid)}`,
      });
      this.browsers.set(jid, session);
    }
    return this.browsers.get(jid)!;
  }
}
```

The MCP tool calls `browserManager.getSession(jid)` and proxies the navigation commands.

### Scope of new tasks unlocked

| Category | Examples |
|----------|---------|
| Booking & reservations | Restaurants, flights, appointments, venues |
| Form submission | Job applications, contact forms, signups |
| Services without APIs | Many B2B dashboards, internal tools, government portals |
| Dynamic web scraping | Any page that requires JavaScript to render |
| Monitoring | "Tell me when this product is back in stock" |
| Authentication-gated content | Analytics dashboards, ad platforms, CRM UIs |

## Where It Lives

| What | Where |
|------|-------|
| Browser sessions | `agent/store/browser/<jid-hash>/chromium-profile/` |
| Browser manager | `agent/server/browser.ts` |
| MCP tools | `agent/server/agent.ts` — 5 new tools added to `buildMcpServer()` |
| System prompt addition | Short section describing when and how to use browser tools |
| Dependencies | `playwright`, `@playwright/browser-chromium` |

## User Experience Impact

**Before:** "Book me a table at Nobu" → "I can't do that, I don't have a way to interact with restaurant booking sites." "Scrape the pricing table from this page" → returns empty or garbled content from static HTML. Anything requiring a login → impossible.

**After:** The agent handles any web task a human could handle in a browser. Combined with per-session authentication persistence, it becomes genuinely useful for the long tail of services that will never have a Corsair plugin — which is most of them.

This also dramatically reduces the pressure on the typed plugin system. Instead of needing a plugin for every new service, the browser tool provides a universal fallback. Plugins remain the right answer for high-frequency, structured operations (Slack, GitHub, Linear), while the browser covers everything else.
