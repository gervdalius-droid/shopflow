/* ============================================================
   ShopFlow — App core
   Session, PIN login, shell, router, toasts, modals, palette.
   ============================================================ */
"use strict";

/* ---------- Tiny DOM + format utils ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function isLT() { return typeof I18N !== "undefined" && I18N.lang === "lt"; }
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(isLT() ? "lt-LT" : "en-US", { month: "short", day: "numeric" });
}
function fmtDue(ts) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / DAY);
  const lt = isLT();
  if (diff < -1) return { cls: "overdue", label: lt ? `Vėluoja ${-diff} d.` : `${-diff}d overdue` };
  if (diff === -1) return { cls: "overdue", label: lt ? "Vėluoja 1 d." : "1d overdue" };
  if (diff === 0) return { cls: "today", label: lt ? "Šiandien" : "Due today" };
  if (diff === 1) return { cls: "soon", label: lt ? "Rytoj" : "Due tomorrow" };
  if (diff <= 4) return { cls: "soon", label: lt ? `Po ${diff} d.` : `Due in ${diff}d` };
  return { cls: "", label: (lt ? "Iki " : "Due ") + fmtDate(ts) };
}
function fmtDur(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (hh ? hh + ":" : "") + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
}
function fmtAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  const lt = isLT();
  if (s < 60) return lt ? "ką tik" : "just now";
  if (s < 3600) return lt ? `prieš ${Math.floor(s / 60)} min.` : Math.floor(s / 60) + "m ago";
  if (s < 86400) return lt ? `prieš ${Math.floor(s / 3600)} val.` : Math.floor(s / 3600) + "h ago";
  return lt ? `prieš ${Math.floor(s / 86400)} d.` : Math.floor(s / 86400) + "d ago";
}
function initials(name) {
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
}
function avatarHtml(member, size = "md") {
  if (!member) return `<span class="avatar ${size}" style="--av-c1:#aeaeb2;--av-c2:#8e8e93">?</span>`;
  const [c1, c2] = AV_COLORS[member.color % AV_COLORS.length];
  return `<span class="avatar ${size}" style="--av-c1:${c1};--av-c2:${c2}" title="${esc(member.name)}">${esc(initials(member.name))}</span>`;
}
function pillHtml(status, label) {
  return `<span class="pill ${status}"><span class="dot"></span>${esc(label || D.statusLabel[status] || status)}</span>`;
}
function prioHtml(p) {
  const labels = { rush: "Rush", high: "High", normal: "Normal", low: "Low" };
  if (p === "normal") return "";
  return `<span class="prio ${p}">${prioIcon(p)} ${labels[p]}</span>`;
}
function stepsMini(order) {
  const shown = order.ops.slice(0, 14);
  return `<span class="steps-mini">${shown.map(op =>
    `<i class="${op.status}" title="${esc(D.station(op.stationId)?.name || "")}"></i>`).join("")}${order.ops.length > 14 ? `<span class="t-caption" style="font-size:10px">+${order.ops.length - 14}</span>` : ""}</span>`;
}
function activityHtml(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

/* ============================================================
   App
   ============================================================ */
