// FA-19087 (FA-19172): the native studio's Agent chat against the legacy studio's (card-studio.js chatOpen / chatRender). Both pages open
// the studio of the app, then its Agent button, and read the chat dialog: its title, the model picker (each option's label, which are
// disabled, which is picked), the spend, whether Stop shows (only while a turn runs), the send button's label, each message (who, and
// the first 60 characters of its text, the markdown read as text), each staging change's Undo / Undone, and the empty state.
//
// SAFETY (real apps, real money): nothing here sends a message, stops a turn or undoes a change. Every write goes through the real
// controls with the request REWRITTEN by Playwright to the app id no-such-app-fa19087 (and, for Send, an empty text as well), so the
// cockpit refuses it before it acts: chat/send -> "Write a message first" (studio-chat.mjs sendMessage, before anything else),
// chat/stop -> "Nothing is running" (stopTurn of a chat that has no turn), staged/<id>/undo -> "APP-no-such-app-fa19087 is not on the
// board" (studio-api.mjs, before the change is looked up). A route that is not proven to rewrite first is never used: any studio write the
// interceptor cannot parse, or one that would still name a real app, is ABORTED.
import studio from "./studio.mjs";
import { diffRecords, norm } from "./harness.mjs";

const NOAPP = "no-such-app-fa19087";
const PROXY = process.env.COCKPIT_FRONT || "http://127.0.0.1:5207";
// THE STAGING FRAME IN A TEST REGION: the chat shows the staging app in its frame (frame/_/info -> staging.base, served same-origin by the
// cockpit's front). On a test region the page's origin is the region's port, not the front's, so (a) the frame's own CSP names the front's
// origin and blocks its live events, and (b) the staging app's frame-buster (docs/js/framebust.js) tries to navigate the top window, which
// the sandbox refuses with a console error (the legacy studio logs the same). Neither is the chat's; both would read as page errors here,
// so the native page gets the frame document with its CSP naming the page's own origin, the frame-buster as an empty script and its
// live-reload feed as a quiet stream (the test proxy aborts event streams).
async function frameShim(np) {
  await np.route(/\/api\/studio\/APP-[a-z0-9-]+\/frame\/s\//, async (route) => {
    const u = new URL(route.request().url());
    if (/\/framebust\.js$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: "text/javascript", body: "/* e2e: the staging app's frame-buster is off inside the studio frame */" });
    // its live-reload feed: the test proxy aborts every event stream, which would read as a failed load; a quiet, long-retry stream instead
    if (/\/__env\/events$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" });
    if (route.request().resourceType() !== "document") return route.fallback();
    const r = await route.fetch({ url: PROXY + u.pathname + u.search });
    const headers = { ...r.headers() };
    for (const k of Object.keys(headers)) if (/content-security-policy/i.test(k)) headers[k] = headers[k].split(PROXY).join(u.origin);
    return route.fulfill({ response: r, headers });
  });
}
const POST = /\/_agent-native\/actions\/cockpit-studio-post(?:\?|$)/;

const readChat = (d, legacy) => {
  if (!d) return { title: "(no chat dialog)" };
  const n = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const sel = d.querySelector("[data-k=chat-model]");
  const thread = d.querySelector("[data-k=chat-thread]");
  const msgs = [...thread.querySelectorAll(legacy ? ":scope > .cs-chm:not(.cs-chplanbox)" : ":scope > .sc-m:not(.sc-plan)")];
  const stop = d.querySelector("[data-k=chat-stop]");
  const empty = thread.querySelector(legacy ? ".cs-chempty" : ".sc-empty");
  return {
    title: n((legacy ? d.querySelector("#cs-chh") : d.querySelector(".cp-dlg-title"))?.textContent),
    models: sel ? [...sel.options].map((o) => n(o.textContent) + (o.disabled ? " (disabled)" : "")) : [],
    picked: sel && sel.selectedOptions[0] ? n(sel.selectedOptions[0].textContent) : "",
    spend: n(d.querySelector("[data-k=chat-spend]")?.textContent),
    stop: Boolean(stop && !stop.hidden),
    send: n(d.querySelector("[data-k=chat-send]")?.textContent),
    count: String(msgs.length),
    messages: msgs.map((m) => (m.classList.contains("me") ? "me" : "agent") + ": " + n(m.querySelector(legacy ? ".cs-chtx" : ".sc-tx")?.textContent).slice(0, 60)),
    undo: [...thread.querySelectorAll("[data-k=chat-undo]")].map((b) => n(b.textContent)),
    empty: empty ? n(empty.textContent) : "",
  };
};
const LEGACY_DLG = "dialog[open][data-k=chat-dialog]";
const NATIVE_DLG = "[data-testid=studio-chat]";
// the conversation has loaded (messages or the empty state, not "Loading the conversation…")
const loaded = (sel, legacy) => `${sel} [data-k=chat-thread] ${legacy ? ".cs-chm, " + sel + " .cs-chempty" : ".sc-m, " + sel + " .sc-empty"}`;

