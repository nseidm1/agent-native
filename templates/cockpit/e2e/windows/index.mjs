// FA-19087: every window the agent-native cockpit renders itself, in the order verify-cockpit-full.mjs proves them.
import account from "./account.mjs";
import master from "./master.mjs";
import phone from "./phone.mjs";
import push from "./push.mjs";

export const WINDOWS = [push, account, master, phone];
