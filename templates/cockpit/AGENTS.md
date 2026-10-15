# Cockpit cards — Agent Guide

The right-side card region of the cockpit dashboard (the cockpit itself is a separate Node server on this
Mac). The cockpit embeds this app as an iframe at `/cards/` through a proxy that forwards `/cards/` and
`/_agent-native/` here. One screen (`/`, served as `/cards/`): 14 status cards in bands, their click
windows, and the whole board.

## The cockpit client — the ONLY way this app reaches the cockpit (FA-19027)

`server/cockpit/client.ts` is the one file that knows where the cockpit is. It reads the cockpit's
manifest (every resource and action, with JSON Schemas) and offers `get(name)` (etag-cached, a 304 reuses
the copy), `act(name, input)` (input checked against the manifest schema first) and `events(listener)`
(one shared change stream). Everything else names resources and actions, never a route:

- `server/cockpit/state.ts` assembles the cards' and windows' state from the bounded resources.
- `server/cockpit/board.ts` reads the whole board (`board`, `board/cards`) and one card (`board/card/<fa>`).
- `server/plugins/cockpit-live.ts` turns the client's change stream into a framework `cockpit` change, which
  the page hears through `useDbSync` and answers by re-reading; nothing polls the cockpit's state.
- `server/cockpit/client-only.spec.ts` fails if any other file of this app names a cockpit route or port;
  `server/cockpit/manifest-parity.spec.ts` checks every name used against the manifest
  (`shared/cockpit-manifest.json`, refreshed by `scripts/sync-manifest.ts`, and live when it answers).

## Actions (the contract the UI, the agent and MCP share)

- `get-cards` (GET): the 14 compact cards `{ id, title, tone: g|a|r|d, headline, sub, chip, spark?, meters? }`
  mapped server-side (`server/cockpit/cards.ts`) from the client's resources. A missing field gives tone `d`.
- `get-card-detail` (GET): one card's click window (`server/cockpit/detail.ts`).
- `get-board` (GET) / `get-board-card` (GET): every column and open card, and one card's body, notes and questions.
- `cockpit-manifest` (GET) / `cockpit-read` (GET): what the cockpit offers, and any resource by name. A resource
  the cockpit adds is readable here with no change to this app.
- `cockpit-act` (POST, loopback only, asks first, never an MCP tool): any cockpit action by manifest name.
  The dialog writes (`cockpit-board-card-action`, `cockpit-halo-model`, ...) are typed shortcuts onto the same path.
- `cockpit-ping` (POST): the client round trip (the cockpit echoes the text back).
- `get-layout` (GET) / `set-layout` (POST): app state key `cockpit-layout`
  `{ bands: [{ id, title, cards }], hidden, size: { id: s|m|l } }`. `set-layout` refuses any unknown card id
  (400, `unknown_card_id`) and writes nothing; validation lives in `shared/cockpit.ts`.
- `ask-agent` (POST, UI only): runs the Mac's logged-in Claude Code CLI with the read tools above and
  `set-layout` over this app's MCP endpoint (`server/cockpit/agent.ts`); a frontend change is applied behind
  the gates (`server/cockpit/apply/`), a system request becomes a board card. Who may apply (Portfolio MI-388):
  this Mac, or a phone the cockpit's front marks `x-cockpit-write: verified` (paired with the board token).
  Any other remote viewer gets reads only, no `set-layout`, and its change requests filed as cards.
  `undo-ask-change` needs the same: this Mac or a paired phone. It never writes to the cockpit.
- `view-screen`, `navigate`: what the region shows (layout + headlines), and navigation.

## Rules

- Never name a cockpit route or port outside `server/cockpit/client.ts`; add what is missing to the cockpit's
  client API (Portfolio `tools/lane/maint/ui/client-api.mjs`) instead.
- Change layout only through `set-layout`; read `get-layout` first and send the whole layout back.
- The card ids are fixed: score, pipeline, production, board, jobs, forge, orphans, hygiene, events, models,
  halo, halocaps, modes, appkpis. A card's content comes from the cockpit, never from this app.
- Design is the cockpit's neon theme (tokens in `app/global.css`); the page background stays transparent.
- Clicking a card posts `{ type: 'cockpit-open', sec: id }` to the parent; the root posts
  `{ type: 'cockpit-height', h }` whenever its height changes.

## Build, run, verify

    pnpm build        # APP_BASE_PATH=/cards -> .output
    pnpm serve        # PORT=5241 HOST=127.0.0.1, AUTH_DISABLED=true, telemetry off
    pnpm test         # vitest: the client, the client-only judge, the manifest parity, the mappers
    node e2e/verify-region.mjs <shots-dir> [--agent]      # Playwright on system Chrome, 1280x900 + 390x844
    node e2e/verify-client-board.mjs <shots-dir>          # the board from the client, through the cockpit front
