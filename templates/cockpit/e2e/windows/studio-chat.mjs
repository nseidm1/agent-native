// FA-19087: the native studio's chat tool against the legacy studio's (STUB in the shell: it only opens the studio on both pages).
import studio from "./studio.mjs";

export default {
  id: "studio-chat",
  window: "apps",
  shot: "studio-chat",
  label: "App studio: chat",
  openLegacy: studio.openLegacy,
  readLegacy: async () => ({}),
  openNative: studio.openNative,
  readNative: async () => ({}),
  compare: () => [],
};