const App = {
  me: null,          // logged-in member
  view: "dashboard", // current manager view
  viewParams: {},
  workerTab: "my",   // worker mode tab
  _tick: null,

  /* role helpers — managers + engineers use the cockpit; only they see engineering */
  isManager() { return this.me && this.me.role === "manager"; },
  isEngineer() { return this.me && this.me.role === "engineer"; },
  isWorker() { return this.me && this.me.role === "worker"; },
  seesEng() { return this.me && (this.me.role === "manager" || this.me.role === "engineer"); },

  /* Can I do this? Everyone shares one cockpit; roles differ in what they
     may CHANGE, and a manager decides that in Settings → Permissions. */
  can(cap) { return !!this.me && D.roleCan(this.me.role, cap); },

  /* ---- which shell ----
     Everybody gets the cockpit now. "Bench mode" is the big-button tablet
     screen, kept for the shopfloor: a per-device choice (a shared tablet
     should stay in bench mode whoever signs in), never a role. */
  /* stamped into index.html by tools/deploy-pages.sh; "dev" when served raw */
  build() {
    const m = document.querySelector('meta[name="shopflow-build"]');
    return (m && m.content) || "dev";
  },

  BENCH_KEY: "shopflow.bench",
  benchMode() { return localStorage.getItem(this.BENCH_KEY) === "1"; },
  setBenchMode(on) {
    on ? localStorage.setItem(this.BENCH_KEY, "1") : localStorage.removeItem(this.BENCH_KEY);
    if (!on && !this.usesCockpit()) this.view = "mywork";
    if (on) this.workerTab = "my";
    this._html = null;                       // shell changes wholesale
    Router.replace(); this.render();
  },
  usesCockpit() { return !!this.me && !this.benchMode(); },

  async boot() {
    if (typeof I18N !== "undefined") I18N.boot();   // localization: watch renders, translate UI chrome
    await Store.boot();                             // the vault, falling back to localStorage
    // theme
    const savedTheme = localStorage.getItem("shopflow.theme") || "auto";
    this.applyTheme(savedTheme);

    // Auto-login (dev/demo only): ?as=… bypasses the PIN, so honour it only on
    // localhost / file:// — never when the app is actually hosted for the shop.
    const p = new URLSearchParams(location.search);
    if (p.get("theme")) this.applyTheme(p.get("theme"));
    const devHost = ["localhost", "127.0.0.1", "", "[::1]"].includes(location.hostname) || location.protocol === "file:";
    const as = devHost ? p.get("as") : null;
    if (as) {
      this._localOnly = true;                 // local dev (?as= on localhost): run fully offline, never touch the shop's cloud
      const m = Store.state.members.find(x =>
        x.name.toLowerCase() === as.toLowerCase() ||
        (as === "manager" && x.role === "manager") ||
        (as === "engineer" && x.role === "engineer") ||
        (as === "worker" && x.role === "worker"));
      if (m) this.me = m;
      if (p.get("view")) this.view = p.get("view");
      if (p.get("tab")) { this.workerTab = p.get("tab"); this.viewParams.tab = p.get("tab"); }
      if (p.get("scope")) this.viewParams.scope = p.get("scope");
    } else {
      const sid = sessionStorage.getItem("shopflow.session");
      if (sid) this.me = D.member(sid);
    }
    // Scan-station kiosk deep link: ?scan=<stationId> (works for any signed-in user)
    if (this.me && p.get("scan") && typeof ScanStation !== "undefined") {
      this.view = "scan";
      const stn = D.station(p.get("scan"));
      ScanStation.stationId = stn ? stn.id : null;
    }

    this._notifSeenTs = Date.now(); // baseline: existing notifications show as badge, not toast
    // if cloud sync is configured, show the connecting gate immediately (no PIN-picker flash)
    if (typeof Sync !== "undefined" && Sync.configured() && !this._localOnly) Sync.checking = true;
    this.render();
    if (this.me && p.get("order")) {
      const o = Store.state.orders.find(x => x.id === p.get("order") || x.num === p.get("order"));
      if (o) Drawer.open(o.id);
    }
    M.sweepClocks();                                  // settle runs that went quiet while away
    this._tick = setInterval(() => this.tickTimers(), 1000);
    this._sweep = setInterval(() => { if (M.sweepClocks()) this.render(); }, 60000);
    this._bindPointerGuard();
    Router.boot();
    Offline.boot();                                   // cache the shell; keep working without a network
    if (typeof Bridge !== "undefined") Bridge.boot();  // shared customers + document index (optional)
    if (typeof Files !== "undefined") Files.boot();    // retry any attachment that never uploaded

    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); this.me && Palette.toggle(); }
      if (e.key === "Escape") { Palette.close(); Modal.close(); Drawer.close(); Popover.close(); }
    });

    /* Nothing in flight may be lost because a tab was closed or a tablet was
       pocketed. Both events fire; flush() is a no-op when nothing is dirty. */
    const settle = () => { Store.flush(); };
    window.addEventListener("pagehide", settle);
    document.addEventListener("visibilitychange", () => { if (document.hidden) settle(); });

    /* Live sync between open tabs/windows: another tab saved → adopt its state.
       The vault raises no storage event, so tabs tell each other directly; the
       storage listener stays for the localStorage fallback path. */
    const adopt = (next) => {
      const typing = (typeof WB !== "undefined" && WB.editingId) ||
        document.activeElement?.isContentEditable ||
        /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
      Store.state = next;
      if (typeof Notif !== "undefined") Notif.flushLive(); // toast/desktop-alert new arrivals
      if (!typing) this.render();
    };
    window.addEventListener("storage", (ev) => {
      if (ev.key !== DB_KEY || !ev.newValue) return;
      try { adopt(JSON.parse(ev.newValue)); } catch (_) {}
    });
    if (typeof BroadcastChannel !== "undefined") {
      const chan = new BroadcastChannel("shopflow");
      chan.onmessage = async (ev) => {
        if (!ev.data || ev.data.t !== "doc" || Store._dirty || Store._flushing) return;
        try { const raw = await Vault.get("doc"); if (raw) adopt(JSON.parse(raw)); } catch (_) {}
      };
    }

    // Cloud sync — no-op unless sync-config.js provides SYNC_CONFIG
    if (typeof Sync !== "undefined" && !this._localOnly) Sync.init();
  },

  applyTheme(mode) {
    localStorage.setItem("shopflow.theme", mode);
    const dark = mode === "dark" || (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  },

  login(member) {
    this.me = member;
    this._notifSeenTs = Date.now(); // only genuinely new notifications toast; existing show as a badge
    sessionStorage.setItem("shopflow.session", member.id);
    // workers land on their own work; everyone else on the dashboard. ("my" is
    // the bench tab id — the cockpit page is "mywork".)
    this.view = member.role === "worker" ? (this.benchMode() ? "my" : "mywork") : "dashboard";
    // shared-tablet hygiene: don't inherit the previous worker's tab/station
    this.workerTab = "my";
    if (typeof Wkr !== "undefined") Wkr.station = null;
    this.render();
    Router.replace();
  },

  logout() {
    this.me = null;
    sessionStorage.removeItem("shopflow.session");
    Drawer.close(true); Modal.close(true); Palette.close();
    this.render();
  },

  navigate(view, params = {}) {
    this.view = view; this.viewParams = params;
    Router.push();
    this.render();
  },

  /* ---- render plumbing: never yank the DOM out from under a finger ----
     A full re-render replaces #app wholesale, so any button the user is
     pressing is destroyed mid-tap and the click never fires — that is the
     "press Complete twice" bug. Renders that arrive while a pointer is down
     (cloud echo, another tab, another device) are queued and flushed after
     the click has been dispatched. */
  _pointerDown: false, _pointerAt: 0, _renderQueued: false, _html: null,
  moreOpen: false,          // phone: the "More" navigation sheet

  _bindPointerGuard() {
    const down = () => { this._pointerDown = true; this._pointerAt = Date.now(); };
    // release AFTER the click has been dispatched, otherwise the flush
    // destroys the button between pointerup and click — the same bug again
    const up = () => {
      this._pointerDown = false;
      setTimeout(() => { if (!this._pointerDown && this._renderQueued) this.render(); }, 0);
    };
    document.addEventListener("pointerdown", down, true);
    ["pointerup", "pointercancel", "dragend", "drop"].forEach(ev => document.addEventListener(ev, up, true));
    window.addEventListener("blur", up);
  },

  /* scroll containers survive the innerHTML swap — a queue that jumps back
     to the top on every tap reads as flicker and loses the worker's place */
  _SCROLLERS: ".content,.worker-body,.board-wrap,.board-col-cards,.projects-body,.tl-scroll,.scan-recent",
  _snapScroll(root) {
    const m = new Map();
    $$(this._SCROLLERS, root).forEach((el, i) => {
      if (el.scrollTop || el.scrollLeft) m.set(i + "|" + el.className, [el.scrollTop, el.scrollLeft]);
    });
    return m;
  },
  _restoreScroll(root, m) {
    if (!m.size) return;
    $$(this._SCROLLERS, root).forEach((el, i) => {
      const v = m.get(i + "|" + el.className); if (!v) return;
      const prev = el.style.scrollBehavior;
      el.style.scrollBehavior = "auto";        // .content animates otherwise
      el.scrollTop = v[0]; el.scrollLeft = v[1];
      el.style.scrollBehavior = prev;
    });
  },

  /* Re-render everything (state changed) */
  render() {
    // mid-tap: hold the rebuild until the finger lifts (2s ceiling so a
    // swallowed pointerup can never freeze the UI)
    if (this._pointerDown && Date.now() - this._pointerAt < 2000) { this._renderQueued = true; return; }
    this._pointerDown = false; this._renderQueued = false;

    // a cloud/cross-tab sync swaps Store.state wholesale, which leaves me
    // pointing at the previous state's member object — re-resolve it
    if (this.me) { const m = D.member(this.me.id); if (m) this.me = m; }

    const root = $("#app");
    // cloud shop-login gate: when sync is on but this device isn't signed in yet
    if (typeof Sync !== "undefined" && !App._localOnly && Sync.needsGate()) {
      this._html = null; root.innerHTML = Sync.gateHtml(); Sync.bindGate(root); return;
    }
    let html, view;
    if (!this.me) { html = Login.html(); view = Login; }
    else if (this.usesCockpit()) { html = Mgr.shell(); view = Mgr; }
    else { html = Wkr.shell(); view = Wkr; }

    // identical output → leave the live DOM (and its handlers, scroll and
    // ticking timers) exactly where it is. Kills every redundant repaint.
    if (html !== this._html || !root.firstElementChild) {
      const scroll = this._snapScroll(root);
      root.innerHTML = html; this._html = html;
      view.bind(root);
      this._restoreScroll(root, scroll);
    }
    if (typeof GPM !== "undefined" && this.view !== "planner" && GPM.taskId) GPM.closeTask();
    if (typeof Router !== "undefined") Router.sync();
    Drawer.refresh();
  },

  /* Completing is one tap now. Swallow the reflex second tap people learned
     to give, so it can't land on the next task's button after the re-render. */
  _lastDone: 0,
  tapGuard(ms = 450) {
    const now = Date.now();
    if (now - this._lastDone < ms) return false;
    this._lastDone = now; return true;
  },

  /* Light-touch: update visible timers without re-rendering */
  tickTimers() {
    // refresh the login lock countdown (and re-enable the pad when it expires)
    if (!this.me && Login.selected && (Login.lockUntil[Login.selected.id] || 0) > Date.now() - 1500) {
      if ($(".pin-stage")) { this.render(); return; }
    }
    $$("[data-timer]").forEach(el => {
      const [orderId, opId] = el.dataset.timer.split("/");
      const o = D.order(orderId); if (!o) return;
      const op = o.ops.find(x => x.id === opId); if (!op) return;
      const style = el.dataset.timerStyle || "clock";
      el.textContent = style === "clock" ? fmtClock(D.opElapsed(op)) : fmtDur(D.opElapsed(op));
    });
  },
};


