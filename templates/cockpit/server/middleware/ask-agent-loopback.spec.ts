import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/application-state", () => ({ readAppState: vi.fn(), writeAppState: vi.fn() }));

import { askerCanApply, loopbackOnlyRefusal, REMOTE_VERIFIED_ACTIONS, viewerCanWrite } from "./ask-agent-loopback";

const A = (name: string) => `/cards/_agent-native/actions/${name}`;

describe("FA-19087 phone writes parity (MI-370): the region's write gate", () => {
  it("lets this Mac run every gated action", () => {
    for (const n of ["ask-agent", "undo-ask-change", "cockpit-act", "cockpit-lane-switch", "cockpit-budget"]) expect(loopbackOnlyRefusal(A(n), "127.0.0.1", undefined)).toBeNull();
    expect(loopbackOnlyRefusal(A("cockpit-lane-switch"), "127.0.0.1", "127.0.0.1")).toBeNull();
  });
  it("refuses a socket that is not loopback whatever the headers say", () => {
    expect(loopbackOnlyRefusal(A("cockpit-lane-switch"), "100.64.0.9", undefined, "verified")).toMatch(/loopback/);
  });
  it("admits a remote viewer's cockpit-* write only when the front marked it verified", () => {
    expect(REMOTE_VERIFIED_ACTIONS).toContain("cockpit-lane-switch");
    expect(REMOTE_VERIFIED_ACTIONS).toContain("cockpit-budget");
    expect(loopbackOnlyRefusal(A("cockpit-lane-switch"), "127.0.0.1", "100.64.0.9", "verified")).toBeNull();
    expect(loopbackOnlyRefusal(A("cockpit-budget"), "127.0.0.1", "100.64.0.9", "verified")).toBeNull();
    expect(loopbackOnlyRefusal(A("cockpit-lane-switch"), "127.0.0.1", "100.64.0.9")).toMatch(/read-only/);
    expect(loopbackOnlyRefusal(A("cockpit-lane-switch"), "127.0.0.1", "100.64.0.9", "yes")).toMatch(/read-only/);
  });
  it("keeps the generic act loopback only, mark or not", () => {
    expect(REMOTE_VERIFIED_ACTIONS).not.toContain("cockpit-act");
    expect(loopbackOnlyRefusal(A("cockpit-act"), "127.0.0.1", "100.64.0.9", "verified")).toMatch(/read-only/);
  });
  it("MI-388: answers ask-agent from a remote viewer (the action decides from the mark); its Undo needs the mark", () => {
    expect(loopbackOnlyRefusal(A("ask-agent"), "127.0.0.1", "100.64.0.9", "verified")).toBeNull();
    expect(loopbackOnlyRefusal(A("ask-agent"), "127.0.0.1", "100.64.0.9")).toBeNull();
    expect(loopbackOnlyRefusal(A("ask-agent"), "100.64.0.9", undefined, "verified")).toMatch(/loopback/);
    expect(loopbackOnlyRefusal(A("undo-ask-change"), "127.0.0.1", "100.64.0.9", "verified")).toBeNull();
    expect(loopbackOnlyRefusal(A("undo-ask-change"), "127.0.0.1", "100.64.0.9")).toMatch(/read-only/);
    expect(loopbackOnlyRefusal(A("undo-ask-change"), "127.0.0.1", "100.64.0.9", "yes")).toMatch(/read-only/);
  });
  it("MI-388: this Mac and a paired phone apply an Ask agent change; any other remote viewer reads and files", () => {
    expect(askerCanApply(undefined, undefined)).toBe(true);
    expect(askerCanApply("127.0.0.1", undefined)).toBe(true);
    expect(askerCanApply("100.64.0.9", "verified")).toBe(true);
    expect(askerCanApply("100.64.0.9", undefined)).toBe(false);
    expect(askerCanApply("100.64.0.9", "yes")).toBe(false);
  });
  it("tells the page whether this viewer may write, by the same rule", () => {
    expect(viewerCanWrite("127.0.0.1", undefined, undefined)).toBe(true);
    expect(viewerCanWrite("127.0.0.1", "::1", undefined)).toBe(true);
    expect(viewerCanWrite("127.0.0.1", "100.64.0.9", "verified")).toBe(true);
    expect(viewerCanWrite("127.0.0.1", "100.64.0.9", undefined)).toBe(false);
    expect(viewerCanWrite("100.64.0.9", undefined, "verified")).toBe(false);
  });
});
