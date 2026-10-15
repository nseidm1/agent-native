/**
 * FA-19175: a lifecycle tile's full detail, as studio-lifecycle.js drawDetail draws it under the bar: Build (the hint, the
 * requirements row of studio-pilot.js, the definition of done), Quality (the text, QA agents, UI Optimizer, qa's measurements),
 * Launch ready (launchBox: the scorecard, Fix all), Deploy (deployBox: the five stages of the promotion, the failure, the launch
 * line; the staging / production row of studio-env.js), Live (liveBox: the KPIs with target and trend, alerts). Reads:
 * app lifecycle, env '', app launch, app kpis (10 s, as the legacy refresh).
 */
import {
  studioRead,
  studioWrite,
  useStudio,
  useStudioRead,
  type Studio,
} from "../api";
import { EnvRow, PilotRow } from "../StudioMenus";
import { ErrLine, fmt, Spin, useActs, WBtn } from "./common";

const ago = (at: unknown) => {
  const t = Date.parse(String(at || ""));
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 90
    ? "just now"
    : s < 5400
      ? Math.round(s / 60) + " min ago"
      : s < 129600
        ? Math.round(s / 3600) + " h ago"
        : Math.round(s / 86400) + " d ago";
};

type Stage = { k: string; l: string; st: "todo" | "done" | "now" | "bad" };
/** studio-lifecycle.js deployStages: the deploy job's five stages from the promotion (env-api.mjs promotionView). */
export function deployStages(pm: any, monitorArmed: boolean) {
  const S: [string, string][] = [
    ["build", "Build"],
    ["checks", "Checks"],
    ["sign", "Phone signature"],
    ["deploy", "Deploy"],
    ["monitor", "Monitoring"],
  ];
  if (!pm)
    return {
      state: "idle",
      stages: S.map(([k, l]) => ({ k, l, st: "todo" }) as Stage),
      text: "Idle",
      failedAt: null as string | null,
    };
  const ph = pm.phase || "",
    at =
      ph === "filing" || ph === "cards" || ph === "cards-partial"
        ? 0
        : ph === "candidate"
          ? 1
          : ph === "awaiting-signature"
            ? 2
            : ph === "published"
              ? 4
              : ph === "checks-failed"
                ? 1
                : ph === "failed"
                  ? pm.publish && pm.publish.sha
                    ? 3
                    : 0
                  : ph === "cancelled"
                    ? -1
                    : 0;
  const bad = pm.state === "failed",
    stopped = pm.state === "stopped";
  const stages: Stage[] = S.map(([k, l], i) => ({
    k,
    l,
    st: stopped
      ? "todo"
      : i < at
        ? "done"
        : i === at
          ? bad
            ? "bad"
            : ph === "published"
              ? monitorArmed
                ? "done"
                : "now"
              : "now"
          : "todo",
  }));
  const cur = stages.find((s) => s.st === "now" || s.st === "bad");
  return {
    state: stopped
      ? "stopped"
      : bad
        ? "failed"
        : ph === "published"
          ? "live"
          : "running",
    stages,
    failedAt: bad && cur ? cur.l : null,
    text: stopped
      ? "Stopped"
      : bad
        ? "Failed at " + (cur ? cur.l : "a stage")
        : ph === "published"
          ? "Deployed"
          : ph === "awaiting-signature"
            ? "Waiting for your signature"
            : cur
              ? cur.l + "…"
              : "Running",
  };
}
/** studio-lifecycle.js spark: a KPI's trend as a line. */
export function Spark({ xs }: { xs: unknown[] }) {
  const v = (xs || []).map(Number).filter(Number.isFinite);
  if (v.length < 2) return null;
  const lo = Math.min(...v),
    hi = Math.max(...v),
    W = 100,
    H = 22;
  const pts = v
    .map(
      (x, i) =>
        ((i * W) / (v.length - 1)).toFixed(1) +
        "," +
        (hi === lo ? H / 2 : H - 2 - ((x - lo) / (hi - lo)) * (H - 4)).toFixed(
          1,
        ),
    )
    .join(" ");
  return (
    <span className="sd-spark" aria-hidden="true">
      <svg
        viewBox="0 0 100 22"
        preserveAspectRatio="none"
        width="100%"
        height="22"
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
          points={pts}
        />
      </svg>
    </span>
  );
}

