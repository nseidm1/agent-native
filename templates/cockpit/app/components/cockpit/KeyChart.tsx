import type { KChart } from "@shared/cockpit-home";

/**
 * A key tile's small chart (FA-19087), drawn from the view model's own scale so
 * an axis label never states a value the chart does not draw (the legacy
 * neonAxes rule). Bars grow by CSS transition; nothing loops.
 */
export function KeyChart({ chart, label }: { chart: KChart; label: string }) {
  if (chart.kind === "bars") return <Bars chart={chart} label={label} />;
  if (chart.kind === "pairs") return <Pairs chart={chart} label={label} />;
  if (chart.kind === "velocity") return <Velocity chart={chart} label={label} />;
  return <Strip chart={chart} label={label} />;
}

function Axes({ y, x }: { y?: [string, string, string]; x?: string[] }) {
  return (
    <>
      {y ? (
        <span className="cf-ay" aria-hidden="true">
          <i>{y[0]}</i>
          <i>{y[1]}</i>
        </span>
      ) : null}
      {x && x.length ? (
        <span className="cf-ax" aria-hidden="true">
          {x.map((l, i) => (
            <i key={l + i}>{l}</i>
          ))}
        </span>
      ) : null}
    </>
  );
}

function Grid({ w }: { w: number }) {
  return (
    <g className="cf-grid">
      <line x1="0" x2={w} y1="2" y2="2" />
      <line x1="0" x2={w} y1="16" y2="16" />
      <line className="z" x1="0" x2={w} y1="30" y2="30" />
    </g>
  );
}

function Bars({ chart, label }: { chart: Extract<KChart, { kind: "bars" }>; label: string }) {
  const n = Math.max(1, chart.values.length),
    W = Math.max(70, n * 10),
    cw = W / n;
  return (
    <div className="cf-chart">
      <svg viewBox={`0 0 ${W} 30`} preserveAspectRatio="none" role="img" aria-label={label}>
        <Grid w={W} />
        {chart.values.map((v, i) => {
          const h = v ? (30 * v) / Math.max(1e-9, chart.max) : 1.5;
          return <rect key={i} className={"cf-bar" + (v ? "" : " z") + (i === n - 1 ? " cur" : "")} x={i * cw + cw * 0.15} width={cw * 0.7} y={30 - h} height={h} />;
        })}
      </svg>
      <Axes y={chart.yLabels} x={chart.xLabels} />
    </div>
  );
}

function Pairs({ chart, label }: { chart: Extract<KChart, { kind: "pairs" }>; label: string }) {
  const n = Math.max(1, chart.live.length),
    W = Math.max(70, n * 12),
    cw = W / n,
    mx = Math.max(1e-9, chart.max);
  return (
    <div className="cf-chart">
      <svg viewBox={`0 0 ${W} 30`} preserveAspectRatio="none" role="img" aria-label={label}>
        <defs>
          <pattern id="cfHatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="3" />
          </pattern>
        </defs>
        <Grid w={W} />
        {chart.live.map((v, i) => {
          const h = v ? (30 * v) / mx : 1.5,
            o = chart.other[i] || 0,
            ho = o ? (30 * o) / mx : 0;
          return (
            <g key={i}>
              <rect className={"cf-bar" + (v ? "" : " z") + (i === n - 1 ? " cur" : "")} x={i * cw + cw * 0.1} width={cw * 0.38} y={30 - h} height={h} />
              {ho ? <rect className="cf-hatch" x={i * cw + cw * 0.52} width={cw * 0.38} y={30 - ho} height={ho} /> : null}
            </g>
          );
        })}
      </svg>
      <Axes y={chart.yLabels} x={chart.xLabels} />
    </div>
  );
}

function Velocity({ chart, label }: { chart: Extract<KChart, { kind: "velocity" }>; label: string }) {
  const n = Math.max(1, chart.values.length),
    cw = 110 / n,
    top = Math.max(1, chart.top);
  const Y = (v: number) => 30 - 28 * Math.sqrt(Math.max(0, v) / top);
  const gy = chart.goal ? Y(chart.goal) : -5;
  return (
    <div className="cf-vel">
      <svg className="cf-vh" viewBox="0 0 110 30" preserveAspectRatio="none" role="img" aria-label={label}>
        {chart.values.map((v, i) => {
          const y = Math.min(29, Y(v));
          return <rect key={i} className={"cf-vb" + (i === n - 1 ? " cur" : "") + (v ? "" : " z")} x={i * cw + 1.2} width={cw - 2.4} y={v ? y : 28.8} height={v ? 30 - y : 1.2} />;
        })}
        <line className="cf-goal" x1="0" x2="110" y1={gy} y2={gy} />
        <line className="cf-base" x1="0" x2="110" y1="30" y2="30" />
      </svg>
      {chart.net.length ? (
        <div className="cf-nets">
          <span className="cf-vleg">✅ Finished − 📥 New · 30 min</span>
          <svg className="cf-nb" viewBox="0 0 100 24" role="img" aria-label="Net units per 30 minutes: finished minus new">
            {chart.net.map((v, i) => {
              const h = v ? Math.max(1.5, (10 * Math.abs(v)) / Math.max(1, chart.netMax)) : 0.8;
              return <rect key={i} className={"cf-nbr " + (v > 0 ? "up" : v < 0 ? "dn" : "zr")} x={i * 25 + 4} width="17" y={v >= 0 ? 12 - h : 12} height={h} />;
            })}
            <line className="cf-base" x1="0" x2="100" y1="12" y2="12" />
          </svg>
        </div>
      ) : null}
    </div>
  );
}

function Strip({ chart, label }: { chart: Extract<KChart, { kind: "strip" }>; label: string }) {
  const X = (v: number) => Math.max(0, Math.min(100, (100 * v) / Math.max(1e-9, chart.max)));
  return (
    <div className="cf-chart strip">
      <svg viewBox="0 0 100 20" preserveAspectRatio="none" role="img" aria-label={label}>
        <rect className="cf-trk" x="0" y="8" width="100" height="4" />
        {chart.band ? <rect className="cf-iqr" x={X(chart.band[0])} width={Math.max(0, X(chart.band[1]) - X(chart.band[0]))} y="4" height="12" rx="1" /> : null}
        {chart.ticks.map((v, i) => (
          <rect key={i} className="cf-tk" x={X(v)} width="0.6" y="6" height="8" />
        ))}
        {chart.goal != null ? <line className="cf-goal" x1={X(chart.goal)} x2={X(chart.goal)} y1="0" y2="20" /> : null}
        {chart.mark != null ? <rect className="cf-mk" x={Math.min(98, Math.max(0, X(chart.mark) - 1))} width="2" y="0" height="20" /> : null}
      </svg>
    </div>
  );
}
