/* ============================================================
   ShopFlow — Whiteboard (WB)
   FigJam/Freeform-style shared canvas: sticky notes, text,
   shapes + connectors (workflows), tables, freehand pen.
   Every team member can add; every element remembers its author.
   ============================================================ */
"use strict";

const WB = {
  openId: null,
  tool: "select",          // select | sticky | text | shape | table | pen | connect
  selectedId: null,
  editingId: null,
  connectFrom: null,
  vp: { x: 60, y: 40, z: 1 },
  _gesture: null,
  _kbInstalled: false,

  COLORS: 7, // wb-c0..c6

  isActive() {
    return !!App.me && !!this.openId &&
      ((App.usesCockpit() && App.view === "whiteboard") ||
       (App.me.role === "worker" && App.workerTab === "board"));
  },

  board() { return D.board(this.openId); },

  /* ================= view ================= */
  view() {
    if (this.openId && (!D.board(this.openId) || !D.boardAccess(D.board(this.openId), App.me.id))) this.openId = null;
    return this.openId ? this.canvasView() : this.gallery();
  },

  shareBadge(b, size = 12) {
    const v = b.visibility || "team";
    if (v === "private") return `<span class="wb-vis" title="Private — only ${esc(D.member(b.createdBy)?.name || "the creator")}">${icon("lock", size)} Private</span>`;
    if (v === "custom") return `<span class="wb-vis" title="Shared with selected people">${icon("users", size)} ${(b.memberIds || []).length + 1}</span>`;
    return `<span class="wb-vis" title="Visible to the whole team">${icon("users", size)} Team</span>`;
  },

  /* ---------- gallery ---------- */
  gallery() {
    const boards = D.boardsFor(App.me.id).sort((a, b) => b.updatedAt - a.updatedAt);
    return `<div class="wb-gallery view-anim">
      <div class="section-title">
        <h2 class="muted" style="font-weight:500">${boards.length} board${boards.length === 1 ? "" : "s"} you can see — private boards stay yours</h2>
      </div>
      <div class="wb-grid">
        ${boards.map(b => {
          const creator = D.member(b.createdBy);
          return `<button class="wb-card" data-wb-open="${b.id}">
            <div class="thumb">${this.thumb(b)}</div>
            <div class="cbody">
              <span class="grow"><b>${esc(b.name)}</b>
              <span>${b.els.length} item${b.els.length === 1 ? "" : "s"} · ${fmtAgo(b.updatedAt)} · ${this.shareBadge(b, 10)}</span></span>
              ${avatarHtml(creator, "sm")}
            </div>
          </button>`;
        }).join("")}
        <button class="wb-card wb-new-card" id="wb-new">${icon("plus", 15)} New board</button>
      </div>
    </div>`;
  },

  thumb(b) {
    if (!b.els.length) return "";
    const xs = b.els.map(e => e.x), ys = b.els.map(e => e.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const x1 = Math.max(...b.els.map(e => e.x + (e.w || 100))), y1 = Math.max(...b.els.map(e => e.y + (e.h || 60)));
    const sc = Math.min(230 / Math.max(x1 - x0, 1), 96 / Math.max(y1 - y0, 1), 0.4);
    return b.els.slice(0, 14).map(e => {
      const cls = e.type === "sticky" || e.type === "shape" ? `wb-c${e.color % this.COLORS}` : "";
      const bg = cls ? "" : "background:var(--surface-3);";
      return `<i class="${cls}" style="${bg}left:${6 + (e.x - x0) * sc}px;top:${6 + (e.y - y0) * sc}px;width:${Math.max(6, (e.w || 100) * sc)}px;height:${Math.max(4, (e.h || 60) * sc)}px"></i>`;
    }).join("");
  },

  /* ---------- canvas ---------- */
  canvasView() {
    const b = this.board();
    const creator = D.member(b.createdBy);
    return `<div class="wb-shell view-anim">
      <div class="wb-topbar">
        <button class="icon-btn" id="wb-back" title="All boards">${icon("chev-left", 16)}</button>
        <span style="color:var(--accent)">${icon("brain", 19)}</span>
        <input class="wb-title" id="wb-title" value="${esc(b.name)}" maxlength="60">
        <span class="meta">${creator ? "by " + esc(creator.name) + " · " : ""}updated ${fmtAgo(b.updatedAt)}</span>
        <span class="grow"></span>
        <button class="btn ghost" id="wb-share" style="padding:6px 13px;font-size:12.5px">${this.shareBadge(b, 12)}</button>
        ${b.createdBy === App.me.id || App.isManager() ? `<button class="icon-btn" id="wb-del-board" title="Delete board">${icon("trash", 15)}</button>` : ""}
      </div>
      <div class="wb-canvas ${this.toolClass()}" id="wb-canvas">
        <div class="wb-world" id="wb-world" style="transform:translate(${this.vp.x}px,${this.vp.y}px) scale(${this.vp.z})">
          ${this.linesSvg(b)}
          ${b.els.map(e => this.elHtml(e)).join("")}
        </div>
        ${this.contextBar(b)}
        <div class="wb-hint" id="wb-hint">${this.hint()}</div>
        <div class="wb-tools">
          ${[["select", "cursor", "Select · drag empty space to pan", "V"],
             ["sticky", "sticky", "Sticky note", "S"],
             ["text", "type", "Text", "T"],
             ["shape", "square", "Shape (workflow node)", "R"],
             ["connect", "arrow-right", "Connector — click two shapes", "C"],
             ["table", "table", "Table", "B"],
             ["pen", "pen", "Pen", "P"]]
            .map(([t, ico, tip, k]) => `<button class="wb-tool ${this.tool === t ? "active" : ""}" data-wb-tool="${t}" title="${tip}">${icon(ico, 18)}<span class="kbd">${k}</span></button>`).join("")}
        </div>
        <div class="wb-zoom">
          <button id="wb-zout" title="Zoom out">−</button>
          <span class="pct">${Math.round(this.vp.z * 100)}%</span>
          <button id="wb-zin" title="Zoom in">＋</button>
          <button id="wb-fit" title="Fit to content">⛶</button>
        </div>
      </div>
    </div>`;
  },

  toolClass() {
    if (this.tool === "pen") return "tool-pen";
    if (this.tool === "connect") return "tool-connect";
    if (["sticky", "text", "shape", "table"].includes(this.tool)) return "tool-place";
    return "";
  },

  hint() {
    return {
      select: "Double-click empty space for a sticky · double-click an item to edit its text",
      sticky: "Click anywhere to place a sticky note",
      text: "Click anywhere to place text",
      shape: "Click to place a workflow node — connect them with ↦",
      table: "Click anywhere to place a table",
      pen: "Draw freely — release to finish a stroke",
      connect: this.connectFrom ? "Now click the target item" : "Click the first item, then the second — click a line to remove it",
    }[this.tool] || "";
  },

  linesSvg(b) {
    const mid = (e) => e ? [e.x + (e.w || 100) / 2, e.y + (e.h || 60) / 2] : null;
    return `<svg class="wb-lines">
      <defs><marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--text-3)"></path>
      </marker></defs>
      ${b.conns.map(c => {
        const a = mid(b.els.find(e => e.id === c.from));
        const z = mid(b.els.find(e => e.id === c.to));
        if (!a || !z) return "";
        return `<path class="conn" data-conn="${c.id}" d="M ${a[0]} ${a[1]} L ${z[0]} ${z[1]}" marker-end="url(#wb-arrow)"></path>`;
      }).join("")}
    </svg>`;
  },

  elHtml(e) {
    const sel = e.id === this.selectedId ? "selected" : "";
    const src = e.id === this.connectFrom ? "connect-src" : "";
    const by = D.member(e.by);
    const byChip = `<span class="wb-by">${by ? avatarHtml(by, "sm") : ""}${by ? esc(by.name) : ""} · ${fmtAgo(e.ts)}</span>`;
    const base = `class="wb-el ${sel} ${src}" data-el="${e.id}"`;
    const pos = (h) => `style="left:${e.x}px;top:${e.y}px;width:${e.w}px;${h ? `height:${e.h}px;` : ""}"`;

    if (e.type === "sticky")
      return `<div ${base.replace('class="', 'class="wb-sticky wb-c' + (e.color % this.COLORS) + " ")} ${pos(true)}>
        <div class="wb-text">${esc(e.text)}</div><span class="wb-resize"></span>${byChip}</div>`;
    if (e.type === "text")
      return `<div ${base.replace('class="', 'class="wb-textblock ')} ${pos(false)}>
        <div class="wb-text">${esc(e.text)}</div><span class="wb-resize"></span>${byChip}</div>`;
    if (e.type === "shape")
      return `<div ${base.replace('class="', `class="wb-shape kind-${e.kind || "rect"} wb-c${e.color % this.COLORS} `)} ${pos(true)}>
        <div class="wb-text" style="display:flex;align-items:center;justify-content:center">${esc(e.text)}</div><span class="wb-resize"></span>${byChip}</div>`;
    if (e.type === "table")
      return `<div ${base.replace('class="', 'class="wb-tablewrap ')} ${pos(false)}>
        <div class="wb-tablebar"><i></i><i></i><i></i></div>
        <table>${e.rows.map((row, r) => `<tr>${row.map((cell, c) =>
          `<td contenteditable="true" data-r="${r}" data-c="${c}">${esc(cell)}</td>`).join("")}</tr>`).join("")}</table>
        <span class="wb-resize"></span>${byChip}</div>`;
    if (e.type === "draw") {
      const stroke = ["#e0a800", "#ff6b22", "#d61f47", "#1fa946", "#0a84ff", "#8e2de2", "var(--text)"][e.color % this.COLORS];
      return `<div ${base.replace('class="', 'class="wb-draw ')} ${pos(true)}>
        <svg width="${e.w}" height="${e.h}"><polyline points="${e.points.map(p => p.join(",")).join(" ")}" stroke="${stroke}"></polyline></svg>${byChip}</div>`;
    }
    return "";
  },

  contextBar(b) {
    const e = b.els.find(x => x.id === this.selectedId);
    if (!e) return "";
    const by = D.member(e.by);
    const labels = { sticky: "Sticky", text: "Text", shape: "Shape", table: "Table", draw: "Drawing" };
    const colorable = ["sticky", "shape", "draw"].includes(e.type);
    return `<div class="wb-context">
      <b style="color:var(--text)">${labels[e.type] || "Item"}</b>
      <span>· ${by ? esc(by.name) : "?"} · ${fmtAgo(e.ts)}</span>
      ${colorable ? Array.from({ length: this.COLORS }, (_, i) =>
        `<span class="wb-swatch wb-c${i} ${e.color % this.COLORS === i ? "on" : ""}" data-wb-color="${i}"></span>`).join("") : ""}
      ${e.type === "shape" ? `<button class="mini-act" data-wb-kind>${(e.kind || "rect") === "rect" ? "◯ Pill" : "▢ Rect"}</button>` : ""}
      ${e.type === "table" ? `<button class="mini-act" data-wb-tbl="row+">＋ Row</button>
        <button class="mini-act" data-wb-tbl="row-">− Row</button>
        <button class="mini-act" data-wb-tbl="col+">＋ Col</button>
        <button class="mini-act" data-wb-tbl="col-">− Col</button>` : ""}
      <button class="mini-act danger" data-wb-el-del>Delete</button>
    </div>`;
  },

  /* ================= bind ================= */
  bind(root) {
    if (!this.openId) {
      $$("[data-wb-open]", root).forEach(bn => bn.onclick = () => {
        this.openId = bn.dataset.wbOpen;
        this.selectedId = null; this.tool = "select"; this.connectFrom = null;
        this.fit(true);
        App.render();
      });
      const nb = $("#wb-new", root);
      if (nb) nb.onclick = () => {
        Modal.open(`
          <header><h2>New board</h2><button class="icon-btn" data-close>✕</button></header>
          <div class="modal-body"><div class="field"><label>Board name</label>
            <input class="input" id="nb-name" placeholder="e.g. Shop improvement ideas"></div></div>
          <footer><button class="btn ghost" data-close>Cancel</button>
            <button class="btn primary" id="nb-create">Create board</button></footer>
        `, (modal) => {
          $$("[data-close]", modal).forEach(x => x.onclick = () => Modal.close());
          const create = () => {
            const name = $("#nb-name", modal).value.trim() || "New board";
            const b = M.addBoard(name, App.me.id);
            Modal.close();
            this.openId = b.id; this.vp = { x: 60, y: 40, z: 1 };
            App.render();
            Toast.show(`Board “${name}” — everyone on the team can add to it`, { emoji: "brain", ms: 3800 });
          };
          $("#nb-create", modal).onclick = create;
          $("#nb-name", modal).onkeydown = (ev) => { if (ev.key === "Enter") create(); };
        });
      };
      return;
    }
    this.bindCanvas(root);
    this.installKeys();
  },

  bindCanvas(root) {
    const b = this.board();
    $("#wb-back", root).onclick = () => { this.openId = null; App.render(); };
    $("#wb-title", root).onchange = (e) => M.renameBoard(b.id, e.target.value.trim(), App.me.id);
    $("#wb-share", root).onclick = () => this.shareModal(b);
    const delBtn = $("#wb-del-board", root);
    if (delBtn) delBtn.onclick = () => {
      const snap = Store.snapshot();
      M.deleteBoard(b.id, App.me.id);
      this.openId = null; App.render();
      Toast.show("Board deleted", { undo: () => { Store.restore(snap); App.render(); } });
    };
    $$("[data-wb-tool]", root).forEach(bt => bt.onclick = () => {
      this.tool = bt.dataset.wbTool; this.connectFrom = null;
      this.repaint();
    });
    $("#wb-zin", root).onclick = () => this.zoomBy(1.2);
    $("#wb-zout", root).onclick = () => this.zoomBy(1 / 1.2);
    $("#wb-fit", root).onclick = () => { this.fit(); this.repaint(); };

    const canvas = $("#wb-canvas", root);
    canvas.onwheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const f = Math.pow(1.0016, -e.deltaY);
        this.zoomAt(e.clientX, e.clientY, f, canvas);
      } else {
        this.vp.x -= e.deltaX; this.vp.y -= e.deltaY;
        this.applyTransform(canvas);
      }
    };
    canvas.onpointerdown = (e) => this.pointerDown(e, canvas);
    canvas.onpointermove = (e) => this.pointerMove(e, canvas);
    canvas.onpointerup = (e) => this.pointerUp(e, canvas);
    canvas.ondblclick = (e) => this.dblClick(e, canvas);

    /* connectors: click a line to remove it */
    $$("path.conn", canvas).forEach(p => p.style.pointerEvents = "stroke");
    canvas.addEventListener("click", (e) => {
      const path = e.target.closest && e.target.closest("path.conn");
      if (path && this.tool === "connect") {
        M.wbDisconnect(b.id, path.dataset.conn);
        this.repaint();
      }
    });

    /* table cell edits save on focusout */
    canvas.addEventListener("focusout", (e) => {
      const td = e.target.closest && e.target.closest("td[data-r]");
      if (!td) return;
      const wrap = td.closest(".wb-el");
      const rows = [...wrap.querySelectorAll("tr")].map(tr => [...tr.children].map(c => c.innerText.trim()));
      M.wbUpdate(b.id, wrap.dataset.el, { rows });
    });
  },

  /* ---------- sharing ---------- */
  shareModal(b) {
    const canEdit = b.createdBy === App.me.id || App.isManager();
    const v = b.visibility || "team";
    Modal.open(`
      <header><h2>Board sharing</h2><button class="icon-btn" data-close>${icon("x", 15)}</button></header>
      <div class="modal-body">
        ${canEdit ? `
        <div class="field"><label>Who can see “${esc(b.name)}”?</label>
          <div class="route-picker">
            ${[["team", "users", "Whole team", "Everyone can view and edit"],
               ["private", "lock", "Only me", "Visible only to " + esc(D.member(b.createdBy)?.name || "the creator")],
               ["custom", "sliders", "Selected people", "Pick exactly who has access"]]
              .map(([val, ic, label, sub]) => `
              <div class="route-pick ${v === val ? "on" : ""}" data-vis="${val}">
                <span class="chk">✓</span>
                <span class="ico" style="color:var(--text-2)">${icon(ic, 16)}</span>
                <b>${label}</b><span class="t-caption">${sub}</span>
              </div>`).join("")}
          </div>
        </div>
        <div class="field ${v === "custom" ? "" : "hide"}" id="wb-share-members">
          <label>People with access (besides ${esc(D.member(b.createdBy)?.name || "creator")})</label>
          <div class="route-picker">
            ${Store.state.members.filter(m => m.id !== b.createdBy).map(m => `
              <div class="route-pick ${(b.memberIds || []).includes(m.id) ? "on" : ""}" data-share-m="${m.id}">
                <span class="chk">✓</span>${avatarHtml(m, "sm")}<b>${esc(m.name)}</b>
                <span class="t-caption">${esc(m.trade)}</span>
              </div>`).join("")}
          </div>
        </div>` : `<div class="t-caption">Only ${esc(D.member(b.createdBy)?.name || "the creator")} or a manager can change sharing.</div>`}
      </div>
      ${canEdit ? `<footer>
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="wb-share-save">Save sharing</button>
      </footer>` : ""}
    `, (modal) => {
      $$("[data-close]", modal).forEach(x => x.onclick = () => Modal.close());
      let vis = v;
      $$("[data-vis]", modal).forEach(r => r.onclick = () => {
        vis = r.dataset.vis;
        $$("[data-vis]", modal).forEach(x => x.classList.toggle("on", x === r));
        $("#wb-share-members", modal).classList.toggle("hide", vis !== "custom");
      });
      $$("[data-share-m]", modal).forEach(r => r.onclick = () => r.classList.toggle("on"));
      const save = $("#wb-share-save", modal);
      if (save) save.onclick = () => {
        const ids = $$("[data-share-m].on", modal).map(r => r.dataset.shareM);
        M.setBoardSharing(b.id, vis, ids, App.me.id);
        Modal.close(); App.render();
        Toast.show(vis === "team" ? "Shared with the whole team" : vis === "private" ? "Board is now private" : `Shared with ${ids.length + 1} people`, { emoji: vis === "private" ? "lock" : "users" });
      };
    });
  },

  /* ================= geometry ================= */
  world(e, canvas) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left - this.vp.x) / this.vp.z, (e.clientY - r.top - this.vp.y) / this.vp.z];
  },
  applyTransform(canvas) {
    const w = $("#wb-world", canvas);
    if (w) w.style.transform = `translate(${this.vp.x}px,${this.vp.y}px) scale(${this.vp.z})`;
    const pct = canvas.querySelector(".wb-zoom .pct");
    if (pct) pct.textContent = Math.round(this.vp.z * 100) + "%";
  },
  zoomAt(cx, cy, f, canvas) {
    const r = canvas.getBoundingClientRect();
    const z2 = Math.max(0.25, Math.min(2.5, this.vp.z * f));
    const k = z2 / this.vp.z;
    this.vp.x = (cx - r.left) - k * ((cx - r.left) - this.vp.x);
    this.vp.y = (cy - r.top) - k * ((cy - r.top) - this.vp.y);
    this.vp.z = z2;
    this.applyTransform(canvas);
  },
  zoomBy(f) {
    const canvas = $("#wb-canvas");
    if (canvas) {
      const r = canvas.getBoundingClientRect();
      this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, f, canvas);
    }
  },
  fit(initial) {
    const b = this.board();
    if (!b || !b.els.length) { this.vp = { x: 60, y: 40, z: 1 }; return; }
    const hEst = (e) => e.h || (e.type === "table" ? e.rows.length * 34 + 24 : 60);
    const x0 = Math.min(...b.els.map(e => e.x)), y0 = Math.min(...b.els.map(e => e.y));
    const x1 = Math.max(...b.els.map(e => e.x + (e.w || 100))), y1 = Math.max(...b.els.map(e => e.y + hEst(e)));
    const canvas = $("#wb-canvas");
    const cw = canvas ? canvas.clientWidth : 1100, ch = canvas ? canvas.clientHeight : 640;
    const z = Math.max(0.25, Math.min((cw - 100) / Math.max(x1 - x0, 1), (ch - 170) / Math.max(y1 - y0, 1), initial ? 1 : 1.4));
    this.vp = { z, x: (cw - (x1 - x0) * z) / 2 - x0 * z, y: (ch - (y1 - y0) * z) / 2 - y0 * z - 20 };
  },

  /* ================= interactions ================= */
  DEFAULTS: {
    sticky: { w: 180, h: 180, color: 0, text: "" },
    text: { w: 240, h: 44, color: 6, text: "" },
    shape: { w: 180, h: 64, color: 4, kind: "rect", text: "" },
    table: { w: 340, h: 0, color: 6, text: "", rows: [["", "", ""], ["", "", ""], ["", "", ""]] },
  },

  pointerDown(e, canvas) {
    if (e.target.closest(".wb-tools, .wb-zoom, .wb-context, .wb-hint, .wb-topbar")) return;
    const b = this.board();
    const [wx, wy] = this.world(e, canvas);

    if (["sticky", "text", "shape", "table"].includes(this.tool)) {
      const def = JSON.parse(JSON.stringify(this.DEFAULTS[this.tool]));
      const el = M.wbAdd(b.id, { type: this.tool, x: Math.round(wx - def.w / 2), y: Math.round(wy - (def.h || 60) / 2), ...def }, App.me.id);
      this.tool = "select"; this.selectedId = el.id;
      this.repaint();
      if (el.type !== "table") this.startEditing(el.id);
      return;
    }

    if (this.tool === "pen") {
      canvas.setPointerCapture(e.pointerId);
      this._gesture = { kind: "pen", pts: [[wx, wy]] };
      const w = $("#wb-world", canvas);
      const tmp = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      tmp.setAttribute("class", "wb-lines"); tmp.id = "wb-pen-tmp";
      tmp.innerHTML = `<polyline fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${wx},${wy}"></polyline>`;
      w.appendChild(tmp);
      return;
    }

    const elDiv = e.target.closest(".wb-el");

    if (this.tool === "connect") {
      if (elDiv) {
        const id = elDiv.dataset.el;
        if (!this.connectFrom) { this.connectFrom = id; }
        else if (this.connectFrom !== id) {
          M.wbConnect(b.id, this.connectFrom, id);
          this.connectFrom = null;
        }
        this.repaint();
      }
      return;
    }

    // ---- select tool ----
    const handle = e.target.closest(".wb-resize");
    if (handle && elDiv) {
      const el = b.els.find(x => x.id === elDiv.dataset.el);
      canvas.setPointerCapture(e.pointerId);
      this._gesture = { kind: "resize", el, sw: el.w, sh: el.h || 0, sx: wx, sy: wy, div: elDiv };
      return;
    }
    if (elDiv) {
      const id = elDiv.dataset.el;
      if (this.editingId === id) return;                       // typing — leave alone
      if (e.target.closest("td[data-r]")) { this.select(id); return; } // table cells edit on click
      const el = b.els.find(x => x.id === id);
      canvas.setPointerCapture(e.pointerId);
      this._gesture = { kind: "drag", el, ox: wx - el.x, oy: wy - el.y, div: elDiv, moved: false };
      this.select(id);
      return;
    }
    // empty canvas → pan
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("panning");
    this._gesture = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: this.vp.x, oy: this.vp.y };
    if (this.selectedId) { this.selectedId = null; this.repaint(); }
  },

  pointerMove(e, canvas) {
    const g = this._gesture;
    if (!g) return;
    const [wx, wy] = this.world(e, canvas);
    if (g.kind === "pan") {
      this.vp.x = g.ox + (e.clientX - g.sx);
      this.vp.y = g.oy + (e.clientY - g.sy);
      this.applyTransform(canvas);
    } else if (g.kind === "drag") {
      g.moved = true;
      g.el.x = Math.round(wx - g.ox); g.el.y = Math.round(wy - g.oy);
      g.div.style.left = g.el.x + "px"; g.div.style.top = g.el.y + "px";
      this.updateConnPaths(canvas);
    } else if (g.kind === "resize") {
      g.el.w = Math.max(60, Math.round(g.sw + (wx - g.sx)));
      g.div.style.width = g.el.w + "px";
      if (g.el.type !== "table" && g.el.type !== "text") {
        g.el.h = Math.max(40, Math.round(g.sh + (wy - g.sy)));
        g.div.style.height = g.el.h + "px";
      }
      this.updateConnPaths(canvas);
    } else if (g.kind === "pen") {
      const last = g.pts[g.pts.length - 1];
      if (Math.hypot(wx - last[0], wy - last[1]) > 2.5 / this.vp.z) {
        g.pts.push([wx, wy]);
        const poly = canvas.querySelector("#wb-pen-tmp polyline");
        if (poly) poly.setAttribute("points", g.pts.map(p => p.join(",")).join(" "));
      }
    }
  },

  pointerUp(e, canvas) {
    const g = this._gesture;
    this._gesture = null;
    canvas.classList.remove("panning");
    if (!g) return;
    const b = this.board();
    if (g.kind === "drag") {
      if (g.moved) {
        g.el.x = Math.round(g.el.x / 8) * 8; g.el.y = Math.round(g.el.y / 8) * 8; // snap
        M.wbUpdate(b.id, g.el.id, { x: g.el.x, y: g.el.y });
        M.wbFront(b.id, g.el.id);
        this.repaint();
      }
    } else if (g.kind === "resize") {
      M.wbUpdate(b.id, g.el.id, { w: g.el.w, h: g.el.h });
      this.repaint();
    } else if (g.kind === "pen") {
      $("#wb-pen-tmp", canvas)?.remove();
      if (g.pts.length > 2) {
        const xs = g.pts.map(p => p[0]), ys = g.pts.map(p => p[1]);
        const x0 = Math.min(...xs), y0 = Math.min(...ys);
        M.wbAdd(b.id, {
          type: "draw", x: Math.round(x0), y: Math.round(y0),
          w: Math.max(8, Math.round(Math.max(...xs) - x0)), h: Math.max(8, Math.round(Math.max(...ys) - y0)),
          color: 4, points: g.pts.map(p => [Math.round(p[0] - x0), Math.round(p[1] - y0)]),
        }, App.me.id);
        this.repaint();
      }
    }
  },

  dblClick(e, canvas) {
    if (e.target.closest(".wb-tools, .wb-zoom, .wb-context, .wb-hint")) return;
    const elDiv = e.target.closest(".wb-el");
    if (elDiv) {
      if (elDiv.querySelector(".wb-text")) this.startEditing(elDiv.dataset.el);
      return;
    }
    // FigJam habit: double-click empty space → sticky (select tool only)
    if (this.tool !== "select") return;
    const [wx, wy] = this.world(e, canvas);
    const def = JSON.parse(JSON.stringify(this.DEFAULTS.sticky));
    const el = M.wbAdd(this.board().id, { type: "sticky", x: Math.round(wx - 90), y: Math.round(wy - 90), ...def }, App.me.id);
    this.selectedId = el.id;
    this.repaint();
    this.startEditing(el.id);
  },

  startEditing(elId) {
    const div = document.querySelector(`.wb-el[data-el="${elId}"] .wb-text`);
    if (!div) return;
    this.editingId = elId;
    div.contentEditable = "true";
    div.focus();
    const range = document.createRange();
    range.selectNodeContents(div); range.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(range);
    div.onblur = () => {
      div.contentEditable = "false";
      this.editingId = null;
      M.wbUpdate(this.openId, elId, { text: div.innerText.trim() });
    };
  },

  select(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.repaint();
  },

  updateConnPaths(canvas) {
    const b = this.board();
    const mid = (e) => e ? [e.x + (e.w || 100) / 2, e.y + (e.h || 60) / 2] : null;
    b.conns.forEach(c => {
      const path = canvas.querySelector(`path[data-conn="${c.id}"]`);
      if (!path) return;
      const a = mid(b.els.find(e => e.id === c.from));
      const z = mid(b.els.find(e => e.id === c.to));
      if (a && z) path.setAttribute("d", `M ${a[0]} ${a[1]} L ${z[0]} ${z[1]}`);
    });
  },

  /* light re-render of the canvas area only (keeps scroll/topbar) */
  repaint() {
    const host = $("#wb-canvas");
    if (!host) { App.render(); return; }
    App.render();
  },

  /* context bar & keyboard */
  installKeys() {
    if (this._kbInstalled) return;
    this._kbInstalled = true;
    document.addEventListener("keydown", (e) => {
      if (!this.isActive()) return;
      if (this.editingId || document.activeElement?.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
      const map = { v: "select", s: "sticky", t: "text", r: "shape", c: "connect", b: "table", p: "pen" };
      const k = e.key.toLowerCase();
      if (map[k] && !e.metaKey && !e.ctrlKey) { this.tool = map[k]; this.connectFrom = null; this.repaint(); }
      if ((e.key === "Delete" || e.key === "Backspace") && this.selectedId) {
        e.preventDefault();
        const snap = Store.snapshot();
        M.wbDelete(this.openId, this.selectedId);
        this.selectedId = null;
        this.repaint();
        Toast.show("Deleted", { undo: () => { Store.restore(snap); App.render(); } });
      }
      if (e.key === "Escape") {
        if (this.connectFrom) this.connectFrom = null;
        else if (this.selectedId) this.selectedId = null;
        else this.tool = "select";
        this.repaint();
      }
    });
    /* context bar actions (delegated — survives repaints) */
    document.addEventListener("click", (e) => {
      if (!this.isActive() || !this.selectedId) return;
      const b = this.board();
      const el = b && b.els.find(x => x.id === this.selectedId);
      if (!el) return;
      const sw = e.target.closest("[data-wb-color]");
      if (sw) { M.wbUpdate(b.id, el.id, { color: parseInt(sw.dataset.wbColor) }); this.repaint(); return; }
      if (e.target.closest("[data-wb-kind]")) {
        M.wbUpdate(b.id, el.id, { kind: (el.kind || "rect") === "rect" ? "pill" : "rect" });
        this.repaint(); return;
      }
      const tbl = e.target.closest("[data-wb-tbl]");
      if (tbl) {
        const rows = el.rows.map(r => [...r]);
        const act = tbl.dataset.wbTbl;
        if (act === "row+") rows.push(rows[0].map(() => ""));
        if (act === "row-" && rows.length > 1) rows.pop();
        if (act === "col+") rows.forEach(r => r.push(""));
        if (act === "col-" && rows[0].length > 1) rows.forEach(r => r.pop());
        M.wbUpdate(b.id, el.id, { rows });
        this.repaint(); return;
      }
      if (e.target.closest("[data-wb-el-del]")) {
        const snap = Store.snapshot();
        M.wbDelete(b.id, el.id);
        this.selectedId = null;
        this.repaint();
        Toast.show("Deleted", { undo: () => { Store.restore(snap); App.render(); } });
      }
    });
  },
};
