// FA-19087: the native studio's design tool against the legacy studio's (STUB in the shell: it only opens the studio on both pages).
import studio from "./studio.mjs";

export default {
  id: "studio-design",
  window: "apps",
  shot: "studio-design",
  label: "App studio: design",
  openLegacy: studio.openLegacy,
  readLegacy: async () => ({}),
  openNative: studio.openNative,
  readNative: async () => ({}),
  compare: () => [],
};
