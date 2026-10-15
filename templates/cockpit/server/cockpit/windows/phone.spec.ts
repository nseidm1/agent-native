import { describe, expect, it } from "vitest";

import { phoneWindow, phState } from "./phone";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const dev = { serial: "R3C", state: "device", model: "SM F916U1" };

describe("FA-19128: the Phone app window", () => {
  it("says a single ready phone is picked and offers Install", () => {
    const d = phoneWindow({ state: "ready", devices: [dev], pick: "R3C", master: "39cce3d6498" }, 1, true, undefined, NOW);
    expect(d.headline).toBe("Ready to install on SM F916U1 (R3C)");
    expect(d.chips[0].t).toBe("ready");
    expect(d.part).toMatchObject({ pick: "R3C", go: "Install", steps: null });
    expect(d.sections.find((s) => s.title === "Installed build")!.items![0].text).toBe("master android/ 39cce3d6498");
  });
  it("asks for a pick with several phones", () => {
    const v = { state: "ready", devices: [dev, { serial: "X9", state: "device", model: null }], pick: null };
    expect(phState(v, null, NOW).tip).toBe("Ready to install on 2 devices: pick one");
    expect(phoneWindow(v, 1, true, undefined, NOW).part).toMatchObject({ pick: null, ready: [{ serial: "R3C", label: "SM F916U1 (R3C)" }, { serial: "X9", label: "X9" }] });
  });
  it("shows the job's steps with their lines while it installs", () => {
    const v = { state: "installing", devices: [dev], job: { serial: "R3C", at: "2026-10-15T11:59:00Z", step: "install", steps: { build: { state: "done", line: "built 13069" } } } };
    const d = phoneWindow(v, 1, true, undefined, NOW);
    expect(d.chips[0].t).toBe("installing · install");
    expect((d.part as any).steps).toEqual([{ id: "build", cls: "did", line: "built 13069" }, { id: "install", cls: "on", line: "" }, { id: "launch", cls: "", line: "" }]);
    expect((d.part as any).go).toBeNull();
  });
  it("says a failed install's reason and offers Retry; an out-of-date build is amber", () => {
    const f = phState({ state: "failed", devices: [dev], last: { ok: false, reason: "gradle build failed", hint: "see the log" } }, "R3C", NOW);
    expect(f).toMatchObject({ w: "failed", tip: "Install failed: gradle build failed - see the log", go: "Retry" });
    const d = phoneWindow({ state: "installed", devices: [dev], master: "new", installed: { ok: true, serial: "R3C", at: "2026-10-15T10:00:00Z", sha: "old", versionCode: 7 } }, 1, true, undefined, NOW);
    const its = d.sections.find((s) => s.title === "Installed build")!.items!;
    const sha = its[its.length - 1];
    expect(sha.text).toBe("Installed android/ old (versionCode 7) · master android/ new · out of date: Reinstall");
    expect(sha.tone).toBe("a");
  });
  it("words no adb and no device as the legacy table does", () => {
    expect(phState({ state: "noadb" }, null, NOW).w).toBe("no adb");
    expect(phState({ state: "none", adbError: true }, null, NOW).tip).toMatch(/^adb did not answer/);
  });
});