/** Opens another tile's detail (the studio owns which one is open; its tile button is the one way to switch). */
export function openTile(app: string, k: string) {
  const t = document.querySelector<HTMLButtonElement>(
    `[data-testid=studio][data-app="${app}"] .st-tile[data-k="${k}"]`,
  );
  if (t && t.getAttribute("aria-expanded") !== "true") t.click();
}

const AREA: Record<string, string> = {
  completeness: "Completeness",
  requirements: "Requirements",
  quality: "Quality",
  monetization: "Monetization",
  instrumentation: "Instrumentation",
  operations: "Operations",
};

/** A lifecycle tile's detail (k: build | quality | launch | deploy | live). */
export function TileDetailBody({ k }: { k: string }) {
  const st = useStudio();
  const lcQ = useStudioRead<any>(st.app, "app", "lifecycle", { every: 10000 });
  const envQ = useStudioRead<any>(st.app, "env", "", {
    every: 10000,
    enabled: k === "deploy" || k === "launch",
  });
  const lc = lcQ.data;
  if (!lc)
    return (
      <div className="sd-detail" data-k="lc-detail">
        <div className="sd-row" role="status">
          {lcQ.error ? (
            <span className="sd-err">
              Could not read the app's state:{" "}
              {String((lcQ.error as Error).message || lcQ.error).replace(
                /^Action [\w-]+ failed:\s*/,
                "",
              )}
            </span>
          ) : (
            <>
              <Spin /> Reading the app's state…
            </>
          )}
        </div>
        {k === "build" ? <Requirements /> : null}
      </div>
    );
  return (
    <div className="sd-detail" data-k="lc-detail" aria-live="polite">
      {k === "build" ? <BuildBox lc={lc} /> : null}
      {k === "quality" ? <QualityBox lc={lc} /> : null}
      {k === "launch" ? (
        <>
          <LaunchBox lc={lc} refresh={() => lcQ.refetch()} />
          <EnvRow />
        </>
      ) : null}
      {k === "deploy" ? (
        <>
          <DeployBox e={envQ.data || null} />
          <EnvRow />
        </>
      ) : null}
      {k === "live" ? <LiveBox lc={lc} /> : null}
    </div>
  );
}

