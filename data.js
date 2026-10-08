/* ============================================================
   ShopFlow — Data layer
   localStorage-persisted store, seed data, domain logic.

   v3 model (MRPEasy-inspired):
   - orders have items (article lines with quantities)
   - each item's ops form parallel LANES (part groups, e.g.
     Facades / Carcass) that merge into a shared final lane
   - ops track qtyDone: pieces flow downstream as they finish
   - order.type: "prod" | "eng" (engineering projects)
   - portfolios group orders + projects
   ============================================================ */
"use strict";

const DB_KEY = "shopflow.v1";
const BK_KEY = "shopflow.backups";   // rolling local auto-backups (restore points)
const BK_MAX = 6;                    // keep the last N automatic snapshots on this device
const BK_KEEP_MAX = 24;              // …plus up to this many named restore points, never auto-evicted
/* Counting snapshots was the wrong budget: 18 copies of a 400 KB document is
   7 MB. Against localStorage that was fatal; the vault has room, so the
   ceiling is generous rather than mean. */
const BK_BUDGET = 20_000_000;        // characters of JSON across ALL local backups (vault)
const BK_BUDGET_LS = 1_200_000;      // …and the tight one, for the localStorage fallback
const QUOTA_GUESS = 5_000_000;       // what browsers give an origin in localStorage
const IDX_KEY = "shopflow.index";    // a few KB the hub can read without the whole document

/* ============================================================
   Vault — the local store that actually has room

   localStorage gives the WHOLE origin about 5 MB, shared with the hub, offers
   and invoices, and a shop's document plus its restore points went past that.
   IndexedDB is budgeted against free disk instead — hundreds of megabytes —
   so that is where the document lives now. localStorage keeps only a small
   index for the hub, and remains the fallback when IndexedDB is unavailable
   (some private-browsing modes), where the old tight limits still apply.
   ============================================================ */
const VAULT_DB = "shopflow-vault", VAULT_STORE = "kv";
const Vault = {
  _db: null,
  supported() { return typeof indexedDB !== "undefined" && indexedDB !== null; },
  open() {
    if (this._db) return Promise.resolve(this._db);
    if (!this.supported()) return Promise.reject(new Error("no indexedDB"));
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(VAULT_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(VAULT_STORE)) db.createObjectStore(VAULT_STORE);
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("indexedDB blocked"));
    });
  },
  async _tx(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VAULT_STORE, mode);
      const req = fn(tx.objectStore(VAULT_STORE));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("aborted"));
      if (req) req.onsuccess = () => resolve(req.result);
      else tx.oncomplete = () => resolve();
    });
  },
  get(k) { return this._tx("readonly", (s) => s.get(k)); },
  set(k, v) { return this._tx("readwrite", (s) => s.put(v, k)); },
  del(k) { return this._tx("readwrite", (s) => s.delete(k)); },
  keys() { return this._tx("readonly", (s) => s.getAllKeys()); },
  async size() {
    try {
      const e = await navigator.storage.estimate();
      return { used: e.usage || 0, quota: e.quota || 0 };
    } catch (_) { return { used: 0, quota: 0 }; }
  },
  /* usage() has to answer synchronously for a render, so the browser's own
     estimate is fetched in the background and read from here. */
  est: null,
  refresh() { this.size().then(e => { this.est = e; }).catch(() => {}); return this.est; },
};
const EXPORT_NAG_DAYS = 14;          // remind to download a backup after this long
const DAY = 86400000;

/* ---------- PIN hashing ----------
   PINs are never stored or exported in plaintext. We keep a per-install
   random salt + a SHA-256 digest of salt+PIN. A 4-digit PIN is a small
   keyspace (10k) so this is obfuscation against casual snooping, not
   strong crypto — it removes plaintext exposure and the reveal button. */
function sha256(ascii) {
  function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
  const mp = Math.pow, maxWord = mp(2, 32);
  let result = "", words = [], i, j;
  const asciiBitLength = ascii.length * 8;
  let hash = sha256.h = sha256.h || [];
  const k = sha256.k = sha256.k || [];
  let primeCounter = k.length;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (mp(candidate, .5) * maxWord) | 0;
      k[primeCounter++] = (mp(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += "\x80";
  while (ascii.length % 64 - 56) ascii += "\x00";
  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return "";
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;
  for (j = 0; j < words.length;) {
    const w = words.slice(j, j += 16);
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const t1 = hash[7]
        + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))
          ) | 0);
      const t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(t1 + t2) | 0].concat(hash);
      hash[4] = (hash[4] + t1) | 0;
    }
    for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (i = 0; i < 8; i++)
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? 0 : "") + b.toString(16);
    }
  return result;
}
function randSalt() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  return (Math.random().toString(36) + Math.random().toString(36)).replace(/[^a-z0-9]/g, "").slice(0, 24);
}
function hashPin(pin, salt) { return sha256((salt || "") + "$" + String(pin)); }

/* ---------- Avatar palette (Apple-ish gradients) ---------- */
const AV_COLORS = [
  ["#ff9f0a", "#ff6b22"], ["#0a84ff", "#0055d4"], ["#30d158", "#1fa946"],
  ["#bf5af2", "#8e2de2"], ["#ff375f", "#d61f47"], ["#64d2ff", "#2fa8e0"],
  ["#ffd60a", "#e0a800"], ["#5e5ce6", "#3634a3"], ["#ff453a", "#c22b22"],
  ["#30b0c7", "#1d8a9e"],
];

const STATION_ICONS = ["🪚","📏","⚙️","🔩","🌀","🎨","🔍","📦","🪵","🧰","🪛","🗜️","🚪","🪞","🛠️","✨"];
const MATERIAL_ICONS = ["🟫","🪵","🧻","🧴","🧲","🔩","🪝","🎨","🧪","📦","🪟","⬜️"];
const PORTFOLIO_ICONS = ["📁","☕️","🏨","🏠","🏢","📦","🛋","🚪","🍽","🧒"];

/* ---------- Stations (production + engineering stages) ---------- */
const SEED_STATIONS = [
  { id: "cut",  name: "Cutting",        icon: "🪚", ic: "saw",    estMins: 90,  kind: "prod" },
  { id: "edge", name: "Edge Banding",   icon: "📏", ic: "ruler",  estMins: 60,  kind: "prod" },
  { id: "cnc",  name: "CNC / Drilling", icon: "⚙️", ic: "drill",  estMins: 75,  kind: "prod" },
  { id: "asm",  name: "Assembly",       icon: "🔩", ic: "wrench", estMins: 150, kind: "prod" },
  { id: "sand", name: "Sanding",        icon: "🌀", ic: "disc",   estMins: 60,  kind: "prod" },
  { id: "fin",  name: "Finishing",      icon: "🎨", ic: "brush",  estMins: 120, kind: "prod" },
  { id: "qc",   name: "Quality Check",  icon: "🔍", ic: "badge",  estMins: 30,  kind: "prod" },
  { id: "pack", name: "Packing",        icon: "📦", ic: "box",    estMins: 45,  kind: "prod" },
];
const ENG_STATIONS = [
  { id: "eg-brief",  name: "Brief",              icon: "📋", ic: "bulb",      estMins: 60,  kind: "eng" },
  { id: "eg-meas",   name: "Measurement",        icon: "📐", ic: "compass",   estMins: 120, kind: "eng" },
  { id: "eg-design", name: "Design & Drawings",  icon: "✏️", ic: "pencil",    estMins: 480, kind: "eng" },
  { id: "eg-appr",   name: "Client Approval",    icon: "🤝", ic: "handshake", estMins: 60,  kind: "eng" },
  { id: "eg-cam",    name: "CNC Programs",       icon: "💾", ic: "cpu",       estMins: 180, kind: "eng" },
  { id: "eg-hand",   name: "Handoff to Production", icon: "🏭", ic: "factory", estMins: 30, kind: "eng" },
];
const STATION_IC_KEYS = ["saw", "ruler", "drill", "wrench", "disc", "brush", "badge", "box", "hammer", "toolbox", "bulb", "compass", "pencil", "handshake", "cpu", "factory", "door", "sparkles"];
const MATERIAL_IC_KEYS = ["layers", "roll", "bottle", "screw", "flask", "box", "square", "toolbox"];
const PORTFOLIO_IC_KEYS = ["folder", "cup", "building", "home", "bed", "door", "child", "box", "archive", "sparkles"];

/* ---------- Articles (standard products with lane routings) ----------
   Each lane = a part group produced in parallel (Facades, Carcass…).
   The lane with group:null is the shared final lane (assembly → pack)
   and starts once every part lane has produced pieces.
   mpu = minutes per unit. */
function seedArticles() {
  return [
    { id: "a-bc600", sku: "BC-600", name: "Base cabinet 600", unit: "pcs", lanes: [
      { group: "Carcass", route: [{ stationId: "cut", mpu: 8 }, { stationId: "edge", mpu: 6 }, { stationId: "cnc", mpu: 5 }] },
      { group: "Facades", route: [{ stationId: "cut", mpu: 6 }, { stationId: "edge", mpu: 5 }, { stationId: "sand", mpu: 4 }, { stationId: "fin", mpu: 8 }] },
      { group: null, route: [{ stationId: "asm", mpu: 15 }, { stationId: "qc", mpu: 3 }, { stationId: "pack", mpu: 5 }] },
    ]},
    { id: "a-wc800", sku: "WC-800", name: "Wall cabinet 800", unit: "pcs", lanes: [
      { group: "Carcass", route: [{ stationId: "cut", mpu: 7 }, { stationId: "edge", mpu: 5 }, { stationId: "cnc", mpu: 4 }] },
      { group: "Facades", route: [{ stationId: "cut", mpu: 5 }, { stationId: "edge", mpu: 4 }, { stationId: "fin", mpu: 7 }] },
      { group: null, route: [{ stationId: "asm", mpu: 12 }, { stationId: "qc", mpu: 3 }, { stationId: "pack", mpu: 4 }] },
    ]},
    { id: "a-tb160", sku: "TB-O160", name: "Oak table 1600", unit: "pcs", lanes: [
      { group: "Tops", route: [{ stationId: "cut", mpu: 20 }, { stationId: "sand", mpu: 15 }, { stationId: "fin", mpu: 25 }] },
      { group: "Frames & legs", route: [{ stationId: "cut", mpu: 15 }, { stationId: "cnc", mpu: 10 }] },
      { group: null, route: [{ stationId: "asm", mpu: 20 }, { stationId: "qc", mpu: 5 }, { stationId: "pack", mpu: 10 }] },
    ]},
  ];
}

/* ---------- Warehouse seed ---------- */
function seedMaterials() {
  return [
    { id: "mat1",  sku: "MDF-18",  name: "MDF board 18 mm",        unit: "pcs",    qty: 34,  minQty: 10,  location: "A1", icon: "🟫", supplierId: "sup1" },
    { id: "mat2",  sku: "PLY-12",  name: "Birch plywood 12 mm",    unit: "pcs",    qty: 18,  minQty: 8,   location: "A2", icon: "🪵", supplierId: "sup1" },
    { id: "mat3",  sku: "OAK-20",  name: "Oak panel 20 mm",        unit: "pcs",    qty: 12,  minQty: 6,   location: "A3", icon: "🪵", supplierId: "sup1" },
    { id: "mat4",  sku: "EB-W23",  name: "Edge banding, white 23 mm", unit: "m",   qty: 240, minQty: 100, location: "B1", icon: "🧻", supplierId: "sup1" },
    { id: "mat5",  sku: "EB-O23",  name: "Edge banding, oak 23 mm", unit: "m",     qty: 65,  minQty: 80,  location: "B1", icon: "🧻", supplierId: "sup1" },
    { id: "mat6",  sku: "LAC-M",   name: "Matte lacquer",          unit: "L",      qty: 2,   minQty: 10,  location: "C2", icon: "🧴", supplierId: "sup3" },
    { id: "mat7",  sku: "GLU-D3",  name: "Wood glue D3",           unit: "L",      qty: 14,  minQty: 5,   location: "C1", icon: "🧴", supplierId: "sup3" },
    { id: "mat8",  sku: "HNG-HET", name: "Hettich hinges",         unit: "pcs",    qty: 260, minQty: 100, location: "D4", icon: "🪝", supplierId: "sup2" },
    { id: "mat9",  sku: "SLD-500", name: "Drawer slides 500 mm",   unit: "pairs",  qty: 42,  minQty: 20,  location: "D2", icon: "🔩", supplierId: "sup2" },
    { id: "mat10", sku: "SCR-435", name: "Screws 4×35",            unit: "boxes",  qty: 9,   minQty: 4,   location: "D1", icon: "📦", supplierId: "sup2" },
    { id: "mat11", sku: "SND-180", name: "Sandpaper P180",         unit: "sheets", qty: 55,  minQty: 40,  location: "C3", icon: "🧻", supplierId: "sup3" },
  ];
}

function seedSuppliers() {
  return [
    { id: "sup1", name: "Medienos centras", contact: "Rimas Petraitis", email: "uzsakymai@medienoscentras.lt", phone: "+370 600 11223", leadDays: 5, notes: "Boards and edge banding. Cut-off for next-day delivery is 14:00." },
    { id: "sup2", name: "Hettich Lietuva",  contact: "Agnė Kazlauskienė", email: "sales@hettich.lt",           phone: "+370 601 44556", leadDays: 10, notes: "Hinges and slides. Orders under €300 carry a delivery fee." },
    { id: "sup3", name: "Dažų ir lakų namai", contact: "Tomas Verba",     email: "info@lakunamai.lt",          phone: "+370 602 77889", leadDays: 3, notes: "" },
  ];
}

function seedPurchases(now) {
  return [
    { id: "po1", num: "PO-1001", supplierId: "sup1", status: "sent", createdAt: now - 4 * DAY, createdBy: "m2",
      sentAt: now - 4 * DAY, expectedAt: now + 1 * DAY, receivedAt: null, notes: "",
      lines: [
        { id: "pl1", materialId: "mat5", qty: 200, received: 0 },
        { id: "pl2", materialId: "mat2", qty: 20,  received: 0 },
      ] },
    { id: "po2", num: "PO-1002", supplierId: "sup3", status: "draft", createdAt: now - 6 * 3600000, createdBy: "m2",
      sentAt: null, expectedAt: null, receivedAt: null, notes: "Waiting on a price for the matte lacquer.",
      lines: [{ id: "pl3", materialId: "mat6", qty: 20, received: 0 }] },
  ];
}

function seedStockMoves() {
  const now = Date.now();
  return [
    { id: "sm1", ts: now - 5 * DAY, materialId: "mat1", delta: +40, note: "Delivery — Medienos centras", who: "m2" },
    { id: "sm2", ts: now - 4 * DAY, materialId: "mat1", delta: -24, note: "Consumed for WO-1041", orderId: "o1", who: "m3" },
    { id: "sm3", ts: now - 4 * DAY, materialId: "mat4", delta: -120, note: "Consumed for WO-1041", orderId: "o1", who: "m4" },
    { id: "sm4", ts: now - 3 * DAY, materialId: "mat3", delta: -16, note: "Consumed for WO-1043", orderId: "o3", who: "m3" },
    { id: "sm5", ts: now - 2 * DAY, materialId: "mat8", delta: +100, note: "Delivery — Hettich", who: "m2" },
    { id: "sm6", ts: now - 2 * DAY, materialId: "mat6", delta: -3, note: "Stocktake correction", who: "m2" },
    { id: "sm7", ts: now - 1 * DAY, materialId: "mat1", delta: -8, note: "Consumed for WO-1042", orderId: "o2", who: "m3" },
  ];
}

let lineSeq = 1;
const mkLine = (materialId, qty, consumed) => ({
  id: "ln" + (lineSeq++), materialId, qty,
  consumed: !!consumed, consumedAt: consumed ? Date.now() - 3 * DAY : null, consumedBy: consumed ? "m3" : null,
});
function seedOrderLines(orderId) {
  switch (orderId) {
    case "o1": return [mkLine("mat1", 24, true), mkLine("mat4", 120, true), mkLine("mat8", 48), mkLine("mat9", 12)];
    case "o2": return [mkLine("mat1", 8, true), mkLine("mat5", 40)];
    case "o3": return [mkLine("mat3", 16, true), mkLine("mat6", 6)]; // lacquer shortage → the block
    case "o4": return [mkLine("mat1", 6)];
    case "o5": return [mkLine("mat1", 9), mkLine("mat4", 60)];
    case "o12": return [mkLine("mat1", 40), mkLine("mat4", 200)];
    default: return [];
  }
}

const uid = (p) => p + Math.random().toString(36).slice(2, 9);
const esc0 = (v) => String(v ?? "");   // activity text is plain, escaped at render time

/* Build ops for an item from an article's lanes.
   prog: `${group||"_"}/${stationId}` -> [status, qtyDone, who, loggedMins, blockNote] */
function opsFromArticle(article, item, prog = {}) {
  const now = Date.now();
  const ops = [];
  for (const lane of article.lanes) {
    for (const r of lane.route) {
      const key = `${lane.group || "_"}/${r.stationId}`;
      const [status = "queued", qtyDone = 0, who = null, logged = 0, blockNote = null] = prog[key] || [];
      ops.push({
        id: uid("op"), itemId: item.id, group: lane.group,
        stationId: r.stationId, estMins: Math.max(5, Math.round(r.mpu * item.qty)),
        status, qtyDone: status === "done" ? item.qty : qtyDone,
        assigneeId: who, loggedMs: logged * 60000,
        startedAt: status === "running" ? now - 22 * 60000 : null,
        completedAt: status === "done" ? now - 2 * DAY : null,
        blockNote,
      });
    }
  }
  return ops;
}

/* ---------- Whiteboard starter content ---------- */
function seedBoard(members, lt) {
  const by = (i) => members[i % members.length].id;
  const now = Date.now();
  const T = lt
    ? { name: "Idėjų lenta", title: "Northwood Furniture — idėjų lenta",
        s1: "Galandinti obliaus peilius kas penktadienį", s2: "Atraižų lentyna prie CNC — naudoti >300 mm", s3: "Dažyklai reikia geresnės ventiliacijos!",
        th: ["Staklės", "Aptarnauta", "Kitas kartas"], tr1: ["CNC", "2026-06-10", "2026-09-10"], tr2: ["Obliavimo", "2026-05-02", "2026-08-02"],
        w1: "Idėja 💡", w2: "Išbandom viename užsakyme", w3: "Tampa standartu ✅" }
    : { name: "Shop improvement board", title: "Shop improvement board",
        s1: "Sharpen planer blades every Friday", s2: "Offcut shelf near CNC — reuse >300 mm pieces", s3: "Lacquer room needs better extraction!",
        th: ["Machine", "Last service", "Next due"], tr1: ["CNC", "2026-06-10", "2026-09-10"], tr2: ["Planer", "2026-05-02", "2026-08-02"],
        w1: "Idea 💡", w2: "Try it on one order", w3: "Make it standard ✅" };
  const els = [
    { id: uid("we"), type: "text", x: 40, y: 16, w: 420, h: 48, color: 6, text: T.title, by: by(0), ts: now - 6 * DAY },
    { id: uid("we"), type: "sticky", x: 40, y: 90, w: 180, h: 180, color: 0, text: T.s1, by: by(2), ts: now - 5 * DAY },
    { id: uid("we"), type: "sticky", x: 244, y: 90, w: 180, h: 180, color: 4, text: T.s2, by: by(4), ts: now - 4 * DAY },
    { id: uid("we"), type: "sticky", x: 448, y: 90, w: 180, h: 180, color: 2, text: T.s3, by: by(5), ts: now - 2 * DAY },
    { id: uid("we"), type: "table", x: 40, y: 320, w: 360, h: 0, color: 6, text: "", rows: [T.th, T.tr1, T.tr2], by: by(1), ts: now - 3 * DAY },
    { id: "wf1-" + (lt ? "lt" : "en"), type: "shape", x: 470, y: 320, w: 190, h: 64, color: 4, kind: "pill", text: T.w1, by: by(0), ts: now - 3 * DAY },
    { id: "wf2-" + (lt ? "lt" : "en"), type: "shape", x: 470, y: 424, w: 190, h: 64, color: 0, kind: "rect", text: T.w2, by: by(0), ts: now - 3 * DAY },
    { id: "wf3-" + (lt ? "lt" : "en"), type: "shape", x: 470, y: 528, w: 190, h: 64, color: 3, kind: "rect", text: T.w3, by: by(0), ts: now - 3 * DAY },
  ];
  const conns = [
    { id: uid("wc"), from: "wf1-" + (lt ? "lt" : "en"), to: "wf2-" + (lt ? "lt" : "en") },
    { id: uid("wc"), from: "wf2-" + (lt ? "lt" : "en"), to: "wf3-" + (lt ? "lt" : "en") },
  ];
  return { id: uid("wb"), name: T.name, createdBy: members[0].id, createdAt: now - 6 * DAY, updatedAt: now - 2 * DAY, els, conns, visibility: "team", memberIds: [] };
}

/* ---------- Planner (general PM) seed ---------- */
const GP_COLORS = ["blue", "indigo", "teal", "purple", "orange", "green", "red", "gray"];
function defaultStages() {
  return [
    { id: uid("gs"), name: "Backlog", color: "gray", done: false },
    { id: uid("gs"), name: "To do", color: "blue", done: false },
    { id: uid("gs"), name: "In progress", color: "orange", done: false },
    { id: uid("gs"), name: "In review", color: "purple", done: false },
    { id: uid("gs"), name: "Done", color: "green", done: true },
  ];
}
function seedPlanner(members) {
  const now = Date.now();
  const by = (i) => (members[i % members.length] || members[0]).id;
  const mk = (name, key, color, icon, tasks) => {
    const stages = defaultStages();
    const S = (n) => stages[n].id;
    let ord = 0;
    return {
      id: uid("gp"), name, key, color, icon, desc: "",
      createdBy: by(0), createdAt: now - 20 * DAY, archived: false,
      stages, labels: [
        { id: uid("gl"), name: "Bug", color: "red" }, { id: uid("gl"), name: "Design", color: "purple" },
        { id: uid("gl"), name: "Urgent", color: "orange" },
      ],
      tasks: tasks.map(([title, si, who, dueD, prio, subs]) => ({
        id: uid("gt"), title, desc: "", stageId: S(si), assigneeId: who, due: dueD == null ? null : now + dueD * DAY,
        start: null, priority: prio || "normal", labelIds: [],
        subtasks: (subs || []).map(t => ({ id: uid("gk"), title: t[0], done: !!t[1] })),
        comments: [], createdBy: by(0), createdAt: now - 18 * DAY, ord: ord++,
      })),
    };
  };
  return [
    mk("Website relaunch", "WEB", "blue", "sparkles", [
      ["Finalise sitemap", 4, by(0), -2, "high", [["Home", true], ["Products", true], ["Contact", false]]],
      ["Write homepage copy", 2, by(1), 3, "normal"],
      ["Design system in Figma", 2, by(1), 5, "high"],
      ["Set up CMS", 1, by(0), 9, "normal"],
      ["Photo shoot — workshop", 3, by(1), 1, "high", [["Book photographer", true], ["Shot list", false]]],
      ["Migrate old blog posts", 0, null, 14, "low"],
      ["Launch checklist", 1, by(0), 12, "normal"],
    ]),
    mk("Q3 marketing", "MKT", "orange", "flame", [
      ["Plan autumn campaign", 2, by(0), 2, "high"],
      ["Instagram content calendar", 1, by(1), 6, "normal", [["Week 1", true], ["Week 2", false], ["Week 3", false]]],
      ["Email newsletter #8", 3, by(1), -1, "high"],
      ["Trade fair booth brief", 0, by(0), 20, "normal"],
      ["Review ad budget", 4, by(0), -3, "normal"],
    ]),
    mk("Office move", "OPS", "teal", "building", [
      ["Get quotes from movers", 4, by(0), -5, "normal"],
      ["New floor plan", 2, by(1), 4, "normal", [["Measure space", true], ["Desk layout", false]]],
      ["Update address everywhere", 1, by(0), 10, "low"],
      ["Internet + phones", 1, by(0), 7, "high"],
    ]),
  ];
}

