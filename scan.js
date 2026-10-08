/* ============================================================
   ShopFlow — Scan Station (QR / barcode)
   A kiosk you run on a device at each station. A hardware
   scanner (HID keyboard-wedge) types the label code + Enter,
   or the device camera reads the QR. Each scan advances the
   part through this station and updates progress live.
   ============================================================ */
"use strict";

const ScanStation = {
  stationId: null,
  camera: false,
  _last: { payload: "", ts: 0 },
  _ac: null, _stream: null, _raf: null, _det: null,

  isActive() { return App.me && App.view === "scan"; },

  view() {
    if (this.stationId && !D.station(this.stationId)) this.stationId = null;
    return this.stationId ? this.kiosk() : this.picker();
  },

  /* ---------- station picker ---------- */
  picker() {
    const stns = D.stationsOf("prod");
    return `<div class="scan-picker view-anim">
      <div class="scan-picker-head">
        <div class="scan-logo">${icon("scan", 26)}</div>
        <div><h1 style="font-size:22px">Scan station</h1>
        <p class="muted" style="font-size:13.5px">Pick the station this device sits at. A USB/Bluetooth scanner or the camera then advances every part you scan.</p></div>
      </div>
      <div class="scan-grid">
        ${stns.map(st => {
          const s = D.stationScanStats(st.id);
          const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
          return `<button class="scan-station-card" data-scan-station="${st.id}">
            <div class="ico">${stIcon(st, 26)}</div>
            <b>${esc(st.name)}</b>
            <div class="progress ${pct === 100 ? "done" : ""}" style="width:100%"><i style="width:${pct}%"></i></div>
            <span class="t-caption t-num">${s.done}/${s.total} pcs today</span>
          </button>`;
        }).join("")}
      </div>
    </div>`;
  },

  /* ---------- kiosk ---------- */
  kiosk() {
    const st = D.station(this.stationId);
    const s = D.stationScanStats(st.id);
    const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
    const hasCam = typeof window !== "undefined" && "BarcodeDetector" in window;
    return `<div class="scan-shell view-anim">
      <div class="scan-top">
        <button class="icon-btn" id="scan-back" title="Change station">${icon("chev-left", 16)}</button>
        <div class="scan-st-ico">${stIcon(st, 22)}</div>
        <div class="grow"><b style="font-size:18px;font-weight:700">${esc(st.name)}</b>
        <span class="t-caption">Scan station · ready for labels</span></div>
        <button class="btn ghost" id="scan-cam-btn" title="${hasCam ? "Use device camera" : "No built-in camera scanner — use a USB/Bluetooth scanner"}">${icon("camera", 15)} Camera</button>
        <div class="scan-progress-badge"><b class="t-num">${s.done}/${s.total}</b><span>pcs · ${pct}%</span></div>
      </div>
      <div class="scan-body">
        <div class="scan-main">
          <video id="scan-video" class="hide" playsinline muted></video>
          <div class="scan-status idle" id="scan-status">
            <div class="scan-status-ico">${icon("qr", 54, "", 1.4)}</div>
            <div class="scan-status-title">Ready to scan</div>
            <div class="scan-status-sub">Point the scanner at a part label’s QR code</div>
          </div>
          <input id="scan-capture" class="scan-capture" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="…or type / paste a part code and press Enter">
        </div>
        <div class="scan-side">
          <div class="scan-side-head">${icon("history", 14)} Recent scans</div>
          <div class="scan-recent" id="scan-recent">${this.recentHtml()}</div>
        </div>
      </div>
    </div>`;
  },

  recentHtml() {
    const rows = (Store.state.scanLog || []).filter(r => r.stationId === this.stationId).slice(0, 40);
    if (!rows.length) return `<div class="t-caption" style="padding:14px">No scans yet at this station.</div>`;
    const meta = {
      ok: ["ok", "check"], opDone: ["ok", "check-circle"], dup: ["warn", "history"],
      waiting: ["warn", "clock"], notrouted: ["warn", "alert"], stationDone: ["info", "check-circle"],
      notfound: ["err", "ban"], nostation: ["err", "alert"],
    };
    return rows.map(r => {
      const [cls, ic] = meta[r.status] || ["info", "info"];
      const o = r.orderId ? D.order(r.orderId) : null;
      const m = D.member(r.by);
      return `<div class="scan-rec ${cls}">
        <span class="scan-rec-ic">${icon(ic, 13)}</span>
        <span class="grow"><b>${esc(r.partCode || r.payload)}</b><span>${o ? esc(o.num) : "unknown"} · ${m ? esc(m.name) : ""} · ${fmtAgo(r.ts)}</span></span>
      </div>`;
    }).join("");
  },

  /* ---------- bind ---------- */
  bind(root) {
    if (!this.stationId) {
      $$("[data-scan-station]", root).forEach(b => b.onclick = () => { this.stationId = b.dataset.scanStation; App.render(); });
      return;
    }
    $("#scan-back", root).onclick = () => { this.stopCamera(); this.stationId = null; App.render(); };
    const cap = $("#scan-capture", root);
    const focus = () => { if (!this.camera && cap && document.activeElement !== cap) cap.focus(); };
    focus();
    // keyboard-wedge scanners end with Enter
    cap.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); const v = cap.value; cap.value = ""; if (v.trim()) this.onScan(v.trim()); }
    };
    // keep the field focused for the scanner (unless camera or a dialog is open)
    root.onclick = (e) => { if (!e.target.closest("button,input,video,.wb-el")) focus(); };
    cap.onblur = () => setTimeout(() => { if (this.isActive() && !this.camera && !$(".modal-scrim")) focus(); }, 60);
    $("#scan-cam-btn", root).onclick = () => this.camera ? this.stopCamera() : this.startCamera();
  },

  /* ---------- scan handling ---------- */
  onScan(payload) {
    const now = Date.now();
    if (payload === this._last.payload && now - this._last.ts < 700) return; // scanners double-fire
    this._last = { payload, ts: now };
    const res = M.scanPart(payload, this.stationId, App.me.id);
    this.render(res);
    this.beep(res.status === "opDone" ? "done" : res.status === "ok" ? "ok"
      : ["notfound", "nostation"].includes(res.status) ? "err" : "warn");
  },

  render(res) {
    const el = $("#scan-status"); if (!el) return;
    const cls = { ok: "ok", opDone: "ok", dup: "warn", waiting: "warn", notrouted: "warn", stationDone: "info", notfound: "err", nostation: "err" }[res.status] || "info";
    const o = res.order, item = res.item, op = res.op;
    let ico = "check", title = "", sub = "";
    if (res.status === "ok") { ico = "check-circle"; title = `${res.qtyDone} / ${item.qty}`; sub = `${o.num} · ${esc(res.parsed.partCode || "")}`; }
    else if (res.status === "opDone") { ico = "check-circle"; title = "Station complete"; sub = `${o.num} — all ${item.qty} pcs through ${res.station.name}`; }
    else if (res.status === "dup") { ico = "history"; title = "Already scanned"; sub = `${esc(res.parsed.partCode)} counted here already`; }
    else if (res.status === "waiting") { ico = "clock"; title = "Waiting for upstream"; sub = `${o.num} — earlier step hasn’t produced this part yet`; }
    else if (res.status === "notrouted") { ico = "alert"; title = "Not routed here"; sub = `${o.num} doesn’t pass ${res.station.name}`; }
    else if (res.status === "stationDone") { ico = "check-circle"; title = "Already complete"; sub = `${o.num} is done at ${res.station.name}`; }
    else if (res.status === "unknownPart") { ico = "ban"; title = "Not on the part list"; sub = `${res.order.num} has no part “${esc(res.parsed.partCode)}” — wrong or outdated label`; }
    else if (res.status === "notfound") { ico = "ban"; title = "Unknown code"; sub = `No project matches “${esc(res.parsed?.partCode || res.parsed?.project || "")}”`; }
    else { ico = "alert"; title = "No station"; sub = "Pick a station first"; }
    el.className = `scan-status ${cls} flash`;
    el.innerHTML = `<div class="scan-status-ico">${icon(ico, 54, "", 1.5)}</div>
      <div class="scan-status-title">${title}</div>
      <div class="scan-status-sub">${sub}</div>
      ${item && ["ok", "opDone"].includes(res.status) ? `<div class="scan-status-bar"><div class="progress ${res.qtyDone >= item.qty ? "done" : ""}" style="width:220px"><i style="width:${Math.round((res.qtyDone || item.qty) / item.qty * 100)}%"></i></div></div>` : ""}`;
    setTimeout(() => { if ($("#scan-status") === el) el.classList.remove("flash"); }, 500);
    const rec = $("#scan-recent"); if (rec) rec.innerHTML = this.recentHtml();
    const badge = $(".scan-progress-badge"); if (badge) {
      const s = D.stationScanStats(this.stationId);
      badge.innerHTML = `<b class="t-num">${s.done}/${s.total}</b><span>pcs · ${s.total ? Math.round(s.done / s.total * 100) : 0}%</span>`;
    }
  },

  /* ---------- feedback beep ---------- */
  beep(kind) {
    try {
      this._ac = this._ac || new (window.AudioContext || window.webkitAudioContext)();
      const ac = this._ac, t = ac.currentTime;
      const tone = (f, s, d, g = 0.14) => {
        const o = ac.createOscillator(), ga = ac.createGain();
        o.type = "sine"; o.frequency.value = f; o.connect(ga); ga.connect(ac.destination);
        ga.gain.setValueAtTime(g, t + s); ga.gain.exponentialRampToValueAtTime(0.001, t + s + d);
        o.start(t + s); o.stop(t + s + d);
      };
      if (kind === "ok") { tone(880, 0, 0.09); tone(1320, 0.08, 0.11); }
      else if (kind === "done") { tone(880, 0, 0.08); tone(1174, 0.09, 0.08); tone(1568, 0.18, 0.16); }
      else if (kind === "warn") { tone(440, 0, 0.18, 0.11); }
      else { tone(180, 0, 0.3, 0.16); }
    } catch (e) { /* audio may be blocked until a user gesture */ }
  },

  /* ---------- camera (BarcodeDetector) ---------- */
  async startCamera() {
    if (!("BarcodeDetector" in window)) {
      Toast.show("This browser has no built-in QR reader — use a USB/Bluetooth scanner", { emoji: "camera", ms: 4800 });
      return;
    }
    try {
      this._det = this._det || new window.BarcodeDetector({ formats: ["qr_code", "data_matrix", "code_128", "code_39", "ean_13"] });
      this._stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const v = $("#scan-video"); v.srcObject = this._stream; await v.play(); v.classList.remove("hide");
      this.camera = true; $("#scan-cam-btn")?.classList.add("active");
      const loop = async () => {
        if (!this.camera) return;
        try { const codes = await this._det.detect(v); if (codes && codes[0]) this.onScan(codes[0].rawValue); } catch (e) {}
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    } catch (e) { Toast.show("Camera unavailable — check permissions", { emoji: "alert" }); }
  },
  stopCamera() {
    this.camera = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._stream) this._stream.getTracks().forEach(t => t.stop());
    this._stream = null;
    $("#scan-video")?.classList.add("hide");
    $("#scan-cam-btn")?.classList.remove("active");
    const cap = $("#scan-capture"); if (cap) cap.focus();
  },
};
