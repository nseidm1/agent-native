/**
 * FA-19155: at 390 the region's first get-ask-job came back 403 ui_capability_required. get-ask-job is uiOnly, and AppliedBanner
 * read it the moment the region mounted, before anything had taken the browser's UI capability cookie; the framework only takes it
 * after a 403. These tests pin the fix: one shared capability request, reused while fresh and renewed before the 10-minute cookie
 * lapses, and every useActionQuery of a uiOnly action in the app is gated on useUiCapability().
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import { UI_CAPABILITY_RENEW_MS, ensureUiCapability, resetUiCapability } from "./ui-capability";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("ensureUiCapability", () => {
  beforeEach(() => resetUiCapability());
  it("takes the capability once and reuses the request while it is fresh", async () => {
    const urls: string[] = [];
    let t = 1_000;
    const fetcher = async (u: string, init: RequestInit) => {
      urls.push(u);
      expect(init.credentials).toBe("same-origin");
      return { ok: true };
    };
    const a = ensureUiCapability({ fetcher, now: () => t });
    const b = ensureUiCapability({ fetcher, now: () => t });
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/_agent-native\/ui-capability$/);
    t += UI_CAPABILITY_RENEW_MS - 1;
    await ensureUiCapability({ fetcher, now: () => t });
    expect(urls).toHaveLength(1);
    t += 2;
    await ensureUiCapability({ fetcher, now: () => t });
    expect(urls).toHaveLength(2);
    await ensureUiCapability({ fetcher, now: () => t, force: true });
    expect(urls).toHaveLength(3);
  });
  it("renews well inside the framework's 10-minute capability", () => {
    expect(UI_CAPABILITY_RENEW_MS).toBeLessThanOrEqual(5 * 60_000);
  });
  it("settles false, never throws, when the capability is refused or the network fails", async () => {
    expect(await ensureUiCapability({ fetcher: async () => ({ ok: false }) })).toBe(false);
    resetUiCapability();
    expect(await ensureUiCapability({ fetcher: async () => Promise.reject(new Error("offline")) })).toBe(false);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("uiOnly reads wait for the capability", () => {
  const uiOnly = readdirSync(path.join(APP, "actions"))
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => /uiOnly:\s*true/.test(readFileSync(path.join(APP, "actions", f), "utf8")))
    .map((f) => f.replace(/\.ts$/, ""));
  it("finds the uiOnly actions (get-ask-job among them)", () => {
    expect(uiOnly).toContain("get-ask-job");
  });
  it("every useActionQuery of a uiOnly action passes enabled from useUiCapability()", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of walk(path.join(APP, "app"))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/useActionQuery<[^>]*>\(\s*"([\w-]+)"[^;]*;/g)) {
        if (!uiOnly.includes(m[1])) continue;
        seen++;
        const enabledVar = /enabled:\s*(\w+)/.exec(m[0]);
        const ok = !!enabledVar && new RegExp("const\\s+" + enabledVar[1] + "\\s*=\\s*useUiCapability\\(\\)").test(src);
        if (!ok) bad.push(path.relative(APP, f) + ": " + m[1]);
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
});
