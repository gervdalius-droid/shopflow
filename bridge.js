/* ============================================================
   bridge.js — ShopFlow's half of the shared shop system

   OPTIONAL BY DESIGN. It does something only when the hub's core.js has
   loaded; every entry point is guarded, so ShopFlow served on its own — or
   with the hub not deployed yet — behaves exactly as it always has. The
   <script> tag for core.js is allowed to 404.

   Two jobs:
     • publish every order into the shared document index, so a quote knows
       which order it became and an invoice knows what it is billing
     • resolve `order.client`, which has only ever been a string, to a shared
       customer record

   It never invents a customer in the background. A typo in a client name
   would otherwise quietly become a new company in the shared list, so the
   periodic sync only MATCHES; creating happens when a person actually
   submits a name (M.createOrder / the edit dialog).
   ============================================================ */
"use strict";

const Bridge = {
  DEBOUNCE: 900,
  _timer: null,

  ready() { return typeof Core !== "undefined" && !!Core.state; },

  boot() {
    if (!this.ready()) return;
    Core.boot();
    Core.cloud.load();
    this.sync();
    // a customer edited in the hub or in Invoices should show up in the picker
    Core.on("change", () => { if (typeof App !== "undefined" && App._html) App._html = null; });
    if (Core.cloud.on()) Core.startPolling();
  },

  /* Store.save() calls this on every change; the index only needs the settled
     result, so it is debounced rather than run per keystroke. */
  mark() {
    if (!this.ready()) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.sync(), this.DEBOUNCE);
  },

  /* A production order is an "order"; an engineering project is a "design".
     Calling both an order would lose the distinction the shop actually makes. */
  kindOf(o) { return o.type === "eng" ? "design" : "order"; },

  statusOf(o) {
    if (o.archived || o.shipped) return "done";
    const st = D.orderStatus(o);
    return st === "ready" ? "ready" : st === "blocked" ? "blocked" : "active";
  },

  sync() {
    if (!this.ready()) return 0;
    let n = 0;
    const held = new Set();
    for (const o of Store.state.orders) {
      held.add(String(o.id));
      // match only — never create from a background pass
      let customerId = o.customerId || null;
      if (!customerId && o.client) {
        const m = Core.matchCustomer({ name: o.client });
        if (m) customerId = m.customer.id;
      }
      Core.linkDoc({
        app: "shopflow", ref: o.id, kind: this.kindOf(o), num: o.num,
        customerId, title: o.product || "", status: this.statusOf(o),
        amount: null,                       // ShopFlow does not carry money
        date: o.createdAt || Date.now(),
        fromId: o.fromQuoteId || null,      // set when an order comes from a quote
      });
      n++;
    }
    // an order deleted here should stop appearing in the shared index
    for (const d of Core.docs({ app: "shopflow" }))
      if (!held.has(String(d.ref))) Core.unlinkDoc("shopflow", d.ref);
    return n;
  },

  /* Called when a person submits a client name, so this one may create. */
  resolveClient(name) {
    if (!this.ready() || !name) return null;
    const rec = Core.resolveCustomer({ name: name.trim() });
    return rec ? rec.id : null;
  },

  /* Names for the client field's datalist, so the shop stops re-typing them. */
  customerNames() {
    if (!this.ready()) return [];
    return Core.customers().map(c => c.name);
  },
  datalistHtml(id = "shared-customers") {
    const names = this.customerNames();
    if (!names.length) return "";
    return `<datalist id="${id}">${names.map(n => `<option value="${esc(n)}"></option>`).join("")}</datalist>`;
  },
};
