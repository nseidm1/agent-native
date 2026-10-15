/**
 * FA-19173 (Design and Verify): New Design / Enhance Existing Design (card-studio.js ND: the job, its cost before anything is spent,
 * its progress, Draw the images, Apply / Discard), Review Existing Designs (RD: every design as staging last had it, swap back) and QA
 * agents (qa-panel.js in its dialog, with API mocks: card-studio.js mk*). The hooks give the Design and Verify menus their items
 * (legacy appMenus' design and verify parts, with their live state); DesignLayers renders the dialogs by the studio's open layer.
 */
import { type MenuItem, useStudio } from "./api";
import { ACTIVE, ND_KINDS, type NdKind, ndJob, ndProgress, rdSig, useCaps, useDesigns, useLive, useMocksGate, useView } from "./design/data";
import { NewDesignDialog } from "./design/NewDesign";
import { QaDialog } from "./design/QaDialog";
import { ReviewDesignsDialog } from "./design/ReviewDesigns";
import "./studio-design.css";

/** The Design menu's items (card-studio.js appMenus design: New Design, Enhance Existing Design, Review Existing Designs; the menus add Variants and Add a theme). */
export function useDesignItems(): MenuItem[] {
  const st = useStudio();
  const v = useView(st.app).data;
  const live = useLive(st.app, Boolean(v && v.running)).data;
  const full = Boolean(v && v.running >= v.maxRunning);
  useCaps(st.app, "newdesign"); // the jobs' caps, read ahead so the dialog names its cost at once
  const ndIt = (kind: NdKind): MenuItem => {
    const K = ND_KINDS[kind],
      nd = v ? ndJob(v, live, kind) : null,
      run = Boolean(nd && ACTIVE(nd)),
      ready = Boolean(nd && nd.status === "done" && !nd.reviewed);
    return {
      k: K.k,
      label: K.label,
      run: () => st.open({ kind: "design", which: kind }),
      busy: run,
      badge: run ? ndProgress(nd).pct + "%" : ready ? "review" : null,
      tone: ready ? "g" : "s",
      disabled: full && !nd,
      why: full && !nd ? v.maxRunning + " jobs are running (the most at once)" : run ? "Being made: open its progress" : ready ? "Ready: review it beside the staging app" : K.does,
    };
  };
  const rd = useDesigns(st.app, v ? rdSig(v) : null);
  const d = rd.data,
    n = d ? d.designs.filter((y: any) => !y.current).length : 0;
  return [
    ndIt("newdesign"),
    ndIt("enhancedesign"),
    {
      k: "review-designs",
      label: "Review Existing Designs",
      run: () => st.open({ kind: "designs" }),
      disabled: n < 1,
      badge: n || null,
      tone: "",
      why: !d && rd.loading ? "Reading the designs…" : !d && rd.err ? "Could not read the designs: " + rd.err : n < 1 ? "No earlier designs yet" : "Swap back to a design made with New Design",
    },
  ];
}
/** The Verify menu's items (card-studio.js appMenus verify: QA agents, API mocks, Requirements) and the QA gate's badge. */
export function useVerifyItems(): { items: MenuItem[]; gate: { badge: string; why: string; state: string } | null } {
  const st = useStudio();
  const { gate } = useMocksGate(st.app, st.name, !st.layer || st.layer.kind !== "qa");
  return {
    items: [
      { k: "qa-agents", label: "QA agents", run: () => st.open({ kind: "qa" }), badge: gate ? gate.badge : null, why: gate ? gate.why : "Launch QA agents on the staging app and read their findings" },
      { k: "qa-mocks", label: "API mocks", run: () => st.open({ kind: "qa", mocks: true }), why: "Mocks of the app's external APIs, so QA can pass or fail them" },
      { k: "requirements", label: "Requirements", run: () => st.open({ kind: "checklist" }), why: "The checklist, each requirement with its browser check" },
    ],
    gate: gate ? { badge: gate.badge, why: gate.why, state: gate.state } : null,
  };
}
/** The dialogs: design (New / Enhance), designs (Review Existing Designs), qa (QA agents, API mocks). */
export function DesignLayers() {
  const st = useStudio();
  const l = st.layer;
  if (!l) return null;
  if (l.kind === "design") return <NewDesignDialog key={l.which} which={l.which} />;
  if (l.kind === "designs") return <ReviewDesignsDialog />;
  if (l.kind === "qa") return <QaDialog key={l.mocks ? "mocks" : "qa"} mocks={l.mocks} />;
  return null;
}
