/**
 * FA-19173: studio-lifecycle.js's KPI dialog (openKpis / kpiDraw / kpiCards), natively: the app's definition of success. Where the
 * model came from (confirmed, the Feature Optimizer's proposal, or none yet), the readings now (each KPI's value against its target,
 * its trend), and the model as a table to edit: Name, Slot, Unit, Target, Better (higher / lower), Guardrail, Events; + KPI, a row's
 * ×, then Confirm the KPI model (a proposal) or Save the KPI model. Read: app kpis (once on open, again after a save, never under an
 * edit); write: app kpis {model}.
 */
import { useEffect, useState } from "react";

import { READ_ONLY } from "../../../CardDialog";
import { ago, useStudio } from "../api";
import { StudioModal } from "../Modal";
import { errOf, fmt, useRead, useReread, useWriter } from "./data";
import { Spark } from "./Lens";
import { Spin } from "./Menu";
import { Err } from "./Pilot";

type Row = { id?: string; name: string; slot?: string; unit: string; target: number | null; better: string; guardrail: number | null; events: string[] };

/** The readings, one card per KPI: its value (amber off target), its target and where it was read, its trend. */
export function KpiCards({ kv }: { kv: any }) {
  return (
    <div className="sm-kpis" data-k="lc-kpi-cards">
      {kv.kpis.map((k: any, i: number) => {
        const r = k.reading || {},
          off = r.value !== null && r.value !== undefined && k.target !== null && (k.better === "down" ? r.value > k.target : r.value < k.target);
        return (
          <div className="sm-kpi" key={k.id || i}>
            <span className="sm-hint">{(k.slot ? kv.slotLabels[k.slot] + " · " : "") + k.name}</span>
            <span className={"v" + (off ? " off" : "")}>{r.value === null || r.value === undefined ? "no data yet" : fmt(r.value, k.unit)}</span>
            <span className="sm-hint">{"target " + fmt(k.target, k.unit) + (r.env ? " · " + r.env : "")}</span>
            <Spark xs={r.trend || []} />
          </div>
        );
      })}
    </div>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export function KpisLayer() {
  const st = useStudio();
  // read on open (and after a save); not polled, so a draft is never overwritten under the console's hands
  const q = useRead<any>(st.app, "app", "kpis", { stale: 0 });
  const reread = useReread();
  const write = useWriter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const kv = q.data;
  useEffect(() => {
    reread("app", "kpis");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // the draft starts from the model, else the proposal, else empty
  useEffect(() => {
    if (kv && rows === null) setRows((kv.model ? kv.model.kpis : kv.proposed ? kv.proposed.model.kpis : []).map((k: any) => ({ ...k, events: k.events || [] })));
  }, [kv, rows]);
  const ro = !st.canWrite;
  const set = (i: number, f: keyof Row, v: unknown) => setRows((rs) => (rs ? rs.map((r, j) => (j === i ? { ...r, [f]: v } : r)) : rs));
  const num = (v: string) => (v === "" ? null : Number(v));
  const save = async () => {
    if (!rows || saving) return;
    setSaving(true);
    setErr("");
    try {
      const model = { kpis: rows.map((r, i) => ({ ...r, id: r.name ? slug(String(r.id || r.name)).slice(0, 40) : r.id || "kpi_" + (i + 1) })) };
      const j = await write<any>("app", "kpis", { model });
      st.say("KPI model saved" + (j && j.staging ? " in the staging copy" : ""));
      setRows(null);
      await q.refetch();
    } catch (e) {
      setErr(errOf(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <StudioModal open onClose={st.close} size="lg" testid="kpi-dialog" title={"KPIs · " + st.name}>
      {!kv ? (
        q.isError ? (
          <p className="sm-err" role="alert">
            {"The KPIs could not be read: " + errOf(q.error)}
          </p>
        ) : (
          <p className="sm-row" role="status">
            <Spin /> Reading the KPIs…
          </p>
        )
      ) : (
        <div className="sm-db" data-k="kpi-body">
          <p className="sm-hint" data-k="kpi-from">
            {kv.model
              ? "Confirmed " + (kv.confirmedAt ? ago(kv.confirmedAt) : "") + (kv.file ? " · " + kv.file : "") + ". " + kv.productionText + "."
              : kv.proposed
                ? "The Feature Optimizer proposed this model (" + ago(kv.proposed.at) + "): edit it, then confirm. Nothing is used until you do."
                : "No KPI model yet. Run the Feature Optimizer to get a proposal, or write one: one north star, then activation, D7 retention, conversion and revenue."}
          </p>
          {kv.invalid ? (
            <p className="sm-err" role="alert">
              {"The kpis.json on disk is not valid: " + kv.invalid.join("; ")}
            </p>
          ) : null}
          {kv.kpis.length ? (
            <section data-k="kpi-now">
              <h4 className="sm-h4">Now</h4>
              <KpiCards kv={kv} />
            </section>
          ) : null}
          <section data-k="kpi-model">
            <h4 className="sm-h4">The model</h4>
            <div className="sm-ktw">
              <table className="sm-kt" data-k="kpi-table">
                <thead>
                  <tr>
                    {["Name", "Slot", "Unit", "Target", "Better", "Guardrail", "Events", ""].map((t, i) => (
                      <th scope="col" key={i}>
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(rows || []).map((r, i) => (
                    <tr key={i} data-k={"kpi-row-" + i}>
                      <td data-label="Name">
                        <input aria-label="Name" value={r.name || ""} disabled={ro} onChange={(e) => set(i, "name", e.target.value)} />
                      </td>
                      <td data-label="Slot">
                        <select aria-label={"Slot of " + (r.name || "KPI " + (i + 1))} value={r.slot || ""} disabled={ro} onChange={(e) => set(i, "slot", e.target.value || undefined)}>
                          <option value="">–</option>
                          {kv.slots.map((s: string) => (
                            <option key={s} value={s}>
                              {kv.slotLabels[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td data-label="Unit">
                        <input aria-label="Unit" value={r.unit || ""} disabled={ro} onChange={(e) => set(i, "unit", e.target.value)} />
                      </td>
                      <td data-label="Target">
                        <input aria-label="Target" type="number" step="any" inputMode="decimal" value={r.target ?? ""} disabled={ro} onChange={(e) => set(i, "target", num(e.target.value))} />
                      </td>
                      <td data-label="Better">
                        <select aria-label="Better when" value={r.better || "up"} disabled={ro} onChange={(e) => set(i, "better", e.target.value)}>
                          <option value="up">higher</option>
                          <option value="down">lower</option>
                        </select>
                      </td>
                      <td data-label="Guardrail">
                        <input aria-label="Guardrail" type="number" step="any" inputMode="decimal" value={r.guardrail ?? ""} disabled={ro} onChange={(e) => set(i, "guardrail", num(e.target.value))} />
                      </td>
                      <td data-label="Events">
                        <input
                          aria-label="Events (comma separated)"
                          value={(r.events || []).join(", ")}
                          disabled={ro}
                          onChange={(e) =>
                            set(
                              i,
                              "events",
                              e.target.value
                                .split(",")
                                .map((x) => x.trim())
                                .filter(Boolean),
                            )
                          }
                        />
                      </td>
                      <td>
                        <button type="button" className="cp-btn sm ghost" aria-label={"Remove " + (r.name || "this KPI")} disabled={ro} onClick={() => setRows((rs) => (rs ? rs.filter((_, j) => j !== i) : rs))}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sm-row">
              <button
                type="button"
                className="cp-btn sm"
                data-k="kpi-add"
                disabled={ro}
                title={ro ? READ_ONLY : undefined}
                onClick={() => setRows((rs) => [...(rs || []), { name: "", unit: "", target: null, better: "up", guardrail: null, events: [] }])}
              >
                + KPI
              </button>
              <button type="button" className="cp-btn sm sm-pri" data-k="kpi-save" disabled={!rows || !rows.length || saving || ro} title={ro ? READ_ONLY : undefined} onClick={save}>
                {saving ? <Spin /> : null}
                {kv.model ? "Save the KPI model" : "Confirm the KPI model"}
              </button>
              <Err m={err} clear={() => setErr("")} />
            </div>
          </section>
        </div>
      )}
    </StudioModal>
  );
}
