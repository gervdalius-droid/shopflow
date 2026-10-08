/* ============================================================
   ShopFlow — SWOOD "Report Lists to Excel" import
   Turns a SWOOD export straight into a manufacturing project:
   parts, per-material quantities, a production route, and the
   material + hardware lines the job will consume.

   No libraries: an .xlsx/.xlsm is a ZIP of XML, and browsers can
   inflate on their own (DecompressionStream) and parse XML with
   DOMParser. That keeps the shopfloor working offline.
   ============================================================ */
"use strict";

/* ---------- minimal XLSX reader ---------- */
const XLSX = {
  /* Read the ZIP central directory. Only the entries we ask for are
     inflated, so a 3 MB workbook of 560 files costs us five sheets. */
  async open(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    // End of Central Directory: scan back from the tail (max 64k comment)
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65558); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Not a valid .xlsx/.xlsm file (no ZIP directory)");
    let count = dv.getUint16(eocd + 10, true);
    let dirOff = dv.getUint32(eocd + 16, true);
    // ZIP64 fallback — a big workbook stores the real offsets in a locator
    if (dirOff === 0xffffffff || count === 0xffff) {
      for (let i = eocd - 20; i >= 0; i--) {
        if (dv.getUint32(i, true) === 0x07064b50) {
          const z64 = Number(dv.getBigUint64(i + 8, true));
          count = Number(dv.getBigUint64(z64 + 32, true));
          dirOff = Number(dv.getBigUint64(z64 + 48, true));
          break;
        }
      }
    }
    const files = new Map();
    let p = dirOff;
    for (let i = 0; i < count && p + 46 <= u8.length; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
      files.set(name, { method, csize, local });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return new XlsxFile(buf, dv, u8, files);
  },
};

class XlsxFile {
  constructor(buf, dv, u8, files) { this.buf = buf; this.dv = dv; this.u8 = u8; this.files = files; this._shared = null; this._sheets = null; }

  async raw(name) {
    const e = this.files.get(name);
    if (!e) return null;
    // the local header repeats the name/extra lengths — the central copy lies
    const nameLen = this.dv.getUint16(e.local + 26, true);
    const extraLen = this.dv.getUint16(e.local + 28, true);
    const start = e.local + 30 + nameLen + extraLen;
    const bytes = this.u8.subarray(start, start + e.csize);
    if (e.method === 0) return new TextDecoder().decode(bytes);
    if (e.method !== 8) throw new Error("Unsupported compression in the workbook");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
  }

  async xml(name) {
    const text = await this.raw(name);
    if (text == null) return null;
    return new DOMParser().parseFromString(text, "application/xml");
  }

  /* sheet name → part path, via workbook.xml + its rels */
  async sheetIndex() {
    if (this._sheets) return this._sheets;
    const wb = await this.xml("xl/workbook.xml");
    const rels = await this.xml("xl/_rels/workbook.xml.rels");
    if (!wb || !rels) throw new Error("Workbook is missing its index");
    const target = {};
    for (const r of rels.getElementsByTagName("Relationship")) target[r.getAttribute("Id")] = r.getAttribute("Target");
    const map = new Map();
    for (const s of wb.getElementsByTagName("sheet")) {
      const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let t = target[rid] || "";
      if (t && !t.startsWith("xl/")) t = "xl/" + t.replace(/^\/?/, "");
      map.set(s.getAttribute("name"), t);
    }
    return (this._sheets = map);
  }

  async sharedStrings() {
    if (this._shared) return this._shared;
    const doc = await this.xml("xl/sharedStrings.xml");
    const out = [];
    if (doc) for (const si of doc.getElementsByTagName("si")) {
      let s = "";                                   // rich text = several <t> runs
      for (const t of si.getElementsByTagName("t")) s += t.textContent;
      out.push(s);
    }
    return (this._shared = out);
  }

  static col(ref) {                                  // "AH12" → 33 (0-based)
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }

  /* → array of rows, each a sparse array of strings/numbers */
  async rows(sheetName, maxRows = 100000) {
    const idx = await this.sheetIndex();
    const path = idx.get(sheetName);
    if (!path) return null;
    const [doc, shared] = [await this.xml(path), await this.sharedStrings()];
    if (!doc) return null;
    const out = [];
    for (const row of doc.getElementsByTagName("row")) {
      const r = parseInt(row.getAttribute("r") || "0", 10);
      if (r > maxRows) break;
      const cells = [];
      for (const c of row.getElementsByTagName("c")) {
        const ci = XlsxFile.col(c.getAttribute("r") || "A1");
        const t = c.getAttribute("t");
        let v;
        if (t === "inlineStr") {
          v = "";
          for (const tt of c.getElementsByTagName("t")) v += tt.textContent;
        } else {
          const vn = c.getElementsByTagName("v")[0];
          if (!vn) continue;
          v = vn.textContent;
          if (t === "s") v = shared[parseInt(v, 10)] ?? "";
          else if (t === "e") continue;              // #VALUE! and friends: not data
          else if (t !== "str") { const n = Number(v); if (!Number.isNaN(n)) v = n; }
        }
        if (v !== "" && v != null) cells[ci] = v;
      }
      out[r - 1] = cells;
    }
    for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = [];
    return out;
  }
}

/* ============================================================
   SWOOD report-list → a manufacturing plan
   ============================================================ */
