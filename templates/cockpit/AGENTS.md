# Cockpit cards — Agent Guide

The right-side card region of the cockpit dashboard (the cockpit itself is a separate Node server on
http://127.0.0.1:5217). The cockpit embeds this app as an iframe at `/cards/` through a proxy that forwards
`/cards/` and `/_agent-native/` here. One screen (`/`, served as `/cards/`): 14 status cards in bands.

## Actions (the contract the UI, the agent and MCP share)

- `get-cards` (GET): fetches the cockpit's full `/api/state` (8 s timeout, 3 s in-process cache) and maps it
  server-side (`server/cockpit/cards.ts`, words from the cockpit's own tile renderers) to 14 compact cards
  `{ id, title, tone: g|a|r|d, headline, sub, chip, spark?, meters? }`. A missing field gives tone `d`, "no data".
- `get-layout` (GET) / `set-layout` (POST): app state key `cockpit-layout`
  `{ bands: [{ id, title, cards }], hidden, size: { id: s|m|l } }`. `set-layout` refuses any unknown card id
  (400, `unknown_card_id`) and writes nothing; validation lives in `shared/cockpit.ts`.
- `ask-agent` (POST, UI only, loopback only): runs the Mac's logged-in Claude Code CLI with exactly the three
  tools above over this app's MCP endpoint (`server/cockpit/agent.ts`). Never an agent or MCP tool itself.
- `view-screen`, `navigate`: what the region shows (layout + headlines), and navigation.

## Rules

- Change layout only through `set-layout`; read `get-layout` first and send the whole layout back.
- The card ids are fixed: score, pipeline, production, board, jobs, forge, orphans, hygiene, events, models,
  halo, halocaps, modes, appkpis. A card's content comes from the cockpit's state, never from this app.
- Design is the cockpit's neon theme (tokens in `app/global.css`); the page background stays transparent.
- Clicking a card posts `{ type: 'cockpit-open', sec: id }` to the parent; the root posts
  `{ type: 'cockpit-height', h }` whenever its height changes.

## Build, run, verify

    pnpm build        # APP_BASE_PATH=/cards -> .output
    pnpm serve        # PORT=5241 HOST=127.0.0.1, AUTH_DISABLED=true, telemetry off
    node e2e/verify-region.mjs <shots-dir> [--agent]   # Playwright on system Chrome, 1280x900 + 390x844
