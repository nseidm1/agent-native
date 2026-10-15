// FA-19087: every window the agent-native cockpit renders itself, in the order verify-cockpit-full.mjs proves them.
import apps from "./apps.mjs";
import issues from "./issues.mjs";
import push from "./push.mjs";
import questions from "./questions.mjs";

export const WINDOWS = [push, apps, questions, issues];
