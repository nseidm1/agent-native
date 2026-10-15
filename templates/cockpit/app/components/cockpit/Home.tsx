import { useActionMutation } from "@agent-native/core/client/hooks";
import { useEffect, useRef, useState } from "react";

import type { BudgetView, FaceView, HomeView, KeyTile, LaneView, ModeView, Opens } from "@shared/cockpit-home";
import { KeyChart } from "./KeyChart";
import { OfficeCard } from "./OfficeCard";
import { QuestionsButton } from "./windows/QuestionsButton";

export type Notify = (text: string, bad?: boolean) => void;
export type OpenFn = (o: Opens, el: HTMLElement) => void;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Action [\w-]+ failed:\s*/, "");

const LockIcon = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 100 132" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={open ? "M29 62V38a21 21 0 0 1 42 0v8" : "M29 62V38a21 21 0 0 1 42 0v24"} />
    <rect x="15" y="60" width="70" height="60" rx="9" fill="currentColor" fillOpacity=".2" />
    <path d="M23 72h12M23 108h18M66 74h11M70 104h7M23 90h6" strokeWidth="1.2" strokeOpacity=".45" />
    <circle cx="50" cy="83" r="7.5" />
    <path d="M45.5 89l-2.5 15h14l-2.5-15" />
  </svg>
);

