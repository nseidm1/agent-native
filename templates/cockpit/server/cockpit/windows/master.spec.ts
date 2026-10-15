import { describe, expect, it } from "vitest";

import { masterWindow, threadOf } from "./master";

describe("FA-19126: the Message master window", () => {
  const v = {
    thread: {
      messages: [
        { id: "r1", at: "2026-10-09T21:27:52Z", side: "re" as const, text: "answer" },
        { id: "m1", at: "2026-10-09T21:26:34Z", side: "me" as const, text: "question", via: "phone", readAt: "2026-10-09T21:27:52Z" },
        { id: "m2", at: "2026-10-09T21:27:52Z", side: "me" as const, text: "same instant" },
      ],
      hasMore: true,
    },
    replies: [{ id: "r2", at: "2026-10-12T06:01:32Z" }, { id: "r1", at: "2026-10-09T21:27:52Z" }],
    live: true,
  };
  it("orders the thread oldest first, the console's message before a reply at the same instant", () => {
    expect(threadOf(v).map((m) => m.id)).toEqual(["m1", "m2", "r1"]);
  });
  it("hands the part the thread, whether master is live, and the newest reply's time for msgSeen", () => {
    const d = masterWindow(v, 1, true);
    expect(d.headline).toBe("Answers within a minute");
    expect(d.part).toMatchObject({ hasMore: true, live: true, seenAt: Date.parse("2026-10-12T06:01:32Z") });
    expect((d.part as any).messages).toHaveLength(3);
  });
  it("reads an older server's sent and replies when there is no thread", () => {
    const d = masterWindow({ sent: [{ id: "s", at: "2026-01-01T00:00:00Z", text: "hi" }], replies: [{ id: "r", at: "2026-01-01T00:01:00Z", text: "yo" }], live: false }, 1, true);
    expect((d.part as any).messages.map((m: any) => m.side + ":" + m.text)).toEqual(["me:hi", "re:yo"]);
    expect(d.headline).toBe("Replies when master is back");
  });
});
