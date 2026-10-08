#!/usr/bin/env python3
"""Convert Northwood Furniture xlsx backup → ShopFlow REAL_SEED (realdata.js)."""
import openpyxl, json, re, datetime, hashlib
from collections import Counter, defaultdict

SRC = "/Users/User/Downloads/NorthwoodFurniture_S4OQX_2026-07-17.xlsx"
OUT = "/Users/User/shopflow/realdata.js"
wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)

def sheet_rows(name):
    ws = wb[name]
    rows = list(ws.iter_rows(values_only=True))
    hdr = [str(h) if h is not None else "" for h in rows[0]]
    out = []
    for r in rows[1:]:
        if all(c is None or str(c).strip() == "" for c in r): continue
        out.append({hdr[i]: r[i] for i in range(min(len(hdr), len(r)))})
    return out

def ts(v, fallback=None):
    """→ epoch ms or fallback"""
    if v is None or str(v).strip() == "": return fallback
    if isinstance(v, datetime.datetime): return int(v.timestamp() * 1000)
    if isinstance(v, datetime.date): return int(datetime.datetime(v.year, v.month, v.day, 12).timestamp() * 1000)
    s = str(v).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try: return int(datetime.datetime.strptime(s, fmt).timestamp() * 1000)
        except ValueError: pass
    return fallback

def num(v, d=0):
    if v is None or str(v).strip() == "": return d
    try: return float(str(v).replace(",", "."))
    except ValueError: return d

def sid(prefix, text):
    return prefix + hashlib.md5(text.encode()).hexdigest()[:8]

DAY = 86400000
NOW = int(datetime.datetime.now().timestamp() * 1000)

# ---------- Stations ----------
PROD_STEPS = [  # (name, icon, estMins)
    ("Pjovimas", "🪚", 90), ("Briaunavimas", "📏", 60), ("Gręžimas", "⚙️", 45),
    ("Surinkimas", "🔩", 120), ("Apdaila", "🎨", 120), ("Pakavimas", "📦", 30),
    ("Montavimas", "🛠️", 180), ("Išstatymas / KK", "🔍", 45),
]
ENG_STEPS = [
    ("Idėja + Projekto info", "💡", 60), ("Eskizas", "✏️", 120),
    ("Gamybinis modelis ir brėžiniai", "📐", 480), ("CAM / Nesting", "💾", 120),
    ("Perdavimas į gamybą", "🏭", 30),
]
stations, st_by_name, st_order = [], {}, {}
for i, (name, icon, est) in enumerate(PROD_STEPS):
    st = {"id": sid("st-", name), "name": name, "icon": icon, "estMins": est, "kind": "prod"}
    stations.append(st); st_by_name[name] = st; st_order[name] = i
for i, (name, icon, est) in enumerate(ENG_STEPS):
    st = {"id": sid("eg-", name), "name": name, "icon": icon, "estMins": est, "kind": "eng"}
    stations.append(st); st_by_name[name] = st; st_order[name] = 100 + i

tasks = sheet_rows("✅ Užduotys")
for t in tasks:  # any step not predefined → append as prod station
    step = str(t["Žingsnis"] or "").strip()
    if step and step not in st_by_name:
        st = {"id": sid("st-", step), "name": step, "icon": "🧰", "estMins": 60, "kind": "prod"}
        stations.append(st); st_by_name[step] = st; st_order[step] = 50 + len(st_order)

# ---------- Members ----------
import hashlib, secrets
ROLE = {"💼 Vadyba": "manager", "📐 Projektavimas": "engineer", "🔧 Gamyba": "worker"}
PINS = {"DB": "1234", "Ricardas": "5678", "Mantas Projektavimas": "6789",
        "Dainius": "1111", "Donatas": "2222", "Mantas": "3333", "Nerijus": "4444"}
PIN_SALT = secrets.token_hex(16)                       # per-export salt
def hash_pin(pin): return hashlib.sha256((PIN_SALT + "$" + str(pin)).encode()).hexdigest()  # matches app hashPin()
members, mem_by_name = [], {}
for i, k in enumerate(sheet_rows("👥 Komanda")):
    name = str(k["Vardas"]).strip()
    role = ROLE.get(str(k["Rolė"]).strip(), "worker")
    pin = PINS.get(name, str(1111 * ((i % 8) + 1))[:4])
    m = {"id": sid("m-", name), "name": name, "trade": str(k["Rolė"]).strip().split(" ", 1)[-1],
         "role": role, "pinHash": hash_pin(pin), "color": i % 10}  # never emit plaintext pin
    members.append(m); mem_by_name[name] = m
