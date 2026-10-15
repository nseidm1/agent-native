/**
 * FA-19173: the studio's action menus (card-studio.js appMenus / renderActions, studio-lifecycle.js menu / improveItems), their dialogs
 * (the Optimizer per lens, the KPIs, the requirements, the checkpoints; the env confirms) and the rows the tile details hold
 * (studio-pilot.js PilotRow: the requirements and Build it; studio-env.js EnvRow: staging / production, Make Production Ready, Promote).
 * Wide: five menus by job - Build, Design, Improve (its badge: the proposals waiting), Verify (QA's mocks gate as its badge), Launch -
 * then the gear (the model and caps for the next actions); below 760 px ONE Actions menu with the five as headings. A disabled item
 * keeps its reason. The Design and Verify menus' first items are DesignTools.tsx's (useDesignItems, useVerifyItems); Variants and
 * Add a theme are the live frame's (st.stage). Every write goes through the cockpit client; a viewer that cannot write sees the
 * writes off with READ_ONLY. The menus' pieces live in ./menus/.
 */
import { useRef, useState } from "react";

import { READ_ONLY } from "../../CardDialog";
import { type MenuItem, ago, useStudio } from "./api";
import { useDesignItems, useVerifyItems } from "./DesignTools";
import { actMsg, errOf, openTile, settings, useActionsList, useFlow, useLifecycle, useNarrow, useStore, useWriter } from "./menus/data";
import { EnvConfirms, EnvRow as EnvRowImpl, openConfirm, useEnvModel } from "./menus/Env";
import { KpisLayer } from "./menus/Kpis";
import { LensLayer } from "./menus/Lens";
import { Menu, Spin, useEscape, useOutside } from "./menus/Menu";
import { CheckpointsLayer, ChecklistLayer, PilotRow as PilotRowImpl, usePilot } from "./menus/Pilot";
import "./studio-menus.css";

// the flow's design steps are the New Design job's own steps (card-studio.js splitNext): they leave the menus
const COVERED = new Set(["research", "ideas", "copy", "critique"]);
const ACTIVE = (j: any) => ["queued", "working"].includes(j.status);

/** The Improve menu's items (studio-lifecycle.js improveItems): one per lens (its state, its waiting proposals, its baseline), then KPIs. */
export function useImproveItems(): MenuItem[] {
  const st = useStudio();
  const lc = useLifecycle().data;
  const ls = lc ? lc.lenses : [];
  return [
    ...ls.map((l) => ({
      k: "lens-" + l.id,
      label: l.label,
      busy: l.state === "measuring" || l.state === "running",
      badge: l.waiting || null,
      why:
        l.state === "never"
          ? "Never run · " + l.does.split(":")[0] + " · cap $" + l.caps.maxUsd
          : l.state === "measuring" || l.state === "running"
            ? l.step
            : l.state === "failed"
              ? "Last run failed: " + (l.error || "")
              : (l.waiting ? l.waiting + " proposal" + (l.waiting === 1 ? "" : "s") + " waiting · " : "") + "baseline " + l.baseline + "/100 · " + ago(l.lastAt),
      run: () => st.open({ kind: "lens", id: l.id }),
    })),
    { sep: true as const },
    { k: "kpis", label: "KPIs", why: "The app's definition of success: north star, activation, retention, conversion, revenue", run: () => st.open({ kind: "kpis" }) },
  ];
}

/** A lead action of the flow (card-studio.js runAction): the app's ask (with the gear's caps), or Build it in staging (draftable). */
function useRunAction() {
  const st = useStudio();
  const write = useWriter();
  const actions = useActionsList();
  return async (x: any) => {
    if (x.staging) {
      actMsg.set({ tone: "s", text: "Sending to the staging builder…", busy: true });
      try {
        const j = await write<any>("app", "draftable", { dry: false });
        actMsg.set(null);
        st.say('"' + j.staged.title + '" is queued for the staging copy; its bar follows it');
      } catch (e) {
        actMsg.set({ tone: "r", text: errOf(e) });
      }
      return;
    }
    const s = settings.get(),
      a = (actions || []).find((y: any) => y.k === x.action) || {};
    const caps = { model: s.model !== "auto" ? s.model : a.model, maxUsd: Number(s.maxUsd) || a.maxUsd, maxMin: Number(s.maxMin) || a.maxMin };
    try {
      await write("app", "ask", { action: x.action, followOf: x.followOf || undefined, message: x.message || "", autoApply: true, flow: x.k, ...caps });
      actMsg.set(null);
      st.say(x.label + " started; the preview updates as it works");
    } catch (e) {
      actMsg.set({ tone: "r", text: x.label + ": " + errOf(e) });
    }
  };
}

