// FA-19087: the native studio's menus tool against the legacy studio's (STUB in the shell: it only opens the studio on both pages).
import studio from "./studio.mjs";

export default {
  id: "studio-menus",
  window: "apps",
  shot: "studio-menus",
  label: "App studio: menus",
  openLegacy: studio.openLegacy,
  readLegacy: async () => ({}),
  openNative: studio.openNative,
  readNative: async () => ({}),
  compare: () => [],
};