def mem_id(name):
    n = str(name or "").strip()
    return mem_by_name[n]["id"] if n in mem_by_name else None

# home station = most common prod step among a worker's tasks
per_member_steps = defaultdict(Counter)
for t in tasks:
    who, step = str(t["Atsakingas"] or "").strip(), str(t["Žingsnis"] or "").strip()
    if who and step in st_by_name and st_by_name[step]["kind"] == "prod":
        per_member_steps[who][step] += 1
for m in members:
    if m["role"] == "worker" and per_member_steps[m["name"]]:
        m["station"] = st_by_name[per_member_steps[m["name"]].most_common(1)[0][0]]["id"]

# ---------- Projects → orders ----------
projects = sheet_rows("📁 Projektai")
positions = sheet_rows("📋 Pozicijos")
cust_orders = sheet_rows("📬 Užsakymai")
pos_by_proj = defaultdict(list)
for p in positions: pos_by_proj[str(p["Projektas"]).strip()].append(p)
co_by_proj = {}
for co in cust_orders:
    link = str(co.get("Susietas projektas") or "").strip()
    if link: co_by_proj[link] = co
tasks_by_proj = defaultdict(list)
for t in tasks: tasks_by_proj[str(t["Projektas"]).strip()].append(t)

# portfolios from clients with ≥2 projects
client_count = Counter(str(p["Klientas"]).strip() for p in projects
                       if str(p["Klientas"] or "").strip() not in ("", "—", "None"))
portfolios, pf_by_client = [], {}
PF_ICONS = ["🏢", "🏠", "🛋", "📁", "🏨", "🚪", "🧒", "☕️"]
for i, (client, n) in enumerate(c for c in client_count.most_common() if c[1] >= 2):
    pf = {"id": sid("p-", client), "name": client, "icon": PF_ICONS[i % len(PF_ICONS)]}
    portfolios.append(pf); pf_by_client[client] = pf

PRIO = {"Aukštas": "high", "Vidutinis": "normal", "Žemas": "low", "Skubus": "rush"}
orders, activity = [], []

KNOWN_COLS = {"ID","Pavadinimas","Kategorija","Tipas","Klientas","Prioritetas","Statusas","Dizaino fazė",
              "Paslaugos žingsniai","Terminas","Baigta","Užbaigimo pastaba","Atsakingas","Pozicijų",
              "Užduočių","Atlikta %","Sukurta"}

