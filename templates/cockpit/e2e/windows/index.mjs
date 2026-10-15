// FA-19087: every window the agent-native cockpit renders itself, in the order verify-cockpit-full.mjs proves them.
import apps from "./apps.mjs";
import push from "./push.mjs";

export const WINDOWS = [push, apps];