/** The action row's menus (and the gear), in place of the legacy row of equal buttons. */
export function StudioMenus() {
  const st = useStudio();
  const narrow = useNarrow();
  const [open, setOpen] = useState<string | null>(null);
  const flow = useFlow();
  const lc = useLifecycle().data;
  const pilot = usePilot();
  const E = useEnvModel();
  const design = useDesignItems();
  const verify = useVerifyItems();
  const improve = useImproveItems();
  const runAction = useRunAction();
  const msg = useStore(actMsg);
  const ro = !st.canWrite;
  const it = (k: string, label: string, run: () => void, o: Partial<Extract<MenuItem, { k: string }>> = {}): MenuItem => ({ k, label, run, ...o });
  const full = Boolean(flow && flow.running >= flow.maxRunning);
  const lead = flow ? flow.next.filter((x: any) => !COVERED.has(x.k)) : [];
  const runOf = (x: any) => x.action && flow && flow.jobs.filter(ACTIVE).find((j: any) => !j.ask && j.action === x.action && (!x.followOf || j.followOf === x.followOf));
  // a write a viewer cannot make: off, with READ_ONLY as its reason
  const w = (o: Partial<Extract<MenuItem, { k: string }>>) => (ro ? { ...o, disabled: true, why: READ_ONLY } : o);

  // BUILD: the autopilot's own buttons, else Build it (opens the Build tile); the lead actions; Checkpoints
  const build: MenuItem[] = [
    ...pilot.buttons.map((b) => it(b.k, b.label, () => void pilot.press(b.action), w({ busy: pilot.busy === b.action, disabled: pilot.busy === b.action, why: b.title }))),
    ...(pilot.buttons.length ? [] : [it("build-open", "Build it", () => openTile(st.app, "build"), { why: "The requirements, the autopilot and its state" })]),
    ...lead.map((s: any) => {
      const run = runOf(s);
      return it("na-" + s.k, s.label, () => void runAction(s), w({ busy: Boolean(run), disabled: Boolean(run || (full && s.action)), why: run ? "Running" : s.why }));
    }),
    it("checkpoints", "Checkpoints", () => (pilot.d.cps === null ? openTile(st.app, "build") : st.open({ kind: "checkpoints" })), { why: "Named checkpoints of staging, rollback, experiments" }),
  ];
  // DESIGN: New / Enhance / Review (DesignTools.tsx), then Variants and Add a theme (the live frame's)
  const stage = st.stage;
  const theme = stage && stage.theme && stage.theme.kind === false ? stage.theme : null;
  const other = theme && theme.base === "light" ? "dark" : "light";
  const designAll: MenuItem[] = [
    ...design,
    it("variants", "Variants", () => stage && stage.variants(), {
      disabled: !(stage && stage.live),
      why: stage && stage.live ? "Variants from the app's own palette and the design knowledge, tried on the app" : "Available once the staging app is live in the frame",
    }),
    ...(theme
      ? [
          it("theme-add", "Add a " + other + " theme", () => st.open({ kind: "chat", prefill: "Add a " + other + " theme to " + st.name + ", keyed to data-theme on <html> (and prefers-color-scheme when nothing is chosen), with a visible theme switch." }), {
            why: st.name + " has one theme (" + theme.base + "): a proposal, made with the Agent",
          }),
        ]
      : []),
  ];
  // LAUNCH: Make Production Ready, Promote / Deploy in progress, Rollback, the production site
  const env = E.env,
    prod = (env && env.production) || ({} as any),
    pm = env && env.promotion;
  const answered = E.loaded;
  const rdy = answered ? { off: E.model.ready.off, why: E.model.ready.title } : { off: true, why: "The staging row has not answered yet" };
  const pro = answered ? { off: E.model.promote.off, why: E.model.promote.title } : { off: true, why: "The staging row has not answered yet" };
  const deploying = Boolean(pm && !["published", "failed", "stopped"].includes(pm.state));
  const launch: MenuItem[] = [
    it(
      "production-ready",
      "Make Production Ready",
      () => {
        openTile(st.app, "launch");
        if (!rdy.off && !ro) openConfirm(st, "ready");
      },
      { why: "The launch scorecard" + (rdy.off && rdy.why ? "; " + rdy.why : ", then the cards that make staging production ready") },
    ),
    it(
      "promote",
      deploying ? "Deploy in progress" : "Promote to production",
      () => {
        openTile(st.app, "deploy");
        if (!deploying && !pro.off && !ro) openConfirm(st, "promote");
      },
      { busy: deploying, why: deploying ? "A deploy is running: open it (never a second one)" : pro.off && pro.why ? pro.why : "Starts the deploy: build, checks, phone signature, deploy, monitoring" },
    ),
    it("rollback", "Rollback", () => openConfirm(st, "rollback"), w({ disabled: !prod.canRollback, why: prod.canRollback ? "Put the previous production build back" : "No earlier production build to roll back to" })),
    it("prod-link", "Production site ↗", () => window.open(prod.url, "_blank", "noopener"), { disabled: !prod.url, why: prod.url || "Not in production yet" }),
  ];
  const waiting = lc ? lc.inbox.proposals : 0;
  const gate = verify.gate;
  const qg = gate ? { badge: gate.badge, badgeK: "qa-mocks-badge", badgeTone: gate.state === "generating" ? "s" : "a", title: gate.why } : {};
  const menus = narrow ? (
    <Menu
      label="Actions"
      k="all"
      open={open}
      setOpen={setOpen}
      items={[{ head: "Build" }, ...build, { head: "Design" }, ...designAll, { head: "Improve" }, ...improve, { head: "Verify" }, ...verify.items, { head: "Launch" }, ...launch]}
      opts={gate ? qg : { badge: waiting || null }}
    />
  ) : (
    <>
      <Menu label="Build" k="build" open={open} setOpen={setOpen} items={build} />
      <Menu label="Design" k="design" open={open} setOpen={setOpen} items={designAll} />
      <Menu label="Improve" k="improve" open={open} setOpen={setOpen} items={improve} opts={{ badge: waiting || null }} />
      <Menu label="Verify" k="verify" open={open} setOpen={setOpen} items={verify.items} opts={qg} />
      <Menu label="Launch" k="launch" open={open} setOpen={setOpen} items={launch} />
    </>
  );
  return (
    <>
      {menus}
      <Gear open={open === "gear"} setOpen={(on) => setOpen(on ? "gear" : null)} maxRunning={flow ? flow.maxRunning : 3} />
      {msg ? (
        <div className={"sm-amsg t-" + (msg.tone || "n")} role={msg.tone === "r" ? "alert" : "status"} data-k="act-msg">
          {msg.busy ? <Spin /> : null}
          {msg.text}
          {msg.tone === "r" ? (
            <button type="button" className="sm-x" aria-label="Dismiss" onClick={() => actMsg.set(null)}>
              ×
            </button>
          ) : null}
        </div>
      ) : null}
      {full && flow ? (
        <div className="sm-amsg" role="status" data-k="act-full">
          {flow.maxRunning + " jobs are running on this card (the most at once); the next action waits for one."}
        </div>
      ) : null}
    </>
  );
}

