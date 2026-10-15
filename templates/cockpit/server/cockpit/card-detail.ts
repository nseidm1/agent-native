import { type CardId } from "../../shared/cockpit.js";
import type { CardDetail } from "../../shared/cockpit-detail.js";
import { getState } from "./cards.js";
import { cockpitGet } from "./cockpit-api.js";
import { buildDetail, type DetailOptions } from "./detail.js";

/** One card's detail from the shared, cached state read; the halo and appkpis dialogs add one live GET each. */
export async function getCardDetail(id: CardId, o: Pick<DetailOptions, "cls" | "window"> = {}): Promise<CardDetail> {
  const r = await getState();
  const opts: DetailOptions = { ...o };
  if (id === "halo") {
    const m = await cockpitGet("/api/halo/models");
    opts.haloModels = Array.isArray(m) ? m.slice(0, 200) : null;
  }
  if (id === "appkpis") opts.appData = await cockpitGet("/api/env/_data");
  if (id === "score") opts.costPanel = await cockpitGet("/api/studio/estimate/panel");
  const d = buildDetail(id, r.j, opts);
  if (!r.ok) return { ...d, ok: d.ok && !!r.j, error: r.error, at: r.at };
  return { ...d, at: r.at };
}