function BuildBox({ lc }: { lc: any }) {
  const p = lc.build && lc.build.progress;
  return (
    <>
      <h4 className="sd-h4">Build</h4>
      <p className="sd-hint sd-m0" data-k="lc-build-hint">
        {"The requirements are the definition of done; Build it builds each one, verifies it in a browser and checkpoints. " +
          (p && p.detail ? p.detail + "." : "")}
      </p>
      <PilotRow />
      <Requirements />
    </>
  );
}
const STATUS_WORD: Record<string, string> = {
  verified: "verified",
  failing: "failing",
  blocked: "could not check",
  pending: "not checked yet",
  unwritten: "no check yet",
  context: "context",
};
/** The definition of done (the shell's requirement list, from the studio face). */
function Requirements() {
  const st = useStudio();
  const r = st.s.requirements;
  return (
    <>
      {r.note ? <p className="sd-hint sd-m0">{r.note}</p> : null}
      {r.items.length ? (
        <ul className="st-list st-reqs" data-testid="studio-requirements">
          {r.items.map((x) => (
            <li key={x.id} title={x.why || undefined}>
              <span className={"ap-chip t-" + (x.tone || "n")}>
                {STATUS_WORD[x.status] || x.status}
              </span>{" "}
              {x.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ap-none">No requirements yet.</p>
      )}
    </>
  );
}

const MEASURES: [string, string, string][] = [
  ["Accessibility violations", "a11y", ""],
  ["Phone LCP", "phoneLcpMs", "ms"],
  ["Layout shift (CLS)", "cls", ""],
  ["States shown (loading, empty, error)", "states", ""],
  ["Key flows passing", "flows", ""],
  ["Design consistency", "design", ""],
];
function QualityBox({ lc }: { lc: any }) {
  const st = useStudio();
  const m = lc.quality && lc.quality.measure;
  return (
    <>
      <h4 className="sd-h4">Quality</h4>
      <div className="sd-row">
        <span>{lc.quality ? lc.quality.text : ""}</span>
        <button
          type="button"
          className="cp-btn sm"
          data-k="lc-qa"
          onClick={() => st.open({ kind: "qa" })}
        >
          QA agents
        </button>
        <button
          type="button"
          className="cp-btn sm"
          data-k="lc-ui-opt"
          onClick={() => st.open({ kind: "lens", id: "ui" })}
        >
          UI Optimizer
        </button>
      </div>
      {m ? (
        <ul className="sd-list" data-k="lc-measure">
          {MEASURES.map(([l, f, u]) => (
            <li key={f}>
              <span className="sd-ok n" aria-hidden="true">
                ·
              </span>
              <span>
                {l + ": "}
                <b>
                  {m[f] === null || m[f] === undefined ? "n/a" : fmt(m[f], u)}
                </b>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sd-hint sd-m0">
          Not measured yet: an Optimizer run measures the staging app first
          (accessibility, speed, states, flows).
        </p>
      )}
    </>
  );
}

/** studio-lifecycle.js fixAll: runs what can be run for every red item (Build it, the Optimizers that never ran, the KPI model or the Agent). */
async function fixAll(st: Studio, lc: any, items: any[]): Promise<string[]> {
  const did: string[] = [],
    refused: string[] = [];
  const areas = new Set(items.map((i) => i.area));
  if (areas.has("requirements")) {
    // studio-pilot.js Build it (legacy hooks.build clicks it): the autopilot's start, only while its row offers Build it
    const b = document.querySelector<HTMLButtonElement>(
      `[data-testid=studio][data-app="${st.app}"] [data-k="pilot-start"]`,
    );
    if (b && !b.disabled) b.click();
    else {
      const ap = await studioRead<any>(st.app, "env", "autopilot").catch(
        () => null,
      );
      const s = ap && (ap.autopilot || ap);
      const state = s && s.state;
      if (s && !["running", "paused", "waiting"].includes(state))
        await studioWrite(st.app, "env", "autopilot", {
          action: "start",
        }).catch((e) => refused.push("Build it: " + errMsg(e)));
      else if (!s) openTile(st.app, "build");
    }
    did.push("Build it");
  }
  for (const [area, lens] of [
    ["completeness", "feature"],
    ["quality", "ui"],
  ]) {
    if (!areas.has(area)) continue;
    const l = lc && (lc.lenses || []).find((x: any) => x.id === lens);
    if (l && l.state === "never") {
      await studioWrite(st.app, "app", "lens/" + lens + "/run", {}).catch((e) =>
        refused.push(l.label + ": " + errMsg(e)),
      );
      did.push(l.label);
    }
  }
  if (
    items.some((i) => i.area === "instrumentation" && /KPI model/.test(i.label))
  ) {
    st.open({ kind: "kpis" });
    did.push("the KPI model");
  } else if (items.some((i) => i.area === "instrumentation")) {
    st.open({
      kind: "chat",
      prefill:
        "Add the missing KPI events to " +
        st.name +
        " (each declared in kpis.json, fired with window.appKpi && appKpi.track at the moment the user gets the value): " +
        items
          .filter((i) => i.area === "instrumentation")
          .map((i) => i.why)
          .join("; "),
    });
    did.push("the missing events (Agent)");
  }
  st.say(
    did.length
      ? "Started: " + did.join(", ")
      : "Nothing here can be fixed automatically: the red items need your decision",
  );
  return refused;
}
const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Action [\w-]+ failed:\s*/,
    "",
  );

function LaunchBox({ lc, refresh }: { lc: any; refresh: () => void }) {
  const st = useStudio();
  const q = useStudioRead<any>(st.app, "app", "launch", { every: 10000 });
  const A = useActs(refresh);
  const sc = q.data;
  if (!sc)
    return (
      <div className="sd-row" data-k="lc-launch" role="status">
        {q.error ? (
          <span className="sd-err" role="alert">
            The launch scorecard could not be read: {errMsg(q.error)}
          </span>
        ) : (
          <>
            <Spin /> Reading the launch scorecard…
          </>
        )}
      </div>
    );
  const fixable = (sc.items || []).filter((i: any) => i.ok !== true);
  return (
    <div className="sd-col" data-k="lc-launch">
      <div className="sd-row">
        <h4 className="sd-h4">Launch scorecard</h4>
        <b data-k="lc-launch-pct">{sc.pct}% ready</b>
        <span className="sd-hint">
          {sc.done} of {sc.total} green
        </span>
        <WBtn
          can={st.canWrite}
          busy={A.busy.fix}
          disabled={!fixable.length}
          className="cp-btn sm sd-pri"
          k="lc-fix-all"
          title="Runs what can be run for every red item: Build it for requirements, the Optimizers for their areas, the KPI model for instrumentation"
          onClick={() =>
            A.run("fix", async () => {
              const refused = await fixAll(st, lc, fixable);
              if (refused.length) throw new Error(refused.join("; "));
            })
          }
        >
          Fix all
        </WBtn>
        <ErrLine
          text={A.err.fix}
          onClear={() => A.clear("fix")}
          k="lc-fix-err"
        />
      </div>
      <div
        className="sd-meter"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={sc.pct}
        aria-label={sc.pct + "% launch ready"}
      >
        <i style={{ width: sc.pct + "%" }} />
      </div>
      <ul className="sd-list" data-k="lc-launch-items">
        {(sc.items || []).map((i: any, n: number) => (
          <li key={n}>
            <span
              className={
                "sd-ok " + (i.ok === true ? "g" : i.ok === false ? "r" : "n")
              }
              role="img"
              aria-label={
                i.ok === true
                  ? "green"
                  : i.ok === false
                    ? "red"
                    : "not proven yet"
              }
            >
              {i.ok === true ? "✓" : i.ok === false ? "✗" : "?"}
            </span>
            <span>
              <b>{(AREA[i.area] || i.area) + " · " + i.label}</b>
              {i.why ? <span className="sd-hint">{" - " + i.why}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="sd-hint sd-m0">
        Promote to production stays possible below 100%; it says exactly what is
        missing. Make Production Ready and Promote are below.
      </p>
    </div>
  );
}

function DeployBox({ e }: { e: any }) {
  const pm = e && e.promotion,
    d = deployStages(pm, false);
  return (
    <div className="sd-col" data-k="lc-deploy">
      <div className="sd-row">
        <h4 className="sd-h4">Deploy to production</h4>
        <span className="sd-hint">
          {pm
            ? "Started " +
              ago(pm.at || pm.startedAt) +
              "; you can leave and come back: pressing Promote again attaches to this deploy, never starts another"
            : "Idle: Promote to production below starts the deploy (a long-running job)"}
        </span>
      </div>
      <ol className="sd-stages" aria-label="Deploy stages" data-k="lc-stages">
        {d.stages.map((s) => (
          <li
            key={s.k}
            className={
              "sd-stage " +
              (s.st === "done"
                ? "done"
                : s.st === "now"
                  ? "now"
                  : s.st === "bad"
                    ? "bad"
                    : "")
            }
            aria-current={s.st === "now" ? "step" : undefined}
          >
            <b>
              {s.st === "now" ? <Spin /> : null}
              {s.l}
            </b>
            <span className="sd-hint">
              {s.st === "done"
                ? "done"
                : s.st === "now"
                  ? s.k === "sign"
                    ? "sign on your phone"
                    : "running"
                  : s.st === "bad"
                    ? "failed"
                    : "waiting"}
            </span>
          </li>
        ))}
      </ol>
      {d.state === "failed" ? (
        <p className="sd-err sd-m0" role="alert">
          {"Failed at " +
            d.failedAt +
            (pm.why ? ": " + pm.why : "") +
            ". Retry with Promote, or Rollback below."}
        </p>
      ) : null}
      <LaunchLine />
    </div>
  );
}
/** THE LAUNCH SCORECARD IN PROMOTE: Promote stays possible below 100% and says exactly what is missing. */
function LaunchLine() {
  const st = useStudio();
  const q = useStudioRead<any>(st.app, "app", "launch", { every: 10000 });
  const sc = q.data;
  return (
    <p className="sd-hint sd-m0" data-k="lc-deploy-launch" role="status">
      {sc ? (
        <>
          <b>{"Launch readiness " + sc.pct + "%"}</b>
          {(sc.red || []).length
            ? " · missing: " +
              sc.red
                .slice(0, 4)
                .map((r: any) => r.label)
                .join(", ") +
              (sc.red.length > 4
                ? " (+" + (sc.red.length - 4) + " more)"
                : "") +
              " "
            : " · every item green "}
          <button
            type="button"
            className="sd-lnk"
            data-k="lc-deploy-scorecard"
            onClick={() => openTile(st.app, "launch")}
          >
            See the scorecard
          </button>
        </>
      ) : q.error ? (
        "The launch scorecard could not be read: " + errMsg(q.error)
      ) : (
        <>
          <Spin /> Reading the launch scorecard…
        </>
      )}
    </p>
  );
}

function LiveBox({ lc }: { lc: any }) {
  const st = useStudio();
  const q = useStudioRead<any>(st.app, "app", "kpis", { every: 10000 });
  const kv = q.data;
  if (!kv)
    return (
      <div className="sd-row" data-k="lc-live" role="status">
        {q.error ? (
          <span className="sd-err" role="alert">
            The KPIs could not be read: {errMsg(q.error)}
          </span>
        ) : (
          <>
            <Spin /> Reading the KPIs…
          </>
        )}
      </div>
    );
  return (
    <div className="sd-col" data-k="lc-live">
      <div className="sd-row">
        <h4 className="sd-h4">{"Live: how " + st.name + " is doing"}</h4>
        <button
          type="button"
          className="cp-btn sm"
          data-k="lc-kpis-edit"
          onClick={() => st.open({ kind: "kpis" })}
        >
          {kv.model ? "Edit KPIs" : "Set up KPIs"}
        </button>
      </div>
      <p className="sd-hint sd-m0">{kv.productionText}</p>
      {(kv.kpis || []).length ? (
        <KpiCards kv={kv} />
      ) : (
        <p className="sd-hint sd-m0">
          {kv.proposed
            ? "The Feature Optimizer proposed a KPI model: review and confirm it in KPIs."
            : "No KPI model yet: the Feature Optimizer proposes one (north star, activation, retention, conversion, revenue); you confirm it."}
        </p>
      )}
      {lc.live && lc.live.alerts ? (
        <ul className="sd-list" data-k="lc-alerts">
          {(kv.alerts || []).map((a: any, i: number) => (
            <li key={i}>
              <span className="sd-ok r" aria-hidden="true">
                !
              </span>
              <span>{(a.level || "warn") + ": " + (a.text || a.kpi)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
export function KpiCards({ kv }: { kv: any }) {
  return (
    <div className="sd-kpis" data-k="lc-kpi-cards">
      {(kv.kpis || []).map((k: any, i: number) => {
        const r = k.reading || {},
          off =
            r.value !== null &&
            r.value !== undefined &&
            k.target !== null &&
            k.target !== undefined &&
            (k.better === "down" ? r.value > k.target : r.value < k.target);
        return (
          <div className="sd-kpi" key={k.id || i}>
            <span className="sd-hint sd-kn">
              {(k.slot ? (kv.slotLabels || {})[k.slot] + " · " : "") + k.name}
            </span>
            <span className={"v" + (off ? " off" : "")}>
              {r.value === null || r.value === undefined
                ? "no data yet"
                : fmt(r.value, k.unit)}
            </span>
            <span className="sd-hint">
              {"target " + fmt(k.target, k.unit) + (r.env ? " · " + r.env : "")}
            </span>
            <Spark xs={r.trend || []} />
          </div>
        );
      })}
    </div>
  );
}
