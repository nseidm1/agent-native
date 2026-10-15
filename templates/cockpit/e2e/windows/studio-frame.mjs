// FA-19087 (FA-19174): the native studio's live staging frame (StudioStage.tsx + stage/steer.tsx + stage/canvas.tsx) against the legacy
// studio's (studio-stage.js, studio-steer.js, studio-canvas.js). Read from both: the bar's controls (Phone | Wide, Dark | Light, Select,
// Mark, Comments (N), Variants: labels and pressed state), the frame's src (both embed the SAME staging URL, frame/_/info staging.base),
// that the frame loaded (its ready message hid the overlay) and the building bar's text if a round builds. Then on native only: Phone /
// Wide resizes the frame; Dark / Light round-trips through the app's own theme (the frame reports ev theme); Select picks an element into
// the tray; and the writes are proven by REFUSAL ONLY (the request rewritten to the app no-such-app-fa19087, which every frame route
// refuses before acting, or a comment with an empty note, refused before anything is stored): Style's Save to staging (frame/_/tweak),
// Pin comment (comments), Apply to staging (frame/_/recolor). Nothing is tweaked, recoloured, asked or commented on family-office.
import { diffRecords } from "./harness.mjs";
import studio from "./studio.mjs";

const APP = process.env.STUDIO_APP || "family-office";
const NOAPP = "no-such-app-fa19087";
const POST = "**/_agent-native/actions/cockpit-studio-post";

// the same reading on both pages: root is the studio (legacy: the open studio dialog; native: the studio part)
function read(which) {
  const root = which === "legacy" ? [...document.querySelectorAll("dialog[open]")].find((x) => x.querySelector(".lc-tiles")) : document.querySelector("[data-testid=studio]");
  if (!root) return { error: "no studio" };
  // a control's words without its icon (the native bar's icons are aria-hidden spans, the legacy bar's are CSS ::before)
  const tx = (n) => (n ? [...n.childNodes].filter((c) => !(c.nodeType === 1 && c.getAttribute("aria-hidden") === "true")).map((c) => c.textContent).join("").replace(/\s+/g, " ").trim() : "");
  const on = (b) => b.getAttribute("aria-pressed") === "true" || b.getAttribute("aria-expanded") === "true";
  const seg = (k) => {
    const s = root.querySelector(".ss-bar [data-k=" + k + "]");
    return s ? [...s.querySelectorAll("button")].map((b) => tx(b) + (on(b) ? " (on)" : "")).join(" | ") : "(none)";
  };
  const btn = (k) => {
    const b = root.querySelector(".ss-bar [data-k=" + k + "]");
    return b ? tx(b) + (on(b) ? " (on)" : "") : "(none)";
  };
  const f = root.querySelector("iframe.ss-frame"),
    o = root.querySelector(".ss-ovl"),
    rb = root.querySelector(".ss-rbar");
  return {
    width: seg("ss-width"),
    theme: seg("ss-theme"),
    select: btn("ss-select"),
    mark: btn("ss-mark"),
    comments: btn("ss-comments"),
    variants: btn("ss-variants"),
    src: f ? f.getAttribute("src") : "(no frame)",
    loaded: String(Boolean(f) && (!o || o.hidden)),
    building: rb && !rb.hidden ? tx(rb) : "",
  };
}
const frameReady = (which) => {
  const root = which === "legacy" ? [...document.querySelectorAll("dialog[open]")].find((x) => x.querySelector(".lc-tiles")) : document.querySelector("[data-testid=studio]");
  if (!root) return false;
  const o = root.querySelector(".ss-ovl");
  return Boolean(root.querySelector("iframe.ss-frame") && root.querySelector(".ss-bar [data-k=ss-variants]") && (!o || o.hidden));
};

// rewrite every studio write of this page to the app that does not exist (and, for a comment, an empty note): the cockpit refuses it
async function refusing(np, fn, { note = false } = {}) {
  const seen = [];
  const h = (r) => {
    let j = {};
    try {
      j = JSON.parse(r.request().postData() || "{}");
    } catch {
      /* not JSON */
    }
    seen.push(j.path);
    const body = note && j.path === "comments" ? { ...(j.body || {}), note: "" } : j.body;
    return r.continue({ postData: JSON.stringify({ ...j, app: NOAPP, body }) });
  };
  await np.route(POST, h);
  try {
    return { r: await fn(), seen };
  } finally {
    await np.unroute(POST, h);
  }
}

