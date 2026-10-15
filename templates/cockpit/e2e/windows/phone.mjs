// FA-19128: Phone app. The legacy phoneDlg against the agent-native phone window. Nothing is ever installed: the write path is proven
// by its refusal (android.install on a serial no phone has: the cockpit answers "that device is not attached" before building).
import { diffRecords } from "./harness.mjs";

export default {
  id: "phone",
  label: "Phone app",
  async openLegacy(lp) {
    await lp.evaluate(() => {
      const pill = document.getElementById("foPhone");
      if (pill.getAttribute("aria-disabled") === "true") document.getElementById("phoneDlg").showModal();   // an idle pill does not open it
      else pill.click();
    });
    await lp.waitForFunction(() => { const d = document.getElementById("phoneDlg"); return d && d.open && document.getElementById("phoneWhat").textContent.trim(); }, null, { timeout: 20_000 });
  },
  readLegacy: (lp) =>
    lp.evaluate(() => {
      const $ = (id) => document.getElementById(id);
      return {
        what: $("phoneWhat").textContent,
        devices: [...document.querySelectorAll("#phoneDevs label")].map((l) => l.textContent),
        steps: $("phoneSteps").hidden ? [] : [...$("phoneSteps").children].map((s) => s.dataset.s + " " + (s.className || "-")),
        last: $("phoneLast").textContent,
        sha: $("phoneSha").textContent,
        button: $("phoneGo").hidden ? "" : $("phoneGo").textContent,
      };
    }),
  async openNative(np) {
    // the header hides the phone pill at phone width on both pages (legacy .pills.tightest): there it is clicked as the legacy one is
    if (await np.locator(".cf-fpill.phone").isVisible()) await np.click(".cf-fpill.phone");
    else await np.evaluate(() => document.querySelector(".cf-fpill.phone").click());
    await np.waitForSelector("[data-window=phone] .cp-dlg-hl", { timeout: 20_000 });
  },
  readNative: (np) =>
    np.evaluate(() => {
      const w = document.querySelector("[data-window=phone]");
      const sec = [...w.querySelectorAll(".cp-sec")].find((x) => { const h = x.querySelector(".cp-sec-t"); return h && h.textContent === "Installed build"; });
      const items = sec ? [...sec.querySelectorAll(".cp-list li")].map((li) => li.textContent) : [];
      const go = w.querySelector(".cf-ph-go");
      return {
        what: w.querySelector(".cp-dlg-hl").textContent,
        devices: [...w.querySelectorAll(".cf-ph-devs label")].map((l) => l.textContent),
        steps: [...w.querySelectorAll(".cf-ph-steps li")].map((li) => li.querySelector(".cf-ph-sn").textContent + " " + (li.className || "-")),
        last: items.find((t) => t.startsWith("Last install:")) || "",
        sha: items.find((t) => !t.startsWith("Last install:")) || "",
        button: go ? go.textContent : "",
      };
    }),
  compare: (L, N) => diffRecords(L, N),
  async writes(np, check) {
    const chip = await np.evaluate(() => { const c = document.querySelector("[data-window=phone] .cp-dlg-sub .cp-chip"); return c ? c.textContent : ""; });
    if (/^installing/.test(chip) || chip === "no adb") { check("Phone app: write path skipped (" + chip + ": the refusal would not be the device check)", true); return; }
    const r = await np.evaluate(async () => {
      const res = await fetch(new URL("/cards/_agent-native/actions/cockpit-android-install", location.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serial: "FA19128-no-such-phone" }) });
      return { status: res.status, body: (await res.text()).slice(0, 300) };
    });
    check("Phone app: android.install on a serial no phone has is refused by the cockpit before any build (refusal path, nothing installed)", r.status >= 400 && r.status < 500 && /not attached|not ready|loopback/.test(r.body), JSON.stringify(r));
  },
};