export default {
  id: "studio-chat",
  window: "apps",
  shot: "studio-chat",
  label: "App studio: chat",
  async openLegacy(lp) {
    await studio.openLegacy(lp);
    await lp.click("dialog[open] [data-k=agent]");
    await lp.waitForSelector(loaded(LEGACY_DLG, true), { timeout: 30_000 });
  },
  readLegacy: (lp) => lp.evaluate(`(${readChat})(document.querySelector(${JSON.stringify(LEGACY_DLG)}), true)`),
  async openNative(np) {
    await frameShim(np);
    await studio.openNative(np);
    const b = np.locator("[data-testid=studio] [data-k=agent]");
    await b.click();
    await np.waitForSelector(loaded(NATIVE_DLG, false), { timeout: 30_000 });
    if ((await b.getAttribute("aria-expanded")) !== "true") throw new Error("the Agent button is not pressed while the chat is open");
  },
  readNative: (np) => np.evaluate(`(${readChat})(document.querySelector(${JSON.stringify(NATIVE_DLG)}), false)`),
  compare: (L, N) => diffRecords(L, N, ["title", "models", "picked", "spend", "stop", "send", "count", "messages", "undo", "empty"]),
  async writes(np, check) {
    const dlg = np.locator(NATIVE_DLG);
    const seen = [];
    // THE INTERCEPTOR: every studio write leaves this page for app no-such-app-fa19087 (and chat/send with no text), or not at all
    const handler = async (route) => {
      let b = null;
      try {
        b = JSON.parse(route.request().postData() || "");
      } catch {
        b = null;
      }
      if (!b || typeof b !== "object" || typeof b.app !== "string") {
        seen.push({ aborted: true });
        return route.abort();
      }
      const out = { ...b, app: NOAPP };
      if (b.path === "chat/send") out.body = { ...(b.body || {}), text: "", image: undefined, refs: undefined };
      seen.push({ from: b.app, path: b.path, app: out.app });
      return route.continue({ postData: JSON.stringify(out) });
    };
    await np.route(POST, handler);
    try {
      const err = dlg.locator("[data-k=chat-err]");
      // 0. the interceptor is proven on a request that is harmless even unrewritten (an empty message is refused before anything)
      const probe = await np.evaluate(async () => {
        const r = await fetch(new URL("/cards/_agent-native/actions/cockpit-studio-post", location.origin), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ app: "family-office", root: "app", path: "chat/send", body: { text: "" } }),
        });
        return { status: r.status, body: (await r.text()).slice(0, 300) };
      });
      const proven = seen.length === 1 && seen[0].app === NOAPP && probe.status >= 400 && /write a message first/i.test(probe.body);
      check("Chat: every studio write in this run is rewritten to a non-existent app first (the probe: an empty message, refused)", proven, JSON.stringify({ seen, probe }));
      if (!proven) return;

      // 1. Send (the real button): the request leaves for no-such-app-fa19087 with no text; the cockpit's refusal shows on the error line
      seen.length = 0;
      await dlg.locator("[data-k=chat-text]").fill("FA-19087 e2e probe: never sent (rewritten)");
      await dlg.locator("[data-k=chat-send]").click();
      await err.filter({ hasText: /\S/ }).waitFor({ timeout: 20_000 });
      const sendErr = norm(await err.textContent());
      check(
        "Chat: Send round-trips through the cockpit and its refusal shows on the chat's error line (\"Write a message first\")",
        seen.length === 1 && seen[0].path === "chat/send" && seen[0].app === NOAPP && /write a message first/i.test(sendErr),
        JSON.stringify({ seen, sendErr }),
      );
      check("Chat: a refused message keeps its text in the composer", (await dlg.locator("[data-k=chat-text]").inputValue()).includes("FA-19087 e2e probe"));
      await dlg.locator("[data-k=chat-text]").fill("");

      // 2. Stop: only while a turn runs (as legacy); with no turn, the route answers "Nothing is running" (for the non-existent app)
      const stopShown = await dlg.locator("[data-k=chat-stop]").count();
      seen.length = 0;
      if (stopShown) {
        // a turn is running on the real app: Stop still goes to no-such-app-fa19087 (nothing stops), its refusal on the error line
        await dlg.locator("[data-k=chat-stop]").click();
        await err.filter({ hasText: /nothing is running/i }).waitFor({ timeout: 20_000 });
        check("Chat: Stop round-trips to the cockpit's refusal (\"Nothing is running\" for an app with no turn)", seen.length === 1 && seen[0].path === "chat/stop" && seen[0].app === NOAPP);
      } else {
        const r = await np.evaluate(async (app) => {
          const x = await fetch(new URL("/cards/_agent-native/actions/cockpit-studio-post", location.origin), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ app, root: "app", path: "chat/stop", body: {} }),
          });
          return { status: x.status, body: (await x.text()).slice(0, 300) };
        }, NOAPP);
        check(
          "Chat: Stop is hidden with no turn running (as legacy), and chat/stop answers the studio's refusal \"Nothing is running\"",
          seen.length === 1 && seen[0].app === NOAPP && r.status >= 400 && /nothing is running/i.test(r.body),
          JSON.stringify({ seen, r }),
        );
      }

      // 3. Undo (the real link of the newest staging change), rewritten: the studio refuses it for the non-existent app
      const undo = dlg.locator("[data-k=chat-undo]:not([disabled])").last();
      if (await undo.count()) {
        seen.length = 0;
        await err.evaluate((e) => e.click()); // clear the error line first
        await undo.scrollIntoViewIfNeeded();
        await undo.click();
        await err.filter({ hasText: /no such staging change|not on the board/i }).waitFor({ timeout: 20_000 });
        const undoLabel = norm(await undo.textContent());
        check(
          "Chat: Undo round-trips to the studio's refusal for an app that does not exist (\"... is not on the board\") and stays Undo",
          seen.length === 1 && /^staged\/sc-[a-z0-9]+\/undo$/.test(seen[0].path) && seen[0].app === NOAPP && undoLabel === "Undo",
          JSON.stringify({ seen, undoLabel }),
        );
      } else check("Chat: Undo (no staging change in this conversation to try it on)", true);

      // 4. the phone's Chat | Staging switch is wide-hidden; the staging pane shows the live staging app (or says why not)
      const frame = await dlg.locator("[data-k=chat-staging-frame], .sc-stg .sc-msg").count();
      check("Chat: the staging pane beside the chat shows the staging app or says why it cannot", frame === 1);
      // 5. Esc closes the chat alone, never the studio under it; the Agent button is no longer pressed
      await np.keyboard.press("Escape");
      await dlg.waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
      const studioOpen = await np.locator("[data-testid=studio] .st-tile").count();
      check(
        "Chat: Esc closes the chat alone (the studio stays) and the Agent button is released",
        (await dlg.count()) === 0 && studioOpen === 5 && (await np.locator("[data-testid=studio] [data-k=agent]").getAttribute("aria-expanded")) === "false",
      );
    } finally {
      await np.unroute(POST, handler);
    }
    check("Chat: no studio write in this run named a real app", !seen.some((x) => x.aborted));
  },
};
