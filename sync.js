/* ============================================================
   ShopFlow — Cloud sync (GitHub Pages app + Supabase data)
   Shared workspace across every device with a real login:
   the shop password signs in to Supabase, and the database is
   locked to authenticated sessions — the public key alone gets
   you nothing. Instant sync via Supabase realtime.

   Inert until configured: with no SYNC_CONFIG (no sync-config.js)
   this stays off and the app runs fully local. See SETUP-CLOUD.md.
   ============================================================ */
"use strict";

const Sync = {
  client: null, channel: null, wsId: "default", table: "workspaces",
  status: "off", authed: false, checking: false,
  _debounce: null, _applying: false, _initted: false, _lastSync: null,

  configured() { return typeof SYNC_CONFIG !== "undefined" && SYNC_CONFIG && SYNC_CONFIG.url && SYNC_CONFIG.anonKey; },

  async _load() {
    if (this.client) return;
    const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    this.client = mod.createClient(SYNC_CONFIG.url, SYNC_CONFIG.anonKey);
    this.wsId = SYNC_CONFIG.workspace || "default";
    this.table = SYNC_CONFIG.table || "workspaces";
  },

  async init() {
    if (this._initted || !this.configured()) { this.paint(); return; }
    this._initted = true;
    this.checking = true;
    try {
      await this._load();
      const { data: { session } } = await this.client.auth.getSession(); // remembered on this device?
      this.checking = false;
      if (session) { this.authed = true; await this._afterAuth(); }
      else { this.authed = false; App.render(); }                       // → shop login gate
    } catch (e) {
      console.warn("[Sync] init:", e && e.message || e);
      this.checking = false; this.status = "error"; App.render();
    }
  },

  /* shop login (shared password → Supabase auth session) */
  async login(password) {
    await this._load();
    const { error } = await this.client.auth.signInWithPassword({ email: SYNC_CONFIG.shopEmail, password });
    if (error) return false;
    this.authed = true;
    await this._afterAuth();
    return true;
  },
  async logout() { try { await this.client && this.client.auth.signOut(); } catch (e) {} location.reload(); },

  async _afterAuth() {
    const { data, error } = await this.client.from(this.table).select("data").eq("id", this.wsId).maybeSingle();
    if (!error && data && data.data) this._applyRemote(data.data);
    else await this.push(true);                       // empty cloud → seed from this device
    Store._onSave = () => { if (!this._applying) this.schedulePush(); };
    this.channel = this.client.channel("ws-" + this.wsId)
      .on("postgres_changes",
          { event: "*", schema: "public", table: this.table, filter: "id=eq." + this.wsId },
          (p) => { const d = p.new && p.new.data; if (d) this._applyRemote(d); })
      .subscribe((st) => { this.status = st === "SUBSCRIBED" ? "live" : "connecting"; this.paint(); });
    this.status = "live"; App.render(); this.paint();
  },

  /* replace local state with a cloud version, without echoing it back up.
     Realtime hands us back our OWN writes too, so a payload we already hold
     must be dropped: re-applying it used to fire a second full re-render
     ~1s after every button press — the screen flicker on the shopfloor. */
  _applyRemote(state) {
    let json; try { json = JSON.stringify(state); } catch (e) { json = null; }
    if (json && (json === this._lastSync || json === JSON.stringify(Store.state))) { this.paint(); return; }
    this._lastSync = json;
    const ae = document.activeElement;
    const typing = ae && (ae.isContentEditable || /^(INPUT|TEXTAREA)$/.test(ae.tagName || ""));
    this._applying = true;
    try { Store.state = state; Store.save(); } finally { this._applying = false; }
    if (typeof Notif !== "undefined") Notif.flushLive();
    if (!typing && typeof App !== "undefined" && App.render) App.render();
    this.paint();
  },

  schedulePush() { clearTimeout(this._debounce); this._debounce = setTimeout(() => this.push(), 500); },
  async push(initial) {
    if (!this.authed || !this.client) return;
    try {
      const row = { id: this.wsId, data: Store.state,
                    updated_by: (typeof App !== "undefined" && App.me && App.me.name) || null };
      this._lastSync = JSON.stringify(Store.state);   // recognise our own echo
      const { error } = await this.client.from(this.table).upsert(row);
      if (error) throw error;
      if (this.status !== "live") { this.status = "live"; this.paint(); }
    } catch (e) { console.warn("[Sync] push:", e && e.message || e); this.status = "error"; this.paint(); }
  },
  async pull() {
    if (!this.authed || !this.client) return;
    const { data } = await this.client.from(this.table).select("data").eq("id", this.wsId).maybeSingle();
    if (data && data.data) this._applyRemote(data.data);
  },

  /* ---- shop login gate (before the PIN picker when cloud is on) ---- */
  needsGate() { return this.configured() && !this.authed; },
  gateHtml() {
    const s = Store.state;
    return `<div class="login-screen"><div class="pin-stage" style="gap:4px">
      <div class="login-logo"><div class="mark" style="color:var(--accent)">${icon("logo", 52, "", 1.6)}</div>
        <h1>${esc(s.shopName || "ShopFlow")}</h1>
        <p>${this.checking ? "Connecting…" : "Sign in to your workspace"}</p></div>
      ${this.checking ? `<div class="sync-spinner"></div>` : `
        <div class="field" style="width:280px"><input class="input" id="shop-pass" type="password" placeholder="Shop password" autocomplete="current-password"></div>
        <button class="btn primary xl" id="shop-login-btn" style="width:280px;margin-top:12px">Sign in</button>
        <div class="t-caption" id="shop-login-err" style="color:var(--red);min-height:16px;margin-top:8px"></div>`}
    </div></div>`;
  },
  bindGate(root) {
    if (this.checking) return;
    const inp = $("#shop-pass", root), btn = $("#shop-login-btn", root), err = $("#shop-login-err", root);
    const go = async () => {
      if (!inp.value) return;
      btn.disabled = true; err.textContent = "";
      const ok = await this.login(inp.value).catch(() => false);
      if (!ok) { btn.disabled = false; err.textContent = "Wrong password — try again"; inp.value = ""; inp.focus(); }
    };
    btn.onclick = go;
    inp.onkeydown = (e) => { if (e.key === "Enter") go(); };
    setTimeout(() => inp && inp.focus(), 60);
  },

  paint() { const el = document.getElementById("sync-status"); if (el) el.outerHTML = this.badge(); },
  badge() {
    const map = { off: "Local only (not connected)", connecting: "Connecting…",
                  live: "Synced live", error: "Sync error — see console" };
    return `<span id="sync-status" class="sync-badge ${this.status}">${map[this.status] || map.off}</span>`;
  },
};