function seedData() {
  const now = Date.now();
  const members = [
    { id: "m1", name: "Tomas", trade: "Owner",         role: "manager", pin: "1234", color: 1 },
    { id: "m2", name: "Eglė",     trade: "Production Manager", role: "manager", pin: "5678", color: 3 },
    { id: "m8", name: "Rūta",     trade: "Design & Drawings", role: "engineer", pin: "6789", color: 7, station: "eg-design" },
    { id: "m3", name: "Andrius",  trade: "Cutting & Panels", role: "worker", pin: "1111", color: 0, station: "cut" },
    { id: "m4", name: "Lukas",    trade: "Edge & CNC",     role: "worker", pin: "2222", color: 5, station: "cnc" },
    { id: "m5", name: "Jonas",    trade: "Assembly",       role: "worker", pin: "3333", color: 2, station: "asm" },
    { id: "m6", name: "Milda",    trade: "Finishing",      role: "worker", pin: "4444", color: 4, station: "fin" },
    { id: "m7", name: "Greta",    trade: "QC & Packing",   role: "worker", pin: "5555", color: 9, station: "qc" },
  ];

  const articles = seedArticles();
  const artOf = (id) => articles.find(a => a.id === id);

  /* Flat ops builder for custom orders (single General item, one lane) */
  let opSeq = 1;
  const mkOps = (itemId, specs) => specs.map(([st, status, who, logged, qtyDone]) => {
    const stn = SEED_STATIONS.find(s => s.id === st);
    return {
      id: "op" + (opSeq++), itemId, group: null,
      stationId: st, estMins: stn.estMins,
      status: status || "queued",
      qtyDone: qtyDone ?? 0,
      assigneeId: who || null,
      loggedMs: (logged || 0) * 60000,
      startedAt: status === "running" ? now - 22 * 60000 : null,
      completedAt: status === "done" ? now - 3 * DAY : null,
      blockNote: null,
    };
  });
  /* single-item custom order helper */
  const flat = (id, qty, specs) => {
    const item = { id: id + "-it0", articleId: null, name: "General", qty };
    const ops = mkOps(item.id, specs.map(s => {
      // done ops carry full qty
      if (s[1] === "done") return [...s.slice(0, 4), qty];
      return s;
    }));
    return { items: [item], ops };
  };

  /* ---- o1: standard kitchen from articles, lanes mid-flow ---- */
  const o1it1 = { id: "o1-it1", articleId: "a-bc600", name: "Base cabinet 600", qty: 8 };
  const o1it2 = { id: "o1-it2", articleId: "a-wc800", name: "Wall cabinet 800", qty: 4 };
  const o1ops = [
    ...opsFromArticle(artOf("a-bc600"), o1it1, {
      "Carcass/cut": ["done", 8, "m3", 70], "Carcass/edge": ["done", 8, "m4", 50], "Carcass/cnc": ["paused", 5, "m4", 40],
      "Facades/cut": ["done", 8, "m3", 50], "Facades/edge": ["done", 8, "m4", 40], "Facades/sand": ["done", 8, "m6", 35], "Facades/fin": ["done", 8, "m6", 70],
      "_/asm": ["running", 3, "m5", 95],
    }),
    ...opsFromArticle(artOf("a-wc800"), o1it2, {
      "Carcass/cut": ["done", 4, "m3", 30],
      "Facades/cut": ["done", 4, "m3", 22],
    }),
  ];

  /* ---- o3: rush tables from article, finishing blocked ---- */
  const o3it = { id: "o3-it1", articleId: "a-tb160", name: "Oak table 1600", qty: 8 };
  const o3ops = opsFromArticle(artOf("a-tb160"), o3it, {
    "Tops/cut": ["done", 8, "m3", 160], "Tops/sand": ["done", 8, "m6", 75],
    "Tops/fin": ["blocked", 3, "m6", 40, "Out of matte lacquer — delivery expected tomorrow"],
    "Frames & legs/cut": ["done", 8, "m3", 60], "Frames & legs/cnc": ["done", 8, "m4", 45],
  });

  /* ---- o12: standard stock batch, all queued ---- */
  const o12it = { id: "o12-it1", articleId: "a-bc600", name: "Base cabinet 600", qty: 20 };
  const o12ops = opsFromArticle(artOf("a-bc600"), o12it, {});

  /* ---- o13: engineering project ---- */
  const o13it = { id: "o13-it1", articleId: null, name: "Project", qty: 1 };
  const o13ops = ["eg-brief", "eg-meas", "eg-design", "eg-appr", "eg-cam", "eg-hand"].map((st, i) => {
    const stn = ENG_STATIONS.find(s => s.id === st);
    const status = i < 2 ? "done" : i === 2 ? "running" : "queued";
    return {
      id: uid("op"), itemId: o13it.id, group: null, stationId: st, estMins: stn.estMins,
      status, qtyDone: status === "done" ? 1 : 0, assigneeId: i <= 2 ? "m8" : null,
      loggedMs: (i === 2 ? 190 : i < 2 ? stn.estMins : 0) * 60000,
      startedAt: status === "running" ? now - 35 * 60000 : null,
      completedAt: status === "done" ? now - 2 * DAY : null, blockNote: null,
    };
  });

  const orders = [
    {
      id: "o1", num: "WO-1041", type: "prod", product: "Oak kitchen — Vilniaus g. 14", client: "Šiaulių NT projektai",
      qty: 12, unit: "cabinets", priority: "high", due: now + 2 * DAY, shipped: false, portfolioId: "p2",
      notes: "Handleless fronts, matte lacquer NCS S 0502-Y. Client wants site delivery before Aug 1.",
      createdAt: now - 9 * DAY, items: [o1it1, o1it2], ops: o1ops,
    },
    {
      id: "o2", num: "WO-1042", type: "prod", product: "Walnut wardrobe, sliding doors", client: "A. Petrauskienė",
      qty: 1, unit: "unit", priority: "normal", due: now + 6 * DAY, shipped: false, portfolioId: null,
      notes: "Soft-close Hettich rails. Mirror on middle door.",
      createdAt: now - 7 * DAY,
      ...flat("o2", 1, [["cut", "done", "m3", 95], ["edge", "done", "m4", 55], ["cnc", "queued", "m4"], ["asm"], ["sand"], ["fin"], ["qc"], ["pack"]]),
    },
    {
      id: "o3", num: "WO-1043", type: "prod", product: "Restaurant tables ×8", client: "Bistro „Ąžuolas“",
      qty: 8, unit: "tables", priority: "rush", due: now - 1 * DAY, shipped: false, portfolioId: null,
      notes: "RUSH — opening pushed to next week. Solid oak tops, steel legs arrive Thursday.",
      createdAt: now - 12 * DAY, items: [o3it], ops: o3ops,
    },
    {
      id: "o4", num: "WO-1044", type: "prod", product: "Office reception counter", client: "UAB Baltic Hub",
      qty: 1, unit: "unit", priority: "normal", due: now + 11 * DAY, shipped: false, portfolioId: null,
      notes: "Corian top ordered separately — arrives in ~1 week.",
      createdAt: now - 4 * DAY,
      ...flat("o4", 1, [["cut", "running", "m3", 35], ["edge"], ["cnc"], ["asm"], ["sand"], ["fin"], ["qc"], ["pack"]]),
    },
    {
      id: "o5", num: "WO-1045", type: "prod", product: "Bathroom vanities ×3", client: "Domus Interjeras",
      qty: 3, unit: "units", priority: "normal", due: now + 4 * DAY, shipped: false, portfolioId: null,
      notes: "Moisture-resistant MDF, painted RAL 7016.",
      createdAt: now - 6 * DAY,
      ...flat("o5", 3, [["cut", "done", "m3", 80], ["edge", "queued", null], ["cnc"], ["asm"], ["fin"], ["qc"], ["pack"]]),
    },
    {
      id: "o6", num: "WO-1046", type: "prod", product: "TV wall unit, smoked oak", client: "M. Kazlauskas",
      qty: 1, unit: "unit", priority: "low", due: now + 16 * DAY, shipped: false, portfolioId: null,
      notes: "",
      createdAt: now - 2 * DAY,
      ...flat("o6", 1, [["cut"], ["edge"], ["cnc"], ["asm"], ["sand"], ["fin"], ["qc"], ["pack"]]),
    },
    {
      id: "o7", num: "WO-1047", type: "prod", product: "Kids room set — bed + desk", client: "I. Jankauskienė",
      qty: 2, unit: "pieces", priority: "high", due: now + 1 * DAY, shipped: false, portfolioId: null,
      notes: "Birch plywood, rounded corners everywhere, water-based lacquer only.",
      createdAt: now - 10 * DAY,
      ...flat("o7", 2, [["cut", "done", "m3", 70], ["cnc", "done", "m4", 60], ["asm", "done", "m5", 130], ["sand", "done", "m6", 45], ["fin", "done", "m6", 95], ["qc", "paused", "m7", 12, 1], ["pack"]]),
    },
    {
      id: "o8", num: "WO-1048", type: "prod", product: "Wardrobe doors refit ×6", client: "Senamiesčio butai",
      qty: 6, unit: "doors", priority: "normal", due: now + 3 * DAY, shipped: false, portfolioId: null,
      notes: "",
      createdAt: now - 5 * DAY,
      ...flat("o8", 6, [["cut", "done", "m3", 55], ["edge", "running", "m4", 20, 2], ["fin"], ["qc"], ["pack"]]),
    },
    {
      id: "o9", num: "WO-1039", type: "prod", product: "Standing desks ×4, ash", client: "Kūrybos namai",
      qty: 4, unit: "desks", priority: "normal", due: now + 1 * DAY, shipped: false, portfolioId: null,
      notes: "Legs pre-ordered (Linak). Cable trays included.",
      createdAt: now - 15 * DAY,
      ...flat("o9", 4, [["cut", "done", "m3", 90], ["edge", "done", "m4", 50], ["asm", "done", "m5", 120], ["sand", "done", "m6", 40], ["fin", "done", "m6", 110], ["qc", "done", "m7", 25], ["pack", "done", "m7", 30]]),
    },
    {
      id: "o10", num: "WO-1038", type: "prod", product: "Oak bookshelf wall", client: "V. Norkus",
      qty: 1, unit: "unit", priority: "normal", due: now - 3 * DAY, shipped: true, shippedAt: now - 2 * DAY, portfolioId: null,
      notes: "",
      createdAt: now - 20 * DAY,
      ...flat("o10", 1, [["cut", "done", "m3", 85], ["edge", "done", "m4", 45], ["asm", "done", "m5", 140], ["fin", "done", "m6", 100], ["qc", "done", "m7", 20], ["pack", "done", "m7", 35]]),
    },
    {
      id: "o11", num: "WO-1049", type: "prod", product: "Café bar counter, 4.2 m", client: "Kavinė „Šviesa“",
      qty: 1, unit: "unit", priority: "high", due: now + 8 * DAY, shipped: false, portfolioId: "p1",
      notes: "Fluted oak front. Brass foot rail supplied by client.",
      createdAt: now - 1 * DAY,
      ...flat("o11", 1, [["cut"], ["edge"], ["cnc"], ["asm"], ["sand"], ["fin"], ["qc"], ["pack"]]),
    },
    {
      id: "o12", num: "WO-1050", type: "prod", product: "Base cabinets 600 — stock batch", client: "Stock",
      qty: 20, unit: "pcs", priority: "low", due: now + 18 * DAY, shipped: false, portfolioId: "p2",
      notes: "Standard batch for the showroom + stock.",
      createdAt: now - 1 * DAY, items: [o12it], ops: o12ops,
    },
    {
      id: "o13", num: "ENG-2043", type: "eng", product: "Bar counter — drawings & CNC programs", client: "Kavinė „Šviesa“",
      qty: 1, unit: "project", priority: "high", due: now + 5 * DAY, shipped: false, portfolioId: "p1",
      notes: "Fluted front detail 1:1 sample to approve. Brass rail bracket positions TBC.",
      createdAt: now - 3 * DAY, items: [o13it], ops: o13ops,
    },
  ];

  orders.forEach(o => { o.materials = seedOrderLines(o.id); });

  const activity = [
    { ts: now - 22 * 60000, who: "m5", orderId: "o1", text: "started **Assembly** on WO-1041 — 3 of 12 pcs done" },
    { ts: now - 35 * 60000, who: "m2", orderId: "o13", text: "started **Design & Drawings** on ENG-2043" },
    { ts: now - 47 * 60000, who: "m4", orderId: "o8", text: "started **Edge Banding** on WO-1048 — 2 of 6 pcs done" },
    { ts: now - 70 * 60000, who: "m4", orderId: "o1", text: "reported **5 of 8 pcs** at CNC / Drilling · Carcass on WO-1041" },
    { ts: now - 2 * 3600000, who: "m6", orderId: "o3", text: "blocked **Finishing · Tops** on WO-1043 — out of matte lacquer" },
    { ts: now - 3 * 3600000, who: "m7", orderId: "o7", text: "paused **Quality Check** on WO-1047" },
    { ts: now - 5 * 3600000, who: "m7", orderId: "o9", text: "completed **Packing** on WO-1039 — ready to ship" },
    { ts: now - 8 * 3600000, who: "m3", orderId: "o4", text: "started **Cutting** on WO-1044" },
    { ts: now - 1 * DAY, who: "m2", orderId: "o12", text: "created order **WO-1050** — Base cabinet 600 ×20" },
    { ts: now - 1 * DAY - 3600000, who: "m6", orderId: "o7", text: "completed **Finishing** on WO-1047" },
    { ts: now - 2 * DAY, who: "m2", materialId: "mat8", text: "received **100 pcs Hettich hinges**" },
  ];

  const todos = [
    { id: uid("td"), text: "Order more matte lacquer (10 L)", forId: "m2", by: "m1", ts: now - 2 * 3600000, done: false, due: now + DAY },
    { id: uid("td"), text: "Calibrate the edge bander before WO-1050", forId: "m4", by: "m2", ts: now - 5 * 3600000, done: false, due: now + 2 * DAY },
    { id: uid("td"), text: "Send photos of WO-1039 desks to client", forId: "m1", by: "m1", ts: now - DAY, done: true, doneAt: now - 3 * 3600000 },
  ];

  const pinSalt = randSalt();
  members.forEach(m => { m.pinHash = hashPin(m.pin, pinSalt); delete m.pin; }); // never store plaintext

  // demo: the manager already confirmed the client is happy with the drawings for the eng project
  const o13 = orders.find(o => o.id === "o13");
  if (o13) o13.clientApproved = { at: now - 2 * 3600000, by: "m1" };
  const notifications = [
    { id: uid("nt"), forId: "m8", by: "m1", ts: now - 2 * 3600000, read: false, type: "client_ok",
      orderId: "o13", text: "Client approved the drawings for ENG-2043 — you're clear to proceed to CNC programs" },
  ];

  orders.forEach(o => { if (!Array.isArray(o.comments)) o.comments = []; if (!o.parts) o.parts = []; });  // v13 comments, v15 parts

  return {
    v: 18,
    backupMeta: { lastExportAt: null, firstSeenAt: now },
    perms: JSON.parse(JSON.stringify(DEFAULT_PERMS)),
    shopName: "Northwood Furniture",
    pinSalt,
    notifications,
    gprojects: seedPlanner(members),
    oneDrive: { baseUrl: "https://example.com/projects", template: "{base}/{code}" },
    orderSeq: 1051,
    engSeq: 2044,
    members, stations: [...SEED_STATIONS, ...ENG_STATIONS], orders, activity,
    materials: seedMaterials(),
    stockMoves: seedStockMoves(),
    suppliers: seedSuppliers(),
    purchases: seedPurchases(now),
    poSeq: 1003,
    articles,
    portfolios: [
      { id: "p1", name: "Kavinė Šviesa fit-out", icon: "☕️", ic: "cup" },
      { id: "p2", name: "Standard products — July", icon: "📦", ic: "box" },
    ],
    boards: [seedBoard(members, false)],
    todos,
    shift: JSON.parse(JSON.stringify(DEFAULT_SHIFT)),
    scan: { prefixes: {} },
    scanLog: [],
    prefs: {},
  };
}

/* ============================================================
   Store
   ============================================================ */
