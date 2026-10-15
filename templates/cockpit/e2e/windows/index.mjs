// FA-19087: every window the agent-native cockpit renders itself, in the order verify-cockpit-full.mjs proves them.
import jev from "./jev.mjs";
import push from "./push.mjs";

export const WINDOWS = [push, jev];