/* ============================================================
   Router — the browser Back button belongs to the app
   A shopfloor tablet's Back gesture should step back through the
   app (close the drawer, return to the previous view), not walk
   off the site. Views live in the hash so a refresh keeps your
   place, which also means no server-side routes to configure.
   ============================================================ */
const Router = {
  _applying: false,

  snapshot() {
    return {
      view: App.view,
      params: App.viewParams || {},
      tab: App.workerTab,
      station: typeof Wkr !== "undefined" ? Wkr.station : null,
      gp: typeof GPM !== "undefined" ? GPM.openId : null,
      gtab: typeof GPM !== "undefined" ? GPM.tab : null,
      ptab: typeof Mgr !== "undefined" ? Mgr.projectsTab : null,
    };
  },

  hash() {
    const st = this.snapshot();
    const parts = [App.usesCockpit() ? st.view : "w-" + (st.tab || "my")];
    if (st.view === "planner" && st.gp) parts.push(st.gp);
    if (st.view === "projects" && st.ptab) parts.push(st.ptab);
    return "#" + parts.join("/");
  },

  /* Browsers throttle history writes (Chrome ~100/10s); a burst of navigation
     must never take the app down with it. */
  _safe(fn) { try { fn(); } catch (e) { /* rate-limited — the view still renders */ } },

  /* Replace, don't grow: same destination shouldn't stack duplicates */
  push() {
    if (this._applying || !App.me) return;
    const h = this.hash();
    this._safe(() => location.hash === h
      ? history.replaceState(this.snapshot(), "", h)
      : history.pushState(this.snapshot(), "", h));
  },
  replace() {
    if (this._applying || !App.me) return;
    this._safe(() => history.replaceState(this.snapshot(), "", this.hash()));
  },
  /* Keep the URL honest after any state change, without growing history.
     Guarded on an actual change — browsers rate-limit replaceState. */
  sync() {
    if (this._applying || !App.me) return;
    if (location.hash !== this.hash()) this.replace();
  },

  /* Any transient layer the Back gesture should dismiss first */
  topOverlay() {
    if ($("#pop-root")) return () => Popover.close();
    if (Palette.isOpen) return () => Palette.close();
    if ($(".modal-scrim", $("#modal-root"))) return () => Modal.close();
    if (App.moreOpen) return () => { App.moreOpen = false; App.render(); };
    if (typeof GPM !== "undefined" && GPM.taskId) return () => { GPM.closeTask(); App.render(); };
    if (Drawer.orderId) return () => Drawer.close();
    return null;
  },

  apply(state) {
    if (!state) return;
    this._applying = true;
    try {
      App.view = state.view || App.view;
      App.viewParams = state.params || {};
      if (state.tab) App.workerTab = state.tab;
      if (typeof Wkr !== "undefined" && state.station !== undefined) Wkr.station = state.station;
      if (typeof GPM !== "undefined") { if (state.gp !== undefined) GPM.openId = state.gp; if (state.gtab) GPM.tab = state.gtab; }
      if (typeof Mgr !== "undefined" && state.ptab) Mgr.projectsTab = state.ptab;
      App.render();
    } finally { this._applying = false; }
  },

  /* Read a view out of the URL on a cold load / refresh */
  fromHash() {
    const h = decodeURIComponent(location.hash || "").replace(/^#/, "");
    if (!h) return null;
    const [head, ...rest] = h.split("/");
    if (head.startsWith("w-")) return { tab: head.slice(2) };
    const st = { view: head, params: {} };
    if (head === "planner" && rest[0]) st.gp = rest[0];
    if (head === "projects" && rest[0]) st.ptab = rest[0];
    return st;
  },

  boot() {
    const fromUrl = this.fromHash();
    if (fromUrl && App.me) {
      // a refresh should land where you were, not on the dashboard
      if (fromUrl.view && App.usesCockpit()) { App.view = fromUrl.view; if (fromUrl.ptab) Mgr.projectsTab = fromUrl.ptab; if (fromUrl.gp) GPM.openId = fromUrl.gp; }
      if (fromUrl.tab && !App.usesCockpit()) App.workerTab = fromUrl.tab;
      App.render();
    }
    this.replace();                                  // own the first entry

    window.addEventListener("popstate", (ev) => {
      // Back closes what's on top first — drawer, modal, popover — and puts
      // the entry back so the user's history depth is unchanged
      const close = this.topOverlay();
      if (close) { close(); this._safe(() => history.pushState(this.snapshot(), "", this.hash())); return; }
      if (ev.state) this.apply(ev.state);
      else this.apply(this.fromHash() || this.snapshot());
    });
  },
};

/* ============================================================
   Mentions — type "@" in a comment box to address a teammate
   Names are resolved to member ids when the comment is posted
   (D.parseMentions), so the stored text stays readable and a
   rename can't orphan a thread. This is only the typing aid.
   ============================================================ */
const Mentions = {
  /* Wire an <input>/<textarea>. onSubmit runs on Enter (unless picking). */
  attach(input, onSubmit) {
    if (!input || input._mentions) return;
    input._mentions = true;
    let menu = null, items = [], sel = 0, from = -1;

    const close = () => { if (menu) menu.remove(); menu = null; items = []; from = -1; };

    /* the "@word" being typed immediately before the caret, if any */
    const token = () => {
      const pos = input.selectionStart ?? input.value.length;
      const before = input.value.slice(0, pos);
      const m = before.match(/(^|\s)@([\p{L}\p{N}._-]*)$/u);
      return m ? { start: pos - m[2].length - 1, query: m[2] } : null;
    };

    const paint = () => {
      const t = token();
      if (!t) return close();
      items = D.mentionCandidates(t.query);
      if (!items.length) return close();
      from = t.start;
      if (!menu) {
        menu = document.createElement("div");
        menu.className = "mention-menu";
        document.body.appendChild(menu);
      }
      sel = Math.min(sel, items.length - 1);
      menu.innerHTML = items.map((m, i) => `<button class="${i === sel ? "on" : ""}" data-mi="${i}">
        ${avatarHtml(m, "sm")}<span class="grow"><b>${esc(m.name)}</b><span>${esc(m.role || "")}</span></span></button>`).join("");
      const r = input.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(r.left, innerWidth - 250)) + "px";
      menu.style.width = Math.min(Math.max(r.width, 220), 320) + "px";
      // above the field when there's no room below (worker tablets, keyboard up)
      const h = menu.offsetHeight || 180;
      menu.style.top = (r.bottom + h + 12 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + "px";
      $$("[data-mi]", menu).forEach(b => b.onmousedown = (e) => { e.preventDefault(); pick(+b.dataset.mi); });
    };

    const pick = (i) => {
      const m = items[i]; if (!m || from < 0) return;
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, from) + "@" + m.name + " " + input.value.slice(pos);
      const caret = from + m.name.length + 2;
      close();
      input.focus(); input.setSelectionRange(caret, caret);
    };

    input.addEventListener("input", paint);
    input.addEventListener("blur", () => setTimeout(close, 120));
    input.addEventListener("keydown", (e) => {
      if (menu && items.length) {
        if (e.key === "ArrowDown") { e.preventDefault(); sel = (sel + 1) % items.length; paint(); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; paint(); return; }
        if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopImmediatePropagation(); pick(sel); return; }
        if (e.key === "Escape") { e.preventDefault(); close(); return; }
      }
      if (e.key === "Enter" && onSubmit) { e.preventDefault(); close(); onSubmit(); }
    });
  },
};