const SWOOD = {
  SHEETS: { parts: "PARTLIST", stock: "STOCK_CORE", edge: "EDGEBAND", hw: "HARDWARE_LIST" },

  /* strip diacritics + case so "DETALĖS KODAS" matches "detales kodas" */
  norm: (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase(),
  num(v) { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; },

  async parse(buf) {
    const wb = await XLSX.open(buf);
    const warn = [];
    const rows = await wb.rows(this.SHEETS.parts);
    if (!rows) throw new Error("No PARTLIST sheet — is this a SWOOD “Report Lists to Excel” export?");

    /* ---- header row: located by name, so extra columns can't shift us ---- */
    let hRow = -1, cCode = -1;
    for (let r = 0; r < Math.min(rows.length, 40); r++) {
      const i = (rows[r] || []).findIndex(v => this.norm(v) === "DETALES KODAS");
      if (i >= 0) { hRow = r; cCode = i; break; }
    }
    if (hRow < 0) throw new Error("PARTLIST has no “DETALĖS KODAS” column — unexpected SWOOD template");

    /* ---- columns: by NAME first, position only as a last resort ----
       These used to be fixed offsets from DETALĖS KODAS, on the assumption
       that the block is always code, name, board, L, W, KIEKIS, F, B, L, R.
       A template with one extra column — a thickness, say — shifts every
       offset, and the piece count then silently reads whatever sits where
       KIEKIS was expected. So each column is looked up by its own header and
       only falls back to the offset when the name is missing.

       The exception is L: the sheet has TWO columns called "L", the panel
       length and the left-hand edge. They are told apart by position — the
       length comes before KIEKIS, the edge after it. */
    const H = (rows[hRow] || []).map(v => this.norm(v));
    const foundBy = {};
    const byName = (key, names, fallback, lo, hi) => {
      for (const n of names) {
        const i = H.findIndex((h, idx) =>
          h === n && (lo === undefined || idx > lo) && (hi === undefined || idx < hi));
        if (i >= 0) { foundBy[key] = H[i]; return i; }
      }
      foundBy[key] = null;            // nothing named it; we are guessing
      return fallback;
    };

    const cQty = byName("qty", ["KIEKIS", "QTY", "QUANTITY", "PCS"], cCode + 5, cCode);
    const C = {
      code: cCode,
      solid: byName("solid", ["SOLIDNAME", "SOLID NAME"], cCode - 1),
      name:  byName("name",  ["DETALE", "DETAIL", "PART NAME"], cCode + 1, cCode),
      board: byName("board", ["PLOKSTE", "BOARD", "MATERIAL", "PANEL"], cCode + 2, cCode),
      len:   byName("len",   ["L", "ILGIS", "LENGTH"], cCode + 3, cCode, cQty),
      wid:   byName("wid",   ["W", "PLOTIS", "WIDTH"], cCode + 4, cCode, cQty),
      qty:   cQty,
      eF: cQty + 1, eB: cQty + 2, eL: cQty + 3, eR: cQty + 4,
      notes: byName("notes", ["NOTES", "PASTABOS", "PASTABA"], cCode + 11),
    };
    foundBy.code = H[cCode] || null;
    /* The piece count is the one that changes what the shop makes, so if it
       was guessed rather than found, say so on the preview. */
    if (!foundBy.qty) warn.push(`No “KIEKIS” column header — piece counts were read from column ${C.qty + 1}, which may be wrong`);

    /* ---- project code ---- */
    let project = "";
    for (let r = 0; r < hRow; r++) {
      const row = rows[r] || [];
      const i = row.findIndex(v => this.norm(v).startsWith("PROJEKTAS") || this.norm(v) === "PROJECT");
      if (i >= 0) { project = String(row.slice(i + 1).find(v => v) || "").trim(); if (project) break; }
    }

    /* ---- parts ---- */
    const parts = [];
    let section = "";
    for (let r = hRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const code = row[C.code], name = row[C.name];
      const len = this.num(row[C.len]), wid = this.num(row[C.wid]);
      if (!code || !name || !len || !wid) {
        // a thickness banner ("18 mm") introduces the next block of parts
        const banner = row.find(v => /^\s*\d+([.,]\d+)?\s*mm\s*$/i.test(String(v ?? "")));
        if (banner) section = String(banner).trim();
        continue;
      }
      const edges = [row[C.eF], row[C.eB], row[C.eL], row[C.eR]].map(v => (v == null ? "" : String(v).trim()));
      let board = String(row[C.board] ?? "").trim();
      if (!board) { board = section || "Unspecified"; warn.push(`${code}: no board material in the export — filed under “${board}”`); }
      parts.push({
        code: String(code).trim(),
        name: String(name).trim(),
        solid: String(row[C.solid] ?? "").trim(),
        board, l: len, w: wid,
        qty: Math.max(1, Math.round(this.num(row[C.qty]) || 1)),
        edges,
        edged: edges.some(Boolean),
        notes: String(row[C.notes] ?? "").trim(),
      });
    }
    if (!parts.length) throw new Error("PARTLIST has no part rows");
    if (!project) {                                   // fall back to the shared code prefix
      project = parts[0].code.replace(/[_-]\d+[A-Z]?$/i, "");
      warn.push(`No PROJEKTAS cell — using “${project}” from the part codes`);
    }

    const dup = parts.map(p => p.code).filter((c, i, a) => a.indexOf(c) !== i);
    if (dup.length) warn.push(`${dup.length} duplicate part code(s), e.g. ${dup[0]} — scans can't tell them apart`);

    /* ---- consumables ---- */
    const boards = await this._group(wb, this.SHEETS.stock, "MATERIAL", ["M2", "M²"], "m²");
    const edgeband = await this._group(wb, this.SHEETS.edge, "MATERIAL", ["M"], "m");
    const hardware = await this._group(wb, this.SHEETS.hw, "NAME", ["QTY"], "pcs");

    return { project, parts, boards, edgeband, hardware, warnings: warn,
             columns: { map: C, foundBy, header: H },
             totalPieces: parts.reduce((s, p) => s + p.qty, 0) };
  },

  /* Sum one sheet into {name, qty, unit} rows: find the header, then the
     label column and the quantity column by name. */
  async _group(wb, sheet, labelHdr, qtyHdrs, unit) {
    const rows = await wb.rows(sheet);
    if (!rows) return [];
    const want = qtyHdrs.map(h => this.norm(h));
    let hRow = -1, cLabel = -1, cQty = -1;
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const row = rows[r] || [];
      const li = row.findIndex(v => this.norm(v) === this.norm(labelHdr));
      if (li < 0) continue;
      const qi = row.findIndex(v => want.includes(this.norm(v)));
      if (qi < 0) continue;
      hRow = r; cLabel = li; cQty = qi; break;
    }
    if (hRow < 0) return [];
    const acc = new Map();
    for (let r = hRow + 1; r < rows.length; r++) {
      const label = String((rows[r] || [])[cLabel] ?? "").trim();
      if (!label || this.norm(label) === "GRAND TOTAL") continue;
      const q = this.num((rows[r] || [])[cQty]);
      if (!q) continue;
      acc.set(label, (acc.get(label) || 0) + q);
    }
    return [...acc].map(([name, qty]) => ({ name, qty: Math.round(qty * 1000) / 1000, unit }))
                   .sort((a, b) => b.qty - a.qty);
  },

  /* ---------- turn the parse into something manufacturable ---------- */
  /* One item per board material (qty = pieces of that board), because that is
     what gets nested, cut and counted — and it makes a scanned part increment
     the right line. Assembly/QC/Packing live on a separate module line. */
  plan(parsed, opts = {}) {
    const byBoard = new Map();
    for (const p of parsed.parts) {
      if (!byBoard.has(p.board)) byBoard.set(p.board, { board: p.board, pieces: 0, parts: [], edged: false });
      const g = byBoard.get(p.board);
      g.pieces += p.qty; g.parts.push(p); g.edged = g.edged || p.edged;
    }
    const modules = new Set();
    for (const p of parsed.parts) {
      const s = p.solid || "";
      modules.add(s.startsWith(p.name + "_") ? s.slice(p.name.length + 1) : s || p.name);
    }
    /* Stages are resolved by name, so this works on a shop's own station list
       and not just the seed's ids. A stage the shop does not have is left out
       of the route — and said out loud, because a route that quietly collapses
       to one step looks like the job is finished after cutting. */
    const warnRoute = [];
    const stage = (key, label) => {
      const st = D.stationFor(key);
      if (!st) warnRoute.push(label);
      return st;
    };
    const edgeSt = stage("edge", "Edge banding"), cncSt = stage("cnc", "CNC / drilling");
    const cutSt = D.stationFor("cut") || D.stationsOf("prod")[0];
    const cutting = opts.cutStation || (cutSt || {}).id;
    const anyEdged = [...byBoard.values()].some(g => g.edged);
    const items = [...byBoard.values()].sort((a, b) => b.pieces - a.pieces).map(g => ({
      name: g.board,
      qty: g.pieces,
      partCodes: g.parts.map(p => p.code),
      route: [cutting, ...(g.edged && edgeSt ? [edgeSt.id] : []), ...(cncSt ? [cncSt.id] : [])].filter(Boolean),
    }));
    const finalRoute = ["asm", "qc", "pack"].map(k => stage(k, {
      asm: "Assembly", qc: "Quality check", pack: "Packing" }[k])).filter(Boolean).map(st => st.id);
    /* only complain about edge banding if something actually needs it */
    const missing = warnRoute.filter(w => w !== "Edge banding" || anyEdged);
    return {
      project: parsed.project,
      items,
      moduleCount: modules.size,
      /* the cabinets themselves, by name. Assembly is counted in modules, and
         "48" means nothing to the person holding the screwdriver — these are
         what he is actually ticking off. */
      moduleNames: [...modules].sort((a, b) => a.localeCompare(b)),
      finalRoute,
      finalName: opts.finalName || "Surinkimas ir pakavimas",
      boards: parsed.boards, edgeband: parsed.edgeband, hardware: parsed.hardware,
      columns: parsed.columns, missingStages: missing,
      parts: parsed.parts, totalPieces: parsed.totalPieces,
      warnings: missing.length
        ? [...parsed.warnings, `No station matches ${missing.join(", ")} — those steps are left out of the route`]
        : parsed.warnings,
    };
  },
};

