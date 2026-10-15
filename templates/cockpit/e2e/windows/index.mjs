// FA-19087: every window the agent-native cockpit renders itself, in the order verify-cockpit-full.mjs proves them.
import balancer from "./balancer.mjs";
import halosave from "./halosave.mjs";
import jev from "./jev.mjs";
import push from "./push.mjs";

export const WINDOWS = [push, jev, halosave, balancer];