/* A timer that has stopped because the shop is shut needs to say so, or it
   reads as broken. Returns nothing during working hours. */
function offShiftHtml(compact) {
  if (typeof D === "undefined" || D.isWorkingNow()) return "";
  const d = new Date();
  const why = !D.isWorkingDay(d) ? I18N.t("Not a working day")
            : (d.getHours() * 60 + d.getMinutes()) < hhmm(D.shift().start) ||
              (d.getHours() * 60 + d.getMinutes()) >= hhmm(D.shift().end) ? I18N.t("Outside working hours")
            : I18N.t("On a break");
  return `<span class="off-shift" title="${I18N.t("Time is only counted during working hours")}">
    ${icon("clock", 12)} ${esc(why)}${compact ? "" : ` · ${I18N.t("not counting")}`}</span>`;
}

/* Comment body: bold markers, then every @teammate we know highlighted. */
function commentHtml(text) {
  let out = activityHtml(text);
  for (const m of mentionOrder()) {
    const name = esc(m.name);
    out = out.replace(mentionRe(name, "giu"), `<span class="mention">@${name}</span>`);
  }
  return out;
}

/* One comment row — shared by the order drawer and Planner tasks. */
function commentRowHtml(c, { canDelete } = {}) {
  const who = D.member(c.by);
  return `<div class="ocomment">${avatarHtml(who, "sm")}
    <div class="grow">
      <div class="oc-head"><b>${esc(who ? who.name : "?")}</b><span class="when">${fmtAgo(c.ts)}</span>
        ${canDelete ? `<button class="icon-btn tiny" data-oc-del="${c.id}" title="Delete comment">${icon("trash", 12)}</button>` : ""}</div>
      <div class="oc-body">${commentHtml(c.text)}</div>
    </div></div>`;
}