const Store = {
  state: null,
  /* Boot the real way: the vault first, localStorage only to migrate out of.
     Falls back to the old synchronous path when IndexedDB is not there, so a
     locked-down browser still runs ShopFlow exactly as before. */
  async boot() {
    if (!Vault.supported()) { this.load(); return this._vault = false; }
    let doc = null;
    try { doc = await Vault.get("doc"); }
    catch (e) { console.warn("[Store] vault unavailable:", e && e.message); this.load(); return this._vault = false; }

    this._vault = true;
    Vault.refresh();                         // the browser's own figure, for Settings
    if (doc) {
      try {
        this.state = typeof doc === "string" ? JSON.parse(doc) : doc;
        this.migrate();
        await this._loadBackups();
        this._sessionBackup();
        this._writeIndex();
        return true;
      } catch (e) { console.warn("[Store] vault document unreadable:", e && e.message); }
    }

    /* nothing in the vault yet: adopt whatever localStorage holds, prove it
       landed, and only then give the space back to the rest of the domain */
    const raw = (() => { try { return localStorage.getItem(DB_KEY); } catch (_) { return null; } })();
    if (raw) {
      try {
        this.state = JSON.parse(raw);
        this.migrate();
        await Vault.set("doc", JSON.stringify(this.state));
        const back = await Vault.get("doc");
        if (back) {                                   // verified — now it is safe to let go
          await this._migrateBackups();
          try { localStorage.removeItem(DB_KEY); } catch (_) {}
          console.info("[Store] moved to the vault; localStorage freed");
        }
        await this._loadBackups();
        this._sessionBackup();
        this._writeIndex();
        return true;
      } catch (e) { console.warn("[Store] could not migrate:", e && e.message); }
    }

    this.state = (typeof REAL_SEED !== "undefined") ? JSON.parse(JSON.stringify(REAL_SEED)) : seedData();
    this.migrate();
    await this._loadBackups();
    this.save();
    return true;
  },

  load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) { this.state = JSON.parse(raw); this.migrate(); this._sessionBackup(); return; }
    } catch (e) {
      // primary state is corrupted — recover from the newest auto-backup before reseeding
      const b = this._backups()[0];
      if (b) { try { this.state = JSON.parse(b.data); this.migrate(); console.warn("[Store] recovered from backup", new Date(b.ts)); return; } catch (_) {} }
    }
    // fresh start: prefer the real-workshop backup seed (realdata.js) when present
    this.state = (typeof REAL_SEED !== "undefined") ? JSON.parse(JSON.stringify(REAL_SEED)) : seedData();
    this.migrate();
    this.save();
  },
  loadReal() {
    if (typeof REAL_SEED === "undefined") return false;
    this._backup("before restoring Northwood Furniture backup");
    this.state = JSON.parse(JSON.stringify(REAL_SEED));
    this.migrate(); this.save();
    return true;
  },
  loadDemo() {
    this._backup("before loading demo");
    this.state = seedData();
    this.save();
  },
  /* Upgrade older saved states in place (never lose user edits) */
  migrate() {
    const s = this.state;
    if (!s.v || s.v < 2) {
      if (!s.materials) s.materials = seedMaterials();
      if (!s.stockMoves) s.stockMoves = seedStockMoves();
      if (!s.prefs) s.prefs = {};
      s.orders.forEach(o => { if (!o.materials) o.materials = seedOrderLines(o.id); });
      s.activity.forEach(a => {
        if (!a.orderId) {
          const m = a.text.match(/WO-\d+/);
          if (m) { const o = s.orders.find(x => x.num === m[0]); if (o) a.orderId = o.id; }
        }
      });
      s.v = 2;
    }
    if (s.v < 3) {
      // stations: mark production kind, append engineering stages
      s.stations.forEach(st => { if (!st.kind) st.kind = "prod"; });
      for (const es of ENG_STATIONS) if (!s.stations.find(x => x.id === es.id)) s.stations.push({ ...es });
      // catalogs
      if (!s.articles) s.articles = seedArticles();
      if (!s.portfolios) s.portfolios = [
        { id: "p1", name: "Kavinė Šviesa fit-out", icon: "☕️" },
        { id: "p2", name: "Standard products — July", icon: "📦" },
      ];
      if (!s.engSeq) s.engSeq = 2044;
      // orders: wrap flat ops into a single General item, add qty tracking
      s.orders.forEach(o => {
        o.type = o.type || (o.num && o.num.startsWith("ENG-") ? "eng" : "prod");
        if (o.portfolioId === undefined) o.portfolioId = o.id === "o11" ? "p1" : o.id === "o1" ? "p2" : null;
        if (!o.items) {
          const item = { id: o.id + "-it0", articleId: null, name: "General", qty: o.qty || 1 };
          o.items = [item];
          o.ops.forEach(op => {
            op.itemId = item.id;
            if (op.group === undefined) op.group = null;
            if (op.qtyDone === undefined) op.qtyDone = op.status === "done" ? item.qty : 0;
          });
        }
      });
      s.v = 3;
    }
    if (s.v < 4) {
      // whiteboards: starter board in the workshop's language flavour
      const lt = /baldai/i.test(s.shopName || "") && s.shopName !== "Northwood Furniture";
      if (!s.boards) s.boards = [seedBoard(s.members, lt)];
      s.v = 4;
    }
    if (s.v < 5) {
      // vector icon keys for stations/materials/portfolios (legacy emoji kept as fallback)
      s.stations.forEach(st => { if (!st.ic) st.ic = EMOJI_ICON_MAP[st.icon] || (st.kind === "eng" ? "bulb" : "toolbox"); });
      (s.materials || []).forEach(m => { if (!m.ic) m.ic = EMOJI_ICON_MAP[m.icon] || "box"; });
      (s.portfolios || []).forEach(p => { if (!p.ic) p.ic = EMOJI_ICON_MAP[p.icon] || "folder"; });
      // whiteboard sharing
      (s.boards || []).forEach(b => { if (!b.visibility) { b.visibility = "team"; b.memberIds = []; } });
      // personal to-dos
      if (!s.todos) s.todos = [];
      s.v = 5;
    }
    if (s.v < 6) {
      // OneDrive project-files linking (base folder + per-project overrides)
      if (!s.oneDrive) s.oneDrive = { baseUrl: "", template: "{base}/{code}" };
      s.v = 6;
    }
    if (s.v < 7) {
      // QR / barcode scan stations
      if (!s.scan) s.scan = { prefixes: {} };   // { "<scanner prefix>": stationId }
      if (!s.scanLog) s.scanLog = [];
      s.v = 7;
    }
    if (s.v < 8) {
      // engineer role: design staff become "engineer" (only they + managers see engineering)
      s.members.forEach(m => {
        if (m.role === "manager" && /projektav|design|engineer|konstrukt/i.test(m.trade || "")) m.role = "engineer";
      });
      // project archive: ended (shipped/delivered) projects are archived
      s.orders.forEach(o => {
        if (o.archived === undefined) o.archived = !!o.shipped;
        if (o.archived && !o.archivedAt) o.archivedAt = o.shippedAt || Date.now();
      });
      s.v = 8;
    }
    if (s.v < 9) {
      // hash PINs at rest — drop any plaintext pins
      if (!s.pinSalt) s.pinSalt = randSalt();
      s.members.forEach(m => {
        if (m.pin != null && !m.pinHash) m.pinHash = hashPin(m.pin, s.pinSalt);
        delete m.pin;
      });
      s.v = 9;
    }
    if (s.v < 10) {
      if (!s.notifications) s.notifications = [];
      s.v = 10;
    }
    if (s.v < 11) {
      // general project management (Planner): Asana/ClickUp-style projects+tasks
      if (!s.gprojects) s.gprojects = seedPlanner(s.members);
      s.v = 11;
    }
    if (s.v < 12) {
      // Engineering and production are SEPARATE: an order carries only the steps
      // that match its own type. Older imports merged eng + prod tasks onto one
      // order (so a design project already showed Pjovimas etc.) and auto-started
      // some tasks. Split the phases apart, and reset auto-started tasks to queued.
      this._backup("before separating engineering/production");   // safety point — this cleanup drops steps
      const kindOf = {};
      (s.stations || []).forEach(st => { kindOf[st.id] = st.kind || "prod"; });
      (s.orders || []).forEach(o => {
        if (!Array.isArray(o.ops)) return;
        const want = o.type === "eng" ? "eng" : "prod";
        const match = o.ops.filter(op => (kindOf[op.stationId] || "prod") === want);
        if (match.length && match.length !== o.ops.length) {
          o.ops = match;                                   // drop the other phase's steps
        } else if (!match.length && o.ops.length) {
          o.type = (kindOf[o.ops[0].stationId] || "prod") === "eng" ? "eng" : "prod"; // mistyped → fix type
        }
        o.ops.forEach(op => {                              // nothing starts on its own
          if (op.status === "running" || op.status === "paused") {
            op.status = "queued"; op.startedAt = null; op.loggedMs = 0;
          }
        });
      });
      s.v = 12;
    }
    if (s.v < 13) {
      // comment threads on manufacturing/engineering projects (Planner tasks
      // already had them), and a home for backup bookkeeping
      (s.orders || []).forEach(o => { if (!Array.isArray(o.comments)) o.comments = []; });
      (s.gprojects || []).forEach(p => (p.tasks || []).forEach(t => {
        if (!Array.isArray(t.comments)) t.comments = [];
        t.comments.forEach(c => { if (!Array.isArray(c.mentions)) c.mentions = []; });
      }));
      if (!s.backupMeta) s.backupMeta = { lastExportAt: null, firstSeenAt: Date.now() };
      s.v = 13;
    }
    if (s.v < 14) {
      // roles became capabilities: everyone shares the cockpit, permissions differ
      if (!s.perms) s.perms = JSON.parse(JSON.stringify(DEFAULT_PERMS));
      s.v = 14;
    }
    if (s.v < 15) {
      (s.orders || []).forEach(o => { if (!Array.isArray(o.parts)) o.parts = []; });  // SWOOD part lists
      s.v = 15;
    }
    if (s.v < 16) {
      // durations are now measured against the shop's shift, not the wall clock
      if (!s.shift) s.shift = JSON.parse(JSON.stringify(DEFAULT_SHIFT));
      s.v = 16;
    }
    if (s.v < 17) {
      // Reports arrived with its own permission; existing installs have a perms
      // table without the key, and an absent key reads as "no" for every role.
      for (const [role, table] of Object.entries(s.perms || {})) {
        if (table["reports.view"] === undefined) table["reports.view"] = !!DEFAULT_PERMS[role]?.["reports.view"];
      }
      s.v = 17;
    }
    if (s.v < 18) {
      // Purchasing. A real shop's suppliers are its own — the migration creates
      // the shelves empty and never invents a business relationship.
      if (!s.suppliers) s.suppliers = [];
      if (!s.purchases) s.purchases = [];
      if (!s.poSeq) s.poSeq = 1001;
      (s.materials || []).forEach(m => {
        if (m.supplierId === undefined) m.supplierId = null;
        if (m.reorderQty === undefined) m.reorderQty = null;
      });
      s.v = 18;
    }
    this.save();
  },
  /* The cloud is a mirror, not the live store: every change is written here
     first so the shop keeps working when the wifi on the floor drops, and the
     in-memory state is pushed to Supabase afterwards. That is why a full disk
     still says something even when sync is connected — but what it should say
     depends entirely on whether the cloud already has the work. */
  save() {
    if (this._vault) this._flushSoon();          // index written with the flush
    else { this._saveLocal(); this._writeIndex(); }
    if (this._onSave) this._onSave();   // cloud sync still receives the in-memory state
    if (typeof Bridge !== "undefined") Bridge.mark();   // shared document index, when the hub is present
  },

  /* ---- writing to the vault ----
     save() stays synchronous to everything that calls it — the in-memory state
     IS the truth during a session — and the write is coalesced a beat later so
     a burst of edits is one transaction instead of forty. Short enough that
     nothing meaningful is ever in flight, and the tab going away flushes it
     immediately anyway. */
  FLUSH_MS: 120,
  _flushSoon() {
    this._dirty = true;
    clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this.flush(), this.FLUSH_MS);
  },
  async flush() {
    if (!this._vault || !this._dirty || this._flushing) return;
    clearTimeout(this._flushTimer);
    this._flushing = true;
    const snap = JSON.stringify(this.state);
    this._dirty = false;
    try {
      await Vault.set("doc", snap);
      this._saveError = null; this._quotaToldAt = 0;
      this._writeIndex();                        // once per settled write, not per edit
      this._announce();
    } catch (e) {
      this._dirty = true;                       // it did not land; try again on the next change
      this._saveError = e;
      console.error("[Store] vault write failed:", e && e.message);
      this._saveLocal();                        // last resort: the small store, with its old warning
    } finally { this._flushing = false; }
  },

  /* localStorage: the fallback, and where the tight limits still live */
  _saveLocal() {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(this.state));
      this._saveError = null; this._quotaToldAt = 0;
    } catch (e) {
      // storage full? free the auto-backups and retry once — the live data always wins
      try {
        localStorage.removeItem(BK_KEY);
        localStorage.setItem(DB_KEY, JSON.stringify(this.state));
        this._saveError = null; this._quotaToldAt = 0;
      } catch (e2) {
        this._saveError = e2;
        console.error("[Store] save failed:", e2 && e2.message);
        this._warnQuota();
      }
    }
  },

  /* The hub reads ShopFlow's orders to offer an import. It used to read the
     whole document out of localStorage; now it gets a few KB of exactly what
     it asks for, which is the only reason anything of ours stays there. */
  _writeIndex() {
    if (!this.state) return;
    try {
      localStorage.setItem(IDX_KEY, JSON.stringify({
        at: Date.now(),
        orders: (this.state.orders || []).map(o => ({
          id: o.id, num: o.num, product: o.product, client: o.client,
          type: o.type, shipped: !!o.shipped, archived: !!o.archived, createdAt: o.createdAt,
        })),
      }));
    } catch (_) { /* the index is a courtesy, never a reason to fail a save */ }
  },

  /* another tab of the same shop should pick this up */
  _announce() {
    try {
      if (!this._chan && typeof BroadcastChannel !== "undefined") this._chan = new BroadcastChannel("shopflow");
      if (this._chan) this._chan.postMessage({ t: "doc", at: Date.now() });
    } catch (_) {}
  },

  /* Said once every few minutes, not on every keystroke — the old version
     fired on each save and stacked identical toasts down the screen. */
  _warnQuota() {
    if (typeof Toast === "undefined") return;
    if (Date.now() - (this._quotaToldAt || 0) < 300000) return;
    this._quotaToldAt = Date.now();
    const live = typeof Sync !== "undefined" && Sync.status === "live";
    Toast.show(live
      ? "This device is out of storage — your work is safe in the cloud, but it can't be kept offline here. Settings → Storage."
      : "Couldn't save on this device — storage is full. Export a backup now.",
      { emoji: "alert", ms: 9000 });
  },
  reset() {
    try { localStorage.removeItem(DB_KEY); } catch (_) {}
    if (this._vault) { Vault.del("doc").catch(() => {}); this._dirty = false; clearTimeout(this._flushTimer); }
    this.load();
  },
  snapshot() { return JSON.stringify(this.state); },
  restore(snap) { this.state = JSON.parse(snap); Store.save(); },

  /* ---- what is actually filling this device up ----
     Every app published under gervdalius-droid.github.io shares ONE localStorage
     quota of about 5 MB — ShopFlow, the hub, offers, invoices. So "storage is
     full" is rarely about one runaway thing; it is the whole origin. This
     reports it honestly instead of leaving people to guess. */
  /* "0.00 MB" tells nobody anything — say KB when it is KB. */
  fmtBytes(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return Math.round(b / 1024) + " KB";
    if (b < 1073741824) return (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + " MB";
    return (b / 1073741824).toFixed(b < 10737418240 ? 1 : 0) + " GB";
  },

  usage() {
    const bytes = (v) => (v == null ? 0 : v.length * 2);     // UTF-16 in the store
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      keys.push({ key: k, bytes: bytes(localStorage.getItem(k)) });
    }
    keys.sort((a, b) => b.bytes - a.bytes);

    const doc = JSON.stringify(this.state || {});
    const sections = Object.keys(this.state || {}).map(k => ({
      key: k, bytes: bytes(JSON.stringify(this.state[k])),
    })).sort((a, b) => b.bytes - a.bytes);

    /* attachment thumbnails ride along in the document so every device can see
       a drawing without downloading it — worth knowing what that costs */
    let thumbs = 0, thumbN = 0;
    for (const f of (this.state && this.state.files) || []) {
      if (f.thumb) { thumbs += bytes(f.thumb); thumbN++; }
    }

    const total = keys.reduce((n, k) => n + k.bytes, 0);
    const bk = this._backups();
    const backupBytes = this._vault
      ? bk.reduce((n, b) => n + (b.bytes || 0) * 2, 0)
      : bytes(localStorage.getItem(BK_KEY));
    return { keys, sections, total, docBytes: bytes(doc),
             backupBytes, backupCount: bk.length,
             thumbBytes: thumbs, thumbCount: thumbN,
             vault: !!this._vault,
             /* what the browser says the vault may have — disk-sized, not 5 MB */
             vaultUsed: (Vault.est && Vault.est.used) || 0,
             vaultQuota: (Vault.est && Vault.est.quota) || 0,
             /* in the vault the document and its restore points no longer count
                against the small store the rest of the domain is fighting over */
             quota: QUOTA_GUESS, over: total > QUOTA_GUESS * 0.9 };
  },

  /* ---- local auto-backups: rolling restore points, best-effort ----
     In the vault the snapshot bodies live one key per backup ("bk:<ts>") and
     only their descriptions are held in memory, so listing them stays instant
     and synchronous for the UI without carrying twenty megabytes of JSON
     around. On the localStorage fallback it is the old single blob. */
  _bk: null,
  _backups() {
    if (this._vault) return this._bk || [];
    try { return JSON.parse(localStorage.getItem(BK_KEY) || "[]"); } catch (e) { return []; }
  },

  async _loadBackups() {
    if (!this._vault) return;
    try { this._bk = (await Vault.get("bk-index")) || []; }
    catch (_) { this._bk = []; }
  },
  _saveBackupIndex() {
    if (!this._vault) return;
    Vault.set("bk-index", this._bk || []).catch(e => console.warn("[Store] backup index:", e && e.message));
  },
  /* one-time: carry the localStorage backups into the vault, then let them go */
  async _migrateBackups() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(BK_KEY) || "[]"); } catch (_) { return; }
    if (!list.length) return;
    const index = [];
    for (const b of list) {
      try {
        await Vault.set("bk:" + b.ts, b.data);
        index.push({ ts: b.ts, reason: b.reason, keep: !!b.keep, by: b.by || null, bytes: (b.data || "").length });
      } catch (_) {}
    }
    this._bk = index;
    this._saveBackupIndex();
    try { localStorage.removeItem(BK_KEY); } catch (_) {}
  },
  /* Throw every restore point away — from wherever they actually live. */
  async clearBackups() {
    if (this._vault) {
      const list = this._bk || [];
      this._bk = [];
      await Promise.all(list.map(b => Vault.del("bk:" + b.ts).catch(() => {})));
      this._saveBackupIndex();
      Vault.refresh();
      return list.length;
    }
    const n = this._backups().length;
    try { localStorage.removeItem(BK_KEY); } catch (_) {}
    return n;
  },

  /* the body of one backup, which only a restore actually needs */
  async backupData(ts) {
    if (this._vault) return await Vault.get("bk:" + ts);
    const b = this._backups().find(x => x.ts === ts);
    return b ? b.data : null;
  },
  /* Trim to BK_MAX automatic snapshots, but never drop a named restore point
     (keep:true) — those are the ones a person deliberately made. */
  _trimBackups(list, budget) {
    const BUDGET = budget || (this._vault ? BK_BUDGET : BK_BUDGET_LS);
    let auto = 0, kept = 0;
    const byCount = list.filter(b => b.keep ? ++kept <= BK_KEEP_MAX : ++auto <= BK_MAX);
    /* then the byte ceiling: oldest automatic snapshots go first, and a named
       restore point is only dropped when nothing else is left to drop. */
    const size = (b) => b.bytes != null ? b.bytes : (b.data || "").length;
    const out = byCount.slice();
    let total = out.reduce((n, b) => n + size(b), 0);
    const dropOldest = (pred) => {
      for (let i = out.length - 1; i >= 0 && total > BUDGET; i--) {
        if (!pred(out[i], i)) continue;
        total -= size(out[i]); out.splice(i, 1);
      }
    };
    dropOldest((b, i) => !b.keep && i > 0);      // never the newest snapshot
    dropOldest((b, i) => i > 0);                 // still over: named ones too
    return out;
  },
  _backup(reason, opts = {}) {
    if (!this.state) return null;
    const snap = JSON.stringify(this.state);

    if (this._vault) {
      const list = this._bk || (this._bk = []);
      // an unchanged auto-snapshot is noise; a named one is still worth keeping
      if (!opts.keep && list[0] && list[0].bytes === snap.length && list[0].sig === this._sig(snap)) return null;
      const entry = { ts: Date.now(), reason: reason || "auto", bytes: snap.length, sig: this._sig(snap) };
      if (opts.keep) { entry.keep = true; entry.by = opts.by || null; }
      list.unshift(entry);
      const kept = this._trimBackups(list);
      const gone = list.filter(b => !kept.includes(b));
      this._bk = kept;
      Vault.set("bk:" + entry.ts, snap)
        .then(() => { for (const b of gone) Vault.del("bk:" + b.ts).catch(() => {}); this._saveBackupIndex(); })
        .catch(e => {                                   // it never landed — do not claim it did
          this._bk = this._bk.filter(b => b.ts !== entry.ts);
          console.warn("[Store] backup failed:", e && e.message);
        });
      return entry;
    }

    try {
      const list = this._backups();
      if (!opts.keep && list[0] && list[0].data === snap) return null;
      const entry = { ts: Date.now(), reason: reason || "auto", data: snap };
      if (opts.keep) { entry.keep = true; entry.by = opts.by || null; }
      list.unshift(entry);
      localStorage.setItem(BK_KEY, JSON.stringify(this._trimBackups(list)));
      return entry;
    } catch (e) {
      try { localStorage.setItem(BK_KEY, JSON.stringify(this._backups().filter(b => b.keep).slice(0, 2))); } catch (_) {}
      return null;
    }
  },

  /* cheap content fingerprint — only ever used to skip an identical snapshot */
  _sig(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i += 97) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return h;
  },
  /* a restore point the user asked for, by name — survives auto-eviction */
  savePoint(label, byId) {
    return this._backup((label || "").trim() || "Restore point", { keep: true, by: byId || null });
  },
  deleteBackup(ts) {
    if (this._vault) {
      this._bk = (this._bk || []).filter(b => b.ts !== ts);
      Vault.del("bk:" + ts).catch(() => {});
      this._saveBackupIndex();
      return true;
    }
    const list = this._backups().filter(b => b.ts !== ts);
    try { localStorage.setItem(BK_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  },
  /* ---- export bookkeeping: so we can nag when a download is overdue ---- */
  markExported() {
    if (!this.state.backupMeta) this.state.backupMeta = {};
    this.state.backupMeta.lastExportAt = Date.now();
    this.save();
  },
  /* Pure — this runs during render, so it must never write or it would
     reset its own clock (and push to the cloud) on every repaint. */
  exportOverdueDays() {
    const meta = this.state.backupMeta || {};
    const since = meta.lastExportAt || meta.firstSeenAt;
    return since ? Math.floor((Date.now() - since) / 864e5) : 0;
  },
  _sessionBackup() {                                                // one restore point per hour of use
    const list = this._backups();
    if (!list[0] || Date.now() - list[0].ts > 36e5) this._backup("session");
  },
  /* Async now: in the vault the snapshot body is fetched only when a restore
     actually happens, rather than being carried in memory forever. */
  async restoreBackup(ts) {
    const b = this._backups().find(x => x.ts === ts);
    if (!b) return false;
    const data = await this.backupData(ts);
    if (!data) return false;
    this._backup("before restore");                                 // so the restore itself is undoable
    this.state = JSON.parse(data);
    this.migrate();
    this.save();
    return true;
  },
  /* ---- import a JSON file exported from ShopFlow ---- */
  importJSON(text) {
    const incoming = JSON.parse(text);                              // throws on invalid JSON
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.orders) || !Array.isArray(incoming.members))
      throw new Error("Not a ShopFlow backup");
    this._backup("before import");
    this.state = incoming;
    this.migrate();                                                 // upgrade older exports (also saves)
    return true;
  },
};

/* ============================================================
   Domain helpers (derived state)
   ============================================================ */
/* ============================================================
   Working time
   A task left running overnight must not bill sixteen hours, and
   a weekend must not bill at all. Every duration in the app is
   measured against the shop's shift instead of the wall clock.
   ============================================================ */
const DEFAULT_SHIFT = {
  days: [1, 2, 3, 4, 5],                       // 0=Sun … 6=Sat
  start: "08:00", end: "17:00",
  breaks: [
    { from: "10:00", to: "10:15" },
    { from: "12:00", to: "12:45" },            // lunch
    { from: "15:00", to: "15:15" },
  ],
  auto: true,                                  // derive work time from scans
  idleMins: 30,                                // silence that ends a scan session
};

/* "08:00" → minutes past midnight */
const hhmm = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  return m ? Math.min(1440, +m[1] * 60 + +m[2]) : 0;
};
const mmhh = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/* ============================================================
   Capabilities — everyone SEES the same cockpit; roles differ
   only in what they may CHANGE. Managers always hold every
   capability; the rest are editable in Settings → Permissions.
   Anything not listed here (viewing, working on your own tasks,
   commenting, to-dos, Planner, Whiteboard) is open to everyone.
   ============================================================ */
const CAPS = [
  { id: "orders.create",  label: "Create new orders & projects",                   hint: "The + New Order button" },
  { id: "orders.edit",    label: "Edit order details",                             hint: "Due date, priority, notes, portfolio, project files" },
  { id: "orders.route",   label: "Change routing",                                 hint: "Add, move or remove production steps" },
  { id: "orders.assign",  label: "Assign teammates to steps",                      hint: "Decide who does what" },
  { id: "orders.copy",    label: "Copy a project",                                 hint: "Duplicate a job with its full route" },
  { id: "orders.finish",  label: "Ship, archive or restore projects",              hint: "Close a job out" },
  { id: "orders.delete",  label: "Delete orders & projects",                       hint: "Permanent — usually managers only" },
  { id: "materials.use",  label: "Mark order materials as used",                   hint: "Consuming a line moves real stock" },
  { id: "warehouse.edit", label: "Manage the warehouse",                           hint: "Stock, materials, suppliers, purchase orders and the catalogue" },
  { id: "team.manage",    label: "Manage the team",                                hint: "Add members, change roles, reset PINs" },
  { id: "reports.view",   label: "See Reports",                                    hint: "Throughput, on-time delivery and where the hours go" },
  { id: "settings",       label: "Open Settings",                                  hint: "Stations, engineering stages, data, backups, cloud" },
];

/* Defaults per role. Managers are deliberately absent — they always get
   everything, so a shop can never lock itself out of its own settings. */
const DEFAULT_PERMS = {
  engineer: {
    "orders.create": true, "orders.edit": true, "orders.route": true, "orders.assign": true,
    "orders.copy": true, "orders.finish": true, "orders.delete": false,
    "materials.use": false, "warehouse.edit": false, "team.manage": false,
    "reports.view": true, "settings": false,
  },
  worker: {
    "orders.create": false, "orders.edit": false, "orders.route": false, "orders.assign": false,
    "orders.copy": false, "orders.finish": false, "orders.delete": false,
    "materials.use": true, "warehouse.edit": false, "team.manage": false,
    "reports.view": false, "settings": false,
  },
};

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Members longest name first, so "@Anastasija" is never read as "@Ana". */
const mentionOrder = () => [...Store.state.members].sort((a, b) => b.name.length - a.name.length);
/* A name ends where a letter/digit stops — \b is ASCII-only and would break on ė/š/ž */
const mentionRe = (name, flags = "iu") => new RegExp("@" + escapeRe(name) + "(?![\\p{L}\\p{N}])", flags);