/** The lock, Production and Client switches (the legacy laneTri; each writes ONE switch through locks.set). */
export function LaneControl({ lane, canWrite, notify, onDone }: { lane: LaneView; canWrite: boolean; notify: Notify; onDone: () => void }) {
  const [over, setOver] = useState<{ v: Partial<LaneView>; at: number }>({ v: {}, at: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const run = useActionMutation<{ ok: boolean; answer?: any }, { switch: "lock" | "production" | "client"; on: boolean }>("cockpit-lane-switch", { timeoutMs: 60_000 });
  // a written value holds for 3 s so a snapshot taken before the write never flickers the switch back (the legacy wroteAt rule)
  const fresh = Date.now() - over.at < 3000;
  const cur: LaneView = fresh ? { ...lane, ...over.v } : lane;
  const flip = async (sw: "lock" | "production" | "client") => {
    if (!canWrite || busy) return;
    const key = sw === "lock" ? "unlocked" : sw;
    const now = cur[key as keyof LaneView];
    if (now == null) return;
    const on = !now;
    const words: Record<string, [string, string, string, string]> = {
      lock: ["Allowing master intervention", "Locking master intervention", "Master intervention open.", "Master intervention locked."],
      production: ["Turning door runs on", "Turning door runs off", "Door runs on: new ones start.", "Door runs off: no new ones start; running ones finish."],
      client: ["Re-enabling the Halo client", "Tripping the Halo client", "Client on: Halo model calls run again.", "Client tripped: no Halo model call runs until you turn it back on."],
    };
    const w = words[sw];
    setBusy(sw);
    notify(on ? w[0] : w[1]);
    try {
      await run.mutateAsync({ switch: sw, on });
      setOver({ v: { [key]: on }, at: Date.now() });
      notify(on ? w[2] : w[3]);
      onDone();
    } catch (e) {
      notify("Not saved: " + errText(e), true);
    } finally {
      setBusy(null);
    }
  };
  const locked = cur.unlocked !== true;
  const sw = (id: "production" | "client", label: string, on: boolean | null, onWord: string, offWord: string, titleOn: string, titleOff: string, aria: string) => (
    <span className={"cf-dsw" + (on ? " on" : "")} data-sw={id}>
      <span className="cf-dswl">{label}</span>
      <span className="cf-gline" aria-hidden="true" />
      <button
        type="button"
        role="switch"
        className="cf-switch"
        aria-checked={!!on}
        aria-label={aria}
        title={on ? titleOn : titleOff}
        disabled={!canWrite || !!busy || on == null}
        onClick={() => flip(id)}
      >
        <span className="cf-knob" aria-hidden="true" />
      </button>
      <span className="cf-dsws">{on == null ? "…" : on ? onWord : offWord}</span>
      <span className="cf-gline" aria-hidden="true" />
    </span>
  );
  return (
    <div className="cf-lane" data-testid="cf-lane">
      <div className="cf-lanet">Lane</div>
      <span className="cf-lanebar" aria-hidden="true" />
      <div className="cf-tri" role="group" aria-label="Lane">
        <button
          type="button"
          className={"cf-lock" + (locked ? " locked" : "")}
          aria-pressed={locked}
          aria-label={locked ? "MIs locked, system cards only - allow MIs" : "MIs allowed - lock to system cards only"}
          title={
            locked
              ? "MIs locked: master files system cards only and lands no fix itself. Click to allow MIs."
              : "MIs allowed: master may land red/green fixes as master interventions, not only file system cards. Click to lock to system cards only."
          }
          disabled={!canWrite || !!busy || cur.unlocked == null}
          onClick={() => flip("lock")}
        >
          <span className="cf-lki">
            <LockIcon open={!locked} />
          </span>
          <span className="cf-lkt">{cur.unlocked == null ? "…" : locked ? "Locked" : "Unlocked"}</span>
          <span className="cf-gline" aria-hidden="true" />
        </button>
        {sw(
          "client",
          "Client",
          cur.client,
          "On",
          "Tripped",
          "The Halo client is on: model calls run on the Halo. Turn off to trip it; agents and door runs keep going.",
          "The Halo client is tripped: no Halo model call runs (callers fall back). Turn on to re-enable it.",
          "Client tripwire for Halo client calls",
        )}
        {sw(
          "production",
          "Production",
          cur.production,
          "On",
          "Off",
          "Door runs are on: the dispatcher starts new door runs. Turn off to stop new ones; running ones finish.",
          "Door runs are off: no new door run starts; the ones already running finish. Turn on to resume.",
          "Production switch for new door runs",
        )}
      </div>
    </div>
  );
}

/** The Budget stepper (the legacy capBox: steps of 1 %, Auto; a step saves after 700 ms, Auto after 300 ms). */
export function BudgetBox({ budget, canWrite, notify, onDone }: { budget: BudgetView | null; canWrite: boolean; notify: Notify; onDone: () => void }) {
  const [want, setWant] = useState<number | "auto" | undefined>(undefined);
  const [stat, setStat] = useState<{ t: string; bad?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantRef = useRef(want);
  wantRef.current = want;
  const run = useActionMutation<{ ok: boolean }, { pctPerDay?: number; auto?: boolean }>("cockpit-budget", { timeoutMs: 60_000 });
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const val = want !== undefined ? want : budget ? (budget.auto ? "auto" : budget.pctPerDay) : null;
  const auto = val === "auto";
  const shown = !budget ? "…" : auto ? budget.shown === "Auto" || budget.pctPerDay == null ? "Auto" : Math.round(budget.pctPerDay * 10) / 10 + "%" : val == null ? "…" : Math.round((val as number) * 10) / 10 + "%";
  const save = async () => {
    const w = wantRef.current;
    timer.current = null;
    if (w === undefined) return;
    try {
      await run.mutateAsync(w === "auto" ? { auto: true } : { pctPerDay: w });
      setStat({ t: "Saved; the lane paces to it on its next pass" });
      notify("Budget saved: " + (w === "auto" ? "Auto" : w + "% of the weekly limit per day") + ".");
      onDone();
      setTimeout(() => setStat(null), 8000);
    } catch (e) {
      setStat({ t: "Not saved: " + errText(e), bad: true });
      notify("Budget not saved: " + errText(e), true);
    }
    if (!timer.current && wantRef.current === w) setWant(undefined);
  };
  const step = (dir: number) => {
    if (!budget || !canWrite) return;
    let v = val as number | "auto" | null;
    if (v === "auto" || v == null) v = Math.round(budget.pctPerDay && budget.pctPerDay > 0 ? budget.pctPerDay : 10);
    const next = Math.max(1, Math.min(100, (v as number) + dir));
    setWant(next);
    wantRef.current = next;
    setStat({ t: "Saving…" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 700);
  };
  const goAuto = () => {
    if (!budget || !canWrite || auto) return;
    setWant("auto");
    wantRef.current = "auto";
    setStat({ t: "Saving…" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 300);
  };
  const ro = !canWrite || !budget;
  return (
    <div className="cf-cap" data-testid="cf-budget" role="group" aria-label="Team size">
      <div
        className="cf-cstep"
        role="group"
        aria-label="Budget"
        title={"Budget: the share of the WEEKLY account usage limit the fleet may use per day, 1 to 100%; it sets the agent limit and cards at once. Auto = run at capacity." + (budget && budget.line ? "\n\nNow: " + budget.line : "")}
      >
        <span className="cf-ck">
          <span className="cf-cki" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3v9l6.4 6.4M12 12H3" />
            </svg>
          </span>
          Budget
        </span>
        <div className="cf-crow">
          <button type="button" className="cf-cbtn" aria-label="Decrease budget by one percent per day" disabled={ro || (!auto && (val as number) <= 1)} onClick={() => step(-1)}>
            −
          </button>
          <b className="cf-cv" aria-live="polite">
            {shown}
          </b>
          <button type="button" className="cf-cbtn" aria-label="Increase budget by one percent per day" disabled={ro || (!auto && (val as number) >= 100)} onClick={() => step(1)}>
            +
          </button>
        </div>
        <button type="button" className={"cf-auto" + (auto ? " on" : "")} role="switch" aria-checked={auto} aria-label="Budget derived automatically (Auto)" title="Auto: the % per day is derived from what is left of the week" disabled={ro || auto} onClick={goAuto}>
          Auto
        </button>
        {stat ? <span className={"cf-cst" + (stat.bad ? " bad" : "")} role="status">{stat.t}</span> : null}
      </div>
    </div>
  );
}

function Face({ f, onOpen }: { f: FaceView; onOpen: OpenFn }) {
  const parts = f.headline.split(/(FA-\d+)/);
  const detail = f.detail.split(/(FA-\d+)/);
  return (
    <div
      className={"cf-tile cf-face" + (f.flag ? " flag" : "")}
      data-face={f.id}
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={f.aria}
      title={f.headline + " · " + f.detail}
      onClick={(e) => onOpen(f.opens, e.currentTarget)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(f.opens, e.currentTarget))}
    >
      <div className="cf-lab">{f.label}</div>
      <div className="cf-fh">{parts.map((p, i) => (i % 2 ? <span key={i} className="fid">{p}</span> : p))}</div>
      <div className="cf-fd">{detail.map((p, i) => (i % 2 ? <span key={i} className="fid">{p}</span> : p))}</div>
    </div>
  );
}

function ModeTile({ m, onOpen }: { m: ModeView; onOpen: OpenFn }) {
  return (
    <div
      className="cf-tile cf-mode"
      data-tile="modeTile"
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label="Drafting mode outcomes: open the per-family breakdown"
      onClick={(e) => onOpen(m.opens, e.currentTarget)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(m.opens, e.currentTarget))}
    >
      <div className="cf-lab cf-modelab">{m.label}</div>
      <div className="cf-mfh">{m.head}</div>
      <div className="cf-mfd">{m.detail}</div>
    </div>
  );
}

const ART: Record<string, React.ReactNode> = {
  halo: (
    <svg viewBox="0 0 100 100">
      <ellipse className="cf-pulse" cx="50" cy="88" rx="38" ry="7" />
      <g className="cf-art-g">
        <path d="M50 14 L80 31 L50 48 L20 31 Z" className="t" />
        <path d="M20 31 L50 48 L50 82 L20 65 Z" className="l" />
        <path d="M80 31 L50 48 L50 82 L80 65 Z" className="r" />
      </g>
    </svg>
  ),
  jev: (
    <svg viewBox="0 0 100 100">
      <ellipse className="cf-pulse" cx="50" cy="88" rx="38" ry="7" />
      <g className="cf-art-g">
        <path d="M50 16 L78 70 L22 70 Z" className="t" />
      </g>
      <g className="cf-beams">
        <path d="M6 46 L36 43" className="w" />
        <path d="M64 40 L94 30" />
        <path d="M64 44 L94 44" className="c" />
        <path d="M64 48 L94 58" className="d" />
      </g>
    </svg>
  ),
  balancer: (
    <svg viewBox="0 0 100 100">
      <ellipse className="cf-pulse" cx="50" cy="88" rx="38" ry="7" />
      <g className="cf-art-g open">
        <path d="M50 14 V80 M34 82 H66 M18 28 H82" />
        <path d="M18 28 L8 52 H28 Z M82 28 L72 52 H92 Z" className="l" />
      </g>
    </svg>
  ),
  landed: (
    <svg viewBox="0 0 100 80">
      <ellipse className="cf-pulse" cx="50" cy="64" rx="44" ry="10" />
      <circle className="cf-spin" cx="50" cy="34" r="24" />
      <circle className="cf-ring" cx="50" cy="34" r="15" />
    </svg>
  ),
};

function Tile({ t, onOpen }: { t: KeyTile; onOpen: OpenFn }) {
  return (
    <div
      className={`cf-tile cf-kt k-${t.tone}${t.wide ? " wide" : ""}`}
      data-tile={t.id}
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={t.label + ": " + t.value + ". Opens its window."}
      title={t.title}
      onClick={(e) => onOpen(t.opens, e.currentTarget)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(t.opens, e.currentTarget))}
    >
      {t.art ? (
        <div className="cf-art" aria-hidden="true">
          {ART[t.art]}
        </div>
      ) : null}
      <div className="cf-lab">
        <span>
          {t.art === "jev" || t.art === "halo" ? <i className="cf-spulse" aria-hidden="true" /> : null}
          {t.label}
        </span>
      </div>
      {t.id === "kVel" ? (
        <div className="cf-val cf-vhd">
          <span className="cf-vico" aria-hidden="true">
            {t.icon}
          </span>
          <span className="cf-vnum">{t.value}</span>
          <span className="cf-vu">/h</span>
          <span className="cf-vnet">{t.net}</span>
        </div>
      ) : (
        <div className={"cf-val" + (t.valueTone ? " v-" + t.valueTone : "")}>{t.value}</div>
      )}
      {t.chart && t.id !== "kVel" && t.chart.kind !== "strip" ? <KeyChart chart={t.chart} label={t.label} /> : null}
      {t.chart && t.id === "kVel" ? <KeyChart chart={t.chart} label="Units landed per hour, last 12 hours" /> : null}
      {t.chart && t.chart.kind === "strip" ? <KeyChart chart={t.chart} label={t.label} /> : null}
      {t.lines.map((l, i) =>
        l.text ? (
          <div key={i} className={"cf-tgt" + (l.tone ? " t-" + l.tone : "")} title={l.title}>
            {l.text}
          </div>
        ) : null,
      )}
    </div>
  );
}

/** The phone glance's key numbers: velocity first, then what it is made of and the health it rides on. */
const GLANCE_TILES: KeyTile["id"][] = ["kVel", "kLanded", "kMin", "kWt", "kRg"];

/** The home column: lane and Budget beside the office, the three faces, the drafting mode and the key numbers. */
export function Home({ home, glance, canWrite, notify, onOpen, onDone }: { home: HomeView; glance?: boolean; canWrite: boolean; notify: Notify; onOpen: OpenFn; onDone: () => void }) {
  // the glance (the phone) drops Budget, the drafting mode and the cost tiles and keeps velocity and health, velocity first
  const tiles = glance ? GLANCE_TILES.flatMap((id) => home.tiles.filter((t) => t.id === id)) : home.tiles;
  return (
    <div className={"cf-home" + (glance ? " glance" : "")} role="region" aria-label={glance ? "Lane, velocity and system health" : "Lane controls and key numbers"} data-testid="cf-home">
      <div className="cf-lanerow">
        <div className="cf-lanecol">
          <LaneControl lane={home.lane} canWrite={canWrite} notify={notify} onDone={onDone} />
          <QuestionsButton q={home.lane.questions} onOpen={(el) => onOpen({ legacy: "questions" }, el)} />
          {glance ? null : <BudgetBox budget={home.budget} canWrite={canWrite} notify={notify} onDone={onDone} />}
        </div>
        <OfficeCard office={home.office} onOpen={(slug, el) => onOpen({ legacy: slug }, el)} onBoard={(el) => onOpen({ card: "board" }, el)} />
      </div>
      <div className="cf-faces" role="group" aria-label="Cockpit faces">
        {home.faces.map((f) => (
          <Face key={f.id} f={f} onOpen={onOpen} />
        ))}
      </div>
      <div className="cf-keys" role="group" aria-label={glance ? "Velocity and system health" : "Key numbers"}>
        {home.mode && !glance ? <ModeTile m={home.mode} onOpen={onOpen} /> : null}
        {tiles.map((t) => (
          <Tile key={t.id} t={t} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}
