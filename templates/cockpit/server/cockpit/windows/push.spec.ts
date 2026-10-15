import { describe, expect, it } from "vitest";

import { pushWindow } from "./push";

describe("FA-19127: the Push to remote window", () => {
  it("says what would go and offers the push behind a confirm", () => {
    const d = pushWindow({ ahead: 3, upstream: "origin", summary: "s", subjects: [{ sha: "abc", s: "one" }, { sha: "def", s: "two" }] }, 1, true);
    expect(d.headline).toBe("3 commits on local master would go to origin.");
    expect(d.sections[0].items!.map((i) => (i.strong ? i.strong + " " : "") + i.text)).toEqual(["abc one", "def two", "and 1 older"]);
    expect(d.actions![0]).toMatchObject({ kind: "push", label: "Push 3 commits", args: { confirm: true } });
    expect(d.actions![0].confirm).toMatch(/^Push 3 commits/);
  });
  it("offers no push when it cannot go, and says why", () => {
    const d = pushWindow({ ahead: 2, blocked: "the tree is mid-rebase", subjects: [] }, 1, true);
    expect(d.actions).toEqual([]);
    expect(d.sections[1].items![0].text).toBe("The tree is mid-rebase.");
  });
  it("says local master matches when nothing waits", () => {
    expect(pushWindow({ ahead: 0, upstream: "origin" }, 1, true).headline).toBe("Local master matches origin.");
  });
});