/* ============================================================
   Import dialog — pick the file, see exactly what will be made,
   then create it. Nothing is written until "Create project".
   ============================================================ */
const SwoodImport = {
  plan: null, fileName: "",
  scope: 1,          // how many of the whole project are being made
  form: null,        // name / client / due, kept across re-renders
  lineEdits: null,   // production line name → corrected name
  consEdits: null,   // consumable index → { name, qty, materialId }

  open() {
    this.plan = null; this.fileName = "";
    this.scope = 1; this.form = null; this.lineEdits = {}; this.consEdits = {};
    Modal.open(`
      <header><h2>Import SWOOD report list</h2><button class="icon-btn" data-close>✕</button></header>
      <div class="modal-body" id="sw-body">${this.pickHtml()}</div>
      <footer id="sw-foot">
        <button class="btn" data-close>Cancel</button>
        <button class="btn primary" id="sw-go" disabled>${icon("import", 14)} Create project</button>
      </footer>`, (m) => { m.classList.add("sw-modal"); this.bind(m); });
  },

  pickHtml() {
    return `<div class="sw-drop" id="sw-drop">
      <span class="ico">${icon("import", 26)}</span>
      <b>Choose the “Report Lists to Excel” file</b>
      <span class="t-caption">The .xlsm (or .xlsx) SWOOD writes next to the project — drop it here or click to browse</span>
      <input type="file" id="sw-file" accept=".xlsm,.xlsx" hidden>
    </div>`;
  },

  bind(m) {
    const drop = $("#sw-drop", m), file = $("#sw-file", m);
    if (drop) {
      drop.onclick = () => file.click();
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
      drop.ondragleave = () => drop.classList.remove("over");
      drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) this.load(e.dataTransfer.files[0], m); };
      file.onchange = () => file.files[0] && this.load(file.files[0], m);
    }
    const go = $("#sw-go", m);
    if (go) go.onclick = () => this.create(m);
  },

  async load(f, m) {
    this.fileName = f.name;
    const body = $("#sw-body", m);
    body.innerHTML = `<div class="sw-busy"><div class="sync-spinner"></div><span>Reading ${esc(f.name)}…</span></div>`;
    try {
      if (typeof DecompressionStream === "undefined")
        throw new Error("This browser can't unzip the workbook — please use an up-to-date Chrome, Edge or Safari.");
      const parsed = await SWOOD.parse(await f.arrayBuffer());
      this.plan = SWOOD.plan(parsed);
      this.scope = 1; this.lineEdits = {}; this.consEdits = {};
      this.form = { name: this.plan.project, client: "",
                    due: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) };
      this.render(m);
      $("#sw-go", m).disabled = false;
    } catch (e) {
      this.plan = null;
      body.innerHTML = `<div class="sw-error">${icon("alert", 20)}<div><b>Couldn't read that file</b>
        <span>${esc(e && e.message || String(e))}</span></div></div>${this.pickHtml()}`;
      this.bind(m);
      $("#sw-go", m).disabled = true;
    }
  },

  /* ---------- the working lists ----------
     The plan is left alone; what the dialog shows is the plan scaled by the
     scope, with the user's corrections laid over it. */

  lineRows() {
    return this.plan.items.map(it => ({
      src: it.name,
      name: this.lineEdits[it.name] !== undefined ? this.lineEdits[it.name] : it.name,
      base: it.qty,                 // what the report itself said
      qty: it.qty * this.scope,
      route: it.route,
    }));
  },

  consBase() { return [...this.plan.boards, ...this.plan.edgeband, ...this.plan.hardware]; },

  consRows() {
    return this.consBase().map((g, i) => {
      const e = this.consEdits[i] || {};
      const name = e.name !== undefined ? e.name : g.name;
      const qty = e.qty !== undefined ? e.qty : Math.round(g.qty * this.scope * 1000) / 1000;
      // an untouched row keeps following the name; once a person picks, it sticks
      const mat = e.materialId !== undefined
        ? (e.materialId ? D.material(e.materialId) : null)
        : D.matchMaterial(name);
      return { i, name, qty, base: g.qty, edited: e.qty !== undefined,
               unit: (mat && mat.unit) || g.unit, mat, chosen: e.materialId !== undefined };
    });
  },

  render(m) {
    $("#sw-body", m).innerHTML = this.previewHtml();
    this.bindPreview(m);
  },

  previewHtml() {
    const p = this.plan, f = this.form;
    const lines = this.lineRows(), cons = this.consRows();
    const linked = cons.filter(c => c.mat).length;
    const mods = p.moduleCount * this.scope;
    const pieces = p.totalPieces * this.scope;

    return `
      <div class="sw-stats">
        <div><b>${p.parts.length}</b><span>part codes</span></div>
        <div><b>${pieces}</b><span>${this.scope > 1 ? `pieces · ${p.totalPieces} × ${this.scope}` : "pieces"}</span></div>
        <div><b>${lines.length}</b><span>materials</span></div>
        <div><b>${mods}</b><span>modules</span></div>
      </div>
      ${p.warnings.length ? `<div class="sw-warn">${icon("alert", 15)}<div><b>${p.warnings.length} thing${p.warnings.length > 1 ? "s" : ""} worth a look</b>
        ${p.warnings.slice(0, 4).map(w => `<span>${esc(w)}</span>`).join("")}
        ${p.warnings.length > 4 ? `<span>…and ${p.warnings.length - 4} more</span>` : ""}</div></div>` : ""}

      ${this.columnsHtml(p)}

      <div class="field"><label>Project name</label><input class="input" id="sw-name" value="${esc(f.name)}" autocomplete="off">
        <span class="t-caption" id="sw-namewarn" style="color:var(--red);min-height:15px"></span></div>
      <div class="row" style="gap:12px">
        <div class="field grow"><label>Client</label>
          <input class="input" id="sw-client" value="${esc(f.client)}" placeholder="Optional" autocomplete="off"
            list="shared-customers">${typeof Bridge !== "undefined" ? Bridge.datalistHtml() : ""}</div>
        <div class="field"><label>Due date</label><input class="input" type="date" id="sw-due" value="${esc(f.due)}"></div>
        <div class="field sw-scope"><label>How many?</label>
          <input class="input" type="number" min="1" step="1" id="sw-scope" value="${this.scope}"></div>
      </div>
      ${this.scope > 1 ? `<div class="sw-scope-note">${icon("info", 14)}
        <span>The report describes one project. Everything below is multiplied by <b>${this.scope}</b> —
        pieces, modules and materials — so a scanned label counts up to ${this.scope}× as many.</span></div>` : ""}

      <div class="t-label">Production lines it will create</div>
      <div class="sw-table">
        ${lines.map(l => `<div class="sw-row sw-edit">
          <input class="input sw-in" data-line="${esc(l.src)}" value="${esc(l.name)}" autocomplete="off">
          <span class="sw-route">${l.route.map(id => esc((D.station(id) || {}).name || id)).join(" → ")}</span>
          <span class="qty-pill ${this.scope > 1 ? "stacked" : ""}">${l.qty} pcs${this.scope > 1
            ? `<span class="sw-arith">${l.base} × ${this.scope}</span>` : ""}</span></div>`).join("")}
        ${p.finalRoute.length ? `<div class="sw-row sw-edit">
          <span class="sw-in-static"><b>${esc(p.finalName)}</b></span>
          <span class="sw-route">${p.finalRoute.map(id => esc((D.station(id) || {}).name || id)).join(" → ")}</span>
          <span class="qty-pill ${this.scope > 1 ? "stacked" : ""}">${mods} modules${this.scope > 1
            ? `<span class="sw-arith">${p.moduleCount} × ${this.scope}</span>` : ""}</span></div>` : ""}
      </div>

      <div class="t-label" style="display:flex;align-items:center;gap:8px">
        <span class="grow">Materials &amp; hardware — ${linked} of ${cons.length} matched to stock</span>
        <button class="link" id="sw-rematch" type="button">Match again</button>
      </div>
      <div class="t-caption" style="margin:-4px 0 6px">
        A report list carries the names the designer typed. Correct anything here and point it at the right stock item.
      </div>
      <div id="sw-cons">${this.consHtml(cons)}</div>`;
  },

  /* What was actually read out of the workbook. Folded away, because most of
     the time it is uninteresting — but when a count looks wrong, this is the
     only thing that answers "where did that number come from". */
  columnsHtml(p) {
    const c = p.columns;
    if (!c) return "";
    const FIELDS = [["code", "Part code"], ["name", "Part name"], ["board", "Board"],
                    ["len", "Length"], ["wid", "Width"], ["qty", "Quantity"]];
    const guessed = FIELDS.filter(([k]) => !c.foundBy[k]).length;
    const sample = p.parts.slice(0, 3);
    return `<details class="sw-cols" ${guessed ? "open" : ""}>
      <summary>What it read from your file${guessed
        ? ` — <b style="color:var(--orange)">${guessed} column${guessed > 1 ? "s" : ""} guessed by position</b>`
        : ""}</summary>
      <div class="sw-cols-body">
        <div class="sw-cols-grid">
          ${FIELDS.map(([k, label]) => `<div>
            <span>${label}</span>
            <b class="${c.foundBy[k] ? "" : "guess"}">${c.foundBy[k]
              ? esc(c.foundBy[k])
              : `column ${(c.map[k] ?? 0) + 1} — by position`}</b>
          </div>`).join("")}
        </div>
        ${sample.length ? `<div class="t-caption" style="margin-top:8px">First rows as understood:</div>
          <div class="sw-cols-sample">
            ${sample.map(x => `<div><span class="mono">${esc(x.code)}</span>
              <span>${esc(x.board)}</span>
              <span>${x.l}×${x.w}</span>
              <b>${x.qty} pcs</b></div>`).join("")}
          </div>` : ""}
      </div>
    </details>`;
  },

  consHtml(cons) {
    if (!cons.length) return `<div class="sw-table"><span class="t-caption" style="padding:10px 12px">None listed in the export</span></div>`;
    const mats = [...Store.state.materials].sort((a, b) => a.name.localeCompare(b.name));
    return `<div class="sw-table sw-scroll">
      ${cons.map(c => `<div class="sw-row sw-cons-row">
        <input class="input sw-in" data-cname="${c.i}" value="${esc(c.name)}" autocomplete="off">
        <input class="input sw-qty" type="number" min="0" step="any" data-cqty="${c.i}" value="${c.qty}">
        <span class="sw-unit">${esc(c.unit)}${this.scope > 1
          ? `<span class="sw-arith">${c.edited ? "typed" : `${c.base} × ${this.scope}`}</span>` : ""}</span>
        <span class="sw-link ${c.mat ? "on" : ""}">${Picker.html("swl-" + c.i, {
          value: c.mat ? c.mat.id : "",
          placeholder: `Search ${mats.length} stock items…`,
          empty: "— not in the warehouse —",
          options: mats.map(m => ({ value: m.id, label: m.name, sub: m.sku || "" })),
          attrs: `data-clink="${c.i}"`,
        })}</span>
      </div>`).join("")}
    </div>`;
  },

  bindPreview(m) {
    const name = $("#sw-name", m), warn = $("#sw-namewarn", m), go = $("#sw-go", m);
    const check = () => {
      const v = name.value.trim();
      const bad = !v ? "Give the project a name" : D.projectNameTaken(v) ? "A project with that name already exists" : "";
      warn.textContent = bad; go.disabled = !!bad;
      return !bad;
    };
    name.oninput = () => { this.form.name = name.value; check(); };
    check();
    $("#sw-client", m).oninput = (e) => { this.form.client = e.target.value; };
    $("#sw-due", m).onchange = (e) => { this.form.due = e.target.value; };

    /* Scope changes every quantity, so a quantity somebody typed for the old
       scope is no longer what they meant — those are dropped, while the names
       and stock links they corrected are kept. */
    const scope = $("#sw-scope", m);
    scope.onchange = () => {
      const raw = scope.valueAsNumber;
      const v = Math.max(1, Math.round(isNaN(raw) ? 1 : raw));
      if (v === this.scope) return;
      this.scope = v;
      for (const k of Object.keys(this.consEdits)) delete this.consEdits[k].qty;
      this.render(m);
      const again = $("#sw-scope", m);
      if (again) again.focus();
    };

    $$("[data-line]", m).forEach(inp => inp.onchange = () => {
      this.lineEdits[inp.dataset.line] = inp.value.trim() || inp.dataset.line;
    });

    Picker.bind(m);
    this.bindCons(m);
    $("#sw-rematch", m).onclick = () => {
      for (const k of Object.keys(this.consEdits)) delete this.consEdits[k].materialId;
      this.render(m);
    };
  },

  bindCons(m) {
    const edit = (i) => (this.consEdits[i] = this.consEdits[i] || {});
    const repaint = () => {
      const cons = this.consRows();
      $("#sw-cons", m).innerHTML = this.consHtml(cons);
      Picker.bind(m);
      this.bindCons(m);
      const label = $(".t-label .grow", m);
      if (label) label.textContent = `Materials & hardware — ${cons.filter(c => c.mat).length} of ${cons.length} matched to stock`;
    };
    $$("[data-cname]", m).forEach(inp => inp.onchange = () => {
      edit(inp.dataset.cname).name = inp.value.trim();
      repaint();                       // a corrected name may now find its stock
    });
    $$("[data-cqty]", m).forEach(inp => inp.onchange = () => {
      // valueAsNumber, not Number(value): the field renders in the browser's
      // locale and a comma decimal would parse as NaN
      const v = inp.valueAsNumber;
      edit(inp.dataset.cqty).qty = isNaN(v) ? 0 : Math.max(0, v);
    });
    $$("[data-clink]", m).forEach(sel => sel.onchange = () => {
      edit(sel.dataset.clink).materialId = sel.value || null;
      repaint();
    });
  },

  create(m) {
    if (!this.plan) return;
    const name = $("#sw-name", m).value.trim();
    if (D.projectNameTaken(name) || !name) return;
    const dueVal = $("#sw-due", m).value;
    const cons = this.consRows()
      .filter(c => c.qty > 0 && c.name)
      .map(c => ({ name: c.name, qty: c.qty, unit: c.unit, materialId: c.mat ? c.mat.id : null }));
    const order = M.createFromSwood(this.plan, {
      product: name,
      client: $("#sw-client", m).value.trim(),
      due: dueVal ? new Date(dueVal + "T12:00:00").getTime() : undefined,
      notes: `Imported from SWOOD (${this.fileName})${this.scope > 1 ? ` — ×${this.scope}` : ""}`,
      scope: this.scope,
      consumables: cons,
      lineNames: this.lineEdits,
    }, App.me.id);
    if (typeof Bridge !== "undefined") {
      const cid = Bridge.resolveClient(order.client);
      if (cid) { order.customerId = cid; Store.save(); }
    }
    Modal.close();
    App.navigate("projects");
    Drawer.open(order.id);
    Toast.show(`${order.num} created — ${order.parts.length} part codes${this.scope > 1 ? ` ×${this.scope}` : ""} across ${this.plan.items.length} materials`,
      { emoji: "import", ms: 5000 });
  },
};
