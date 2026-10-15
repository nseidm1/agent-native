// FA-19087: every window the agent-native cockpit renders itself, in the order verify-cockpit-full.mjs proves them.
import agents from "./agents.mjs";
import overview from "./overview.mjs";
import account from "./account.mjs";
import master from "./master.mjs";
import phone from "./phone.mjs";
import balancer from "./balancer.mjs";
import halosave from "./halosave.mjs";
import jev from "./jev.mjs";
import push from "./push.mjs";
import queue from "./queue.mjs";

export const WINDOWS = [push, overview, agents, queue, account, master, phone, jev, halosave, balancer];
