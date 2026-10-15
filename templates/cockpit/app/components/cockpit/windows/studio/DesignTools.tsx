/**
 * FA-19173 (Design and Verify): New Design / Enhance Existing Design (card-studio.js ND: the job, its cost before anything is
 * spent, its progress, Draw the images, Apply / Discard), Review Existing Designs (RD: every design as staging last had it,
 * swap back) and QA agents (qa-panel.js in its dialog, with API mocks: card-studio.js mk*). STUB in the shell: the hooks give
 * the menus their items, the layers render the dialogs.
 */
import { type MenuItem, useStudio } from "./api";

/** The Design menu's items (card-studio.js appMenus design: New Design, Enhance Existing Design, Review Existing Designs, Variants, Add a theme). */
export function useDesignItems(): MenuItem[] {
  const st = useStudio();
  return [
    { k: "newdesign", label: "New Design", run: () => st.open({ kind: "design", which: "newdesign" }) },
    { k: "enhancedesign", label: "Enhance Existing Design", run: () => st.open({ kind: "design", which: "enhancedesign" }) },
    { k: "review-designs", label: "Review Existing Designs", run: () => st.open({ kind: "designs" }) },
  ];
}
/** The Verify menu's items (card-studio.js appMenus verify: QA agents, API mocks, Requirements) and the QA gate's badge. */
export function useVerifyItems(): { items: MenuItem[]; gate: { badge: string; why: string; state: string } | null } {
  const st = useStudio();
  return {
    items: [
      { k: "qa-agents", label: "QA agents", run: () => st.open({ kind: "qa" }) },
      { k: "qa-mocks", label: "API mocks", run: () => st.open({ kind: "qa", mocks: true }) },
      { k: "requirements", label: "Requirements", run: () => st.open({ kind: "checklist" }) },
    ],
    gate: null,
  };
}
/** The dialogs: design (New / Enhance), designs (Review Existing Designs), qa (QA agents, API mocks). */
export function DesignLayers() {
  return null;
}