const D = {
  member: (id) => Store.state.members.find(m => m.id === id) || null,
  station: (id) => Store.state.stations.find(s => s.id === id) || null,
  stationsOf: (kind) => Store.state.stations.filter(s => (s.kind || "prod") === kind),
  order: (id) => Store.state.orders.find(o => o.id === id) || null,
  material: (id) => Store.state.materials.find(m => m.id === id) || null,
  article: (id) => Store.state.articles.find(a => a.id === id) || null,
  portfolio: (id) => Store.state.portfolios.find(p => p.id === id) || null,
  board: (id) => (Store.state.boards || []).find(b => b.id === id) || null,

  /* ---- imported part lists (SWOOD) ---- */
  orderPart(order, code) {
    if (!order || !order.parts || !order.parts.length) return null;
    const up = String(code || "").trim().toUpperCase();
    return order.parts.find(p => p.code.toUpperCase() === up) || null;
  },
  /* which order owns this part code? */
  findByPart(code) {
    const up = String(code || "").trim().toUpperCase();
    for (const o of Store.state.orders) {
      if (o.parts && o.parts.some(p => p.code.toUpperCase() === up)) return o;
    }
    return null;
  },
  partsOfItem: (order, itemId) => (order.parts || []).filter(p => p.itemId === itemId),

  /* ---- working time ---- */
  shift() { return Store.state.shift || DEFAULT_SHIFT; },

  /* The worked minutes of one day, as [fromMin, toMin] spans with the
     breaks cut out. Computed once per shift config, not per call. */
  _shiftSpans() {
    const sh = this.shift();
    const key = JSON.stringify([sh.start, sh.end, sh.breaks]);
    if (this.__spanKey === key) return this.__spans;
    const from = hhmm(sh.start), to = hhmm(sh.end);
    const spans = [];
    let cursor = from;
    const brs = [...(sh.breaks || [])]
      .map(b => [hhmm(b.from), hhmm(b.to)])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    for (const [bf, bt] of brs) {
      if (bt <= cursor || bf >= to) continue;
      if (bf > cursor) spans.push([cursor, Math.min(bf, to)]);
      cursor = Math.max(cursor, bt);
    }
    if (cursor < to) spans.push([cursor, to]);
    this.__spanKey = key; this.__spans = spans;
    return spans;
  },

  /* Worked milliseconds in a full working day (08:00–17:00 less breaks = 7h45m) */
  shiftDayMs() { return this._shiftSpans().reduce((n, [a, b]) => n + (b - a), 0) * 60000; },

  isWorkingDay(d) { return (this.shift().days || []).includes(d.getDay()); },

  /* Working milliseconds between two instants. Weekends, evenings, nights and
     breaks contribute nothing. */
  workMsBetween(from, to) {
    if (!from || !to || to <= from) return 0;
    const spans = this._shiftSpans();
    if (!spans.length) return 0;
    let total = 0;
    const day = new Date(from); day.setHours(0, 0, 0, 0);
    const last = new Date(to);
    for (let guard = 0; day.getTime() <= last.getTime() && guard < 400; guard++) {
      if (this.isWorkingDay(day)) {
        const midnight = day.getTime();
        for (const [a, b] of spans) {
          const s = midnight + a * 60000, e = midnight + b * 60000;
          const lo = Math.max(s, from), hi = Math.min(e, to);
          if (hi > lo) total += hi - lo;
        }
      }
      day.setDate(day.getDate() + 1);        // DST-safe: local dates, not +24h
    }
    return total;
  },

  /* Is the shop working right now? */
  isWorkingNow(at = Date.now()) {
    const d = new Date(at);
    if (!this.isWorkingDay(d)) return false;
    const min = d.getHours() * 60 + d.getMinutes();
    return this._shiftSpans().some(([a, b]) => min >= a && min < b);
  },

  /* ---- capabilities ---- */
  /* Managers always hold everything — a shop must never be able to lock
     itself out of Settings. Unknown roles fall back to the worker set. */
  roleCan(role, cap) {
    if (role === "manager") return true;
    const table = (Store.state.perms || {})[role] || (Store.state.perms || {}).worker || DEFAULT_PERMS.worker;
    return !!table[cap];
  },

  /* ---- @mentions ---- */
  /* Which teammates does this text address? Resolved by name at post time so
     the stored text stays readable in exports. */
  parseMentions(text) {
    const ids = [];
    if (!text || text.indexOf("@") < 0) return ids;
    for (const m of mentionOrder()) {
      if (mentionRe(m.name).test(text) && !ids.includes(m.id)) ids.push(m.id);
    }
    return ids;
  },
  /* Members whose name starts with what has been typed after the "@" */
  mentionCandidates(query, limit = 6) {
    const q = (query || "").toLowerCase();
    return Store.state.members
      .filter(m => !q || m.name.toLowerCase().startsWith(q) || m.name.toLowerCase().includes(" " + q))
      .slice(0, limit);
  },

  /* ---- unique project names (a copy must never collide) ---- */
  projectNameTaken: (name, exceptId) => Store.state.orders.some(o =>
    o.id !== exceptId && (o.product || "").trim().toLowerCase() === (name || "").trim().toLowerCase()),
  gprojectNameTaken: (name, exceptId) => Store.state.gprojects.some(p =>
    p.id !== exceptId && (p.name || "").trim().toLowerCase() === (name || "").trim().toLowerCase()),
  /* "Kitchen" → "Kitchen (copy)" → "Kitchen (copy 2)" … */
  uniqueName(base, taken) {
    const stem = String(base || "Project").replace(/\s*\(copy(?:\s+\d+)?\)\s*$/i, "").trim() || "Project";
    let candidate = `${stem} (copy)`;
    for (let n = 2; taken(candidate); n++) candidate = `${stem} (copy ${n})`;
    return candidate;
  },

  /* boards a member may see: team-wide, own, or explicitly shared */
  boardAccess(b, memberId) {
    if (!b) return false;
    if (b.createdBy === memberId) return true;
    if ((b.visibility || "team") === "team") return true;
    if (b.visibility === "custom") return (b.memberIds || []).includes(memberId);
    return false; // private
  },
  boardsFor(memberId) {
    return (Store.state.boards || []).filter(b => this.boardAccess(b, memberId));
  },

  /* ---------- To-dos ---------- */
  todosFor(memberId) {
    return (Store.state.todos || []).filter(t => t.forId === memberId)
      .sort((a, b) => (a.done - b.done) || (a.due || Infinity) - (b.due || Infinity) || b.ts - a.ts);
  },
  openTodoCount(memberId) {
    return (Store.state.todos || []).filter(t => t.forId === memberId && !t.done).length;
  },

  /* ---------- Planner (general PM) ---------- */
  gproject: (id) => (Store.state.gprojects || []).find(p => p.id === id) || null,
  activeGProjects() { return (Store.state.gprojects || []).filter(p => !p.archived); },
  gtask(project, taskId) { return project ? project.tasks.find(t => t.id === taskId) : null; },
  gstage(project, stageId) { return project ? project.stages.find(s => s.id === stageId) : null; },
  gStageTasks(project, stageId) {
    return project.tasks.filter(t => t.stageId === stageId).sort((a, b) => a.ord - b.ord);
  },
  gTaskDone(project, task) { const s = this.gstage(project, task.stageId); return !!(s && s.done); },
  gProgress(project) {
    const total = project.tasks.length;
    const done = project.tasks.filter(t => this.gTaskDone(project, t)).length;
    return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
  },
  gSubProgress(task) {
    const s = task.subtasks || [];
    return { done: s.filter(x => x.done).length, total: s.length };
  },
  /* all tasks assigned to a member across active projects (each with its project) */
  myGTasks(memberId) {
    const out = [];
    for (const p of this.activeGProjects())
      for (const t of p.tasks)
        if (t.assigneeId === memberId && !this.gTaskDone(p, t)) out.push({ project: p, task: t });
    out.sort((a, b) => (a.task.due || Infinity) - (b.task.due || Infinity) || prioRank(a.task) - prioRank(b.task));
    return out;
  },
  myGTaskCount(memberId) {
    return this.activeGProjects().reduce((n, p) => n + p.tasks.filter(t => t.assigneeId === memberId && !this.gTaskDone(p, t)).length, 0);
  },
  gLabel(project, id) { return (project.labels || []).find(l => l.id === id) || null; },

  /* ---------- Notifications ---------- */
  notificationsFor(memberId) {
    return (Store.state.notifications || []).filter(n => n.forId === memberId).sort((a, b) => b.ts - a.ts);
  },
  unreadCount(memberId) {
    return (Store.state.notifications || []).filter(n => n.forId === memberId && !n.read).length;
  },
  /* engineers (or managers) carrying a project — who to notify about it */
  projectEngineers(order) {
    const ids = new Set();
    for (const op of order.ops) {
      const m = op.assigneeId && this.member(op.assigneeId);
      if (m && (m.role === "engineer" || m.role === "manager")) ids.add(m.id);
    }
    if (!ids.size) Store.state.members.filter(m => m.role === "engineer").forEach(m => ids.add(m.id));
    return [...ids];
  },

  /* ---------- QR / barcode scanning ----------
     Labels (e.g. SWOOD) encode a part code like "SA_GA_VIRT_404"
     = {PROJECT}_{partNo}. We strip the part number to get the
     project code, match the order, and count the part at a station. */
  scanParse(raw) {
    let body = String(raw || "").trim();
    if (!body) return null;
    let stationId = null;
    // optional scanner prefix "EDGE#..." → route to a station
    const px = Store.state.scan?.prefixes || {};
    const h = body.indexOf("#");
    if (h > 0 && px[body.slice(0, h)]) { stationId = px[body.slice(0, h)]; body = body.slice(h + 1).trim(); }
    // native ShopFlow token: SF|orderId|itemId|part
    if (body.startsWith("SF|")) {
      const [, oid, iid, part] = body.split("|");
      const o = D.order(oid);
      if (o) return { order: o, item: iid ? D.item(o, iid) : null, partCode: part || body, stationId };
    }
    const partCode = body;
    // An imported SWOOD part list is the most precise match we have: the code
    // names one physical panel, so it resolves the order AND the material line.
    const owner = D.findByPart(partCode);
    if (owner) {
      const part = D.orderPart(owner, partCode);
      return { order: owner, item: part && part.itemId ? D.item(owner, part.itemId) : null,
               part, partCode, project: (owner.swood && owner.swood.project) || owner.num, stationId };
    }
    const project = body.replace(/[_-]\d+[A-Z]?$/i, "").trim(); // SA_GA_VIRT_404 -> SA_GA_VIRT
    const UP = body.toUpperCase(), PUP = project.toUpperCase();
    const hit = (o) => {
      const n = (o.num || "").toUpperCase(), p = (o.product || "").toUpperCase();
      // an imported job keeps its SWOOD project code, so renaming the project
      // in ShopFlow can't stop its own labels from finding it
      const sw = ((o.swood && o.swood.project) || "").toUpperCase();
      if (sw && (sw === UP || sw === PUP)) return true;
      return n === UP || n === PUP || (PUP && (n.includes(PUP) || p.includes(PUP))) || (n && UP.includes(n));
    };
    let order = Store.state.orders.find(o => (o.num || "").toUpperCase() === UP)
             || Store.state.orders.find(o => ((o.swood && o.swood.project) || "").toUpperCase() === PUP)
             || Store.state.orders.find(o => (o.num || "").toUpperCase() === PUP)
             || Store.state.orders.find(hit);
    // an imported project knows every panel it contains, so a code that looks
    // like one of its labels but isn't on the list is a mis-print, not progress
    if (order && order.parts && order.parts.length && !D.orderPart(order, partCode))
      return { order, item: null, partCode, project, stationId, unknownPart: true };
    // article SKU on the label → item
    let item = null;
    if (!order) {
      for (const o of Store.state.orders) for (const it of o.items) {
        const art = it.articleId ? D.article(it.articleId) : null;
        if (art && UP.includes(art.sku.toUpperCase())) { order = o; item = it; break; }
      }
    }
    return order ? { order, item, partCode, project, stationId } : { order: null, partCode, project, stationId };
  },

  stationScanStats(stationId) {
    let done = 0, total = 0;
    for (const o of Store.state.orders) {
      if (o.archived) continue;
      for (const op of o.ops) if (op.stationId === stationId) {
        const it = D.item(o, op.itemId);
        done += op.qtyDone; total += it ? it.qty : 0;
      }
    }
    return { done, total };
  },

  /* ---------- Project files (OneDrive) ---------- */
  slug(s) { return String(s || "").trim().replace(/[\\/:*?"<>|#%]+/g, "").replace(/\s+/g, "_"); },
  projectLink(order) {
    if (!order) return null;
    if (order.oneDriveUrl) return order.oneDriveUrl;          // explicit per-project override
    const od = Store.state.oneDrive;
    if (od && od.baseUrl) {
      const base = od.baseUrl.replace(/\/+$/, "");
      return (od.template || "{base}/{code}")
        .replace("{base}", base)
        .replace("{code}", encodeURIComponent(this.slug(order.num)))
        .replace("{name}", encodeURIComponent(this.slug(order.product)));
    }
    return null;
  },
  projectLinkIsAuto(order) { return !!order && !order.oneDriveUrl && !!Store.state.oneDrive?.baseUrl; },

  /* status label with order context (eng projects aren't "shipped") */
  statusLabelFor(order, st) {
    if (order.type === "eng") {
      if (st === "ready") return "Complete";
      if (st === "shipped") return "Delivered";
    }
    return this.statusLabel[st] || st;
  },
  item: (order, itemId) => order.items.find(i => i.id === itemId) || null,

  /* ---------- Lanes & piece flow ---------- */
  laneOps(order, itemId, group) {
    return order.ops.filter(op => op.itemId === itemId && op.group === group);
  },
  itemGroups(order, itemId) {
    const gs = [];
    for (const op of order.ops) {
      if (op.itemId !== itemId || op.group === null) continue;
      if (!gs.includes(op.group)) gs.push(op.group);
    }
    return gs;
  },
  /* pieces available to process at this op (upstream throughput cap) */
  opAvail(order, op) {
    const item = this.item(order, op.itemId);
    if (!item) return 0;
    const lane = this.laneOps(order, op.itemId, op.group);
    const i = lane.indexOf(op);
    if (i > 0) return lane[i - 1].status === "done" ? item.qty : lane[i - 1].qtyDone;
    if (op.group !== null) return item.qty; // first op of a part lane
    // first op of the shared/final lane: capped by the slowest part lane
    const groups = this.itemGroups(order, op.itemId);
    if (!groups.length) return item.qty;
    let avail = item.qty;
    for (const g of groups) {
      const l = this.laneOps(order, op.itemId, g);
      const last = l[l.length - 1];
      avail = Math.min(avail, last.status === "done" ? item.qty : last.qtyDone);
    }
    return avail;
  },
  /* can this op be worked on now? */
  opReady(order, op) {
    if (op.status === "done") return false;
    return this.opAvail(order, op) > 0 || op.qtyDone > 0 || ["running", "paused", "blocked"].includes(op.status);
  },
  activeOps(order) {
    return order.ops.filter(op => this.opReady(order, op));
  },
  currentOp(order) { return this.activeOps(order)[0] || (order.ops.find(op => op.status !== "done") ? order.ops.find(op => op.status !== "done") : null); },

  opLabel(order, op) {
    const st = this.station(op.stationId);
    const item = this.item(order, op.itemId);
    const multi = order.items.length > 1;
    const bits = [];
    if (op.group) bits.push(op.group);
    if (multi && item) bits.push(item.name);
    return { station: st, suffix: bits.join(" · ") };
  },

  /* is this project ended (archived)? */
  isActive(order) { return !order.archived; },

  /* Order status derived from ops */
  orderStatus(order) {
    if (order.archived || order.shipped) return "shipped";
    if (!order.ops.length) return "queued";
    if (order.ops.every(op => op.status === "done")) return "ready";
    const active = this.activeOps(order);
    if (active.some(op => op.status === "blocked")) return "blocked";
    if (active.some(op => op.status === "running")) return "running";
    if (active.some(op => op.status === "paused")) return "paused";
    if (order.ops.some(op => op.status === "done" || op.qtyDone > 0)) return "running";
    return "queued";
  },

  statusLabel: {
    queued: "Not started", running: "In production", paused: "Paused",
    blocked: "Blocked", ready: "Ready to ship", shipped: "Shipped", done: "Done",
  },

  progress(order) {
    const done = order.ops.filter(op => op.status === "done").length;
    return { done, total: order.ops.length, pct: order.ops.length ? Math.round(done / order.ops.length * 100) : 0 };
  },

  /* final-op output per item, e.g. how many are packed */
  itemFinished(order, itemId) {
    const ops = order.ops.filter(op => op.itemId === itemId);
    if (!ops.length) return { done: 0, label: "finished" };
    // "finished" = output of the final (shared) lane's last op, not whatever op sits last in the array
    const finalLane = ops.filter(op => op.group === null);
    const last = (finalLane.length ? finalLane : ops)[(finalLane.length ? finalLane : ops).length - 1];
    const st = this.station(last.stationId);
    const item = this.item(order, itemId);
    return {
      done: last.status === "done" ? item.qty : last.qtyDone,
      label: st ? st.name.toLowerCase() : "finished",
    };
  },
  orderQty(order) { return order.items.reduce((s, i) => s + i.qty, 0); },
  /* On a SWOOD job this used to add 96 panels to 16 cabinets and print the sum
     under the last stage's name — "surinkimas 0 / 112", which is not a thing
     that exists. When the job is counted in cabinets, report the cabinets. */
  packedSummary(order) {
    const asm = this.hasModules(order) ? this.assemblyOp(order) : null;
    if (asm) {
      const f = this.itemFinished(order, asm.itemId);
      const item = this.item(order, asm.itemId);
      return { done: f.done, total: (item && item.qty) || 0, label: f.label };
    }
    let done = 0, total = 0, label = "packed";
    for (const it of order.items) {
      const f = this.itemFinished(order, it.id);
      done += f.done; total += it.qty; label = f.label;
    }
    return { done, total, label };
  },

  /* Time on a task, counted in working hours only.
     When the clock was started by a scan rather than a button, a run ends at
     the last scan plus the idle grace — nobody has to remember to stop it. */
  opElapsed(op) {
    let ms = op.loggedMs || 0;
    if (op.status === "running" && op.startedAt) ms += this.workMsBetween(op.startedAt, this.opRunUntil(op));
    return ms;
  },

  /* How far a running clock has legitimately reached.
     For a scan-started run that is min(now, last scan + grace): the clock
     keeps ticking for a while after the last scan and then simply stops. It
     never jumps backwards, so what a worker saw is what gets logged. */
  opRunUntil(op, now = Date.now()) {
    if (op.autoStarted && op.lastScanAt) {
      const idle = Math.max(1, this.shift().idleMins || 30) * 60000;
      return Math.min(now, op.lastScanAt + idle);
    }
    return now;
  },

  /* A scan-started task whose session has gone quiet — the sweep closes these */
  opRunStale(op, now = Date.now()) {
    return op.status === "running" && op.autoStarted && op.lastScanAt &&
           now - op.lastScanAt > Math.max(1, this.shift().idleMins || 30) * 60000;
  },

  /* What a member is running right now */
  runningOpOf(memberId) {
    for (const o of Store.state.orders) {
      if (o.archived) continue;
      const op = o.ops.find(op => op.status === "running" && this.opAssignedTo(op, memberId));
      if (op) return { order: o, op };
    }
    return null;
  },

  /* Task queue for a member: ready ops assigned to them or unassigned at their home station.
     Production workers only see manufacturing projects; engineers only engineering. */
  workerQueue(memberId) {
    const me = this.member(memberId);
    const wantEng = me && me.role === "engineer";
    const out = [];
    for (const o of Store.state.orders) {
      if (o.archived) continue;
      if ((o.type === "eng") !== wantEng) continue; // workers never see eng; engineers only eng
      for (const op of this.activeOps(o)) {
        const mine = this.opAssignedTo(op, memberId);          // shared work counts as mine
        const atMyStation = !this.opAssigneeIds(op).length && me.station && op.stationId === me.station;
        if (mine || atMyStation) out.push({ order: o, op });
      }
    }
    out.sort((a, b) => prioRank(a.order) - prioRank(b.order) || a.order.due - b.order.due);
    return out;
  },

  /* All ready tasks at a station (an order can be at several stations at once) */
  stationQueue(stationId) {
    const out = [];
    for (const o of Store.state.orders) {
      if (o.archived) continue;
      for (const op of this.activeOps(o))
        if (op.stationId === stationId) out.push({ order: o, op });
    }
    out.sort((a, b) => prioRank(a.order) - prioRank(b.order) || a.order.due - b.order.due);
    return out;
  },

  doneTodayBy(memberId) {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    let n = 0;
    for (const o of Store.state.orders)
      for (const op of o.ops)
        if (op.status === "done" && op.completedAt >= midnight.getTime() &&
            (this.opAssignedTo(op, memberId) || op.completedBy === memberId)) n++;
    return n;
  },

  /* ---------- Portfolios ---------- */
  portfolioOrders(pid) { return Store.state.orders.filter(o => o.portfolioId === pid); },
  portfolioRollup(pid) {
    const orders = this.portfolioOrders(pid);
    let done = 0, total = 0;
    const statuses = {};
    let minDue = Infinity, maxDue = -Infinity;
    for (const o of orders) {
      const p = this.progress(o);
      done += p.done; total += p.total;
      const st = this.orderStatus(o);
      statuses[st] = (statuses[st] || 0) + 1;
      if (!o.archived) { minDue = Math.min(minDue, o.due); maxDue = Math.max(maxDue, o.due); }
    }
    return { orders, done, total, pct: total ? Math.round(done / total * 100) : 0, statuses, minDue, maxDue };
  },

  /* ---------- Warehouse ---------- */
  lowStock() { return Store.state.materials.filter(m => m.qty <= m.minQty); },

  lastMove(materialId) {
    return Store.state.stockMoves.filter(sm => sm.materialId === materialId).sort((a, b) => b.ts - a.ts)[0] || null;
  },

  materialMoves(materialId) {
    return Store.state.stockMoves.filter(sm => sm.materialId === materialId).sort((a, b) => b.ts - a.ts);
  },

  lineShort(line) {
    const mat = this.material(line.materialId);
    return !line.consumed && mat && mat.qty < line.qty;
  },

  orderShortages(order) { return (order.materials || []).filter(l => this.lineShort(l)); },

  materialInUse(materialId) {
    return Store.state.orders.some(o => !o.archived && (o.materials || []).some(l => l.materialId === materialId && !l.consumed));
  },

  /* ---------- suggesting a SKU ----------
     The shop's own codes follow a shape: MDF-18, SCR-435, SLD-500, EB-W23 —
     a short word from the name, then the numbers in it. So that is what this
     builds. It is only ever a suggestion; the field stays editable. */
  SKU_UNITS: new Set(["MM", "CM", "M", "M2", "KG", "G", "L", "ML", "PCS", "VNT", "KOMPL", "SET", "X"]),

  suggestSku(name, { unique = true } = {}) {
    const clean = String(name || "")
      .replace(/[ąĄ]/g, "a").replace(/[čČ]/g, "c").replace(/[ęėĘĖ]/g, "e")
      .replace(/[įĮ]/g, "i").replace(/[šŠ]/g, "s").replace(/[ųūŲŪ]/g, "u").replace(/[žŽ]/g, "z")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/(\d)[.,](\d)/g, "$1$2")        // 0,6 → 06, so it survives as one token
      .replace(/[^A-Z0-9]+/g, " ").trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (!parts.length) return "";

    const isUnit = (t) => this.SKU_UNITS.has(t);
    /* keep the WHOLE token, not the trimmed head — comparing a 6-character
       head against the token it came from excludes nothing */
    const headToken = parts.find(t => !/^\d+$/.test(t) && !isUnit(t)) || "";
    const head = (headToken || "MAT").slice(0, 6);

    /* a mixed token like ST7 or A356 is a code in its own right, but a unit
       glued on ("3MM") is noise, and a dimension string ("12X1220X2440") is
       only interesting up to its first number */
    const cleanMixed = (t) => {
      let v = t.replace(/(\d)(MM|CM|KG|ML|M2|M)$/, "$1");
      const dim = v.match(/^(\d+)X\d/);
      if (dim) v = dim[1];
      return v.slice(0, 6);
    };
    const rest = parts.filter(t => t !== headToken && !isUnit(t) && /\d/.test(t));
    const mixed = rest.find(t => /[A-Z]/.test(t));
    let tail = mixed ? cleanMixed(mixed)
      : rest.filter(t => /^\d+$/.test(t)).join("").slice(0, 5);
    if (!tail && parts.length > 1) {
      const second = parts.find(t => t !== headToken && !isUnit(t));
      tail = second ? second.slice(0, 3) : "";
    }

    const base = (head + (tail ? "-" + tail : "")).replace(/-+$/, "");
    return unique ? this.uniqueSku(base) : base;
  },

  /* Two materials sharing a code is how the wrong thing gets picked later. */
  uniqueSku(base) {
    const taken = new Set(Store.state.materials.map(m => String(m.sku || "").toUpperCase()));
    if (!taken.has(base.toUpperCase())) return base;
    for (let i = 2; i < 100; i++) if (!taken.has((base + "-" + i).toUpperCase())) return base + "-" + i;
    return base + "-" + Date.now().toString(36).slice(-3).toUpperCase();
  },

  /* ---------- matching a written name to warehouse stock ----------
     A SWOOD report list carries the names the designer typed — "BOARD 18",
     "Edge1", "LMDP 18 baltas" — not the shop's SKUs. Exact matching found
     almost nothing, so this widens in steps and stops at the first that is
     still safe to trust. It never guesses from a single short token: "Edge1"
     must not silently become "Edge banding, oak 23 mm". */
  _matTokens(s) {
    return String(s || "").toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ").filter(Boolean);
  },
  matchMaterial(name) {
    const q = String(name || "").trim();
    if (!q) return null;
    const mats = Store.state.materials;
    const low = q.toLowerCase();

    const exact = mats.find(m => m.name.trim().toLowerCase() === low);
    if (exact) return exact;
    const bySku = mats.find(m => (m.sku || "").trim().toLowerCase() === low);
    if (bySku) return bySku;

    // same characters, different punctuation or spacing
    const flat = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const same = mats.find(m => flat(m.name) === flat(q) || flat(m.sku) === flat(q));
    if (same) return same;

    // every word of the shorter name appears in the longer one, and the
    // overlap carries real information: a word of 3+ letters AND a number
    const qt = this._matTokens(q);
    if (!qt.length) return null;
    let best = null, bestScore = 0;
    for (const m of mats) {
      const mt = this._matTokens(m.name + " " + (m.sku || ""));
      const shared = qt.filter(t => mt.includes(t));
      if (shared.length < 2) continue;
      const hasWord = shared.some(t => /\p{L}{3,}/u.test(t));
      const hasNum = shared.some(t => /\d/.test(t));
      if (!hasWord || !hasNum) continue;
      const score = shared.length / Math.max(qt.length, 1);
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return bestScore >= 0.6 ? best : null;
  },

  /* ---------- the briefing ----------
     Everything an outside pair of eyes would need to judge this shop, built
     from what the app already knows. Lists are capped so the whole thing stays
     small enough to send, and the tracking coverage is stated up front: this
     shop's biggest analytical trap is time that was never logged, which reads
     as "fast" rather than "unmeasured" unless it is called out. */
  briefing({ days = 90 } = {}) {
    const to = Date.now(), from = to - days * DAY;
    const s = Store.state;
    const rep = this.report({ from, to, scope: "all" });
    const active = s.orders.filter(o => !o.archived && !o.shipped);
    const att = App && App.me ? this.attention(App.me.id) : this.attention((s.members[0] || {}).id);

    const hrs = (ms) => Math.round(ms / 360000) / 10;
    const day = (ms) => Math.round(ms / Math.max(1, this.shiftDayMs()) * 10) / 10;

    /* How much of the work actually carries logged time. Without this, an
       untracked shop looks like an instant one. */
    let opsTotal = 0, opsTimed = 0, opsDone = 0, opsDoneTimed = 0;
    for (const o of s.orders) for (const op of o.ops) {
      opsTotal++;
      if (this.opElapsed(op) > 0) opsTimed++;
      if (op.status === "done") { opsDone++; if (this.opElapsed(op) > 0) opsDoneTimed++; }
    }

    const byCustomer = new Map();
    for (const f of rep.finished) {
      const k = f.order.client || "—";
      const c = byCustomer.get(k) || { customer: k, finished: 0, onTime: 0, leadDays: [] };
      c.finished++;
      if (f.finishedAt <= f.order.due) c.onTime++;
      c.leadDays.push(day(this.workMsBetween(f.order.createdAt, f.finishedAt)));
      byCustomer.set(k, c);
    }

    return {
      generatedAt: new Date(to).toISOString(),
      period: { days, from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      shop: {
        name: s.shopName || "",
        people: s.members.length,
        roles: s.members.reduce((m, x) => (m[x.role] = (m[x.role] || 0) + 1, m), {}),
        stations: this.stationsOf("prod").map(x => x.name),
        workingDay: { hoursPerDay: Math.round(this.shiftDayMs() / 360000) / 10, days: (this.shift().days || []).length },
        automaticTimeTracking: !!this.shift().auto,
      },
      tracking: {
        tasksTotal: opsTotal, tasksWithLoggedTime: opsTimed,
        finishedTasks: opsDone, finishedTasksWithLoggedTime: opsDoneTimed,
        note: opsDone && opsDoneTimed / opsDone < 0.5
          ? "Most finished work carries no logged time, so any hours figure below is only the part that was tracked."
          : "Time tracking covers most finished work.",
      },
      delivery: {
        finishedInPeriod: rep.count,
        onTimePercent: rep.onTimePct,
        avgLeadWorkingDays: rep.count ? day(rep.avgLead) : null,
        openJobs: active.length,
        perWeek: rep.buckets.map(b => ({ weekOf: new Date(b.from).toISOString().slice(0, 10), finished: b.n })),
      },
      time: {
        hoursLogged: hrs(rep.workedMs),
        hoursEstimatedForThatWork: hrs(rep.estMs),
        byStation: rep.stations.slice(0, 15).map(x => ({
          station: x.station.name, tasks: x.n, hours: hrs(x.ms), estimatedHours: hrs(x.est),
          overUnderPercent: x.est ? Math.round((x.ms - x.est) / x.est * 100) : null,
        })),
        byPerson: rep.members.slice(0, 20).map(x => ({ person: x.member.name, tasks: x.n, hours: hrs(x.ms) })),
      },
      workInProgress: this.stationsOf("prod").map(st => ({
        station: st.name, waiting: this.stationQueue(st.id).length,
      })),
      attention: {
        blocked: att.blocked.slice(0, 10).map(b => ({
          job: b.order.num, product: b.order.product, customer: b.order.client,
          station: (this.station(b.op.stationId) || {}).name, reason: b.op.blockNote || "",
        })),
        overdue: att.late.slice(0, 10).map(o => ({
          job: o.num, product: o.product, customer: o.client,
          daysLate: Math.round((Date.now() - o.due) / DAY),
        })),
        notMovedInDays: att.stale.slice(0, 10).map(x => ({
          job: x.order.num, product: x.order.product, customer: x.order.client,
          daysQuiet: x.since ? Math.round((Date.now() - x.since) / DAY) : null,
        })),
      },
      materials: {
        shortForAcceptedWork: this.demandShortfalls().slice(0, 20).map(r => {
          const d = r.material ? this.onOrderDetail(r.material.id) : null;
          return {
            material: r.name, unit: r.unit, needed: r.need,
            inStock: r.stock, short: r.short,
            inTheWarehouse: !!r.material,
            onOrder: d ? d.sent : 0, onlyDrafted: d ? d.draft : 0,
            expected: d && d.expectedAt ? new Date(d.expectedAt).toISOString().slice(0, 10) : null,
            overdueDelivery: !!(d && d.late),
            jobsWaiting: r.lines.slice(0, 6).map(l => l.order.num),
          };
        }),
        notLinkedToStock: this.materialDemand().filter(r => !r.material).length,
        openPurchaseOrders: this.openPurchases().length,
      },
      customers: [...byCustomer.values()].sort((a, b) => b.finished - a.finished).slice(0, 15)
        .map(c => ({
          customer: c.customer, finishedInPeriod: c.finished,
          onTime: c.onTime, lateJobs: c.finished - c.onTime,
          avgLeadWorkingDays: c.leadDays.length
            ? Math.round(c.leadDays.reduce((a, b) => a + b, 0) / c.leadDays.length * 10) / 10 : null,
        })),
      finishedJobs: rep.finished.slice(0, 25).map(f => ({
        job: f.order.num, product: f.order.product, customer: f.order.client,
        finished: new Date(f.finishedAt).toISOString().slice(0, 10),
        onTime: f.finishedAt <= f.order.due,
        leadWorkingDays: day(this.workMsBetween(f.order.createdAt, f.finishedAt)),
        hoursLogged: hrs(this.orderActualMs(f.order)),
        hoursEstimated: hrs(this.orderEstMs(f.order)),
      })),
    };
  },

  /* ---------- one place to look first ----------
     Everything below already existed, in five different views. With a lot of
     projects running, the cost was not that any single screen was wrong — it
     was that nobody could hold five of them in their head every morning. */
  STALE_DAYS: 7,

  attention(memberId) {
    const active = Store.state.orders.filter(o => !o.archived && !o.shipped);

    const blocked = [];
    for (const o of active)
      for (const op of o.ops)
        if (op.status === "blocked") blocked.push({ order: o, op });

    const late = active.filter(o => this.orderStatus(o) !== "ready" && o.due < Date.now())
      .sort((a, b) => a.due - b.due);

    /* a job nobody has touched in a week, that is not finished and not
       waiting on anything named — the quiet kind of lost */
    const cut = Date.now() - this.STALE_DAYS * DAY;
    const touched = new Map();
    for (const a of Store.state.activity) {
      if (!a.orderId) continue;
      touched.set(a.orderId, Math.max(touched.get(a.orderId) || 0, a.ts));
    }
    const stale = active.filter(o => {
      if (this.orderStatus(o) === "ready") return false;
      const last = Math.max(touched.get(o.id) || 0, o.createdAt || 0,
        ...o.ops.map(op => op.completedAt || op.startedAt || 0));
      return last < cut;
    }).map(o => ({ order: o, since: Math.max(touched.get(o.id) || 0, o.createdAt || 0) }))
      .sort((a, b) => a.since - b.since);

    const seen = this.pref(memberId, "attentionSeen", 0);
    const changed = Store.state.activity.filter(a => a.ts > seen && a.who !== memberId);

    const shortfalls = this.demandShortfalls();
    const waiting = this.blockedByStock();

    return { blocked, late, stale, changed, shortfalls, waiting, seen,
             count: blocked.length + late.length + stale.length + shortfalls.length };
  },

  /* ---------- what the live jobs actually need ----------
     Low stock compares what is on the shelf against a static minimum, which
     says nothing about the work already accepted. This compares it against
     the jobs in hand: a shop can be green on every minimum and still be short
     for what it has promised, and the only way to find that out used to be
     opening projects one at a time.

     Lines with no warehouse link are included on purpose and grouped by the
     name they were imported under — an unmatched SWOOD material is exactly
     the kind that goes missing. */
  materialDemand({ includeSatisfied = true } = {}) {
    const rows = new Map();
    for (const o of Store.state.orders) {
      if (o.archived || o.shipped) continue;
      for (const line of (o.materials || [])) {
        if (line.consumed) continue;                    // already taken off the shelf
        const mat = line.materialId ? this.material(line.materialId) : null;
        const name = (mat && mat.name) || line.name || "—";
        const key = mat ? mat.id : "name:" + this._stName(name);
        if (!rows.has(key)) {
          rows.set(key, {
            key, material: mat, name,
            unit: (mat && mat.unit) || line.unit || "",
            need: 0,
            stock: mat ? mat.qty : this.spotStock(key),    // one-off stock counts too
            spot: !mat && this.spotStock(key) !== null,
            onOrder: mat ? this.onOrder(mat.id) : 0,
            lines: [],
          });
        }
        const r = rows.get(key);
        r.need = Math.round((r.need + (Number(line.qty) || 0)) * 1000) / 1000;
        r.lines.push({ order: o, line, qty: Number(line.qty) || 0 });
      }
    }
    const out = [...rows.values()].map(r => ({
      ...r,
      // an unlinked material has no stock figure, so everything it needs is short
      short: Math.round((r.need - (r.stock || 0) - r.onOrder) * 1000) / 1000,
    }));
    return out
      .filter(r => includeSatisfied || r.short > 0)
      .sort((a, b) => b.short - a.short || b.need - a.need || a.name.localeCompare(b.name));
  },

  /* ---------- stock we happen to have, without a catalogue entry ----------
     A one-off material does not deserve a permanent warehouse item — it is
     bought for one job and never seen again. But the jobs still need to know
     it is covered, so the amount on hand is recorded against the NAME the
     jobs are asking for. No SKU, no minimum, no supplier: just "we have 800
     of this". Held as a plain map and created on first use, because nothing
     existing has to be reshaped for it.
     A linked material ignores this entirely — the warehouse is the truth then. */
  _spot() { return (Store.state.spotStock = Store.state.spotStock || {}); },
  spotStock(key) {
    const r = this._spot()[key];
    return r && typeof r.qty === "number" ? r.qty : null;
  },
  spotNote(key) { return (this._spot()[key] || {}).note || ""; },

  /* Not just HOW MUCH is coming, but when — and whether it has actually been
     ordered or is still sitting in a draft nobody sent. "On order: 200" with
     no date answers half the question the shop is asking. */
  onOrderDetail(materialId) {
    let sent = 0, draft = 0, expectedAt = null, count = 0;
    for (const po of this.openPurchases()) {
      const out = po.lines.filter(l => l.materialId === materialId)
        .reduce((n, l) => n + this.poLineOutstanding(l), 0);
      if (!out) continue;
      if (po.status === "sent") {
        sent += out; count++;
        // the LATEST of them: that is when the shortfall actually clears
        if (po.expectedAt && (!expectedAt || po.expectedAt > expectedAt)) expectedAt = po.expectedAt;
      } else {
        draft += out;
      }
    }
    return { sent, draft, total: Math.round((sent + draft) * 1000) / 1000, expectedAt, count,
             late: !!(expectedAt && expectedAt < Date.now()) };
  },

  /* One demand row is an aggregate of lines on several orders, so anything
     done to it — renaming, linking to stock — has to reach every one of them.
     Looked up fresh rather than held, because the rows are rebuilt on render. */
  demandRow(key) { return this.materialDemand().find(r => r.key === key) || null; },
  demandLines(key) {
    const r = this.demandRow(key);
    return r ? r.lines : [];
  },

  /* Jobs that cannot be made with what is on the shelf and on its way. */
  demandShortfalls() { return this.materialDemand({ includeSatisfied: false }); },
  blockedByStock() {
    const ids = new Set();
    for (const r of this.demandShortfalls()) for (const l of r.lines) ids.add(l.order.id);
    return [...ids].map(id => this.order(id)).filter(Boolean);
  },

  /* ---------- resolving a production stage to a real station ----------
     The SWOOD importer used to ask for stations by the seed's ids — "edge",
     "cnc", "asm" — but a shop that imported its own station list has ids like
     "st-briaunavimas", so every lookup missed and the route collapsed to a
     single step. Names are what actually survive between installs, so a stage
     is matched by name (Lithuanian first, since that is what the shop uses)
     and only then by id. */
  STAGE_NAMES: {
    cut:  ["pjovimas", "pjaustymas", "cutting", "saw"],
    edge: ["briaunavimas", "kantavimas", "edge banding", "edgebanding", "briaunos"],
    cnc:  ["grezimas", "cnc", "drilling"],
    asm:  ["surinkimas", "assembly", "montavimas"],
    qc:   ["kokybe", "quality check", "quality", "patikra", "kk"],
    pack: ["pakavimas", "packing", "pakuote"],
  },
  _stName: (s) => String(s || "").toLowerCase()
    .replace(/[ąĄ]/g, "a").replace(/[čČ]/g, "c").replace(/[ęėĘĖ]/g, "e")
    .replace(/[įĮ]/g, "i").replace(/[šŠ]/g, "s").replace(/[ųūŲŪ]/g, "u").replace(/[žŽ]/g, "z")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim(),

  stationFor(stage) {
    const byId = this.station(stage);
    if (byId && byId.kind !== "eng") return byId;
    const prod = this.stationsOf("prod");
    for (const want of (this.STAGE_NAMES[stage] || [])) {
      const hit = prod.find(st => {
        const n = this._stName(st.name);
        return n === want || n.split(" ").includes(want) || n.includes(want);
      });
      if (hit) return hit;
    }
    return null;
  },

  /* ---------- repairing an imported route ----------
     A job imported before stages were resolved by name got a single cutting
     step, so it looked finished the moment it was cut. Re-importing would
     throw away the cutting already done, so instead work out what is missing
     and append it — nothing existing is touched. */
  swoodRouteGaps(order) {
    if (!order || !order.swood) return null;
    const finalName = order.items.find(i => (order.parts || []).every(p => p.itemId !== i.id));
    const add = [];
    for (const item of order.items) {
      if (finalName && item.id === finalName.id) continue;      // the assembly line, handled below
      const parts = (order.parts || []).filter(p => p.itemId === item.id);
      if (!parts.length) continue;
      const edged = parts.some(p => (p.edges || []).some(Boolean));
      const want = [];
      if (edged) { const st = this.stationFor("edge"); if (st) want.push(st); }
      const cnc = this.stationFor("cnc"); if (cnc) want.push(cnc);
      const held = new Set(order.ops.filter(op => op.itemId === item.id).map(op => op.stationId));
      const missing = want.filter(st => !held.has(st.id));
      if (missing.length) add.push({ item, stations: missing });
    }
    // and the closing line — assembly, checking, packing
    const finalRoute = ["asm", "qc", "pack"].map(k => this.stationFor(k)).filter(Boolean);
    const hasFinal = !!finalName && order.ops.some(op => op.itemId === finalName.id);
    const addFinal = !hasFinal && finalRoute.length ? finalRoute : null;
    if (!add.length && !addFinal) return null;
    return { add, addFinal, modules: (order.swood && order.swood.modules) || 1 };
  },

  /* ---------- Purchasing ---------- */
  supplier: (id) => (Store.state.suppliers || []).find(s => s.id === id) || null,
  suppliers() { return [...(Store.state.suppliers || [])].sort((a, b) => a.name.localeCompare(b.name)); },
  purchase: (id) => (Store.state.purchases || []).find(p => p.id === id) || null,

  /* Newest first — a purchasing screen is read from the top */
  purchases(status) {
    let list = [...(Store.state.purchases || [])];
    if (status) list = list.filter(p => status === "open" ? (p.status === "draft" || p.status === "sent") : p.status === status);
    return list.sort((a, b) => b.createdAt - a.createdAt);
  },
  openPurchases() { return this.purchases("open"); },
  poLineOutstanding: (l) => Math.max(0, l.qty - (l.received || 0)),
  poOutstanding(po) { return po.lines.reduce((n, l) => n + this.poLineOutstanding(l), 0); },
  poFullyReceived(po) { return po.lines.length > 0 && po.lines.every(l => this.poLineOutstanding(l) === 0); },
  supplierUsed(supplierId) {
    return this.openPurchases().some(p => p.supplierId === supplierId);
  },

  /* How much of a material is already coming — a drafted order counts, or the
     reorder suggestion would keep proposing what somebody just wrote down. */
  onOrder(materialId) {
    let n = 0;
    for (const po of this.openPurchases())
      for (const l of po.lines) if (l.materialId === materialId) n += this.poLineOutstanding(l);
    return n;
  },

  /* Top a material back up to its reorder level, minus whatever is already
     on its way. Returns only the materials that still need something. */
  reorderTarget(m) { return m.reorderQty || Math.max(m.minQty * 2, m.minQty + 1); },
  reorderSuggestions() {
    const out = [];
    for (const m of Store.state.materials) {
      if (m.qty > m.minQty) continue;
      const qty = Math.round((this.reorderTarget(m) - m.qty - this.onOrder(m.id)) * 100) / 100;
      if (qty > 0) out.push({ material: m, qty, supplier: this.supplier(m.supplierId) });
    }
    return out.sort((a, b) => (a.supplier?.name || "￿").localeCompare(b.supplier?.name || "￿"));
  },
  /* Grouped the way the orders will actually be placed: one per supplier */
  reorderBySupplier() {
    const groups = new Map();
    for (const s of this.reorderSuggestions()) {
      const key = s.material.supplierId || "";
      if (!groups.has(key)) groups.set(key, { supplier: s.supplier, lines: [] });
      groups.get(key).lines.push(s);
    }
    return [...groups.values()];
  },

  /* ---------- modules: the cabinets, not a number ----------
     A SWOOD job's assembly line is counted in modules. "0/48" tells the person
     at the bench nothing; the names do. Ticking a module is what moves the
     assembly task's count, so the two can never disagree. */
  orderModules(o) { return (o && o.modules) || []; },
  hasModules(o) { return this.orderModules(o).length > 0; },
  module(o, id) { return this.orderModules(o).find(m => m.id === id) || null; },
  modulesDone(o) { return this.orderModules(o).reduce((n, m) => n + (m.done || 0), 0); },
  modulesTotal(o) { return this.orderModules(o).reduce((n, m) => n + (m.qty || 1), 0); },

  /* ---------- correcting the cabinet count ----------
     Modules are derived from SOLIDNAME by stripping the part name off the
     front, and that guess is only as good as the shop's naming. When it counts
     48 and the job is 16 cabinets, it has been counting PANELS — three names
     per cabinet that never collapsed.

     Rather than throw the names away and number them 1..16, try to recover the
     real grouping: trim segments off either end and see whether the names fall
     into exactly the number asked for. "SPINTELE_A1_SONAS", "SPINTELE_A1_DURYS"
     and "SPINTELE_A1_LENTYNA" become "SPINTELE_A1" — which is what the cabinet
     is actually called. Only if nothing groups cleanly does it fall back to
     numbering. */
  /* ---------- one customer's job, not five unrelated projects ----------
     A house is quoted and drawn piece by piece — GI_SI_VIRT, GI_SI_MIEG,
     GI_SI_KOR are the kitchen, the bedroom and the hall of ONE job — and every
     view treated them as strangers. The shop already writes the grouping into
     the name, so read it rather than asking anyone to maintain it twice.

     An explicit portfolio always wins; a shared name prefix is the fallback,
     and only counts when more than one project actually shares it, so a
     one-off keeps its own name instead of being filed under half of it. */
  jobKeyOf(o, shared, byPrefix) {
    if (o.portfolioId && this.portfolio(o.portfolioId)) return "pf:" + o.portfolioId;
    const pre = this.namePrefix(o.product || o.num || "");
    /* A project nobody filed, whose name matches ones that WERE filed, belongs
       with them. GI_SI_KOR has no portfolio and "GI_SI_KOR" typed into its
       client field; GI_SI_MIEG and GI_SI_VIRT are both in "Giedrius Sirv".
       Without this the hall ends up in a lane of its own, which is the exact
       thing being fixed. Only when one portfolio claims that prefix — two
       would be a guess, and a guess here is worse than a separate row. */
    if (pre && byPrefix && byPrefix.get(pre) && byPrefix.get(pre).size === 1)
      return "pf:" + [...byPrefix.get(pre)][0];
    if (pre && (!shared || shared.has(pre))) return "px:" + pre;
    if (o.client) return "cl:" + this.norm(o.client);
    return "id:" + o.id;
  },
  /* everything before the last _ segment: GI_SI_VIRT → GI_SI */
  namePrefix(name) {
    const segs = String(name).split("_").filter(Boolean);
    return segs.length >= 2 ? segs.slice(0, -1).join("_") : "";
  },
  norm(v) { return String(v || "").trim().toLowerCase(); },

  /* ---------- a colour per job ----------
     Red is left out: in this app red means something is wrong — an overdue
     chip, a blocked note — and a job that merely exists should never borrow
     that. It stays pickable by hand, just never handed out automatically.

     With more jobs than hues two will eventually share one. The colour is
     derived from the job's own key, so it is stable: it never changes when the
     list is filtered or something else is added, and the name is still what
     identifies a lane — the colour only helps the eye find it again. */
  JOB_COLORS: ["blue", "indigo", "teal", "purple", "green", "orange", "gray"],

  jobColor(keyOrGroup) {
    const g = typeof keyOrGroup === "string" ? null : keyOrGroup;
    const key = g ? g.key : keyOrGroup;
    if (g && g.pf && g.pf.color) return g.pf.color;
    if (key && key.startsWith("pf:")) {
      const pf = this.portfolio(key.slice(3));
      if (pf && pf.color) return pf.color;
    }
    return this.JOB_COLORS[this._hue(String(key)) % this.JOB_COLORS.length];
  },

  /* FNV-1a with murmur3's finaliser. A plain djb2 put three of the shop's six
     visible lanes on the same green — short keys that differ in one or two
     characters land in neighbouring buckets without an avalanche step. On the
     40 jobs in the real backup this spreads 9/3/3/6/12/5/2 into 5/4/8/6/7/4/6. */
  _hue(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  },

  jobLabel(key, orders) {
    if (key.startsWith("pf:")) { const p = this.portfolio(key.slice(3)); return p ? p.name : "Portfolio"; }
    if (key.startsWith("px:")) return key.slice(3);
    if (key.startsWith("cl:")) return (orders[0] && orders[0].client) || "—";
    return (orders[0] && (orders[0].product || orders[0].num)) || "—";
  },

  /* The pieces of a job, and how the job as a whole is doing. */
  jobGroups(orders) {
    /* Which portfolios own which name prefixes — so a project left unfiled can
       be matched to the job its siblings are already in. */
    const byPrefix = new Map();
    for (const o of orders) {
      if (!(o.portfolioId && this.portfolio(o.portfolioId))) continue;
      const pre = this.namePrefix(o.product || o.num || "");
      if (!pre) continue;
      if (!byPrefix.has(pre)) byPrefix.set(pre, new Set());
      byPrefix.get(pre).add(o.portfolioId);
    }

    /* Count prefixes only among the projects nobody has filed by hand. A
       portfolio has already claimed its own, and counting those made a prefix
       look shared when the single project left behind was the only one using
       it — which filed it under half its own name. */
    const loose = orders.filter(o => !(o.portfolioId && this.portfolio(o.portfolioId)));
    const counts = new Map();
    for (const o of loose) {
      const pre = this.namePrefix(o.product || o.num || "");
      if (pre && !byPrefix.has(pre)) counts.set(pre, (counts.get(pre) || 0) + 1);
    }
    const shared = new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));

    const by = new Map();
    for (const o of orders) {
      const k = this.jobKeyOf(o, shared, byPrefix);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(o);
    }
    const groups = [...by].map(([key, list]) => {
      const dues = list.map(o => o.due).filter(Boolean);
      const done = list.reduce((n, o) => n + this.progress(o).done, 0);
      const total = list.reduce((n, o) => n + this.progress(o).total, 0);
      const pf = key.startsWith("pf:") ? this.portfolio(key.slice(3)) : null;
      return {
        key, orders: list, pf, color: this.jobColor({ key, pf }),
        label: this.jobLabel(key, list),
        client: list[0].client || "",
        single: list.length === 1,
        due: dues.length ? Math.min(...dues) : null,
        overdue: list.filter(o => o.due && o.due < Date.now() && !o.archived && !o.shipped).length,
        done, total, pct: total ? Math.round(done / total * 100) : 0,
      };
    });
    /* worst first: a job with something overdue is the one to look at */
    groups.sort((a, b) =>
      (b.overdue - a.overdue) ||
      ((a.due || Infinity) - (b.due || Infinity)) ||
      a.label.localeCompare(b.label));
    return groups;
  },

  /* Jobs imported before cabinets were tracked have no checklist at all. If
     their parts kept SOLIDNAME we can rebuild the real names from those; if
     they did not, there is genuinely nothing to recover and they get numbered.
     Mirrors what SWOOD.plan() does at import time, deliberately. */
  moduleNamesFromParts(o) {
    const out = new Set();
    for (const p of (o.parts || [])) {
      const solid = p.solid || "";
      if (!solid) continue;
      out.add(solid.startsWith(p.name + "_") ? solid.slice(p.name.length + 1) : solid);
    }
    return [...out].sort((a, b) => a.localeCompare(b));
  },

  regroupModules(names, want) {
    const uniq = (a) => [...new Set(a)];
    const segs = names.map(n => String(n).split("_").filter(Boolean));
    const depth = Math.max(...segs.map(x => x.length), 1);

    for (let keep = depth - 1; keep >= 1; keep--) {          // trim from the end
      const g = uniq(segs.map(x => x.slice(0, keep).join("_")));
      if (g.length === want) return g;
    }
    for (let drop = 1; drop < depth; drop++) {               // trim from the front
      const g = uniq(segs.map(x => x.slice(drop).join("_")));
      if (g.length === want) return g;
    }
    return null;
  },

  /* The task the checklist belongs to: the first step of the line that has no
     parts of its own — assembly, in a SWOOD import. */
  assemblyOp(o) {
    /* Not gated on the checklist any more: a job imported before cabinets were
       tracked has no checklist and still has an assembly line, and that is
       exactly the job whose count needs correcting. It IS gated on the job
       having cut parts, or "the item with no parts" would just be the only
       item on an ordinary one-line order. */
    if (!o || !(o.parts || []).length) return null;
    const partItems = new Set((o.parts || []).map(p => p.itemId));
    const item = o.items.find(i => !partItems.has(i.id));
    if (!item) return null;
    return o.ops.find(op => op.itemId === item.id) || null;
  },

  /* ---------- who is on a job ----------
     One name was never enough — two people carry a carcass. assigneeId stays
     the primary so nothing that reads it breaks; the list is what the UI uses. */
  /* ---------- who a task goes to before anyone touches it ----------
     In this shop one engineer does every stage after the idea. Leaving every
     task unassigned meant someone re-picking the same name on every project,
     and "Nepriskirta" reads as "nobody has this" when in fact it is always the
     same person. A station can name its default. */
  /* Several, not one: two people carry a carcass, and a stage can belong to a
     pair as easily as to a person. defaultAssigneeId stays readable so a
     station set before this still works. */
  stationDefaults(stationId) {
    const st = this.station(stationId);
    if (!st) return [];
    const raw = Array.isArray(st.defaultAssigneeIds) && st.defaultAssigneeIds.length
      ? st.defaultAssigneeIds
      : (st.defaultAssigneeId ? [st.defaultAssigneeId] : []);
    return raw.filter(id => this.member(id));
  },
  stationDefault(stationId) { return this.stationDefaults(stationId)[0] || null; },
  /* Stamp the station's person on tasks nobody has picked yet. Done in one
     place, after the ops are built, rather than at each of the six literals
     that create one — the variable holding the station id is named something
     different in most of them, which is exactly how this goes wrong. */
  applyStationDefaults(ops) {
    for (const op of ops || []) {
      if (op.assigneeId) continue;
      const crew = this.stationDefaults(op.stationId);
      if (crew.length) { op.assigneeIds = [...crew]; op.assigneeId = crew[0]; }
    }
    return ops;
  },

  opAssigneeIds(op) {
    if (Array.isArray(op.assigneeIds) && op.assigneeIds.length) return op.assigneeIds;
    return op.assigneeId ? [op.assigneeId] : [];
  },
  opAssignees(op) { return this.opAssigneeIds(op).map(id => this.member(id)).filter(Boolean); },
  opAssignedTo(op, memberId) { return this.opAssigneeIds(op).includes(memberId); },

  /* ---------- attachments ----------
     State holds only the metadata and a thumbnail; the bytes live in
     IndexedDB and, where a bucket is configured, in Supabase Storage. See
     files.js for why: the whole state document is pushed on every change. */
  files() { return Store.state.files = Store.state.files || []; },
  file(id) { return this.files().find(f => f.id === id) || null; },
  filesFor({ orderId = null, opId = null } = {}) {
    return this.files()
      .filter(f => (opId ? f.opId === opId : f.orderId === orderId && !f.opId))
      .sort((a, b) => a.at - b.at);
  },
  fileCount(orderId) { return this.files().filter(f => f.orderId === orderId).length; },

  /* ---------- Audit ----------
     Entries are sentences, not structured records — they were written to be
     read, and they predate any need to filter them. Rather than migrate every
     old line, the kind is derived from the words: the log is English by
     design (interpolated data makes partial translation worse than none), so
     matching on it is safe. */
  ACT_KINDS: [
    ["progress",  "Progress",  /\b(started|paused|completed|reported|moved|reopened|scan|shipped|delivered|unblocked|blocked)\b/i],
    ["materials", "Materials", /\b(material|stock|consumed|used|received|supplier|purchase|drafted|sent)\b|PO-/i],
    ["routing",   "Routing",   /\b(step|routing|reordered|filled in|station)\b/i],
    ["people",    "People",    /\b(assigned|claimed|unassigned|member|role|PIN|revoked)\b/i],
    ["created",   "Created",   /\b(created|imported|copied|handed off|drafted a)\b/i],
    ["admin",     "Admin",     /\b(archived|restored|deleted|renamed|reset|settings|backup|shift)\b/i],
  ],
  activityKind(a) {
    const t = String((a && a.text) || "");
    for (const [id, , re] of this.ACT_KINDS) if (re.test(t)) return id;
    return "other";
  },

  /* Every change on one project, newest first. */
  orderHistory(orderId) {
    const o = this.order(orderId);
    return Store.state.activity.filter(a => a.orderId === orderId || (o && a.text.includes(o.num)));
  },


  /* ---------- View prefs (per member) ---------- */
  pref(memberId, key, def) {
    const v = Store.state.prefs?.[memberId]?.[key];
    return v === undefined ? def : v;
  },

  /* ---------- Reporting ----------
     Every duration here goes through workMsBetween, so a lead time reads in
     working days, not calendar days — a job finished Monday morning that
     arrived Friday afternoon took a couple of hours, not a weekend. */

  /* When a project was actually finished: shipping wins, otherwise the moment
     its last task was completed. Null while anything is still open. */
  orderFinishedAt(o) {
    if (o.shippedAt) return o.shippedAt;
    if (!o.ops.length || !o.ops.every(op => op.status === "done")) return null;
    return o.ops.reduce((t, op) => Math.max(t, op.completedAt || 0), 0) || null;
  },
  orderActualMs(o) { return o.ops.reduce((ms, op) => ms + this.opElapsed(op), 0); },
  orderEstMs(o) { return o.ops.reduce((ms, op) => ms + (op.estMins || 0) * 60000, 0); },
  orderLeadMs(o) {
    const fin = this.orderFinishedAt(o);
    return fin ? this.workMsBetween(o.createdAt, fin) : null;
  },

  /* A task carries one cumulative loggedMs, not a time series, so its time is
     attributed to when it was worked — finished, or failing that started.
     Everything downstream says "work finished in this period" for that reason. */
  opWorkedAt(op) { return op.completedAt || op.startedAt || null; },

  /* Mon-based week starts, so buckets line up with how a shop talks about weeks */
  weekStart(ts) {
    const d = new Date(ts); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  },
  monthStart(ts) { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); },

  /* Weekly buckets while they stay readable, monthly beyond that */
  reportBuckets(from, to) {
    const byMonth = to - from > 130 * DAY;
    const out = [];
    let cur = byMonth ? this.monthStart(from) : this.weekStart(from);
    let guard = 0;
    while (cur <= to && guard++ < 400) {
      const d = new Date(cur);
      const next = byMonth ? new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
        : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
      out.push({ from: cur, to: next - 1, byMonth, n: 0 });
      cur = next;
    }
    return out;
  },

  reportScope(o, scope) { return scope === "all" ? true : scope === "eng" ? o.type === "eng" : o.type !== "eng"; },

  /* One pass over the orders — every figure the Reports view shows. */
  report({ from, to, scope = "all" }) {
    const orders = Store.state.orders.filter(o => this.reportScope(o, scope));

    const finished = [];
    for (const o of orders) {
      const fin = this.orderFinishedAt(o);
      if (fin && fin >= from && fin <= to) finished.push({ order: o, finishedAt: fin });
    }
    finished.sort((a, b) => b.finishedAt - a.finishedAt);

    const onTime = finished.filter(f => f.finishedAt <= f.order.due).length;
    const leads = finished.map(f => this.workMsBetween(f.order.createdAt, f.finishedAt));
    const avgLead = leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : 0;

    const buckets = this.reportBuckets(from, to);
    for (const f of finished) {
      const b = buckets.find(x => f.finishedAt >= x.from && f.finishedAt <= x.to);
      if (b) b.n++;
    }

    // time worked in the period, by station and by person
    const byStation = new Map(), byMember = new Map();
    let workedMs = 0, estMs = 0;
    for (const o of orders) {
      for (const op of o.ops) {
        const at = this.opWorkedAt(op);
        if (!at || at < from || at > to) continue;
        const ms = this.opElapsed(op);
        if (!ms) continue;
        workedMs += ms; estMs += (op.estMins || 0) * 60000;
        const st = byStation.get(op.stationId) || { ms: 0, est: 0, n: 0 };
        st.ms += ms; st.est += (op.estMins || 0) * 60000; st.n++;
        byStation.set(op.stationId, st);
        if (op.assigneeId) {
          const mb = byMember.get(op.assigneeId) || { ms: 0, n: 0 };
          mb.ms += ms; mb.n++;
          byMember.set(op.assigneeId, mb);
        }
      }
    }

    const stations = [...byStation.entries()]
      .map(([id, v]) => ({ station: this.station(id), ...v }))
      .filter(x => x.station).sort((a, b) => b.ms - a.ms);
    const members = [...byMember.entries()]
      .map(([id, v]) => ({ member: this.member(id), ...v }))
      .filter(x => x.member).sort((a, b) => b.ms - a.ms);

    return {
      from, to, scope, finished, buckets, stations, members,
      count: finished.length,
      onTime, onTimePct: finished.length ? Math.round(onTime / finished.length * 100) : null,
      avgLead, workedMs, estMs,
      openCount: orders.filter(o => !o.archived && !this.orderFinishedAt(o)).length,
    };
  },
};

function prioRank(order) { return { rush: 0, high: 1, normal: 2, low: 3 }[order.priority] ?? 2; }

/* ============================================================
   Mutations (all go through here → persisted + activity log)
   ============================================================ */
const M = {
  log(who, text, meta = {}) {
    Store.state.activity.unshift({ ts: Date.now(), who, text, ...meta });
    if (Store.state.activity.length > 500) Store.state.activity.length = 500;
  },

  _opName(o, op) {
    const { station, suffix } = D.opLabel(o, op);
    return `${station ? station.name : "?"}${suffix ? " · " + suffix : ""}`;
  },

  _pauseOtherRunning(memberId) {
    for (const o of Store.state.orders) {
      for (const op of o.ops) {
        if (op.status === "running" && D.opAssignedTo(op, memberId)) {
          op.loggedMs = D.opElapsed(op); op.startedAt = null; op.status = "paused";
        }
      }
    }
  },

  startOp(orderId, opId, memberId) {
    const o = D.order(orderId); const op = o.ops.find(x => x.id === opId);
    this._pauseOtherRunning(memberId);
    // fold any already-ticking time (e.g. op was running unassigned) before resetting the clock
    if (op.status === "running" && op.startedAt) op.loggedMs = D.opElapsed(op);
    if (memberId) op.assigneeId = memberId;
    op.status = "running"; op.startedAt = Date.now(); op.blockNote = null;
    op.autoStarted = false;                            // a person is holding this one
    this.log(memberId, `started **${this._opName(o, op)}** on ${o.num}`, { orderId });
    Store.save();
  },

  pauseOp(orderId, opId, memberId) {
    const o = D.order(orderId); const op = o.ops.find(x => x.id === opId);
    op.loggedMs = D.opElapsed(op); op.startedAt = null; op.status = "paused";
    this.log(memberId, `paused **${this._opName(o, op)}** on ${o.num}`, { orderId });
    Store.save();
  },

  /* Report produced pieces at an op (MRPEasy-style partial completion).
     Auto-completes the op when the full item quantity is reached. */
  reportQty(orderId, opId, qty, memberId, opts = {}) {
    const o = D.order(orderId); const op = o.ops.find(x => x.id === opId);
    const item = D.item(o, op.itemId);
    const avail = D.opAvail(o, op);
    // never force an already-reported count down to a shrunken avail — allow stepping down one at a time
    const upper = Math.max(avail, Math.min(op.qtyDone, item.qty));
    const clamped = Math.max(0, Math.min(qty, upper));
    if (clamped === op.qtyDone) return op.qtyDone;
    op.qtyDone = clamped;
    if (op.qtyDone >= item.qty) {
      op.loggedMs = D.opElapsed(op); op.startedAt = null;
      op.status = "done"; op.completedAt = Date.now(); op.completedBy = memberId; op.blockNote = null;
      if (!opts.silent) this.log(memberId, `completed **${this._opName(o, op)}** on ${o.num} — all ${item.qty} ${item.qty > 1 ? "pcs" : "pc"} done`, { orderId });
    } else if (!opts.silent) {
      this.log(memberId, `reported **${op.qtyDone} of ${item.qty} pcs** at ${this._opName(o, op)} on ${o.num}`, { orderId });
    }
    Store.save();
    return op.qtyDone;
  },

  /* Register a scanned part at a station. Dedups by part code per op. */
  scanPart(payload, stationId, memberId) {
    const parsed = D.scanParse(payload);
    const push = (status, extra) => {
      const rec = { ts: Date.now(), by: memberId, payload: String(payload).slice(0, 60), status,
                    orderId: extra?.order?.id || null, stationId: extra?.station?.id || stationId || null,
                    partCode: parsed?.partCode || null };
      Store.state.scanLog.unshift(rec);
      if (Store.state.scanLog.length > 300) Store.state.scanLog.length = 300;
      Store.save();
      return { status, parsed, ...extra };
    };
    if (!parsed || !parsed.order) return push("notfound", { order: parsed?.order || null });
    if (parsed.unknownPart) return push("unknownPart", { order: parsed.order });
    const o = parsed.order;
    const st = D.station(parsed.stationId || stationId);
    if (!st) return push("nostation", { order: o });
    // candidate ops at this station (optionally for the scanned item), not yet done
    let cands = o.ops.filter(op => op.stationId === st.id && op.status !== "done");
    if (parsed.item) cands = cands.filter(op => op.itemId === parsed.item.id);
    const op = cands.find(op => D.opReady(o, op)) || cands[0];
    if (!op) {
      const routed = o.ops.some(op => op.stationId === st.id);
      return push(routed ? "stationDone" : "notrouted", { order: o, station: st });
    }
    const item = D.item(o, op.itemId);
    // dedup identical part scanned twice at the same op
    op.scanCodes = op.scanCodes || [];
    if (parsed.partCode && op.scanCodes.includes(parsed.partCode))
      return push("dup", { order: o, station: st, item, op });
    if (op.qtyDone >= item.qty) return push("stationDone", { order: o, station: st, item, op });
    if (op.qtyDone >= D.opAvail(o, op)) return push("waiting", { order: o, station: st, item, op });
    if (parsed.partCode) op.scanCodes.push(parsed.partCode);
    const wasStatus = op.status;
    if (!op.assigneeId) op.assigneeId = memberId;
    this.touchScanClock(op, memberId);               // the scan IS the timer
    const newQty = this.reportQty(o.id, op.id, op.qtyDone + 1, memberId, { silent: true });
    const completed = D.order(o.id).ops.find(x => x.id === op.id).status === "done";
    if (completed) this.log(memberId, `scan: completed **${this._opName(o, op)}** on ${o.num} — ${item.qty} pcs`, { orderId: o.id });
    return push(completed ? "opDone" : "ok", { order: o, station: st, item, op, qtyDone: newQty });
  },

  /* ---- automatic time tracking ----
     Workers scan parts because the job needs it; nobody should also have to
     remember a stopwatch. A scan opens a run, later scans extend it, and a
     run closes itself after `idleMins` of silence — at the last scan, not at
     whatever time somebody finally notices. */
  touchScanClock(op, memberId) {
    if (!D.shift().auto) {                            // shop prefers manual control
      if (op.status === "queued") op.status = "paused";
      return;
    }
    const now = Date.now();
    if (op.status === "running") {
      if (D.opRunStale(op, now)) {                    // previous session already ended
        op.loggedMs = D.opElapsed(op);
        op.startedAt = now;                           // and this scan opens a new one
      }
    } else {
      this._pauseOtherRunning(memberId);              // one job at a time per person
      op.loggedMs = op.loggedMs || 0;
      op.status = "running"; op.startedAt = now;
    }
    op.autoStarted = true;
    op.lastScanAt = now;
  },

  /* Close out runs that have gone quiet, so the board stops showing them as
     live work. Returns how many it settled. Cheap and idempotent. */
  sweepClocks() {
    let closed = 0;
    for (const o of Store.state.orders) {
      if (o.archived || o.shipped) continue;
      for (const op of o.ops) {
        if (!D.opRunStale(op)) continue;
        op.loggedMs = D.opElapsed(op);
        op.startedAt = null;
        op.status = op.qtyDone > 0 ? "paused" : "queued";
        op.autoStarted = false;
        closed++;
      }
    }
    if (closed) Store.save();
    return closed;
  },

  setScanPrefix(prefix, stationId) {
    Store.state.scan = Store.state.scan || { prefixes: {} };
    if (!stationId) delete Store.state.scan.prefixes[prefix];
    else Store.state.scan.prefixes[prefix] = stationId;
    Store.save();
  },

  completeOp(orderId, opId, memberId) {
    const o = D.order(orderId); const op = o.ops.find(x => x.id === opId);
    const item = D.item(o, op.itemId);
    const avail = D.opAvail(o, op);
    op.loggedMs = D.opElapsed(op); op.startedAt = null;
    if (item && avail < item.qty) {
      // upstream hasn't produced everything yet — report what's possible (never lower an existing count)
      op.qtyDone = Math.max(op.qtyDone, avail); op.status = "paused";
      this.log(memberId, `reported **${op.qtyDone} of ${item.qty} pcs** at ${this._opName(o, op)} on ${o.num} — waiting for upstream`, { orderId });
      Store.save();
      return null;
    }
    op.qtyDone = item ? item.qty : 1;
    op.status = "done"; op.completedAt = Date.now(); op.completedBy = memberId; op.blockNote = null;
    const next = D.activeOps(o).find(x => x.itemId === op.itemId && x.group === op.group) || D.activeOps(o)[0] || null;
    this.log(memberId, next
      ? `completed **${this._opName(o, op)}** on ${o.num} → next: ${this._opName(o, next)}`
      : `completed **${this._opName(o, op)}** on ${o.num}${o.ops.every(x => x.status === "done") ? " — ready to ship 🎉" : ""}`, { orderId });
    Store.save();
    return next;
  },

  /* ---- create a manufacturing project straight from a SWOOD plan ----
     One item per board material (qty = pieces of that board) plus a module
     line for assembly, so a scanned part increments the line it belongs to. */
  /* `scope` is how many of the whole project are being made: a report list
     describes one, and the shop often builds sixteen. It multiplies the
     pieces, the parts and the modules, which is also what keeps scanning
     honest — the same label is scanned scope× as many times.

     `consumables`, when given, REPLACES the plan's own materials and is taken
     as final: the import dialog has already applied the scope and whatever
     the user corrected, because a report list names materials the way the
     designer wrote them, not the way the warehouse does. */
  createFromSwood(plan, { product, client, due, priority, notes, portfolioId, oneDriveUrl,
                          moduleQty, scope, consumables, lineNames }, byId) {
    const s = Store.state;
    const id = uid("o");
    const num = "WO-" + (s.orderSeq++);
    const items = [], ops = [], parts = [];
    const mult = Math.max(1, Math.round(Number(scope) || 1));

    for (const line of plan.items) {
      const named = (lineNames && lineNames[line.name]) || line.name;
      const item = { id: uid("it"), articleId: null, name: named, qty: line.qty * mult };
      items.push(item);
      for (const stId of line.route) {
        const st = D.station(stId); if (!st) continue;
        ops.push({ id: uid("op"), itemId: item.id, group: null, stationId: stId,
                   estMins: Math.max(st.estMins, Math.round(st.estMins * item.qty / 8)),
                   status: "queued", qtyDone: 0, assigneeId: null, loggedMs: 0,
                   startedAt: null, completedAt: null, blockNote: null });
      }
      for (const code of line.partCodes) {
        const p = plan.parts.find(x => x.code === code);
        if (p) parts.push({ code: p.code, name: p.name, board: p.board, l: p.l, w: p.w,
                            qty: p.qty * mult, edges: p.edges, notes: p.notes,
                            solid: p.solid || "",      // which cabinet the part belongs to
                            itemId: item.id });
      }
    }

    // assembly / QC / packing counted in modules, not panels
    const mods = Math.max(1, (moduleQty || plan.moduleCount || 1) * mult);
    /* Named, so assembly can be ticked off cabinet by cabinet rather than as a
       number nobody can map onto the bench in front of them. */
    const modules = (plan.moduleNames || []).map(name => ({
      id: uid("mod"), name, qty: mult, done: 0,
    }));
    if (plan.finalRoute.length) {
      const item = { id: uid("it"), articleId: null, name: plan.finalName, qty: mods };
      items.push(item);
      for (const stId of plan.finalRoute) {
        const st = D.station(stId); if (!st) continue;
        ops.push({ id: uid("op"), itemId: item.id, group: null, stationId: stId,
                   estMins: Math.max(st.estMins, Math.round(st.estMins * mods / 8)),
                   status: "queued", qtyDone: 0, assigneeId: null, loggedMs: 0,
                   startedAt: null, completedAt: null, blockNote: null });
      }
    }

    D.applyStationDefaults(ops);

    // consumables: whatever the dialog settled on, else the plan's own list scaled
    const materials = [];
    const source = consumables || [...plan.boards, ...plan.edgeband, ...plan.hardware]
      .map(g => ({ name: g.name, qty: g.qty * mult, unit: g.unit }));
    for (const g of source) {
      const mat = g.materialId ? D.material(g.materialId) : D.matchMaterial(g.name);
      materials.push({ id: uid("ml"), materialId: mat ? mat.id : null, name: g.name,
                       qty: g.qty, unit: mat ? mat.unit : g.unit, consumed: false, consumedBy: null, consumedAt: null });
    }

    const order = {
      id, num, type: "prod",
      product: product || plan.project, client: client || "",
      qty: items.reduce((n, i) => n + i.qty, 0), unit: "pcs",
      priority: priority || "normal", due: due || (Date.now() + 14 * DAY),
      notes: notes || "", shipped: false, archived: false, createdAt: Date.now(),
      portfolioId: portfolioId || null, oneDriveUrl: oneDriveUrl || "",
      modules,
      swood: { project: plan.project, importedAt: Date.now(), importedBy: byId,
               pieces: plan.totalPieces * mult, modules: mods, scope: mult },
      materials, items, ops, comments: [], parts,
    };
    s.orders.unshift(order);
    this.log(byId, `imported **${plan.project}** from SWOOD → ${num} · ${parts.length} parts, ${plan.totalPieces * mult} pcs across ${plan.items.length} materials${mult > 1 ? ` (×${mult})` : ""}`, { orderId: id });
    Store.save();
    return order;
  },

  /* Append the stages an imported job never got. Only ever adds: every task
     already done, running or counted keeps exactly what it had. */
  repairSwoodRoute(orderId, byId) {
    const o = D.order(orderId);
    const gaps = D.swoodRouteGaps(o);
    if (!gaps) return 0;
    let added = 0;
    const mkOp = (itemId, st, qty) => ({
      id: uid("op"), itemId, group: null, stationId: st.id,
      estMins: Math.max(st.estMins, Math.round(st.estMins * qty / 8)),
      status: "queued", qtyDone: 0, assigneeId: D.stationDefault(st.id), loggedMs: 0,
      startedAt: null, completedAt: null, blockNote: null,
    });
    for (const { item, stations } of gaps.add) {
      // keep each item's tasks together and in flow order
      const at = o.ops.map((op, i) => op.itemId === item.id ? i : -1).filter(i => i >= 0).pop();
      const fresh = stations.map(st => mkOp(item.id, st, item.qty));
      o.ops.splice(at + 1, 0, ...fresh);
      added += fresh.length;
    }
    if (gaps.addFinal) {
      const item = { id: uid("it"), articleId: null, name: "Surinkimas ir pakavimas", qty: gaps.modules };
      o.items.push(item);
      for (const st of gaps.addFinal) { o.ops.push(mkOp(item.id, st, gaps.modules)); added++; }
      o.qty = o.items.reduce((n, i) => n + i.qty, 0);
    }
    if (added) this.log(byId, `filled in ${added} missing step(s) on **${o.num}**`, { orderId: o.id });
    Store.save();
    return added;
  },

  /* ---- duplicate a manufacturing / engineering project ----
     A copy is a fresh job: same product structure and route, but no progress,
     no logged time, no conversation and its own number. */
  duplicateOrder(orderId, { name, copyMaterials = true, copyAssignees = false } = {}, byId) {
    const src = D.order(orderId);
    if (!src) return null;
    let wanted = (name || "").trim() || D.uniqueName(src.product, n => D.projectNameTaken(n));
    if (D.projectNameTaken(wanted)) wanted = D.uniqueName(wanted, n => D.projectNameTaken(n));

    const s = Store.state;
    const id = uid("o");
    const num = src.type === "eng" ? "ENG-" + (s.engSeq++) : "WO-" + (s.orderSeq++);
    const itemMap = {};
    const items = src.items.map(it => { const nid = uid("it"); itemMap[it.id] = nid; return { ...it, id: nid }; });
    const ops = src.ops.map(op => ({
      ...op, id: uid("op"), itemId: itemMap[op.itemId] || items[0]?.id || null,
      status: "queued", qtyDone: 0, loggedMs: 0, startedAt: null,
      completedAt: null, completedBy: null, blockNote: null,
      assigneeId: copyAssignees ? op.assigneeId || null : null,
    }));
    const order = {
      ...structuredClone(src),
      id, num, product: wanted, items, ops,
      materials: copyMaterials ? structuredClone(src.materials || []).map(m => ({ ...m, consumed: 0 })) : [],
      comments: [], shipped: false, shippedAt: null, archived: false, archivedAt: null,
      createdAt: Date.now(), clientApproved: false, clientApprovedAt: null,
      fromEngId: null, handedOffTo: null,
    };
    s.orders.unshift(order);
    this.log(byId, `copied **${src.num}** → **${order.num}** (${esc0(wanted)})`, { orderId: order.id });
    Store.save();
    return order;
  },

  blockOp(orderId, opId, memberId, note) {
    const o = D.order(orderId); const op = o.ops.find(x => x.id === opId);
    op.loggedMs = D.opElapsed(op); op.startedAt = null;
    op.status = "blocked"; op.blockNote = note || "Blocked";
    this.log(memberId, `blocked **${this._opName(o, op)}** on ${o.num} — ${note || ""}`, { orderId });
    Store.save();
  },

  unblockOp(orderId, opId, memberId) {
    const o = D.order(orderId); const op = o.ops.find(x => x.id === opId);
    op.status = op.loggedMs > 0 ? "paused" : "queued"; op.blockNote = null;
    this.log(memberId, `unblocked **${this._opName(o, op)}** on ${o.num}`, { orderId });
    Store.save();
  },

  reopenOp(orderId, opId, memberId) {
    const o = D.order(orderId); const op = o.ops.find(x => x.id === opId);
    op.status = "paused"; op.completedAt = null;
    this.log(memberId, `reopened **${this._opName(o, op)}** on ${o.num}`, { orderId });
    Store.save();
  },

  assignOp(orderId, opId, memberId, byId) {
    const o = D.order(orderId); const op = o.ops.find(x => x.id === opId);
    const prev = D.member(op.assigneeId);
    op.assigneeId = memberId || null;
    this.log(byId, memberId
      ? `assigned **${this._opName(o, op)}** on ${o.num} to ${D.member(memberId).name}`
      : `unassigned **${this._opName(o, op)}** on ${o.num}${prev ? ` (was ${prev.name})` : ""}`, { orderId });
    Store.save();
  },

  /* Name the person a station's work goes to, and offer to fix what is already
     sitting there unassigned — otherwise the setting only helps future work
     and every project already on the board stays blank. */
  setStationDefault(stationId, memberIds, byId) {
    const st = D.station(stationId);
    if (!st) return null;
    const ids = (Array.isArray(memberIds) ? memberIds : [memberIds])
      .filter(id => id && D.member(id));
    st.defaultAssigneeIds = ids;
    st.defaultAssigneeId = ids[0] || null;          // what older code still reads
    const names = ids.map(id => D.member(id).name).join(", ");
    this.log(byId, ids.length
      ? `**${names}** now get new ${esc0(st.name)} tasks`
      : `no default person for ${esc0(st.name)} any more`);
    Store.save();
    return { station: st, ids, pending: this.pendingAtStation(stationId) };
  },

  /* tasks already on the board that nobody has picked up */
  pendingAtStation(stationId) {
    let n = 0;
    for (const o of Store.state.orders) {
      if (o.archived) continue;
      for (const op of o.ops) {
        if (op.stationId === stationId && op.status !== "done" && !D.opAssigneeIds(op).length) n++;
      }
    }
    return n;
  },

  assignPendingAtStation(stationId, memberIds, byId) {
    const ids = (Array.isArray(memberIds) ? memberIds : [memberIds]).filter(id => id && D.member(id));
    if (!ids.length) return 0;
    let n = 0;
    for (const o of Store.state.orders) {
      if (o.archived) continue;
      for (const op of o.ops) {
        if (op.stationId !== stationId || op.status === "done" || D.opAssigneeIds(op).length) continue;
        op.assigneeIds = [...ids]; op.assigneeId = ids[0]; n++;
      }
    }
    const names = ids.map(id => D.member(id).name).join(", ");
    if (n) this.log(byId, `assigned **${names}** to ${n} unassigned ${esc0((D.station(stationId) || {}).name)} task${n === 1 ? "" : "s"}`);
    Store.save();
    return n;
  },

  /* ---------- Routing editing ---------- */
  addOp(orderId, stationId, estMins, byId, itemId, group) {
    const o = D.order(orderId);
    const st = D.station(stationId);
    const item = itemId ? D.item(o, itemId) : o.items[0];
    const newOp = {
      id: uid("op"), itemId: item.id, group: group ?? null,
      stationId, estMins: estMins || st.estMins,
      status: "queued", qtyDone: 0, assigneeId: D.stationDefault(stationId), loggedMs: 0,
      startedAt: null, completedAt: null, blockNote: null,
    };
    // keep lanes contiguous: insert right after the lane's current last op
    const lane = D.laneOps(o, item.id, newOp.group);
    if (lane.length) o.ops.splice(o.ops.indexOf(lane[lane.length - 1]) + 1, 0, newOp);
    else o.ops.push(newOp);
    o.shipped = false;
    this.log(byId, `added step **${st.name}${group ? " · " + group : ""}** to ${o.num} routing`, { orderId });
    Store.save();
  },

  removeOp(orderId, opId, byId) {
    const o = D.order(orderId);
    const op = o.ops.find(x => x.id === opId);
    if (!op || op.status === "done") return false;
    o.ops = o.ops.filter(x => x.id !== opId);
    this.log(byId, `removed step **${D.station(op.stationId)?.name || "?"}** from ${o.num} routing`, { orderId });
    Store.save();
    return true;
  },

  moveOp(orderId, opId, dir, byId) {
    const o = D.order(orderId);
    const op = o.ops.find(x => x.id === opId);
    if (!op || op.status === "done") return false;
    // swap with the lane neighbour (lane order = array order, but lanes may not be array-contiguous)
    const lane = D.laneOps(o, op.itemId, op.group);
    const li = lane.indexOf(op), lj = li + dir;
    if (lj < 0 || lj >= lane.length || lane[lj].status === "done") return false;
    const i = o.ops.indexOf(lane[li]), j = o.ops.indexOf(lane[lj]);
    [o.ops[i], o.ops[j]] = [o.ops[j], o.ops[i]];
    this.log(byId, `reordered routing on ${o.num}`, { orderId });
    Store.save();
    return true;
  },

  /* Drag a lane's task to a station column: complete lane ops before it, reopen from it */
  moveLane(orderId, itemId, group, stationId, byId) {
    const o = D.order(orderId);
    const item = D.item(o, itemId);
    if (stationId === "__ready") {
      for (const op of o.ops) if (op.status !== "done") {
        op.loggedMs = D.opElapsed(op); op.startedAt = null;
        op.status = "done"; op.qtyDone = D.item(o, op.itemId).qty; op.completedAt = Date.now(); op.completedBy = byId;
      }
      this.log(byId, `moved ${o.num} to **Ready to ship**`, { orderId });
      Store.save(); return true;
    }
    const lane = D.laneOps(o, itemId, group);
    const idx = lane.findIndex(op => op.stationId === stationId);
    if (idx < 0) return false;
    lane.forEach((op, i) => {
      if (i < idx && op.status !== "done") {
        op.loggedMs = D.opElapsed(op); op.startedAt = null;
        op.status = "done"; op.qtyDone = item.qty; op.completedAt = Date.now(); op.completedBy = byId;
      }
      if (i === idx && op.status === "done") { op.status = "queued"; op.qtyDone = 0; op.completedAt = null; }
      if (i > idx && (op.status !== "queued" || op.qtyDone > 0)) {
        // everything downstream of the new position starts over
        op.loggedMs = D.opElapsed(op); op.startedAt = null;
        op.status = "queued"; op.qtyDone = 0; op.completedAt = null; op.blockNote = null;
      }
    });
    o.shipped = false; o.archived = false;
    this.log(byId, `moved ${o.num}${group ? ` · ${group}` : ""} to **${D.station(stationId).name}**`, { orderId });
    Store.save();
    return true;
  },

  /* Legacy helper: single-lane orders only */
  moveOrderToStation(orderId, stationId, byId) {
    const o = D.order(orderId);
    if (stationId === "__ready") return this.moveLane(orderId, o.items[0].id, null, "__ready", byId);
    // find the unique lane containing this station
    const lanes = [];
    for (const it of o.items) {
      for (const g of [...D.itemGroups(o, it.id), null])
        if (D.laneOps(o, it.id, g).some(op => op.stationId === stationId)) lanes.push([it.id, g]);
    }
    if (lanes.length !== 1) return false;
    return this.moveLane(orderId, lanes[0][0], lanes[0][1], stationId, byId);
  },

  shipOrder(orderId, byId) {
    const o = D.order(orderId);
    o.shipped = true; o.shippedAt = Date.now();
    o.archived = true; o.archivedAt = Date.now();       // ending a project archives it
    this.log(byId, o.type === "eng" ? `delivered **${o.num}** — ${o.product}` : `shipped **${o.num}** — ${o.product}`, { orderId });
    Store.save();
  },

  /* End a project (any state) → send to archive */
  archiveOrder(orderId, byId) {
    const o = D.order(orderId);
    o.archived = true; o.archivedAt = Date.now();
    this.log(byId, `archived **${o.num}** — ${o.product}`, { orderId });
    Store.save();
  },
  unarchiveOrder(orderId, byId) {
    const o = D.order(orderId);
    o.archived = false; o.archivedAt = null; o.shipped = false; o.shippedAt = null;
    this.log(byId, `restored **${o.num}** from archive`, { orderId });
    Store.save();
  },

  /* Hand an engineering project off to production: spawn a linked manufacturing
     project and archive the engineering one (its design phase is done). */
  handoffToProduction(engId, { route, lines }, byId) {
    const eng = D.order(engId);
    const prod = this.createOrder({
      type: "prod", product: eng.product, client: eng.client,
      unit: "vnt", priority: eng.priority, due: eng.due,
      notes: eng.notes, portfolioId: eng.portfolioId, oneDriveUrl: eng.oneDriveUrl,
      route, lines,
    }, byId);
    prod.fromEngId = eng.id;
    eng.handedOffTo = prod.id;
    eng.archived = true; eng.archivedAt = Date.now();
    this.log(byId, `handed off **${eng.num}** to production → created **${prod.num}**`, { orderId: prod.id });
    Store.save();
    return prod;
  },

  /* Create order.
     type "prod": either `lines` [{articleId, qty} | {name, qty, route:[{stationId,estMins}]}]
                  or legacy `route` (single custom item)
     type "eng":  `stages` [stationId…] */
  createOrder({ type = "prod", product, client, qty, unit, priority, due, notes, route, lines, stages, portfolioId, oneDriveUrl }, byId) {
    const s = Store.state;
    const num = type === "eng" ? "ENG-" + (s.engSeq++) : "WO-" + (s.orderSeq++);
    const id = uid("o");
    const items = [];
    const ops = [];

    if (type === "eng") {
      const item = { id: id + "-it0", articleId: null, name: "Project", qty: 1 };
      items.push(item);
      for (const stId of (stages || [])) {
        const st = D.station(stId);
        ops.push({ id: uid("op"), itemId: item.id, group: null, stationId: stId, estMins: st.estMins, status: "queued", qtyDone: 0, assigneeId: null, loggedMs: 0, startedAt: null, completedAt: null, blockNote: null });
      }
    } else if (lines && lines.length) {
      for (const line of lines) {
        const item = { id: uid("it"), articleId: line.articleId || null, name: line.name, qty: line.qty };
        items.push(item);
        if (line.articleId) {
          const art = D.article(line.articleId);
          item.name = art.name;
          ops.push(...opsFromArticle(art, item));
        } else {
          for (const r of (line.route || [])) {
            ops.push({ id: uid("op"), itemId: item.id, group: null, stationId: r.stationId, estMins: r.estMins, status: "queued", qtyDone: 0, assigneeId: null, loggedMs: 0, startedAt: null, completedAt: null, blockNote: null });
          }
        }
      }
    } else {
      const item = { id: id + "-it0", articleId: null, name: "General", qty: qty || 1 };
      items.push(item);
      for (const r of (route || [])) {
        ops.push({ id: uid("op"), itemId: item.id, group: null, stationId: r.stationId, estMins: r.estMins, status: "queued", qtyDone: 0, assigneeId: r.assigneeId || null, loggedMs: 0, startedAt: null, completedAt: null, blockNote: null });
      }
    }
    D.applyStationDefaults(ops);

    const order = {
      id, num, type, product, client,
      qty: items.reduce((sum, i) => sum + i.qty, 0), unit: unit || (type === "eng" ? "project" : "units"),
      priority: priority || "normal", due, notes: notes || "",
      shipped: false, archived: false, createdAt: Date.now(), portfolioId: portfolioId || null,
      oneDriveUrl: oneDriveUrl || "",
      materials: [], items, ops,
    };
    Store.state.orders.unshift(order);
    const taskNote = ops.length ? ` — ${ops.length} tasks created` : "";
    this.log(byId, `created ${type === "eng" ? "engineering project" : "order"} **${num}** for ${client}${taskNote}`, { orderId: order.id });
    Store.save();
    return order;
  },

  updateOrder(orderId, patch, byId) {
    const o = D.order(orderId);
    Object.assign(o, patch);
    Store.save();
  },

  /* ---------- modules ---------- */
  setModuleDone(orderId, moduleId, done, byId) {
    const o = D.order(orderId);
    const m = D.module(o, moduleId);
    if (!o || !m) return null;
    m.done = Math.max(0, Math.min(m.qty || 1, Math.round(Number(done) || 0)));
    /* the assembly task counts modules, so the tick IS the report — keeping
       them as two numbers somebody has to reconcile is how they drift apart */
    const op = D.assemblyOp(o);
    if (op) {
      const total = D.modulesDone(o);
      const item = D.item(o, op.itemId);
      op.qtyDone = Math.min(total, item ? item.qty : total);
      if (op.status === "queued" && op.qtyDone > 0) op.status = "paused";
      if (item && op.qtyDone >= item.qty && op.status !== "done") {
        op.status = "done"; op.completedAt = Date.now();
        op.loggedMs = D.opElapsed(op); op.startedAt = null;
      } else if (op.status === "done" && item && op.qtyDone < item.qty) {
        op.status = "paused"; op.completedAt = null;
      }
    }
    this.log(byId, `${m.done ? "assembled" : "un-ticked"} **${esc0(m.name)}** on ${o.num}`, { orderId });
    Store.save();
    return m;
  },

  /* Set how many cabinets this job really is. The assembly line is counted in
     modules, so the task targets move with it. */
  setModuleCount(orderId, want, byId) {
    const o = D.order(orderId);
    if (!o) return null;
    const n = Math.max(1, Math.round(Number(want) || 0));
    const old = D.orderModules(o);
    if (old.length === n) return null;

    const scope = (o.swood && o.swood.scope) || (old[0] && old[0].qty) || 1;
    const doneBefore = D.modulesDone(o);
    /* With a checklist, regroup what is there. Without one — a job imported
       before any of this existed — the parts are the only place the cabinets'
       names could still be. */
    const source = old.length ? old.map(m => m.name) : D.moduleNamesFromParts(o);
    const names = source.length === n ? source : D.regroupModules(source, n);
    const recovered = !!names;

    o.modules = (names || Array.from({ length: n }, (_, i) => `Cabinet ${i + 1}`))
      .map(name => ({ id: uid("mod"), name, qty: scope, done: 0 }));

    /* what was already assembled stays assembled — filled from the top, since
       which specific cabinet it was is no longer knowable after a regroup.
       On a job that never had a checklist, the assembly task is what knows. */
    const asmOp = D.assemblyOp(o);
    let left = Math.min(old.length ? doneBefore : (asmOp ? asmOp.qtyDone : 0), n * scope);
    for (const m of o.modules) { const take = Math.min(m.qty, left); m.done = take; left -= take; }

    /* the assembly line is measured in modules; move its target with them */
    const op = asmOp;
    if (op) {
      const item = D.item(o, op.itemId);
      if (item) {
        const was = item.qty || 1;
        item.qty = n * scope;
        for (const x of o.ops.filter(y => y.itemId === item.id)) {
          if (was > 0) x.estMins = Math.max(5, Math.round(x.estMins * item.qty / was));
          x.qtyDone = Math.min(x.qtyDone, item.qty);
          if (x.status === "done" && x.qtyDone < item.qty) { x.status = "queued"; x.completedAt = null; }
        }
        op.qtyDone = D.modulesDone(o);
        o.qty = o.items.reduce((sum, i) => sum + i.qty, 0);
      }
    }
    if (o.swood) o.swood.modules = n * scope;

    this.log(byId, `set ${o.num} to ${n} cabinet${n === 1 ? "" : "s"}${recovered ? " — names regrouped" : " — renumbered"}`, { orderId });
    Store.save();
    return { count: n, recovered, names: o.modules.map(m => m.name) };
  },

  /* A cabinet the shop calls something else. */
  renameModule(orderId, moduleId, name, byId) {
    const o = D.order(orderId);
    const m = D.module(o, moduleId);
    const clean = String(name || "").trim();
    if (!m || !clean || m.name === clean) return null;
    const was = m.name;
    m.name = clean;
    this.log(byId, `renamed **${esc0(was)}** to **${esc0(clean)}** on ${o.num}`, { orderId });
    Store.save();
    return m;
  },

  /* ---------- who is on a job ---------- */
  setOpAssignees(orderId, opId, ids, byId) {
    const o = D.order(orderId);
    const op = o && o.ops.find(x => x.id === opId);
    if (!op) return null;
    const clean = [...new Set((ids || []).filter(id => D.member(id)))];
    op.assigneeIds = clean;
    op.assigneeId = clean[0] || null;      // what the rest of the app still reads
    const names = clean.map(id => D.member(id).name).join(", ");
    this.log(byId, clean.length
      ? `assigned **${names}** to ${this._opName(o, op)} on ${o.num}`
      : `unassigned ${this._opName(o, op)} on ${o.num}`, { orderId });
    Store.save();
    return op;
  },

  /* ---------- attachments ---------- */
  addFileMeta(meta, byId) {
    const f = { at: Date.now(), by: byId || null, cloud: false, ...meta };
    D.files().unshift(f);
    const o = f.orderId ? D.order(f.orderId) : null;
    this.log(byId, `attached **${esc0(f.name)}**${o ? ` to ${o.num}` : ""}`, { orderId: f.orderId || undefined });
    Store.save();
    return f;
  },
  removeFile(id, byId) {
    const f = D.file(id);
    if (!f) return false;
    Store.state.files = D.files().filter(x => x.id !== id);
    this.log(byId, `removed attachment **${esc0(f.name)}**`, { orderId: f.orderId || undefined });
    Store.save();
    return true;
  },
  /* Quiet bookkeeping — no log line, these are not decisions anyone made. */
  setFileStore(id, store, note) {
    const f = D.file(id);
    if (!f || (f.store === store && !note)) return;
    f.store = store;
    f.storeNote = note || "";
    Store.save();
  },
  markFileHere(id) {
    const f = D.file(id); if (!f) return;
    const dev = Files.deviceId();
    if (!(f.devices || []).includes(dev)) { f.devices = [...(f.devices || []), dev]; Store.save(); }
  },

  /* Kept in state so it survives a reload and reaches other devices — an
     assessment somebody paid for should not be a one-off toast. */
  saveInsight(insight, meta, byId) {
    Store.state.insights = { at: Date.now(), by: byId || null, insight, meta: meta || {} };
    this.log(byId, `asked for an assessment of the last ${(meta || {}).days || "?"} days`);
    Store.save();
    return Store.state.insights;
  },

  /* ---------- changing how many to make ----------
     order.qty was only ever a headline: every task counts against its ITEM's
     qty, so editing the order to 4 left the header saying 4 while the shop
     floor still had to report 6. Changing it has to reach the items, the task
     targets and the estimates, or the number on the drawer is a decoration. */
  setOrderQty(orderId, qty, byId) {
    const o = D.order(orderId);
    if (!o) return null;
    const want = Math.max(1, Math.round(Number(qty) || 0));
    const items = o.items || [];
    if (!items.length) return null;

    const was = new Map(items.map(i => [i.id, i.qty]));       // needed to scale estimates
    const before = items.reduce((n, i) => n + i.qty, 0);
    if (before === want) return null;

    /* one item is the ordinary case and can be set outright; several are
       scaled in proportion, and the header then follows the real sum rather
       than claiming a total the lines do not add up to */
    if (items.length === 1) {
      items[0].qty = want;
    } else {
      const f = want / before;
      for (const it of items) it.qty = Math.max(1, Math.round(it.qty * f));
    }
    o.qty = items.reduce((n, i) => n + i.qty, 0);

    let reopened = 0;
    for (const op of o.ops) {
      const item = items.find(i => i.id === op.itemId);
      if (!item) continue;
      const old = was.get(item.id) || item.qty;
      if (old > 0 && item.qty !== old) op.estMins = Math.max(5, Math.round(op.estMins * item.qty / old));
      // reported pieces can never exceed what is being made
      if (op.qtyDone > item.qty) op.qtyDone = item.qty;
      // a task finished for a smaller run has more to do now
      if (op.status === "done" && op.qtyDone < item.qty) {
        op.status = "queued"; op.completedAt = null; reopened++;
      }
    }
    this.log(byId, `changed ${o.num} to ${o.qty} ${o.unit || "pcs"}${reopened ? ` — ${reopened} task(s) reopened` : ""}`, { orderId });
    Store.save();
    return { qty: o.qty, reopened };
  },

  updateOrderLogged(orderId, patch, byId) {
    const o = D.order(orderId);
    const changes = [];
    const label = {
      product: v => `renamed to “${v}”`,
      client: v => `client → ${v}`,
      qty: v => `quantity → ${v}`,
      unit: v => `unit → ${v}`,
      priority: v => `priority ${o.priority} → ${v}`,
      due: v => `due date ${fmtDate(o.due)} → ${fmtDate(v)}`,
      notes: () => `edited notes`,
      portfolioId: v => `portfolio → ${v ? (D.portfolio(v)?.name || "?") : "none"}`,
      oneDriveUrl: v => v ? `set OneDrive link` : `cleared OneDrive link`,
    };
    for (const k of Object.keys(patch)) {
      if ((patch[k] || "") === (o[k] || "") && typeof patch[k] !== "number") continue; // no real change (treats ""≈undefined)
      if (patch[k] !== o[k] && label[k]) changes.push(label[k](patch[k]));
    }
    Object.assign(o, patch);
    if (changes.length) this.log(byId, `updated ${o.num}: ${changes.join(", ")}`, { orderId });
    Store.save();
    return changes.length;
  },

  deleteOrder(orderId, byId) {
    const o = D.order(orderId);
    Store.state.orders = Store.state.orders.filter(x => x.id !== orderId);
    this.log(byId, `deleted order **${o.num}** (${o.product})`);
    Store.save();
  },

  /* ---------- OneDrive config ---------- */
  setOneDrive(patch, byId) {
    Store.state.oneDrive = { ...(Store.state.oneDrive || { baseUrl: "", template: "{base}/{code}" }), ...patch };
    Store.save();
  },

  /* ---------- Portfolios ---------- */
  addPortfolio(name, icon, byId, ic, color) {
    const p = { id: uid("p"), name, icon: icon || "📁", ic: ic || "folder", color: color || null };
    Store.state.portfolios.push(p);
    this.log(byId, `created portfolio **${name}**`);
    Store.save();
    return p;
  },
  updatePortfolio(id, patch) { Object.assign(D.portfolio(id), patch); Store.save(); },
  deletePortfolio(id, byId) {
    const p = D.portfolio(id);
    Store.state.orders.forEach(o => { if (o.portfolioId === id) o.portfolioId = null; });
    Store.state.portfolios = Store.state.portfolios.filter(x => x.id !== id);
    this.log(byId, `deleted portfolio **${p.name}**`);
    Store.save();
  },

  /* ---------- Articles ---------- */
  addArticle({ sku, name, unit, lanes }, byId) {
    const a = { id: uid("a"), sku: sku || name.slice(0, 6).toUpperCase(), name, unit: unit || "pcs", lanes: lanes || [{ group: null, route: [] }] };
    Store.state.articles.push(a);
    this.log(byId, `added article **${a.name}** (${a.sku})`);
    Store.save();
    return a;
  },
  updateArticle(id, patch, byId) {
    const a = D.article(id);
    Object.assign(a, patch);
    if (byId) this.log(byId, `updated article **${a.name}**`);
    Store.save();
  },
  deleteArticle(id, byId) {
    const a = D.article(id);
    Store.state.articles = Store.state.articles.filter(x => x.id !== id);
    this.log(byId, `deleted article **${a.name}**`);
    Store.save();
  },

  /* ---------- Warehouse ---------- */
  _move(materialId, delta, note, byId, orderId) {
    Store.state.stockMoves.unshift({ id: uid("sm"), ts: Date.now(), materialId, delta, note: note || "", orderId: orderId || null, who: byId });
    if (Store.state.stockMoves.length > 1000) Store.state.stockMoves.length = 1000;
  },

  receiveStock(materialId, qty, note, byId) {
    const mat = D.material(materialId);
    mat.qty += qty;
    this._move(materialId, +qty, note || "Received", byId);
    this.log(byId, `received **${qty} ${mat.unit} ${mat.name}**${note ? ` — ${note}` : ""}`, { materialId });
    Store.save();
  },

  adjustStock(materialId, delta, note, byId) {
    const mat = D.material(materialId);
    mat.qty += delta;
    this._move(materialId, delta, note || "Adjustment", byId);
    this.log(byId, `adjusted **${mat.name}** by ${delta > 0 ? "+" : ""}${delta} ${mat.unit}${note ? ` — ${note}` : ""}`, { materialId });
    Store.save();
  },

  addMaterial({ sku, name, unit, qty, minQty, location, icon, ic, supplierId, reorderQty }, byId) {
    const mat = { id: uid("mat"), sku, name, unit: unit || "pcs", qty: qty || 0, minQty: minQty || 0, location: location || "", icon: icon || "📦", ic: ic || "box",
      supplierId: supplierId || null, reorderQty: reorderQty || null };
    Store.state.materials.push(mat);
    if (mat.qty) this._move(mat.id, mat.qty, "Initial stock", byId);
    this.log(byId, `added material **${mat.name}** (${mat.qty} ${mat.unit})`, { materialId: mat.id });
    Store.save();
    return mat;
  },

  updateMaterial(id, patch, byId) {
    const mat = D.material(id);
    const renamed = patch.name && patch.name !== mat.name;
    Object.assign(mat, patch);
    if (byId && renamed) this.log(byId, `updated material **${mat.name}**`, { materialId: id });
    Store.save();
  },

  deleteMaterial(id, byId) {
    if (D.materialInUse(id)) return false;
    const mat = D.material(id);
    Store.state.materials = Store.state.materials.filter(m => m.id !== id);
    Store.state.orders.forEach(o => { o.materials = (o.materials || []).filter(l => l.materialId !== id); });
    this.log(byId, `deleted material **${mat.name}**`);
    Store.save();
    return true;
  },

  /* ---------- Suppliers ---------- */
  addSupplier({ name, contact, email, phone, leadDays, notes }, byId) {
    const sup = { id: uid("sup"), name: (name || "").trim() || "Supplier", contact: contact || "",
      email: email || "", phone: phone || "", leadDays: leadDays || null, notes: notes || "" };
    (Store.state.suppliers = Store.state.suppliers || []).push(sup);
    this.log(byId, `added supplier **${sup.name}**`);
    Store.save();
    return sup;
  },
  updateSupplier(id, patch, byId) {
    const sup = D.supplier(id); if (!sup) return;
    Object.assign(sup, patch);
    this.log(byId, `updated supplier **${sup.name}**`);
    Store.save();
  },
  /* Refused while an order is still out with them — deleting would strand it */
  deleteSupplier(id, byId) {
    if (D.supplierUsed(id)) return false;
    const sup = D.supplier(id); if (!sup) return false;
    Store.state.suppliers = Store.state.suppliers.filter(s => s.id !== id);
    Store.state.materials.forEach(m => { if (m.supplierId === id) m.supplierId = null; });
    this.log(byId, `deleted supplier **${sup.name}**`);
    Store.save();
    return true;
  },

  /* ---------- Purchase orders ----------
     A PO is a promise, not stock: nothing touches the shelves until it is
     received, and receiving goes through the same stock movement as any
     other delivery, so the material history stays one story. */
  createPurchase({ supplierId, lines, expectedAt, notes }, byId) {
    const s = Store.state;
    if (!s.poSeq) s.poSeq = 1001;
    const po = {
      id: uid("po"), num: "PO-" + s.poSeq++,
      supplierId: supplierId || null, status: "draft",
      createdAt: Date.now(), createdBy: byId || null,
      sentAt: null, expectedAt: expectedAt || null, receivedAt: null, notes: notes || "",
      lines: (lines || []).filter(l => l.qty > 0).map(l => ({ id: uid("pl"), materialId: l.materialId, qty: l.qty, received: 0 })),
    };
    (s.purchases = s.purchases || []).unshift(po);
    this.log(byId, `drafted **${po.num}** for ${D.supplier(po.supplierId)?.name || "no supplier"} — ${po.lines.length} line${po.lines.length === 1 ? "" : "s"}`, { purchaseId: po.id });
    Store.save();
    return po;
  },

  /* qty 0 removes the line; an unknown material adds one */
  setPurchaseLine(poId, materialId, qty, byId) {
    const po = D.purchase(poId); if (!po || po.status !== "draft") return;   // a sent order is a record, not a scratchpad
    const line = po.lines.find(l => l.materialId === materialId);
    if (qty > 0) {
      if (line) line.qty = qty;
      else po.lines.push({ id: uid("pl"), materialId, qty, received: 0 });
    } else if (line) {
      po.lines = po.lines.filter(l => l !== line);
    }
    Store.save();
  },

  updatePurchase(poId, patch, byId) {
    const po = D.purchase(poId); if (!po) return;
    Object.assign(po, patch);
    Store.save();
  },

  sendPurchase(poId, byId) {
    const po = D.purchase(poId); if (!po || po.status !== "draft" || !po.lines.length) return false;
    po.status = "sent"; po.sentAt = Date.now();
    // no explicit date? fall back to the supplier's own lead time
    if (!po.expectedAt) {
      const lead = D.supplier(po.supplierId)?.leadDays;
      if (lead) po.expectedAt = Date.now() + lead * DAY;
    }
    this.log(byId, `sent **${po.num}** to ${D.supplier(po.supplierId)?.name || "supplier"}`, { purchaseId: po.id });
    Store.save();
    return true;
  },

  /* receipts: { [lineId]: qty }. Omitted lines are received in full, so the
     common case — the whole delivery arrived — is one click. */
  receivePurchase(poId, receipts, byId) {
    const po = D.purchase(poId); if (!po || po.status === "cancelled" || po.status === "received") return false;
    let moved = 0;
    for (const l of po.lines) {
      const want = receipts && receipts[l.id] !== undefined ? Number(receipts[l.id]) : D.poLineOutstanding(l);
      const take = Math.min(Math.max(0, want), D.poLineOutstanding(l));
      if (!take) continue;
      l.received = (l.received || 0) + take;
      const mat = D.material(l.materialId);
      if (mat) { this.receiveStock(l.materialId, take, `${po.num} — ${D.supplier(po.supplierId)?.name || "delivery"}`, byId); moved++; }
    }
    if (D.poFullyReceived(po)) { po.status = "received"; po.receivedAt = Date.now(); }
    if (moved) this.log(byId, `received ${D.poFullyReceived(po) ? "" : "part of "}**${po.num}**`, { purchaseId: po.id });
    Store.save();
    return moved > 0;
  },

  cancelPurchase(poId, byId) {
    const po = D.purchase(poId); if (!po || po.status === "received") return false;
    po.status = "cancelled";
    this.log(byId, `cancelled **${po.num}**`, { purchaseId: po.id });
    Store.save();
    return true;
  },

  deletePurchase(poId, byId) {
    const po = D.purchase(poId); if (!po) return false;
    // only a draft can vanish; anything sent or received is a record
    if (po.status !== "draft") return false;
    Store.state.purchases = Store.state.purchases.filter(p => p.id !== poId);
    this.log(byId, `deleted draft **${po.num}**`);
    Store.save();
    return true;
  },

  /* ---------- acting on a demand row ----------
     A row gathers the same material across several jobs, so a correction made
     once has to land on all of them — otherwise the row splits in two and the
     shop is looking at half its own demand. */
  renameDemandMaterial(key, newName, byId) {
    const name = String(newName || "").trim();
    if (!name) return 0;
    const lines = D.demandLines(key);
    let n = 0;
    for (const { order, line } of lines) {
      if (line.materialId) continue;          // a linked line takes its name from the warehouse
      if (line.name === name) continue;
      line.name = name; n++;
      this.log(byId, `renamed a material on **${order.num}** → ${esc0(name)}`, { orderId: order.id });
    }
    if (n) {
      /* the key is built from the name, so renaming moves the row — carry the
         one-off stock across or it is orphaned under a name nobody uses */
      const spot = D._spot();
      const to = "name:" + D._stName(name);
      if (spot[key] && to !== key) { spot[to] = { ...spot[key], name }; delete spot[key]; }
      Store.save();
    }
    return n;
  },

  linkDemandMaterial(key, materialId, byId) {
    const mat = materialId ? D.material(materialId) : null;
    const lines = D.demandLines(key);
    let n = 0;
    for (const { order, line } of lines) {
      line.materialId = mat ? mat.id : null;
      if (mat) line.unit = mat.unit;
      n++;
      this.log(byId, `linked ${esc0(line.name || (mat && mat.name) || "a material")} on **${order.num}** to ${mat ? `**${mat.name}**` : "no stock item"}`, { orderId: order.id, materialId: mat ? mat.id : undefined });
    }
    if (n) Store.save();
    return n;
  },

  /* "We have ordered this, and it lands on Thursday." Goes through a real
     purchase order, because that is the shop's record of what is coming — and
     creates the stock item first if the jobs were asking for a name the
     warehouse had never heard of. */
  markDemandOrdered(key, { qty, supplierId, expectedAt, sku, unit } = {}, byId) {
    let row = D.demandRow(key);
    if (!row) return null;
    let mat = row.material;
    if (!mat) {
      mat = this.stockFromDemand(key, { sku, unit: unit || row.unit, qty: 0, minQty: 0, supplierId }, byId);
      if (!mat) return null;
      row = D.demandRow(mat.id);
    }
    const amount = Number(qty) > 0 ? Number(qty) : Math.max(0, row.short);
    if (!amount) return null;
    if (supplierId && !mat.supplierId) this.updateMaterial(mat.id, { supplierId }, byId);

    const po = this.createPurchase({
      supplierId: supplierId || mat.supplierId || null,
      lines: [{ materialId: mat.id, qty: amount }],
      expectedAt: expectedAt || null,
    }, byId);
    this.sendPurchase(po.id, byId);          // it is ordered, not a draft
    if (expectedAt) this.updatePurchase(po.id, { expectedAt }, byId);
    return po;
  },

  /* "We already have 800 of this" — without inventing a catalogue item for
     something bought once. Pass null to forget it again. */
  setSpotStock(key, qty, note, byId) {
    const spot = D._spot();
    const row = D.demandRow(key);
    if (qty === null || qty === undefined || qty === "") {
      delete spot[key];
      this.log(byId, `cleared the on-hand amount for ${esc0(row ? row.name : "a material")}`);
    } else {
      const n = Math.max(0, Number(qty) || 0);
      spot[key] = { qty: n, note: note || "", at: Date.now(), by: byId || null,
                    name: row ? row.name : "" };
      this.log(byId, `recorded ${n}${row ? " " + esc0(row.unit) : ""} of ${esc0(row ? row.name : "a material")} on hand`);
    }
    Store.save();
    return true;
  },

  /* Take a name the jobs are asking for and make it a real stock item. */
  stockFromDemand(key, { sku, unit, qty, minQty, location, supplierId } = {}, byId) {
    const row = D.demandRow(key);
    if (!row || row.material) return null;
    const mat = this.addMaterial({
      sku: sku || "", name: row.name, unit: unit || row.unit || "pcs",
      qty: qty || 0, minQty: minQty || 0, location: location || "",
      supplierId: supplierId || null,
    }, byId);
    this.linkDemandMaterial(key, mat.id, byId);
    return mat;
  },

  /* Draft orders for what the live jobs are short of, rather than for what has
     dipped below a minimum — the figure that actually stops work. */
  draftFromDemand(byId) {
    const bySupplier = new Map();
    let skipped = 0;
    for (const r of D.demandShortfalls()) {
      if (!r.material || !r.material.supplierId) { skipped++; continue; }
      const k = r.material.supplierId;
      if (!bySupplier.has(k)) bySupplier.set(k, []);
      bySupplier.get(k).push({ materialId: r.material.id, qty: r.short });
    }
    const created = [];
    for (const [supplierId, lines] of bySupplier)
      created.push(this.createPurchase({ supplierId, lines }, byId));
    return { created, skipped };
  },

  /* One draft per supplier, covering everything below its minimum. Materials
     with no supplier yet cannot be ordered, so they are reported back rather
     than silently dropped. */
  draftReorder(byId) {
    const created = [];
    let skipped = 0;
    for (const g of D.reorderBySupplier()) {
      if (!g.supplier) { skipped += g.lines.length; continue; }
      created.push(this.createPurchase({
        supplierId: g.supplier.id,
        lines: g.lines.map(l => ({ materialId: l.material.id, qty: l.qty })),
      }, byId));
    }
    return { created, skipped };
  },

  /* ---------- Order ↔ materials ---------- */
  addOrderMaterial(orderId, materialId, qty, byId) {
    const o = D.order(orderId); const mat = D.material(materialId);
    o.materials = o.materials || [];
    o.materials.push({ id: uid("ln"), materialId, qty, consumed: false, consumedAt: null, consumedBy: null });
    this.log(byId, `added **${qty} ${mat.unit} ${mat.name}** to ${o.num}`, { orderId, materialId });
    Store.save();
  },

  removeOrderMaterial(orderId, lineId, byId) {
    const o = D.order(orderId);
    const line = o.materials.find(l => l.id === lineId);
    if (!line || line.consumed) return false;
    const mat = D.material(line.materialId);
    o.materials = o.materials.filter(l => l.id !== lineId);
    this.log(byId, `removed **${mat ? mat.name : "material"}** from ${o.num}`, { orderId });
    Store.save();
    return true;
  },

  consumeLine(orderId, lineId, byId) {
    const o = D.order(orderId);
    const line = o.materials.find(l => l.id === lineId);
    if (!line || line.consumed) return false;
    const mat = D.material(line.materialId);
    mat.qty -= line.qty;
    line.consumed = true; line.consumedAt = Date.now(); line.consumedBy = byId;
    this._move(mat.id, -line.qty, `Consumed for ${o.num}`, byId, orderId);
    this.log(byId, `used **${line.qty} ${mat.unit} ${mat.name}** on ${o.num}`, { orderId, materialId: mat.id });
    Store.save();
    return true;
  },

  /* ---------- Stations (shop flow customization) ---------- */
  addStation({ name, icon, ic, estMins, kind }, byId) {
    const st = { id: uid("st"), name: name || "New station", icon: icon || "🛠️", ic: ic || (kind === "eng" ? "bulb" : "toolbox"), estMins: estMins || 60, kind: kind || "prod" };
    Store.state.stations.push(st);
    this.log(byId, `added station **${st.name}**`);
    Store.save();
    return st;
  },

  updateStation(id, patch, byId) {
    const st = D.station(id);
    const renamed = patch.name && patch.name !== st.name;
    const old = st.name;
    Object.assign(st, patch);
    if (byId && renamed) this.log(byId, `renamed station **${old}** → **${st.name}**`);
    Store.save();
  },

  moveStation(id, dir) {
    const arr = Store.state.stations;
    const i = arr.findIndex(s => s.id === id);
    if (i < 0) return false;
    const kind = arr[i].kind || "prod";
    let j = i + dir; // skip over entries of the other kind
    while (j >= 0 && j < arr.length && (arr[j].kind || "prod") !== kind) j += dir;
    if (j < 0 || j >= arr.length) return false;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    Store.save();
    return true;
  },

  deleteStation(id, byId) {
    const used = Store.state.orders.some(o => o.ops.some(op => op.stationId === id))
      || Store.state.articles.some(a => a.lanes.some(l => l.route.some(r => r.stationId === id)));
    if (used) return false;
    const st = D.station(id);
    Store.state.stations = Store.state.stations.filter(s => s.id !== id);
    Store.state.members.forEach(m => { if (m.station === id) m.station = null; });
    this.log(byId, `deleted station **${st.name}**`);
    Store.save();
    return true;
  },

  /* ---------- Whiteboards ---------- */
  addBoard(name, byId) {
    const b = { id: uid("wb"), name: name || "New board", createdBy: byId,
                createdAt: Date.now(), updatedAt: Date.now(), els: [], conns: [] };
    Store.state.boards.push(b);
    this.log(byId, `created whiteboard **${b.name}**`);
    Store.save();
    return b;
  },
  renameBoard(id, name, byId) {
    const b = D.board(id);
    const old = b.name;
    b.name = name || b.name; b.updatedAt = Date.now();
    if (old !== b.name) this.log(byId, `renamed whiteboard **${old}** → **${b.name}**`);
    Store.save();
  },
  deleteBoard(id, byId) {
    const b = D.board(id);
    Store.state.boards = Store.state.boards.filter(x => x.id !== id);
    this.log(byId, `deleted whiteboard **${b.name}**`);
    Store.save();
  },
  wbAdd(boardId, el, byId) {
    const b = D.board(boardId);
    el.id = el.id || uid("we"); el.by = byId; el.ts = Date.now();
    b.els.push(el); b.updatedAt = Date.now();
    Store.save();
    return el;
  },
  wbUpdate(boardId, elId, patch) {
    const b = D.board(boardId);
    const el = b.els.find(e => e.id === elId);
    if (!el) return;
    Object.assign(el, patch); b.updatedAt = Date.now();
    Store.save();
  },
  wbDelete(boardId, elId) {
    const b = D.board(boardId);
    b.els = b.els.filter(e => e.id !== elId);
    b.conns = b.conns.filter(c => c.from !== elId && c.to !== elId);
    b.updatedAt = Date.now();
    Store.save();
  },
  wbFront(boardId, elId) {
    const b = D.board(boardId);
    const i = b.els.findIndex(e => e.id === elId);
    if (i >= 0) b.els.push(b.els.splice(i, 1)[0]);
    Store.save();
  },
  wbConnect(boardId, from, to) {
    const b = D.board(boardId);
    if (from === to) return null;
    if (b.conns.some(c => c.from === from && c.to === to)) return null;
    const c = { id: uid("wc"), from, to };
    b.conns.push(c); b.updatedAt = Date.now();
    Store.save();
    return c;
  },
  wbDisconnect(boardId, connId) {
    const b = D.board(boardId);
    b.conns = b.conns.filter(c => c.id !== connId);
    b.updatedAt = Date.now();
    Store.save();
  },
  setBoardSharing(boardId, visibility, memberIds, byId) {
    const b = D.board(boardId);
    b.visibility = visibility;
    b.memberIds = visibility === "custom" ? (memberIds || []) : [];
    const label = { team: "the whole team", private: "only themselves", custom: `${b.memberIds.length + 1} people` }[visibility];
    this.log(byId, `changed **${b.name}** sharing → ${label}`);
    Store.save();
  },

  /* ---------- Notifications ---------- */
  notify(forId, { type, orderId, gprojectId, gtaskId, text }, byId) {
    const n = { id: uid("nt"), forId, by: byId || null, ts: Date.now(), read: false,
                type: type || "info", orderId: orderId || null,
                gprojectId: gprojectId || null, gtaskId: gtaskId || null, text };
    Store.state.notifications.unshift(n);
    if (Store.state.notifications.length > 300) Store.state.notifications.length = 300;
    Store.save();
    return n;
  },
  markNotifRead(id) {
    const n = Store.state.notifications.find(x => x.id === id);
    if (n && !n.read) { n.read = true; Store.save(); }
  },
  markAllNotifsRead(memberId) {
    Store.state.notifications.forEach(n => { if (n.forId === memberId) n.read = true; });
    Store.save();
  },
  clearNotifs(memberId) {
    Store.state.notifications = Store.state.notifications.filter(n => n.forId !== memberId);
    Store.save();
  },

  /* Manager confirms the client is happy with the drawings → notify the engineer(s) */
  confirmClientApproval(orderId, byId) {
    const o = D.order(orderId);
    if (!o || o.type !== "eng" || o.clientApproved) return [];
    o.clientApproved = { at: Date.now(), by: byId };
    const engineers = D.projectEngineers(o).filter(id => id !== byId);
    const mgr = D.member(byId);
    for (const engId of engineers)
      this.notify(engId, {
        type: "client_ok", orderId: o.id,
        text: `${mgr ? mgr.name : "A manager"} confirmed the client approved the drawings for ${o.num} — you're clear to proceed`,
      }, byId);
    this.log(byId, `confirmed **client approval** of drawings on ${o.num}${engineers.length ? ` — notified ${engineers.map(id => D.member(id)?.name).filter(Boolean).join(", ")}` : ""}`, { orderId: o.id });
    Store.save();
    return engineers;
  },
  revokeClientApproval(orderId, byId) {
    const o = D.order(orderId);
    if (!o || !o.clientApproved) return;
    o.clientApproved = null;
    this.log(byId, `revoked client approval on ${o.num}`, { orderId: o.id });
    Store.save();
  },

  /* ---------- Planner: projects ---------- */
  addGProject({ name, key, color, icon }, byId) {
    const p = { id: uid("gp"), name: name || "New project", key: (key || name.slice(0, 3)).toUpperCase().slice(0, 4),
      color: color || "blue", icon: icon || "columns", desc: "",
      createdBy: byId, createdAt: Date.now(), archived: false,
      stages: defaultStages(), labels: [], tasks: [] };
    Store.state.gprojects.push(p);
    this.log(byId, `created project **${p.name}** in Planner`);
    Store.save();
    return p;
  },
  updateGProject(id, patch) { Object.assign(D.gproject(id), patch); Store.save(); },
  archiveGProject(id, byId) { const p = D.gproject(id); p.archived = true; p.archivedAt = Date.now(); this.log(byId, `archived project **${p.name}**`); Store.save(); },
  unarchiveGProject(id) { const p = D.gproject(id); p.archived = false; p.archivedAt = null; Store.save(); },
  deleteGProject(id, byId) {
    const p = D.gproject(id);
    Store.state.gprojects = Store.state.gprojects.filter(x => x.id !== id);
    this.log(byId, `deleted project **${p.name}**`);
    Store.save();
  },

  /* stages (status columns) */
  addGStage(pid, name, byId) {
    const p = D.gproject(pid);
    const st = { id: uid("gs"), name: name || "New status", color: GP_COLORS[p.stages.length % GP_COLORS.length], done: false };
    // insert before a trailing done stage if present
    const doneIdx = p.stages.findIndex(s => s.done);
    if (doneIdx >= 0) p.stages.splice(doneIdx, 0, st); else p.stages.push(st);
    Store.save();
    return st;
  },
  updateGStage(pid, sid, patch) { Object.assign(D.gstage(D.gproject(pid), sid), patch); Store.save(); },
  moveGStage(pid, sid, dir) {
    const arr = D.gproject(pid).stages;
    const i = arr.findIndex(s => s.id === sid), j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return false;
    [arr[i], arr[j]] = [arr[j], arr[i]]; Store.save(); return true;
  },
  deleteGStage(pid, sid) {
    const p = D.gproject(pid);
    if (p.stages.length <= 1) return false;
    const idx = p.stages.findIndex(s => s.id === sid);
    const fallback = p.stages[idx === 0 ? 1 : idx - 1].id;
    p.tasks.forEach(t => { if (t.stageId === sid) t.stageId = fallback; });
    p.stages = p.stages.filter(s => s.id !== sid);
    Store.save(); return true;
  },

  /* tasks */
  addGTask(pid, { title, stageId, assigneeId, due, priority }, byId) {
    const p = D.gproject(pid);
    const stage = stageId || (p.stages[0] && p.stages[0].id);
    const maxOrd = Math.max(-1, ...p.tasks.filter(t => t.stageId === stage).map(t => t.ord));
    const t = { id: uid("gt"), title: title || "Untitled task", desc: "", stageId: stage,
      assigneeId: assigneeId || null, due: due || null, start: null, priority: priority || "normal",
      labelIds: [], subtasks: [], comments: [], createdBy: byId, createdAt: Date.now(), ord: maxOrd + 1 };
    p.tasks.push(t);
    if (t.assigneeId && t.assigneeId !== byId) this.notify(t.assigneeId, { type: "task", text: `${D.member(byId)?.name || "Someone"} assigned you “${t.title}” in ${p.name}`, gprojectId: p.id, gtaskId: t.id }, byId);
    Store.save();
    return t;
  },
  updateGTask(pid, taskId, patch, byId) {
    const p = D.gproject(pid); const t = D.gtask(p, taskId);
    const reassigned = "assigneeId" in patch && patch.assigneeId !== t.assigneeId ? patch.assigneeId : null;
    Object.assign(t, patch);
    if (reassigned && reassigned !== byId) this.notify(reassigned, { type: "task", text: `${D.member(byId)?.name || "Someone"} assigned you “${t.title}” in ${p.name}`, gprojectId: p.id, gtaskId: t.id }, byId);
    Store.save();
  },
  moveGTask(pid, taskId, stageId, ord) {
    const p = D.gproject(pid); const t = D.gtask(p, taskId);
    t.stageId = stageId;
    if (ord != null) t.ord = ord;
    Store.save();
  },
  /* place a task into a stage before beforeId (or at end), renumbering that stage */
  placeGTask(pid, taskId, stageId, beforeId, byId) {
    const p = D.gproject(pid); const t = D.gtask(p, taskId);
    const wasDone = D.gTaskDone(p, t);
    t.stageId = stageId;
    const inStage = p.tasks.filter(x => x.stageId === stageId && x.id !== taskId).sort((a, b) => a.ord - b.ord);
    let idx = beforeId ? inStage.findIndex(x => x.id === beforeId) : inStage.length;
    if (idx < 0) idx = inStage.length;
    inStage.splice(idx, 0, t);
    inStage.forEach((x, i) => x.ord = i);
    const nowDone = D.gTaskDone(p, t);
    if (byId && nowDone && !wasDone) this.log(byId, `completed task **${t.title}** in ${p.name}`, {});
    Store.save();
  },
  deleteGTask(pid, taskId) {
    const p = D.gproject(pid);
    p.tasks = p.tasks.filter(t => t.id !== taskId);
    Store.save();
  },
  addSubtask(pid, taskId, title) {
    const t = D.gtask(D.gproject(pid), taskId);
    t.subtasks.push({ id: uid("gk"), title, done: false }); Store.save();
  },
  toggleSubtask(pid, taskId, subId) {
    const t = D.gtask(D.gproject(pid), taskId);
    const s = t.subtasks.find(x => x.id === subId); if (s) s.done = !s.done; Store.save();
  },
  deleteSubtask(pid, taskId, subId) {
    const t = D.gtask(D.gproject(pid), taskId);
    t.subtasks = t.subtasks.filter(x => x.id !== subId); Store.save();
  },
  /* ---- working hours ---- */
  setShift(patch, byId) {
    const sh = { ...D.shift(), ...patch };
    Store.state.shift = sh;
    D.__spanKey = null;                                // drop the memoised spans
    this.log(byId, `changed the working hours — ${sh.start}–${sh.end}, ${(sh.breaks || []).length} breaks`);
    Store.save();
  },

  /* ---- permissions (managers only; the manager row is not editable) ---- */
  setPerm(role, cap, on, byId) {
    if (role === "manager") return;
    if (!Store.state.perms) Store.state.perms = JSON.parse(JSON.stringify(DEFAULT_PERMS));
    if (!Store.state.perms[role]) Store.state.perms[role] = {};
    Store.state.perms[role][cap] = !!on;
    const label = (CAPS.find(c => c.id === cap) || {}).label || cap;
    this.log(byId, `${on ? "granted" : "removed"} **${label}** for ${role}s`);
    Store.save();
  },
  resetPerms(role, byId) {
    if (role === "manager") return;
    Store.state.perms[role] = { ...(DEFAULT_PERMS[role] || DEFAULT_PERMS.worker) };
    this.log(byId, `reset ${role} permissions to the defaults`);
    Store.save();
  },

  /* ---- comments on a manufacturing / engineering project ---- */
  addOrderComment(orderId, text, byId) {
    const o = D.order(orderId);
    const body = (text || "").trim();
    if (!o || !body) return null;
    if (!Array.isArray(o.comments)) o.comments = [];
    const mentions = D.parseMentions(body);
    const c = { id: uid("oc"), by: byId, ts: Date.now(), text: body, mentions };
    o.comments.push(c);
    this.notifyMentions(mentions, byId, body, { type: "mention", orderId: o.id }, `on ${o.num}`);
    this.log(byId, `commented on ${o.num}`, { orderId: o.id });
    Store.save();
    return c;
  },
  deleteOrderComment(orderId, commentId, byId) {
    const o = D.order(orderId);
    if (!o || !o.comments) return;
    o.comments = o.comments.filter(c => c.id !== commentId);
    Store.save();
  },

  /* One notification per mentioned teammate — never to yourself. */
  notifyMentions(ids, byId, text, meta, where) {
    const who = D.member(byId)?.name || "Someone";
    const snippet = text.length > 90 ? text.slice(0, 88).trimEnd() + "…" : text;
    for (const id of ids || []) {
      if (id === byId) continue;
      this.notify(id, { ...meta, text: `**${who}** mentioned you ${where}: ${snippet}` }, byId);
    }
  },

  /* ---- duplicate a Planner project ---- */
  duplicateGProject(pid, { name, copyTasks = false } = {}, byId) {
    const src = D.gproject(pid);
    if (!src) return null;
    let wanted = (name || "").trim() || D.uniqueName(src.name, n => D.gprojectNameTaken(n));
    if (D.gprojectNameTaken(wanted)) wanted = D.uniqueName(wanted, n => D.gprojectNameTaken(n));
    const stageMap = {};
    const p = {
      ...structuredClone(src),
      id: uid("gp"), name: wanted, archived: false, archivedAt: null,
      createdBy: byId, createdAt: Date.now(),
      stages: src.stages.map(st => { const id = uid("gs"); stageMap[st.id] = id; return { ...st, id }; }),
      labels: src.labels.map(l => ({ ...l, id: uid("gl") })),
      tasks: [],
    };
    if (copyTasks) {
      const labelMap = {};
      src.labels.forEach((l, i) => { labelMap[l.id] = p.labels[i].id; });
      p.tasks = src.tasks.map(t => ({
        ...structuredClone(t), id: uid("gt"),
        stageId: stageMap[t.stageId] || p.stages[0].id,
        labelIds: (t.labelIds || []).map(id => labelMap[id]).filter(Boolean),
        subtasks: (t.subtasks || []).map(x => ({ ...x, id: uid("gsb"), done: false })),
        comments: [],                                   // a copy starts its own conversation
        createdBy: byId, createdAt: Date.now(),
      }));
    }
    Store.state.gprojects.push(p);
    this.log(byId, `copied Planner project **${src.name}** → **${p.name}**`);
    Store.save();
    return p;
  },

  addGComment(pid, taskId, text, byId) {
    const p = D.gproject(pid); const t = D.gtask(p, taskId);
    const mentions = D.parseMentions(text);
    t.comments.push({ id: uid("gc"), by: byId, ts: Date.now(), text, mentions });
    this.notifyMentions(mentions, byId, text, { type: "mention", gprojectId: p.id, gtaskId: t.id }, `on “${t.title}”`);
    if (t.assigneeId && t.assigneeId !== byId && !mentions.includes(t.assigneeId))  // a mention already told them
      this.notify(t.assigneeId, { type: "task", text: `${D.member(byId)?.name || "Someone"} commented on “${t.title}”`, gprojectId: p.id, gtaskId: t.id }, byId);
    Store.save();
  },

  /* ---------- To-dos ---------- */
  addTodo({ text, forId, due }, byId) {
    const t = { id: uid("td"), text, forId: forId || byId, by: byId, ts: Date.now(), done: false, doneAt: null, due: due || null };
    Store.state.todos.push(t);
    if (t.forId !== byId) this.log(byId, `added a to-do for **${D.member(t.forId)?.name || "?"}**: ${text}`);
    Store.save();
    return t;
  },
  toggleTodo(id, byId) {
    const t = Store.state.todos.find(x => x.id === id);
    if (!t) return;
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : null;
    if (t.done && t.by !== t.forId) this.log(byId, `completed the to-do: ${t.text}`);
    Store.save();
  },
  updateTodo(id, patch) {
    const t = Store.state.todos.find(x => x.id === id);
    if (t) Object.assign(t, patch);
    Store.save();
  },
  deleteTodo(id) {
    Store.state.todos = Store.state.todos.filter(x => x.id !== id);
    Store.save();
  },

  /* ---------- View prefs ---------- */
  setPref(memberId, key, value) {
    const p = Store.state.prefs;
    (p[memberId] = p[memberId] || {})[key] = value;
    Store.save();
  },

  addMember({ name, trade, role, pin, station }, byId) {
    const m = {
      id: uid("m"),
      name, trade, role, station: station || null,
      pinHash: pin ? hashPin(pin, Store.state.pinSalt) : "",
      color: Store.state.members.length % AV_COLORS.length,
    };
    Store.state.members.push(m);
    this.log(byId, `added **${name}** to the team`);
    Store.save();
    return m;
  },

  updateMember(id, patch) {
    const m = D.member(id);
    if (patch.pin) { m.pinHash = hashPin(patch.pin, Store.state.pinSalt); } // never store plaintext
    delete patch.pin;
    Object.assign(m, patch);
    Store.save();
  },

  /* set / reset a member's PIN (managers only, via the member modal) */
  setPin(id, pin, byId) {
    const m = D.member(id);
    m.pinHash = hashPin(pin, Store.state.pinSalt);
    delete m.pin;
    if (byId) this.log(byId, `reset PIN for **${m.name}**`);
    Store.save();
  },
  verifyPin(id, pin) {
    const m = D.member(id);
    if (!m) return false;
    if (m.pinHash) return m.pinHash === hashPin(pin, Store.state.pinSalt);
    if (m.pin != null) { // legacy plaintext → verify then upgrade
      const ok = String(m.pin) === String(pin);
      if (ok) { m.pinHash = hashPin(pin, Store.state.pinSalt); delete m.pin; Store.save(); }
      return ok;
    }
    return false;
  },

  removeMember(id, byId) {
    const m = D.member(id);
    for (const o of Store.state.orders)
      for (const op of o.ops) if (op.assigneeId === id) op.assigneeId = null;
    Store.state.members = Store.state.members.filter(x => x.id !== id);
    this.log(byId, `removed **${m.name}** from the team`);
    Store.save();
  },
};
