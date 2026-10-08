/* ============================================================
   insights.js — an outside opinion on the shop's own numbers

   Reports says what happened. This says what to do about it: what is
   genuinely working, what is costing money, and the order to fix it in.

   The shop's briefing goes to a Supabase Edge Function which holds the
   Anthropic key; no key ever reaches a browser, because ShopFlow runs on
   shared tablets and a key in localStorage is a key anyone at the machine can
   read. Without the function deployed the briefing is still shown in full —
   you can see exactly what would be sent before anything is.
   ============================================================ */
"use strict";

const Insights = {
  FN: "ai-insights",
  DAYS: 90,
  busy: false,
  error: "",
  showBriefing: false,

  held() { return Store.state.insights || null; },
  briefing() { return D.briefing({ days: this.DAYS }); },

  /* The function is reachable only when the shop is signed in to the cloud —
     it spends real money, so the shop login is the gate. */
  available() {
    return typeof Sync !== "undefined" && Sync.configured() && !!Sync.client && !App._localOnly;
  },

  async run() {
    if (this.busy) return;
    this.busy = true; this.error = ""; App.render();
    try {
      const { data: { session } } = await Sync.client.auth.getSession();
      if (!session) throw new Error("Sign in to the shop workspace first.");
      const briefing = this.briefing();
      const res = await fetch(`${SYNC_CONFIG.url}/functions/v1/${this.FN}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SYNC_CONFIG.anonKey,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ briefing }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        throw new Error(body.detail
          ? `${body.error || "Request failed"} — ${String(body.detail).slice(0, 180)}`
          : (body.error || `Request failed (${res.status})`));
      }
      M.saveInsight(body.insight, { model: body.model, usage: body.usage,
        days: this.DAYS, finished: briefing.delivery.finishedInPeriod }, App.me.id);
      Toast.show("Assessment ready", { emoji: "sparkles" });
    } catch (e) {
      this.error = (e && e.message) || String(e);
    } finally {
      this.busy = false; App.render();
    }
  },

  /* ---------- view ---------- */
  view() {
    const held = this.held();
    const b = this.briefing();
    const canRun = this.available() && App.can("reports.view");

    return `<div class="panel ins-panel">
      <header>
        <h2>${icon("brain", 15)} Assessment</h2>
        <span class="t-caption">${held
          ? `from ${fmtDate(held.at)} · last ${held.meta.days} days`
          : "an experienced read of the numbers below"}</span>
        <div class="grow"></div>
        ${canRun ? `<button class="btn ${held ? "" : "primary"}" id="ins-run" ${this.busy ? "disabled" : ""}>
          ${this.busy ? `<span class="sync-spinner"></span> Reading the numbers…` : `${icon("sparkles", 13)} ${held ? "Look again" : "Get an assessment"}`}
        </button>` : ""}
      </header>
      <div class="panel-pad">
        ${this.error ? `<div class="ins-error">${icon("alert", 16)}<span>${esc(this.error)}</span></div>` : ""}
        ${!canRun ? `<div class="ins-setup">${icon("cloud-off", 17)}
          <span class="grow"><b>Not connected</b>
            <span>${this.available() ? "You need permission to see Reports." :
              "Sign in to the shop workspace, and deploy the ai-insights function, and an assessment can be requested here. The briefing below is what it would be given."}</span></span>
        </div>` : ""}
        ${held ? this.resultHtml(held) : ""}
        ${this.briefingHtml(b, held)}
      </div>
    </div>`;
  },

  resultHtml(held) {
    const r = held.insight || {};
    const conf = { high: "", medium: "warn", low: "bad" }[r.confidence] || "";
    const sev = (s) => ({ high: "bad", medium: "warn", low: "" }[s] || "");
    const list = (arr) => Array.isArray(arr) ? arr : [];

    return `
      <div class="ins-headline">
        <b>${esc(r.headline || "")}</b>
        ${r.confidence ? `<span class="pill ${conf === "bad" ? "blocked" : conf === "warn" ? "paused" : "done"}">${esc(r.confidence)} confidence</span>` : ""}
        ${r.confidence_note ? `<span>${esc(r.confidence_note)}</span>` : ""}
      </div>

      ${list(r.strengths).length ? `<div class="t-label ins-h">${icon("check-circle", 13)} What is working</div>
        <div class="ins-list">
          ${list(r.strengths).map(x => `<div class="ins-card good">
            <b>${esc(x.title)}</b>
            <span>${esc(x.detail)}</span>
            <span class="ins-ev">${esc(x.evidence)}</span>
          </div>`).join("")}
        </div>` : ""}

      ${list(r.issues).length ? `<div class="t-label ins-h">${icon("alert", 13)} What is costing you</div>
        <div class="ins-list">
          ${list(r.issues).map(x => `<div class="ins-card ${sev(x.severity)}">
            <b>${esc(x.title)} <span class="ins-sev">${esc(x.severity || "")}</span></b>
            <span>${esc(x.detail)}</span>
            <span class="ins-cost">${esc(x.cost)}</span>
            <span class="ins-ev">${esc(x.evidence)}</span>
          </div>`).join("")}
        </div>` : ""}

      ${list(r.steps).length ? `<div class="t-label ins-h">${icon("arrow-right", 13)} What to do, in order</div>
        <ol class="ins-steps">
          ${list(r.steps).map(x => `<li>
            <b>${esc(x.title)}</b> <span class="tag">${esc(x.effort || "")}</span>
            <span>${esc(x.detail)}</span>
            <span class="ins-ev">Expect: ${esc(x.expect)}</span>
          </li>`).join("")}
        </ol>` : ""}

      <div class="ins-meta">${esc(held.meta.model || "")} · ${held.meta.finished} finished jobs in ${held.meta.days} days${
        held.meta.usage && held.meta.usage.input ? ` · ${(held.meta.usage.input / 1000).toFixed(1)}k in / ${(held.meta.usage.output / 1000).toFixed(1)}k out` : ""}</div>`;
  },

  /* The briefing is shown, not hidden: it is the shop's own data leaving the
     building, and they should be able to read every line of it. */
  briefingHtml(b, held) {
    const rows = [
      ["Finished in the period", `${b.delivery.finishedInPeriod} jobs · ${b.delivery.onTimePercent === null ? "—" : b.delivery.onTimePercent + "% on time"}`],
      ["Average lead time", b.delivery.avgLeadWorkingDays === null ? "—" : `${b.delivery.avgLeadWorkingDays} working days`],
      ["Open jobs", `${b.delivery.openJobs}`],
      ["Hours logged", `${b.time.hoursLogged} h against ${b.time.hoursEstimatedForThatWork} h estimated`],
      ["Time tracking", `${b.tracking.finishedTasksWithLoggedTime} of ${b.tracking.finishedTasks} finished tasks carry time`],
      ["Needs attention", `${b.attention.blocked.length} blocked · ${b.attention.overdue.length} overdue · ${b.attention.notMovedInDays.length} gone quiet`],
      ["Materials short", `${b.materials.shortForAcceptedWork.length} · ${b.materials.notLinkedToStock} not linked to stock`],
      ["Customers", `${b.customers.length} with finished work`],
    ];
    return `<details class="sw-cols ins-brief" ${held ? "" : "open"}>
      <summary>What it is given — ${this.DAYS} days of this shop's own data</summary>
      <div class="sw-cols-body">
        <div class="ins-facts">
          ${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
        </div>
        <div class="t-caption" style="margin-top:10px">
          Jobs, customers, stations, hours, materials and delivery dates are included, by name.
          Nothing is stored by the assessment; the key stays on the server.
        </div>
        <button class="link" id="ins-raw" type="button">${this.showBriefing ? "Hide" : "Show"} the exact data</button>
        ${this.showBriefing ? `<pre class="ins-raw">${esc(JSON.stringify(b, null, 1))}</pre>` : ""}
      </div>
    </details>`;
  },

  bind(root) {
    const run = $("#ins-run", root);
    if (run) run.onclick = () => this.run();
    const raw = $("#ins-raw", root);
    if (raw) raw.onclick = () => { this.showBriefing = !this.showBriefing; App.render(); };
  },
};