/* ============================================================
   Login (profile grid → PIN pad)
   ============================================================ */
const Login = {
  selected: null, entered: "",

  html() {
    const s = Store.state;
    if (!this.selected) {
      return `<div class="login-screen">
        <div class="login-logo">
          <div class="mark" style="color:var(--accent)">${icon("logo", 52, "", 1.6)}</div>
          <h1>${esc(s.shopName)}</h1>
          <p>Who's working?</p>
        </div>
        <div class="profiles">
          ${s.members.map(m => `
            <button class="profile" data-id="${m.id}">
              ${avatarHtml(m, "xl")}
              <span class="name">${esc(m.name)}</span>
              <span class="role">${esc(m.trade)}</span>
            </button>`).join("")}
        </div>
        <div class="login-foot">ShopFlow · ${esc(s.shopName)}</div>
      </div>`;
    }
    const m = this.selected;
    const locked = this.isLocked(m.id);
    const secs = locked ? Math.ceil((this.lockUntil[m.id] - Date.now()) / 1000) : 0;
    const triesLeft = this.MAX_FAILS - (this.fails[m.id] || 0);
    return `<div class="login-screen">
      <div class="pin-stage">
        <div class="pin-user">
          ${avatarHtml(m, "xl")}
          <div class="name">${esc(m.name)}</div>
          <div class="hint">${locked ? `Too many attempts — try again in ${secs}s`
            : (this.fails[m.id] ? `Wrong PIN · ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left` : "Enter your PIN")}</div>
        </div>
        <div class="pin-dots ${locked ? "error" : ""}" id="pin-dots">${[0,1,2,3].map(i => `<i class="${i < this.entered.length ? "filled" : ""}"></i>`).join("")}</div>
        <div class="pin-pad ${locked ? "locked" : ""}">
          ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="pin-key" data-k="${n}" ${locked ? "disabled" : ""}>${n}</button>`).join("")}
          <button class="pin-key soft" data-k="back">Back</button>
          <button class="pin-key" data-k="0" ${locked ? "disabled" : ""}>0</button>
          <button class="pin-key soft" data-k="del" ${locked ? "disabled" : ""}>⌫</button>
        </div>
      </div>
    </div>`;
  },

  fails: {},        // per-member wrong-attempt count
  lockUntil: {},    // per-member lock expiry (ms)
  MAX_FAILS: 5, LOCK_MS: 30000,

  bind(root) {
    $$(".profile", root).forEach(b => b.onclick = () => {
      this.selected = D.member(b.dataset.id); this.entered = "";
      App.render();
    });
    $$(".pin-key", root).forEach(b => b.onclick = () => this.key(b.dataset.k));
    if (this.selected) {
      this._kb = (e) => {
        if (/^[0-9]$/.test(e.key)) this.key(e.key);
        if (e.key === "Backspace") this.key("del");
        if (e.key === "Escape") this.key("back");
      };
      document.addEventListener("keydown", this._kb, { once: false });
    }
  },

  isLocked(id) { return (this.lockUntil[id] || 0) > Date.now(); },

  key(k) {
    if (k === "back") { this.selected = null; this.entered = ""; this._unbindKb(); App.render(); return; }
    if (this.selected && this.isLocked(this.selected.id)) return; // locked out
    if (k === "del") { this.entered = this.entered.slice(0, -1); this._paint(); return; }
    if (this.entered.length >= 4) return;
    this.entered += k;
    this._paint();
    if (this.entered.length === 4) {
      const m = this.selected;
      if (M.verifyPin(m.id, this.entered)) {
        this.fails[m.id] = 0;
        this.selected = null; this.entered = ""; this._unbindKb();
        App.login(m);
      } else {
        this.fails[m.id] = (this.fails[m.id] || 0) + 1;
        const dots = $("#pin-dots");
        if (dots) dots.classList.add("error");
        if (this.fails[m.id] >= this.MAX_FAILS) {
          this.lockUntil[m.id] = Date.now() + this.LOCK_MS;
          setTimeout(() => { this.entered = ""; App.render(); }, 600);
        } else {
          setTimeout(() => { this.entered = ""; if (dots) dots.classList.remove("error"); this._paint(); }, 600);
        }
      }
    }
  },
  _paint() {
    const dots = $("#pin-dots"); if (!dots) return;
    $$("i", dots).forEach((el, i) => el.classList.toggle("filled", i < this.entered.length));
  },
  _unbindKb() { if (this._kb) { document.removeEventListener("keydown", this._kb); this._kb = null; } },
};

/* ============================================================
   Toasts
   ============================================================ */
const Toast = {
  /* legacy emoji → icon so every toast matches the vector icon system */
  ICON_MAP: {
    "✓": "check", "✅": "check-circle", "🎉": "check-circle", "•": "info", "🔢": "info",
    "⚠️": "alert", "🚫": "ban", "🤔": "info", "⏳": "clock", "📉": "trend-down",
    "🚚": "truck", "📦": "box", "🏬": "warehouse", "📤": "arrow-up", "🗑": "trash",
    "📅": "calendar", "🗓": "calendar", "✦": "sparkles", "👋": "users", "🧠": "brain",
    "▶️": "play", "⏸": "pause", "💪": "check", "🗄": "archive", "😴": "zzz",
  },
  show(msg, { emoji = "", undo = null, ms = 3200 } = {}) {
    const root = $("#toast-root");
    const el = document.createElement("div");
    el.className = "toast";
    const ic = this.ICON_MAP[emoji] || (/^[a-z-]+$/.test(emoji) ? emoji : null);
    const lead = ic ? `<span class="emoji">${icon(ic, 15)}</span>` : (emoji ? `<span class="emoji">${emoji}</span>` : "");
    el.innerHTML = `${lead}<span>${esc(msg)}</span>${undo ? `<button>Undo</button>` : ""}`;
    if (undo) $("button", el).onclick = () => { undo(); this._dismiss(el); };
    root.appendChild(el);
    setTimeout(() => this._dismiss(el), ms);
  },
  _dismiss(el) {
    if (!el.isConnected) return;
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 300);
  },
};

/* ============================================================
   Tip — hover/focus tooltip for chart marks

   Native title= is too slow and unstyled for a chart, and an absolutely
   positioned tip would be clipped by the panel it sits in, so this is one
   fixed-position element shared by the whole page. Tooltips only ever
   supplement: every value they show is also on the page or in a table.
   ============================================================ */
/* ============================================================
   Picker — a <select> you can actually search

   The shop's material catalogue runs to hundreds of items, and a native
   dropdown of that length is a wall of text you scroll past. This is a text
   field that filters as you type.

   The chosen value lives in a hidden input carrying the CALLER'S id and
   attributes, and a real `change` event is dispatched on it — so call sites
   that already read `.value` and assign `.onchange` need no rewriting.
   ============================================================ */
const Picker = {
  _cfg: {},
  _seq: 0,
  MAX: 60,                       // render a screenful, not the whole catalogue

  /* options: [{ value, label, sub }] · actions sit above the list */
  html(id, { value = "", options = [], placeholder = "Search…", empty = "", actions = [], attrs = "" } = {}) {
    const key = id || "pk" + (++this._seq);
    this._cfg[key] = { options, empty, actions };
    const cur = options.find(o => String(o.value) === String(value));
    const act = actions.find(a => String(a.value) === String(value));
    return `<div class="picker" data-pk="${esc(key)}">
      <input class="input picker-input" value="${esc(cur ? cur.label : act ? act.label : value ? "" : empty)}"
        placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false">
      <span class="picker-caret">${icon("chev-down", 14)}</span>
      <input type="hidden" id="${esc(key)}" value="${esc(value)}" ${attrs}>
      <div class="picker-menu" hidden></div>
    </div>`;
  },

  norm: (s) => String(s || "").toLowerCase()
    .replace(/[ąĄ]/g, "a").replace(/[čČ]/g, "c").replace(/[ęėĘĖ]/g, "e")
    .replace(/[įĮ]/g, "i").replace(/[šŠ]/g, "s").replace(/[ųūŲŪ]/g, "u").replace(/[žŽ]/g, "z")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, ""),

  bind(root) {
    $$(".picker", root).forEach(el => {
      if (el._pkBound) return;
      el._pkBound = true;
      const cfg = this._cfg[el.dataset.pk];
      if (!cfg) return;
      const input = $(".picker-input", el);
      const hidden = $('input[type="hidden"]', el);
      const menu = $(".picker-menu", el);
      let rows = [], active = -1, typed = false;

      const labelFor = (v) => {
        const o = cfg.options.find(x => String(x.value) === String(v))
          || cfg.actions.find(x => String(x.value) === String(v));
        return o ? o.label : (v ? "" : cfg.empty);
      };

      const render = () => {
        const q = this.norm(typed ? input.value.trim() : "");
        const hits = q
          ? cfg.options.filter(o => this.norm(o.label + " " + (o.sub || "")).includes(q))
          : cfg.options;
        rows = [
          /* "— none —" is noise once you have typed a query; the create action
             is the opposite — it is exactly what you want after a bad search */
          ...(cfg.empty && !q ? [{ value: "", label: cfg.empty, muted: true }] : []),
          ...cfg.actions,
          ...hits.slice(0, this.MAX),
        ];
        const more = hits.length - Math.min(hits.length, this.MAX);
        menu.innerHTML = rows.map((o, i) => `<button type="button" class="picker-row ${i === active ? "on" : ""} ${o.muted ? "muted" : ""}" data-i="${i}">
            <span>${esc(o.label)}</span>${o.sub ? `<small>${esc(o.sub)}</small>` : ""}
          </button>`).join("")
          + (more > 0 ? `<div class="picker-more">…and ${more} more — keep typing</div>` : "")
          /* judged on the HITS, not on rows — the create action is always there,
             and "nothing matches" is still the useful thing to say */
          + (q && !hits.length ? `<div class="picker-more">Nothing matches “${esc(input.value.trim())}”</div>` : "");
        $$(".picker-row", menu).forEach(b => b.onmousedown = (e) => { e.preventDefault(); choose(+b.dataset.i); });
        menu.hidden = false;
        /* What clips this menu is usually the DIALOG, not the window — measuring
           the viewport says there is plenty of room while the modal body cuts
           the list in half. So measure against whatever actually scrolls. */
        const clip = (() => {
          for (let p = el.parentElement; p; p = p.parentElement) {
            const ov = getComputedStyle(p).overflowY;
            if (ov === "auto" || ov === "scroll") return p.getBoundingClientRect();
          }
          return { top: 0, bottom: window.innerHeight };
        })();
        const box = el.getBoundingClientRect();
        const want = Math.min(240, menu.scrollHeight + 10);
        const below = clip.bottom - box.bottom, above = box.top - clip.top;
        menu.classList.toggle("up", below < want && above > below);
        menu.scrollIntoView({ block: "nearest" });      // and bring it into view either way
      };

      const choose = (i) => {
        const o = rows[i];
        if (!o) return;
        hidden.value = o.value;
        input.value = o.value ? o.label : cfg.empty;
        close();
        hidden.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const close = () => { menu.hidden = true; active = -1; typed = false; };

      input.onfocus = () => { typed = false; input.select(); render(); };
      input.oninput = () => { typed = true; active = 0; render(); };
      input.onblur = () => { setTimeout(() => { input.value = labelFor(hidden.value); close(); }, 120); };
      $(".picker-caret", el).onmousedown = (e) => {
        e.preventDefault();
        if (menu.hidden) input.focus(); else close();
      };
      input.onkeydown = (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (menu.hidden) { render(); active = 0; }
          else active = Math.max(0, Math.min(rows.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
          render();
          const on = $(".picker-row.on", menu);
          if (on) on.scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter") {
          if (!menu.hidden) { e.preventDefault(); choose(active < 0 ? 0 : active); }
        } else if (e.key === "Escape") {
          if (!menu.hidden) { e.stopPropagation(); input.value = labelFor(hidden.value); close(); }
        }
      };
    });
  },
};

const Tip = {
  el: null,
  show(target, text) {
    if (!text) return;
    if (!this.el) { this.el = document.createElement("div"); this.el.className = "tip-pop"; document.body.appendChild(this.el); }
    this.el.textContent = text;
    this.el.classList.add("on");
    const r = target.getBoundingClientRect(), t = this.el.getBoundingClientRect();
    const x = Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2));
    const above = r.top > t.height + 12;
    this.el.style.left = x + "px";
    this.el.style.top = (above ? r.top - t.height - 8 : r.bottom + 8) + "px";
  },
  hide() { if (this.el) this.el.classList.remove("on"); },

  /* Keyboard focus shows exactly what hover shows */
  bind(root) {
    $$("[data-tip]", root).forEach(el => {
      if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
      el.onmouseenter = () => this.show(el, el.dataset.tip);
      el.onmouseleave = () => this.hide();
      el.onfocus = () => this.show(el, el.dataset.tip);
      el.onblur = () => this.hide();
    });
  },
};

/* ============================================================
   Offline — the app itself survives a dropped network

   The shop's data was always local; the files were not, so a WiFi blip
   used to mean a blank page. sw.js caches the shell, which also makes
   ShopFlow installable to a tablet's home screen.
   ============================================================ */
const Offline = {
  online: navigator.onLine !== false,
  reg: null,
  _reloading: false,
  UPDATE_EVERY: 30 * 60000,        // a bench tablet stays open for days

  boot() {
    window.addEventListener("online", () => this._net(true));
    window.addEventListener("offline", () => this._net(false));
    if (!("serviceWorker" in navigator)) return;
    // The manifest is what marks this page as the installable app — test.html
    // has none, and must never have a worker caching the files under test.
    if (!document.querySelector('link[rel="manifest"]')) return;
    if (!/^https?:$/.test(location.protocol)) return;      // file:// can't host a worker

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then(reg => {
        this.reg = reg;
        if (reg.waiting && navigator.serviceWorker.controller) this._offerUpdate(reg);
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            // no controller yet = first install, nothing to interrupt
            if (nw.state === "installed" && navigator.serviceWorker.controller) this._offerUpdate(reg);
          });
        });
        setInterval(() => reg.update().catch(() => {}), this.UPDATE_EVERY);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update().catch(() => {});
        });
      }).catch(e => console.warn("[sw] registration failed:", e && e.message));
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (this._reloading) return;                          // one reload, never a loop
      this._reloading = true;
      location.reload();
    });
  },

  _net(up) {
    if (this.online === up) return;
    this.online = up;
    App.render();                                           // the badge lives in the shell
    Toast.show(up ? "Back online" : "Offline — ShopFlow keeps working, changes sync when you reconnect",
      { emoji: up ? "check" : "info", ms: up ? 2200 : 5000 });
  },

  /* Shown in the topbar so a shopfloor screen says what is going on. */
  badgeHtml() {
    return this.online ? "" :
      `<span class="offline-chip" title="No network. Your work is saved on this device and syncs when the connection returns.">${icon("cloud-off", 13)} Offline</span>`;
  },

  /* A new build is cached and ready. Never swap it in mid-task — ask. */
  _offerUpdate(reg) {
    if ($("#sw-update")) return;
    const el = document.createElement("div");
    el.className = "sw-update"; el.id = "sw-update";
    el.innerHTML = `<span class="ico">${icon("sparkles", 17)}</span>
      <span class="grow"><b>A new version is ready</b><span>Reload to pick it up — nothing in progress is lost.</span></span>
      <button class="btn primary" id="sw-reload">Reload</button>
      <button class="icon-btn" id="sw-later" title="Later">${icon("x", 15)}</button>`;
    document.body.appendChild(el);
    $("#sw-reload", el).onclick = () => {
      $("#sw-reload", el).disabled = true;
      // controllerchange reloads us once the new worker takes over
      reg.waiting ? reg.waiting.postMessage("skip-waiting") : location.reload();
    };
    $("#sw-later", el).onclick = () => el.remove();
  },
};

/* ============================================================
   Modal
   ============================================================ */
const Modal = {
  open(html, bindFn) {
    const root = $("#modal-root");
    root.innerHTML = `<div class="modal-scrim"><div class="modal">${html}</div></div>`;
    /* Clicking the backdrop deliberately does NOT close. These dialogs hold
       work in progress — a corrected SWOOD material list, a half-filled order,
       a route being edited — and a stray click beside the dialog threw all of
       it away with no warning and no undo. Every modal carries a visible
       Cancel or Close, and Escape still works. */
    $$("[data-close]", root).forEach(b => b.onclick = () => this.close());   // every modal marks its own close buttons
    if (bindFn) bindFn($(".modal", root));
    const firstInput = $(".modal input, .modal select", root);
    if (firstInput) setTimeout(() => firstInput.focus(), 60);
  },
  close(instant) {
    const root = $("#modal-root");
    const scrim = $(".modal-scrim", root);
    if (!scrim) return;
    if (instant) { root.innerHTML = ""; return; }
    scrim.classList.add("closing");
    setTimeout(() => { root.innerHTML = ""; }, 200);
  },
};

/* ============================================================
   Drawer (order detail) — content defined in manager.js/worker.js
   ============================================================ */
const Drawer = {
  orderId: null, _html: null,
  open(orderId) {
    this.orderId = orderId;
    if (typeof GPM !== "undefined") GPM.taskId = null; // don't fight the Planner task drawer
    if (typeof OrderDetail !== "undefined") { OrderDetail.showAllHist = false; OrderDetail.showAllParts = false; }
    this.refresh(true);
  },
  refresh(fresh) {
    if (!this.orderId) return;
    const o = D.order(this.orderId);
    if (!o) { this.close(true); return; }
    const root = $("#drawer-root");
    const body = OrderDetail.html(o);
    if (fresh || !$(".drawer", root)) {
      this._html = body;
      root.innerHTML = `<div class="drawer-scrim"></div><div class="drawer">${body}</div>`;
    } else {
      // App.render() calls us on every state change — rebuilding an unchanged
      // drawer scrolls it back to the top and destroys the button under the
      // user's finger (the "press Complete twice" bug, drawer edition)
      if (body === this._html) return;
      this._html = body;
      const d = $(".drawer", root);
      const sc = $(".drawer-body", d), top = sc ? sc.scrollTop : 0;
      d.innerHTML = body;
      const sc2 = $(".drawer-body", d); if (sc2 && top) sc2.scrollTop = top;
    }
    $(".drawer-scrim", root).onclick = () => this.close();
    OrderDetail.bind($(".drawer", root), o);
  },
  close(instant) {
    const root = $("#drawer-root");
    this.orderId = null;
    const d = $(".drawer", root), s = $(".drawer-scrim", root);
    if (!d) return;
    if (instant) { root.innerHTML = ""; return; }
    d.classList.add("closing"); s.classList.add("closing");
    setTimeout(() => { root.innerHTML = ""; }, 240);
  },
};

/* ============================================================
   Popover (anchored menu — Apple style)
   ============================================================ */
const Popover = {
  open(anchor, html, bind) {
    this.close();
    const root = document.createElement("div");
    root.id = "pop-root";
    root.innerHTML = `<div class="pop-scrim"></div><div class="popover">${html}</div>`;
    document.body.appendChild(root);
    const pop = $(".popover", root);
    const r = anchor.getBoundingClientRect();
    pop.style.top = Math.min(r.bottom + 8, innerHeight - pop.offsetHeight - 12) + "px";
    pop.style.left = Math.max(12, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 12)) + "px";
    $(".pop-scrim", root).onclick = () => this.close();
    if (bind) bind(pop);
  },
  /* A picker where several boxes get ticked wants to act once, when the person
     is done, not on every tick — so a popover can leave a note to run then. */
  close() {
    const r = $("#pop-root");
    if (!r) return;
    const pop = $(".popover", r), fn = pop && pop._onClose;
    if (pop) pop._onClose = null;
    r.remove();
    if (fn) fn();
  },
};

/* Apple-style toggle switch */
function switchHtml(id, on) {
  return `<button class="switch ${on ? "on" : ""}" data-switch="${id}" role="switch" aria-checked="${on}"><i></i></button>`;
}

/* ============================================================
   Command palette (⌘K)
   ============================================================ */
const Palette = {
  isOpen: false,
  toggle() { this.isOpen ? this.close() : this.open(); },
  open() {
    this.isOpen = true;
    const root = $("#palette-root");
    root.innerHTML = `<div class="palette-scrim"></div>
      <div class="palette">
        <input placeholder="Search orders, clients, people…" id="pal-q">
        <div class="palette-list" id="pal-list"></div>
      </div>`;
    $(".palette-scrim", root).onclick = () => this.close();
    const q = $("#pal-q", root);
    q.oninput = () => this.renderList(q.value);
    q.onkeydown = (e) => {
      if (e.key === "Enter") { const first = $(".palette-item", root); if (first) first.click(); }
    };
    this.renderList("");
    setTimeout(() => q.focus(), 40);
  },
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    $("#palette-root").innerHTML = "";
  },
  renderList(query) {
    const list = $("#pal-list"); if (!list) return;
    const ql = query.trim().toLowerCase();
    const orders = Store.state.orders.filter(o =>
      !ql || o.num.toLowerCase().includes(ql) || o.product.toLowerCase().includes(ql) || o.client.toLowerCase().includes(ql)
    ).slice(0, 6);
    const members = ql ? Store.state.members.filter(m => m.name.toLowerCase().includes(ql)).slice(0, 3) : [];
    const mats = (ql && App.usesCockpit())
      ? Store.state.materials.filter(m => m.name.toLowerCase().includes(ql) || m.sku.toLowerCase().includes(ql)).slice(0, 4) : [];
    const boards = ql ? D.boardsFor(App.me.id).filter(b => b.name.toLowerCase().includes(ql)).slice(0, 3) : [];
    let html = "";
    for (const o of orders) {
      const st = D.orderStatus(o);
      const cur = D.currentOp(o);
      html += `<button class="palette-item" data-order="${o.id}">
        <span class="ico">${cur ? stIcon(D.station(cur.stationId), 17) : icon(o.shipped ? "truck" : "check-circle", 17)}</span>
        <span class="grow"><b>${o.num !== o.product ? esc(o.num) + " · " : ""}${esc(o.product)}</b><span>${o.client && o.client !== o.product ? esc(o.client) + " — " : ""}${D.statusLabelFor(o, st)}</span></span>
        ${pillHtml(st, D.statusLabelFor(o, st))}
      </button>`;
    }
    for (const m of members) {
      html += `<button class="palette-item" data-member="${m.id}">
        ${avatarHtml(m, "sm")}
        <span class="grow"><b>${esc(m.name)}</b><span>${esc(m.trade)}</span></span>
      </button>`;
    }
    for (const m of mats) {
      const low = m.qty <= m.minQty;
      html += `<button class="palette-item" data-material="${m.id}">
        <span class="ico">${matIcon(m, 17)}</span>
        <span class="grow"><b>${esc(m.name)}</b><span>${esc(m.sku)} · ${m.qty} ${esc(m.unit)} in stock</span></span>
        ${low ? `<span class="pill blocked"><span class="dot"></span>Low</span>` : ""}
      </button>`;
    }
    for (const b of boards) {
      html += `<button class="palette-item" data-board="${b.id}">
        <span class="ico">${icon("brain", 17)}</span>
        <span class="grow"><b>${esc(b.name)}</b><span>Whiteboard · ${b.els.length} items</span></span>
      </button>`;
    }
    list.innerHTML = html || `<div class="palette-empty">No matches for “${esc(query)}”</div>`;
    $$(".palette-item", list).forEach(b => b.onclick = () => {
      this.close();
      if (b.dataset.order) Drawer.open(b.dataset.order);
      if (b.dataset.member && App.isManager()) App.navigate("team");
      if (b.dataset.material) { App.navigate("warehouse"); Warehouse.materialModal(b.dataset.material); }
      if (b.dataset.board) {
        WB.openId = b.dataset.board; WB.fit(true);
        if (App.usesCockpit()) App.navigate("whiteboard");
        else { App.workerTab = "board"; App.render(); }
      }
    });
  },
};