export default {
  id: "studio-frame",
  window: "apps",
  shot: "studio-frame",
  label: "App studio: frame",
  async openLegacy(lp) {
    await studio.openLegacy(lp);
    await lp.waitForFunction(frameReady, "legacy", { timeout: 45_000 });
  },
  readLegacy: (lp) => lp.evaluate(read, "legacy"),
  async openNative(np) {
    await studio.openNative(np);
    await np.waitForFunction(frameReady, "native", { timeout: 45_000 });
  },
  readNative: (np) => np.evaluate(read, "native"),
  compare: (L, N) => [
    ...diffRecords(L, N, ["width", "theme", "select", "mark", "comments", "variants", "src", "loaded", "building"]),
    ...(N.loaded !== "true" ? ["the native frame did not load (no ready message)"] : []),
    ...(!N.src || !/frame\/s\/$/.test(N.src) ? ["the native frame is not the staging app: " + N.src] : []),
  ],
  async writes(np, check) {
    const st = np.locator(`[data-testid=studio][data-app="${APP}"]`);
    const frame = st.locator("iframe.ss-frame");
    const inFrame = np.frameLocator(`[data-testid=studio][data-app="${APP}"] iframe.ss-frame`);
    const tray = st.locator("[data-k=st-tray]");
    // 1. Phone / Wide: the frame is rendered at 375 / 1440 px and scaled to the stage
    await st.locator("[data-k=ss-width] button", { hasText: "Phone" }).click();
    const w1 = await frame.evaluate((f) => [f.style.width, f.style.transform]);
    await st.locator("[data-k=ss-width] button", { hasText: "Wide" }).click();
    const w2 = await frame.evaluate((f) => [f.style.width, f.style.transform]);
    check("Studio frame: Phone renders the app 375 px wide, Wide 1440 px scaled to the stage", w1[0] === "375px" && w2[0] === "1440px" && /scale\(0\.\d+\)/.test(w2[1]), JSON.stringify({ w1, w2 }));
    // 2. Dark / Light drives the app's OWN theme: the frame answers ev theme with the scheme it shows
    await np.evaluate(() => {
      window.__fa19174 = [];
      addEventListener("message", (e) => {
        if (e.data && e.data.studio === "live" && e.data.ev === "theme") window.__fa19174.push({ scheme: e.data.scheme, changed: e.data.changed });
      });
    });
    await st.locator("[data-k=ss-theme] button", { hasText: "Light" }).click();
    const light = await np.waitForFunction(() => (window.__fa19174 || []).some((d) => d.scheme === "light"), null, { timeout: 10_000 }).then(() => true, () => false);
    const pressed = await st.locator("[data-k=ss-theme] button", { hasText: "Light" }).getAttribute("aria-pressed");
    await st.locator("[data-k=ss-theme] button", { hasText: "Dark" }).click();
    const dark = await np.waitForFunction(() => (window.__fa19174 || []).some((d) => d.scheme === "dark"), null, { timeout: 10_000 }).then(() => true, () => false);
    check("Studio frame: Light / Dark round-trip through the app's own theme (the frame reports ev theme)", light && dark && pressed === "true", JSON.stringify(await np.evaluate(() => window.__fa19174)));
    // 3. Select: the frame picks an element (its overlay), the tray shows it
    await st.locator(".ss-bar [data-k=ss-select]").click();
    const sel = await st.locator(".ss-bar [data-k=ss-select]").getAttribute("aria-pressed");
    await inFrame.locator("h1").first().click();
    const picked = await tray.waitFor({ timeout: 8000 }).then(() => true, () => false);
    check("Studio frame: Select picks an element in the live app into the tray", sel === "true" && picked && /1 selected/.test(await tray.textContent()), sel + " " + picked);
    // 4. Style -> Save to staging (frame/_/tweak), refused for an app that does not exist: nothing is written
    await tray.locator("[data-k=st-style]").click();
    await tray.locator("[data-k=st-size-up]").click();
    const tw = await refusing(np, async () => {
      await tray.locator("[data-k=st-style-save]").click();
      return tray.locator(".ss-err", { hasText: /no such app/i }).waitFor({ timeout: 15_000 }).then(() => true, () => false);
    });
    check("Studio frame: Style's Save to staging (frame/_/tweak) shows the cockpit's refusal for an app that does not exist", tw.r && tw.seen.includes("frame/_/tweak"), JSON.stringify(tw.seen));
    await tray.locator("[data-k=st-style-cancel]").click();
    // 5. Comment -> Pin comment (comments), refused before anything is stored (an empty note, the app that does not exist)
    await tray.locator("[data-k=st-comment]").click();
    await tray.locator("[data-k=st-comment-text]").fill("fa19087 e2e refusal");
    const cm = await refusing(
      np,
      async () => {
        const res = np.waitForResponse((r) => /cockpit-studio-post/.test(r.url()) && /"path":"comments"/.test(r.request().postData() || ""), { timeout: 15_000 });
        await tray.locator("[data-k=st-comment-save]").click();
        const x = await res.catch(() => null);
        const shown = await tray.locator(".ss-err", { hasText: /write the comment first/i }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
        return { status: x ? x.status() : 0, shown };
      },
      { note: true },
    );
    check("Studio frame: Pin comment (comments) round-trips to the cockpit's refusal (nothing is stored)", cm.r.shown && cm.r.status >= 400 && cm.seen.includes("comments"), JSON.stringify({ ...cm.r, seen: cm.seen }));
    await tray.locator("[data-k=st-back]").click();
    // 6. Esc closes the steering first (the tray, then Select), never the studio
    await np.keyboard.press("Escape");
    const trayGone = await tray.waitFor({ state: "detached", timeout: 4000 }).then(() => true, () => false);
    await np.keyboard.press("Escape");
    const selOff = (await st.locator(".ss-bar [data-k=ss-select]").getAttribute("aria-pressed")) === "false";
    check("Studio frame: Esc clears the selection, then Select, and leaves the studio open", trayGone && selOff && (await st.count()) === 1, JSON.stringify({ trayGone, selOff }));
    // 7. Variants -> Apply to staging (frame/_/recolor), refused for an app that does not exist: nothing is written
    await st.locator(".ss-bar [data-k=ss-variants]").click();
    const card = st.locator("[data-k^=cv-card-]").first();
    const cards = await card.waitFor({ timeout: 30_000 }).then(() => true, () => false);
    const apply = card.locator("[data-k^=cv-apply-]");
    let rc = { r: false, seen: [] };
    if (cards && (await apply.isEnabled())) {
      rc = await refusing(np, async () => {
        await apply.click();
        return card.locator(".ss-err", { hasText: /no such app/i }).waitFor({ timeout: 15_000 }).then(() => true, () => false);
      });
    }
    check("Studio frame: Variants opens the app's palette and its variants; Apply to staging (frame/_/recolor) shows the cockpit's refusal", cards && rc.r && rc.seen.includes("frame/_/recolor"), JSON.stringify({ cards, seen: rc.seen }));
    await st.locator("[data-k=cv-close]").click();
  },
};
