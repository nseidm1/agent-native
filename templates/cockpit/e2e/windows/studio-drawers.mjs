// FA-19087: the native studio's drawers tool against the legacy studio's (STUB in the shell: it only opens the studio on both pages).
import studio from "./studio.mjs";

export default {
  id: "studio-drawers",
  window: "apps",
  shot: "studio-drawers",
  label: "App studio: drawers",
  openLegacy: studio.openLegacy,
  readLegacy: async () => ({}),
  openNative: studio.openNative,
  readNative: async () => ({}),
  compare: () => [],
};
