// FA-19087: the native studio's frame tool against the legacy studio's (STUB in the shell: it only opens the studio on both pages).
import studio from "./studio.mjs";

export default {
  id: "studio-frame",
  window: "apps",
  shot: "studio-frame",
  label: "App studio: frame",
  openLegacy: studio.openLegacy,
  readLegacy: async () => ({}),
  openNative: studio.openNative,
  readNative: async () => ({}),
  compare: () => [],
};
