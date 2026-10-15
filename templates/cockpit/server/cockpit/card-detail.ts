import { type CardId } from "../../shared/cockpit.js";
import type { CardDetail } from "../../shared/cockpit-detail.js";
import { get } from "./client.js";
import { buildDetail, type DetailOptions } from "./detail.js";
import { getState } from "./state.js";

/** A live client resource's data, or null when the cockpit does not answer. */
async function live<T>(name: string): Promise<T | null> {
  try {
    const r = await get<T>(name);
    return r.ok ? r.data : null;
  } catch {
    return null;
  }
}

/** One card's detail from the shared state read; the halo, appkpis and score windows add one live client resource each. */
export async function getCardDetail(id: CardId, o: Pick<DetailOptions, "cls" | "window"> = {}): Promise<CardDetail> {
  const r = await getState();
  const opts: DetailOptions = { ...o };
  if (id === "halo") {
    const m = await live<{ models: unknown[] }>("halomodels");
    opts.haloModels = m && Array.isArray(m.models) ? m.models.slice(0, 200) : null;
  }
  if (id === "appkpis") opts.appData = (await live<{ data: unknown }>("appdata"))?.data ?? null;
  if (id === "score") opts.costPanel = (await live<{ data: unknown }>("estimate"))?.data ?? null;
  const d = buildDetail(id, r.j, opts);
  if (!r.ok) return { ...d, ok: d.ok && !!r.j, error: r.error, at: r.at };
  return { ...d, at: r.at };
}
