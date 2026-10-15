import { describe, expect, it } from "vitest";

import { questionsBtnOf } from "../home";
import { ago, questionsWindow, saidOf, summaryLine, type Question } from "./questions";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const open: Question = {
  id: "cq-abc",
  question: "Land the unfinished work?",
  why: "It waits on you",
  area: "Agents",
  priority: "blocking",
  askedBy: "the work ledger",
  askedAt: "2026-10-15T11:50:00Z",
  options: [
    { label: "Land it", consequence: "it lands", recommended: true, reason: "first choice" },
    { label: "Discard it", consequence: "it is archived" },
  ],
  after: "Your answer goes to agent-door at once.",
};
const sys: Question = {
  id: "cq-sys",
  question: "Hand it on?",
  area: "Agents",
  askedBy: "the work ledger",
  state: "answered",
  options: [{ label: "Land it" }, { label: "Hand it" }, { label: "Discard it" }],
  answer: { kind: "answer", text: "Hand it", option: 1, at: "2026-10-12T12:00:00Z", system: { why: "Your last 3 answers chose it." } },
  undoUntil: "2026-10-12T12:00:10Z",
  confirm: "The work goes on.",
  delivery: { to: "remedy hand", at: "2026-10-15T11:00:00Z" },
};

describe("FA-19134: the Questions for you window", () => {
  it("says the legacy summary line", () => {
    expect(summaryLine([], 307, 0)).toBe("Nothing is waiting on you · 307 answers on the way to the owners");
    expect(summaryLine([open], 1, 2)).toBe("1 open · 1 blocking a launch · about 1 min · 1 answer on the way · 2 more being put into plain words");
    expect(ago("2026-10-12T12:00:00Z", NOW)).toBe("3 days ago");
  });
  it("shows an open question with its options as answers, a free-text answer, Not now and Drop", () => {
    const d = questionsWindow({ items: [open], recent: [], recentTotal: 0 }, { pending: 0 }, 1, 1, true, undefined, NOW);
    expect(d.tone).toBe("r");
    const s = d.sections[0];
    expect(s.title).toBe("Question 1 of 1");
    expect(s.sub).toBe("Blocks a launch · Agents · Asked by the work ledger · 10 min ago");
    const opt = s.items!.find((i) => i.strong === "Land it (recommended)")!;
    expect(opt.tone).toBe("g");
    expect(opt.actions![0]).toMatchObject({ kind: "question", args: { verb: "answer", id: "cq-abc", option: "Land it" } });
    expect(opt.actions![0].confirm).toBe("Answer “Land it”?");
    const free = s.items!.find((i) => i.strong === "Something else")!;
    expect(free.actions![0].input).toMatchObject({ name: "text", required: true });
    const snooze = s.items!.find((i) => i.strong === "Not now")!;
    expect(snooze.actions!.map((a) => a.args.minutes)).toEqual([60, 240, 1440]);
    const drop = s.items!.find((i) => i.strong === "Drop this")!;
    expect(drop.actions![0]).toMatchObject({ args: { verb: "drop", id: "cq-abc" }, danger: true, input: { name: "reason", required: true } });
    expect(d.part).toEqual({ issuesOpen: 1 });
    expect(d.chips.map((c) => c.t)).toEqual(["1 question open", "1 issue open"]);
  });
  it("lists the answered ones as the legacy does, with Overrule for a system answer", () => {
    const d = questionsWindow({ items: [], recent: [sys], recentTotal: 889 }, { pending: 307, held: 0 }, 0, 1, true, undefined, NOW);
    expect(d.headline).toBe("Nothing is waiting on you · 307 answers on the way to the owners");
    expect(d.sections[0]).toMatchObject({ title: "You are all caught up" });
    const t = d.sections.find((s) => s.title === "Answered")!;
    expect(t.sub).toBe("the newest 1 of 889");
    const r = t.rows![0];
    expect(r.cells[1]).toBe("By the system · Answered: “Hand it” · 3 days ago");
    expect(r.cells[2]).toEqual({ t: "Answered", tone: "a" });
    expect(r.note).toContain("Why the system could answer: Your last 3 answers chose it.");
    expect(r.actions!.map((a) => a.label)).toEqual(["Overrule"]);
    expect(r.actions![0].input!.options).toEqual(["Land it", "Discard it"]);
    expect(saidOf({ id: "x", state: "closed", closed: { why: "moot" } })).toBe("Resolved elsewhere · moot");
  });
  it("the Lane button shows only while questions wait (the legacy qTick)", () => {
    expect(questionsBtnOf({ published: true, n: 0 })).toBeNull();
    expect(questionsBtnOf({ published: true, n: 2, blocking: 1, minutes: 3, tone: "red" })).toEqual({
      n: 2,
      label: "2 questions for you",
      sub: "1 blocking a launch · about 3 min",
      tone: "red",
      aria: "2 questions for you, 1 blocking. Open the questions",
    });
  });
});
