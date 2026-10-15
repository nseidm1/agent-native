import { describe, expect, it } from "vitest";

import { issuesWindow } from "./issues";

describe("FA-19134: the Issues window", () => {
  const open = { id: "is-1", card: "FA-17500", kind: "environment", state: "open", why: "ended no-submit", tried: [{ tier: "", line: "no code" }], refusal: "environment: x", last: "no code", raisedAt: "2026-10-13T00:06:01Z" };
  const closed = { id: "is-2", card: "no card", kind: "lander-hung", state: "closed", reason: "withdrawn", why: "hung", last: "hung" };
  it("shows each open issue with what was tried and Retry / Move to tier / Close", () => {
    const d = issuesWindow({ open: 1, issues: [closed, open] }, 1, true);
    expect(d.headline).toBe("1 issue open");
    const s = d.sections[0];
    expect(s.title).toBe("FA-17500");
    expect(s.items!.map((i) => (i.strong ? i.strong + ": " : "") + i.text)).toEqual(["ended no-submit", "Tried: no code", "Refusal: environment: x", "Last: no code"]);
    const acts = s.items![s.items!.length - 1].actions!;
    expect(acts.map((a) => a.label)).toEqual(["Retry", "Move to tier", "Close"]);
    expect(acts[1].input!.options).toEqual(["haiku", "sonnet", "opus", "human"]);
    expect(acts[2]).toMatchObject({ args: { id: "is-1", do: "close" }, input: { name: "reason", required: true }, danger: true });
    const c = d.sections[1];
    expect(c.title).toBe("Closed");
    expect(c.rows![0].cells.slice(0, 2)).toEqual(["no card", "closed: withdrawn"]);
  });
  it("says so when there are none", () => {
    const d = issuesWindow({ open: 0, issues: [] }, 1, true);
    expect(d.headline).toBe("No open issues");
    expect(d.sections[0].text).toMatch(/^No issues\./);
  });
});
