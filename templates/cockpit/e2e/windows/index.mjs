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

import apps from "./apps.mjs";
import studio from "./studio.mjs";
// FA-19087 (FA-19172..FA-19175): the studio's tools, each against the legacy studio's own
import studioChat from "./studio-chat.mjs";
import studioMenus from "./studio-menus.mjs";
import studioDesign from "./studio-design.mjs";
import studioFrame from "./studio-frame.mjs";
import studioDrawers from "./studio-drawers.mjs";
import issues from "./issues.mjs";
import questions from "./questions.mjs";

export const WINDOWS = [push, overview, agents, queue, account, master, phone, jev, halosave, balancer, apps, studio, studioChat, studioMenus, studioDesign, studioFrame, studioDrawers, questions, issues];