/** The gear (card-studio.js S.gear): the model and caps for the next actions, and "Answering runs the next step". */
function Gear({ open, setOpen, maxRunning }: { open: boolean; setOpen: (on: boolean) => void; maxRunning: number }) {
  const s = useStore(settings);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEscape(open, () => {
    setOpen(false);
    btn.current?.focus();
  });
  useOutside(open, wrap, () => setOpen(false));
  return (
    <div className="sm-menu sm-gearw" ref={wrap} data-k="gearwrap">
      <button
        ref={btn}
        type="button"
        className="cp-btn sm-gear"
        data-k="gear"
        aria-expanded={open}
        aria-controls="sm-gearp"
        aria-label="Action settings: model, caps, answers"
        title="Model and caps"
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(() => wrap.current?.querySelector<HTMLElement>("select")?.focus(), 0);
        }}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      <div className="sm-pop right sm-gearp" id="sm-gearp" role="group" aria-label="Action settings" hidden={!open}>
        <select aria-label="Model for the next actions" data-k="set-model" value={s.model} onChange={(e) => settings.set((x) => ({ ...x, model: e.target.value }))}>
          {[
            ["auto", "Model: each action's default"],
            ["haiku", "Haiku"],
            ["sonnet", "Sonnet"],
            ["opus", "Opus"],
          ].map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <div className="sm-row">
          <label className="sm-f">
            Cap $
            <input type="number" min="0.25" max="20" step="0.25" placeholder="default" inputMode="decimal" data-k="set-usd" aria-label="Cap in dollars per action" value={s.maxUsd} onChange={(e) => settings.set((x) => ({ ...x, maxUsd: e.target.value }))} />
          </label>
          <label className="sm-f">
            Minutes
            <input type="number" min="2" max="120" step="1" placeholder="default" inputMode="numeric" data-k="set-min" aria-label="Cap in minutes per action" value={s.maxMin} onChange={(e) => settings.set((x) => ({ ...x, maxMin: e.target.value }))} />
          </label>
        </div>
        <label className="sm-f sm-chk">
          <input type="checkbox" data-k="set-adv" checked={s.advance} onChange={(e) => settings.set((x) => ({ ...x, advance: e.target.checked }))} />
          Answering runs the next step
        </label>
        <div className="sm-hint">{"Defaults: Sonnet, $2 and 20 min (Opus for the brief, the technical approach and critique). At most " + maxRunning + " jobs at once per card."}</div>
      </div>
    </div>
  );
}

/** The dialogs the menus open, by the studio's open layer: an Optimizer, the KPIs, the requirements, the checkpoints; and the env confirms. */
export function MenuLayers() {
  const st = useStudio();
  const l = st.layer;
  return (
    <>
      {l && l.kind === "lens" ? <LensLayer key={l.id} id={l.id} /> : null}
      {l && l.kind === "kpis" ? <KpisLayer /> : null}
      {l && l.kind === "checklist" ? <ChecklistLayer /> : null}
      {l && l.kind === "checkpoints" ? <CheckpointsLayer /> : null}
      <EnvConfirms />
    </>
  );
}

/** studio-pilot.js: the requirements progress and Build it (the autopilot) with its state; the Build tile's detail holds it. */
export function PilotRow() {
  return <PilotRowImpl />;
}
/** studio-env.js: staging / production and Make Production Ready, Promote; the Launch and Deploy tiles' details hold it. */
export function EnvRow() {
  return <EnvRowImpl />;
}
export { useActionSettings } from "./menus/data";