for p in projects:
    name = str(p["Pavadinimas"]).strip()
    ptasks = tasks_by_proj.get(name, [])
    cat = str(p["Kategorija"] or "")
    otype = "eng" if "Projektavimas" in cat else "prod"
    created = ts(p.get("Sukurta"), None) or min((ts(t.get("Sukurta"), NOW) for t in ptasks), default=NOW - 30 * DAY)
    finished = ts(p.get("Baigta"), None)
    co = co_by_proj.get(name)
    due = ts(p.get("Terminas"), None) or (ts(co.get("Prist. data"), None) if co else None) or finished or (created + 14 * DAY)
    shipped = "Archyvas" in str(p["Statusas"] or "")
    client = str(p["Klientas"] or "").strip()
    if client in ("", "—", "None"): client = name
    ppos = pos_by_proj.get(name, [])
    qty = int(max([num(t.get("Užsakyta")) for t in ptasks] + [num(x.get("Užsakyta")) for x in ppos] + [1]))

    oid = sid("o-", name)
    item = {"id": oid + "-it0", "articleId": None,
            "name": (str(ppos[0]["Aprašymas"]).strip()[:40] if ppos else "Bendra"), "qty": qty}

    notes = []
    if co:
        notes.append(f"Užsakymas {co['Užs. nr.']} · pristatymas {co.get('Prist. data') or '—'}")
        if str(co.get("Pastabos") or "").strip(): notes.append(str(co["Pastabos"]).strip())
    svc = str(p.get("Paslaugos žingsniai") or "").strip()
    if svc: notes.append(f"Paslaugos žingsniai: {svc}")
    for k, v in p.items():  # free-text columns beyond the known set
        if k not in KNOWN_COLS and v and str(v).strip():
            notes.append(str(v).strip())
    if str(p.get("Užbaigimo pastaba") or "").strip(): notes.append("Užbaigta: " + str(p["Užbaigimo pastaba"]).strip())
    for x in ppos[:8]:
        notes.append(f"• {int(num(x.get('Užsakyta')))}× {x.get('Artikulas') or ''} {str(x.get('Aprašymas') or '').strip()} (atlikta {int(num(x.get('Atlikta')))})")
    if len(ppos) > 8: notes.append(f"… ir dar {len(ppos) - 8} pozicijų")

    # ops from tasks, ordered by canonical flow then creation time
    ptasks_sorted = sorted(ptasks, key=lambda t: (st_order.get(str(t["Žingsnis"] or "").strip(), 999), ts(t.get("Sukurta"), created) or 0))
    ops = []
    for t in ptasks_sorted:
        step = str(t["Žingsnis"] or "").strip()
        if step not in st_by_name: continue
        st = st_by_name[step]
        if st["kind"] != otype: continue   # engineering & production stay separate — an order carries only its own phase's steps
        status_raw = str(t["Statusas"] or "")
        block = str(t.get("Blokas") or "").strip()
        atlikta = num(t.get("Atlikta"))
        done_at = ts(t.get("Atlikta data"), None) or finished
        who = mem_id(t.get("Atsakingas"))
        op = {"id": sid("op-", name + step + str(t.get("Sukurta"))), "itemId": item["id"], "group": None,
              "stationId": st["id"], "estMins": st["estMins"] * (1 if qty == 1 else max(1, min(8, qty // 50 + 1))),
              "status": "queued", "qtyDone": 0, "assigneeId": who, "loggedMs": 0,
              "startedAt": None, "completedAt": None, "blockNote": None}
        if "Atlikta" in status_raw:
            op.update(status="done", qtyDone=qty, completedAt=done_at or created + DAY, completedBy=who)
        elif "Vykdoma" in status_raw and block:
            op.update(status="blocked", blockNote=block, qtyDone=int(min(atlikta, qty)),
                      loggedMs=st["estMins"] * 30000)
        elif "Vykdoma" in status_raw:
            op["qtyDone"] = int(min(atlikta, qty))   # in-progress in the backup, but tasks never auto-start — import as queued
        else:  # Laukia
            op["qtyDone"] = int(min(atlikta, qty))
        ops.append(op)

    order = {"id": oid, "num": name[:24], "type": otype, "product": name, "client": client,
             "qty": qty, "unit": "vnt" if qty > 1 else ("projektas" if otype == "eng" else "vnt"),
             "priority": PRIO.get(str(p["Prioritetas"] or "").strip(), "normal"),
             "due": due, "shipped": shipped,
             **({"shippedAt": finished or due} if shipped else {}),
             "portfolioId": pf_by_client.get(str(p["Klientas"] or "").strip(), {}).get("id"),
             "notes": "\n".join(notes), "createdAt": created,
             "materials": [], "items": [item], "ops": ops}
    orders.append(order)

# newest first, like ShopFlow expects
orders.sort(key=lambda o: -o["createdAt"])

# tasks are never auto-started — they stay "queued" until a worker starts them in the app

# ---------- Warehouse ----------
materials, mat_by_sku = [], {}
for w in sheet_rows("🏭 Sandėlis"):
    sku = str(w["SKU"] or "").strip()
    if not sku: continue
    tipo = str(w.get("Tipas") or "")
    sub = str(w.get("Subkategorija") or "").lower()
    icon = "🟫" if "Lakštas" in tipo else ("🪝" if "hinge" in sub or "lankst" in sub else "🔩")
    loc = " ".join(x for x in [str(w.get("Vieta (zona)") or "").strip(), str(w.get("Vieta (lentyna)") or "").strip()] if x)
    mat = {"id": sid("mat-", sku), "sku": sku, "name": str(w.get("Pavadinimas / Medžiaga") or sku).strip(),
           "unit": str(w.get("Vnt.") or "vnt").strip(), "qty": round(num(w.get("Kiekis")), 3),
           "minQty": round(max(num(w.get("Min")), num(w.get("ROP (užsakymo riba)"))), 3),
           "location": loc, "icon": icon}
    materials.append(mat); mat_by_sku[sku] = mat

order_by_name = {o["product"]: o for o in orders}
stockMoves = []
for j in sheet_rows("📜 Žurnalas"):
    sku = str(j.get("SKU") or "").strip()
    if sku not in mat_by_sku: continue
    note = " · ".join(x for x in [str(j.get("Priežastis") or "").strip(), str(j.get("Pastaba") or "").strip()] if x)
    proj = str(j.get("Projektas") or "").strip()
    stockMoves.append({"id": sid("sm-", sku + str(j.get("Data")) + note[:20] + str(num(j.get("Kiekis")))),
                       "ts": ts(j.get("Data"), NOW), "materialId": mat_by_sku[sku]["id"],
                       "delta": round(num(j.get("Kiekis")), 3), "note": note[:120],
                       "orderId": order_by_name.get(proj, {}).get("id"),
                       "who": mem_id(j.get("Naudotojas"))})
stockMoves.sort(key=lambda s: -(s["ts"] or 0))

# ---------- Articles from positions ----------
articles, seen_art = [], set()
prod_route_default = [{"stationId": st_by_name["Pjovimas"]["id"], "mpu": 2},
                      {"stationId": st_by_name["Pakavimas"]["id"], "mpu": 1}]
for x in positions:
    art = str(x.get("Artikulas") or "").strip()
    if not art or art in seen_art: continue
    seen_art.add(art)
    articles.append({"id": sid("a-", art), "sku": art,
                     "name": str(x.get("Aprašymas") or art).strip()[:48] or art,
                     "unit": "vnt", "lanes": [{"group": None, "route": prod_route_default}]})

# ---------- Activity ----------
for c in sheet_rows("💬 Komentarai"):
    o = order_by_name.get(str(c.get("Projektas") or "").strip())
    activity.append({"ts": ts(c.get("Data"), NOW), "who": mem_id(c.get("Autorius")),
                     "orderId": o["id"] if o else None,
                     "text": f"komentaras: „{str(c.get('Tekstas') or '').strip()}“ ({str(c.get('Užduotis') or '').strip()})"})
completions = []
for o in orders:
    for op in o["ops"]:
        if op["status"] == "done" and op.get("completedAt"):
            stn = next(s for s in stations if s["id"] == op["stationId"])
            completions.append({"ts": op["completedAt"], "who": op.get("completedBy"),
                                "orderId": o["id"], "text": f"completed **{stn['name']}** on {o['num']}"})
completions.sort(key=lambda a: -a["ts"])
activity.extend(completions[:30])
for sm in stockMoves[:6]:
    mat = next(m for m in materials if m["id"] == sm["materialId"])
    sign = "+" if sm["delta"] > 0 else ""
    activity.append({"ts": sm["ts"], "who": sm["who"], "materialId": sm["materialId"],
                     "text": f"sandėlis: **{mat['name']}** {sign}{sm['delta']} {mat['unit']} — {sm['note'][:60]}"})
activity = [a for a in activity if a["ts"]]
activity.sort(key=lambda a: -a["ts"])

state = {
    "v": 3, "shopName": "Northwood Furniture", "orderSeq": 1001, "engSeq": 2001, "pinSalt": PIN_SALT,
    # Placeholder base folder — set your real OneDrive/SharePoint "Projektai" URL in Settings.
    # Each project auto-links to {base}/{project code}, matching how folders are named.
    "oneDrive": {"baseUrl": "https://onedrive.live.com/Dedes-Baldai/Projektai", "template": "{base}/{code}"},
    "members": members, "stations": stations, "orders": orders,
    "activity": activity[:120], "materials": materials, "stockMoves": stockMoves,
    "articles": articles, "portfolios": portfolios, "prefs": {},
}

with open(OUT, "w", encoding="utf-8") as f:
    f.write("/* Auto-generated from NorthwoodFurniture_S4OQX_2026-07-17.xlsx — real workshop data. */\n")
    f.write("window.REAL_SEED = ")
    json.dump(state, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")

print(f"orders={len(orders)} (eng={sum(1 for o in orders if o['type']=='eng')}, "
      f"shipped={sum(1 for o in orders if o['shipped'])}, active={sum(1 for o in orders if not o['shipped'])})")
print(f"ops={sum(len(o['ops']) for o in orders)}, members={len(members)}, stations={len(stations)}, "
      f"materials={len(materials)}, moves={len(stockMoves)}, articles={len(articles)}, portfolios={len(portfolios)}, activity={len(activity[:120])}")
running = [(o['num'], next(s['name'] for s in stations if s['id']==op['stationId']), next((m['name'] for m in members if m['id']==op['assigneeId']), '?')) for o in orders for op in o['ops'] if op['status'] == 'running']
print("running:", running)
blocked = [(o['num'], op['blockNote'][:40]) for o in orders for op in o['ops'] if op['status'] == 'blocked']
print("blocked:", blocked)
homes = [(m['name'], next((s['name'] for s in stations if s['id']==m.get('station')), None)) for m in members]
print("homes:", homes)
import os; print("size:", os.path.getsize(OUT) // 1024, "KB")
