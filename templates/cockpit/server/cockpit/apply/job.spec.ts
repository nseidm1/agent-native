import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { type ApplyDeps, type ApplyJob, type ApplyPaths, type Exec, newJob, readJob, runApply, runUndo, saveJob } from "./job";

type Call = { cmd: string; args: string[]; cwd: string };

/** A fake fork: git and the gate commands answer from a script, and every call is recorded in order. */
function harness(o: { changed?: string; added?: string[]; fail?: string; agentSays?: string } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "apply-spec-"));
  const P: ApplyPaths = { appDir: path.join(root, "fork", "templates", "cockpit"), repoRoot: path.join(root, "fork"), wtRoot: path.join(root, "wt"), jobsDir: path.join(root, "jobs"), node: "node", gatePort: 5999 };
  mkdirSync(P.appDir, { recursive: true });
  const calls: Call[] = [];
  const changed = o.changed ?? "templates/cockpit/app/components/cockpit/Office.tsx";
  const added = o.added ?? ['import { useActionQuery } from "@agent-native/core/client/hooks";'];
  const ok = (out = "") => ({ code: 0, out, err: "" });
  const bad = (err: string) => ({ code: 1, out: "", err });
  const exec: Exec = async (cmd, args, x) => {
    calls.push({ cmd, args, cwd: x.cwd });
    const a = args.join(" ");
    if (cmd === "git") {
      if (a.startsWith("worktree add")) {
        mkdirSync(path.join(args[4], "templates", "cockpit"), { recursive: true });
        return ok();
      }
      if (a === "rev-parse HEAD") return ok(x.cwd.startsWith(P.wtRoot) ? "c0ffee\n" : "base00\n");
      if (a.startsWith("status --porcelain=v1 -z")) return ok(x.cwd.startsWith(P.wtRoot) ? `?? ${changed}\0` : "");
      if (a.startsWith("status")) return ok("");
      if (a.startsWith("merge --ff-only") && o.fail === "merge") return bad("not possible to fast-forward");
      if (a.startsWith("merge-base")) return ok();
      return ok();
    }
    if (a.includes("typecheck")) return o.fail === "typecheck" ? bad("error TS2322: Type 'string' is not assignable") : ok();
    if (a.includes("vitest")) {
      const f = args.find((y) => y.startsWith("--outputFile="))!.slice(13);
      writeFileSync(f, JSON.stringify({ numFailedTests: 0, numPassedTests: 60, testResults: [{ name: "/x/server/cockpit/client-only.spec.ts", status: o.fail === "client-only" ? "failed" : "passed" }] }));
      return ok();
    }
    if (a.includes("build")) {
      const live = x.cwd === P.appDir;
      if ((o.fail === "build" && !live) || (o.fail === "live-build" && live && !calls.some((c) => c.args[0] === "revert"))) return bad("Build failed with 1 error");
      return ok();
    }
    return ok();
  };
  const seen: string[] = [];
  const deps: ApplyDeps = {
    exec,
    runCodeAgent: async ({ cwd }) => {
      seen.push("agent");
      // the agent's edit lands in the worktree as an untracked file
      const f = path.join(cwd, "..", "..", changed);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, added.join("\n"));
      return { ok: true, message: o.agentSays ?? "Restyled the office card as a neon tile grid bound to office.data." };
    },
    resourceContext: async () => ({ resources: {} }),
    fileSystemCard: async (why) => {
      seen.push("card:" + why);
      return { fa: "FA-1", title: "Cockpit region: needs data" };
    },
    screenshotGate: async () => {
      seen.push("screenshot");
      return o.fail === "screenshot" ? { ok: false, detail: "1280: console errors: boom", shots: [] } : { ok: true, detail: "ok", shots: ["/s/gate-1280.png", "/s/gate-390.png"] };
    },
    restart: async () => {
      seen.push("restart");
    },
  };
  const job = (): ApplyJob => newJob("apply", "make the office card look like what's attached", "Restyle the office card", "FA-19080");
  const input = { question: "make the office card look like what's attached", title: "Restyle the office card", fa: "FA-19080", images: [{ bytes: Buffer.from("png"), ext: "png", type: "image/png" as const }] };
  const order = () => calls.map((c) => (c.cmd === "git" ? "git " + c.args[0] : c.args.find((y) => /typecheck|build|vitest/.test(y))?.replace(/.*\//, "") || c.args[1]));
  return { P, calls, seen, deps, job, input, order };
}

describe("FA-19080: an Ask change goes live only through the gates, in order", () => {
  it("passes scope, typecheck, tests, build and the Playwright check, then commits, merges, rebuilds and restarts", async () => {
    const h = harness();
    const j = await runApply(h.P, h.job(), h.input, h.deps);
    expect(j.status).toBe("live");
    expect(j.phases.map((p) => p.name + ":" + p.state)).toEqual([
      "worktree:ok",
      "agent:ok",
      "scope:ok",
      "typecheck:ok",
      "tests:ok",
      "build:ok",
      "screenshot:ok",
      "commit:ok",
      "live:ok",
      "restart:running",
    ]);
    const o = h.order();
    const i = (x: string) => o.indexOf(x);
    expect(i("typecheck")).toBeLessThan(i("vitest.mjs"));
    expect(i("vitest.mjs")).toBeLessThan(o.indexOf("build"));
    expect(i("git commit")).toBeGreaterThan(o.indexOf("build"));
    expect(i("git merge")).toBeGreaterThan(i("git commit"));
    expect(h.seen).toEqual(["agent", "screenshot", "restart"]);
    expect(j.commit).toBe("c0ffee");
    expect(j.files).toEqual(["templates/cockpit/app/components/cockpit/Office.tsx"]);
    // the worktree and its branch are gone either way
    expect(o).toContain("git worktree");
    expect(h.calls.some((c) => c.args[0] === "branch" && c.args[1] === "-D")).toBe(true);
    const commit = h.calls.find((c) => c.args[0] === "commit")!;
    expect(commit.args.join(" ")).toMatch(/^commit -q -m FA-19080: Ask agent applied: Restyle the office card/);
    expect(readJob(h.P, j.id)!.status).toBe("live");
  });

  it("the newest job is a job record, never the restarter's note or the vitest report beside it; the restart folds in", async () => {
    const h = harness();
    const j = await runApply(h.P, h.job(), h.input, h.deps);
    // written after the job, so newer by mtime
    writeFileSync(path.join(h.P.jobsDir, j.id + "-vitest.json"), JSON.stringify({ numPassedTests: 1 }));
    writeFileSync(path.join(h.P.jobsDir, j.id + ".restart.json"), JSON.stringify({ ok: true, pid: 4242, detail: "pid 4242 on :5241" }));
    const latest = readJob(h.P)!;
    expect(latest.id).toBe(j.id);
    expect(latest.phases.find((p) => p.name === "restart")).toMatchObject({ state: "ok", detail: "pid 4242 on :5241" });
  });

  for (const fail of ["typecheck", "client-only", "build", "screenshot"]) {
    it(`a ${fail} failure discards the change: nothing merges, nothing restarts`, async () => {
      const h = harness({ fail });
      const j = await runApply(h.P, h.job(), h.input, h.deps);
      expect(j.status).toBe("failed");
      expect(h.calls.some((c) => c.args[0] === "merge")).toBe(false);
      expect(h.calls.some((c) => c.args[0] === "commit")).toBe(false);
      expect(h.seen).not.toContain("restart");
      expect(j.phases.find((p) => p.state === "failed")!.name).toBe(fail === "client-only" ? "tests" : fail);
      expect(j.phases.filter((p) => p.state === "pending")).toEqual([]);
    });
  }

  it("refuses a change outside the frontend before any gate runs, naming the file", async () => {
    const h = harness({ changed: "templates/cockpit/server/cockpit/client.ts" });
    const j = await runApply(h.P, h.job(), h.input, h.deps);
    expect(j.status).toBe("failed");
    expect(j.refusals!.join("\n")).toMatch(/server\/cockpit\/client\.ts: outside the frontend write scope/);
    expect(h.order()).not.toContain("typecheck");
    expect(h.calls.some((c) => c.args[0] === "merge")).toBe(false);
  });

  it("refuses a frontend file that makes its own network call", async () => {
    const h = harness({ added: ['const r = await fetch("/cards/x");'] });
    const j = await runApply(h.P, h.job(), h.input, h.deps);
    expect(j.status).toBe("failed");
    expect(j.refusals!.join("\n")).toMatch(/own network call/);
  });

  it("files a card, and changes nothing, when the agent says the system side is needed", async () => {
    const h = harness({ agentSays: "NEEDS_SYSTEM: the office resource has no refusal share" });
    const j = await runApply(h.P, h.job(), h.input, h.deps);
    expect(j.status).toBe("needs-system");
    expect(j.filed).toEqual({ fa: "FA-1", title: "Cockpit region: needs data" });
    expect(h.seen).toContain("card:the office resource has no refusal share");
    expect(h.order()).not.toContain("typecheck");
  });

  it("reverts the commit when the live rebuild fails", async () => {
    const h = harness({ fail: "live-build" });
    const j = await runApply(h.P, h.job(), h.input, h.deps);
    expect(j.status).toBe("failed");
    expect(j.error).toMatch(/reverted/);
    expect(h.calls.some((c) => c.args[0] === "revert" && c.args.includes("c0ffee"))).toBe(true);
    expect(h.seen).not.toContain("restart");
  });

  it("Undo is one action: revert the applied commit, rebuild, restart; the applied job reads undone", async () => {
    const h = harness();
    const applied = await runApply(h.P, h.job(), h.input, h.deps);
    const u = newJob("undo", applied.question, "Undo: " + applied.title, applied.fa, applied.id);
    saveJob(h.P, u);
    const done = await runUndo(h.P, u, applied, h.deps);
    expect(done.status).toBe("live");
    const revert = h.calls.filter((c) => c.args[0] === "revert");
    expect(revert[revert.length - 1].args).toEqual(["revert", "--no-edit", "c0ffee"]);
    expect(readJob(h.P, applied.id)!.status).toBe("undone");
    expect(h.seen.filter((x) => x === "restart").length).toBe(2);
  });
});
