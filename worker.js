/* ============================================================
   ShopFlow — Worker (shopfloor) mode
   Big targets, zero clutter: My Work · Station · Flow.
   Designed for a tablet at the bench.
   ============================================================ */
"use strict";

const Wkr = {
  station: null, // selected station in Station tab (defaults to member's home)

  shell() {
    const me = App.me;
    const today = new Date().toLocaleDateString(isLT() ? "lt-LT" : "en-US", { weekday: "long", month: "long", day: "numeric" });
    const homeSt = me.station ? D.station(me.station) : null; // may be null if the station was deleted
    const tabs = [
      ["my", "wrench", "My Work"],
      ["station", "factory", "Stations"],
      ["flow", "list", "Flow"],
      ["board", "bulb", "Ideas"],
    ];
    return `<div class="worker-shell">
      <div class="worker-top">
        ${avatarHtml(me, "lg")}
        <div class="meta"><b>${I18N.t("Hi,")} ${esc(me.name)}</b><span>${today}${homeSt ? ` · ${esc(homeSt.name)}` : ""}</span></div>
        ${Offline.badgeHtml()}
        <button class="btn subtle w-exit" id="w-cockpit">${icon("dashboard", 15)} ${I18N.t("Full view")}</button>
        <button class="icon-btn" id="w-theme" title="Appearance">${icon("moon", 16)}</button>
        <button class="icon-btn" id="w-logout" title="Sign out">${icon("power", 15)}</button>
      </div>
      <div class="worker-body ${App.workerTab === "board" ? "wb-fill" : ""}" id="w-body">${this.tabHtml()}</div>
      <div class="tabbar">
        ${tabs.map(([id, ico, label]) => `
          <button class="${App.workerTab === id ? "active" : ""}" data-tab="${id}">
            <span class="ico">${icon(ico, 20)}</span>${label}
          </button>`).join("")}
      </div>
    </div>`;
  },

  tabHtml() {
    switch (App.workerTab) {
      case "my": return this.myWork();
      case "station": return this.stationView();
      case "flow": return this.flowView();
      case "board": return WB.view();
      default: return this.myWork();
    }
  },

  bind(root) {
    $$("[data-tab]", root).forEach(b => b.onclick = () => { App.workerTab = b.dataset.tab; Router.push(); App.render(); });
    $("#w-logout", root).onclick = () => App.logout();
    $("#w-theme", root).onclick = () => {
      const cur = document.documentElement.getAttribute("data-theme");
      App.applyTheme(cur === "dark" ? "light" : "dark");
    };
    $("#w-cockpit", root).onclick = () => App.setBenchMode(false);
    this.bindWork(root);

    // Whiteboard tab
    if (App.workerTab === "board") WB.bind(root);
    // Personal to-dos on My Work
    if (App.workerTab === "my") Todo.bind(root);
  },

  /* Just the task actions — shared with the cockpit's "My Work" page, which
     has no worker top bar or tab bar to wire up. */
  bindWork(root) {
    // Hero actions
    $$("[data-w-act]", root).forEach(b => b.onclick = () => {
      const act = b.dataset.wAct;
      const [orderId, opId] = b.dataset.target.split("/");
      const o = D.order(orderId);
      const op = o.ops.find(x => x.id === opId);
      if (act === "start") {
        M.startOp(orderId, opId, App.me.id);
        Toast.show("Clocked on — good luck!", { emoji: "play" });
      }
      if (act === "pause") { M.pauseOp(orderId, opId, App.me.id); Toast.show("Paused", { emoji: "⏸" }); }
      if (act === "qty+" || act === "qty-") {
        const item = D.item(o, op.itemId);
        const before = op.qtyDone;
        M.reportQty(orderId, opId, op.qtyDone + (act === "qty+" ? 1 : -1), App.me.id);
        if (op.status === "done" && before < item.qty) Toast.show(`All ${item.qty} pcs done — great work!`, { emoji: "check-circle", ms: 4000 });
      }
      if (act === "done") {
        if (!App.tapGuard()) return;              // reflex double-tap
        const item = D.item(o, op.itemId);
        const next = M.completeOp(orderId, opId, App.me.id);
        if (op.status !== "done") {
          Toast.show(`Reported ${op.qtyDone} of ${item.qty} — the rest is still upstream`, { emoji: "⏳", ms: 4200 });
        } else {
          Toast.show(next ? `Done! Next: ${D.station(next.stationId).name}${next.group ? " · " + next.group : ""}` : `${o.num}: all tasks done!`, { emoji: "✅", ms: 4000 });
        }
      }
      if (act === "block") { OrderDetail.blockDialog(orderId, opId); return; }
      App.render();
    });

    // Open order details
    $$("[data-w-order]", root).forEach(b => b.onclick = (e) => {
      if (e.target.closest("[data-w-act]") || e.target.closest("[data-file]")) return;
      Drawer.open(b.dataset.wOrder);
    });

    // Station chips
    $$("[data-w-station]", root).forEach(b => b.onclick = () => { this.station = b.dataset.wStation; Router.push(); App.render(); });

    /* tapping a drawing opens it full screen — and must not also open the
       order drawer underneath it */
    if (typeof Files !== "undefined") Files.bindChips(root);
  },

  /* ---------------- My Work ---------------- */
  myWork() {
    const me = App.me;
    const running = D.runningOpOf(me.id);
    // paused op of mine (shown as hero when nothing is running)
    let pausedMine = null;
    if (!running) {
      for (const o of Store.state.orders) {
        if (o.shipped) continue;
        const op = o.ops.find(x => x.status === "paused" && x.assigneeId === me.id && D.opReady(o, x));
        if (op) { pausedMine = { order: o, op }; break; }
      }
    }
    const heroOpId = running ? running.op.id : pausedMine ? pausedMine.op.id : null;
    const queue = D.workerQueue(me.id).filter(x => x.op.id !== heroOpId);
    const doneToday = D.doneTodayBy(me.id);

    let html = "";

    if (running) {
      const { order, op } = running;
      const st = D.station(op.stationId);
      const due = fmtDue(order.due);
      const item = D.item(order, op.itemId);
      const avail = D.opAvail(order, op);
      const showQty = item && item.qty > 1;
      html += `<div class="worker-section">
        <div class="hero-task" data-w-order="${order.id}">
          <div class="ht-top">
            <div class="grow">
              <div class="stat-line"><span class="dot"></span> ${I18N.t("Working now")} — ${esc(st.name)}${op.group ? ` · ${esc(op.group)}` : ""}</div>
              <h1>${esc(order.product)}</h1>
              <div class="sub">${order.num !== order.product ? esc(order.num) + " · " : ""}${order.client && order.client !== order.product ? esc(order.client) + " · " : ""}${item && order.items.length > 1 ? `${esc(item.name)} · ` : ""}${item ? item.qty : order.qty} ${esc(order.unit)} · ${due.label}</div>
            </div>
          </div>
          ${(() => {
            /* the drawing belongs where the work is — this task's files first,
               then the project's, because at the machine you want both */
            const fs = [...D.filesFor({ opId: op.id }), ...D.filesFor({ orderId: order.id })];
            return fs.length ? Files.chipsHtml(fs) : "";
          })()}
          <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:12px">
            <div class="timer"><span data-timer="${order.id}/${op.id}" data-timer-style="clock">${fmtClock(D.opElapsed(op))}</span><small>${I18N.t("est")} ${fmtDur(op.estMins * 60000)}</small>${offShiftHtml(true)}</div>
            ${showQty ? `<div class="qty-stepper">
              <button class="step-btn" data-w-act="qty-" data-target="${order.id}/${op.id}" ${op.qtyDone <= 0 ? "disabled" : ""}>−</button>
              <span class="qv">${op.qtyDone}<small> / ${item.qty} pcs</small></span>
              <button class="step-btn" data-w-act="qty+" data-target="${order.id}/${op.id}" ${op.qtyDone >= avail ? "disabled" : ""}>＋</button>
            </div>` : ""}
          </div>
          ${showQty && avail < item.qty ? `<div style="font-size:12px;opacity:.8">${icon("clock", 12)} ${avail} of ${item.qty} available from the previous step so far</div>` : ""}
          <div class="ht-actions">
            <button class="btn" data-w-act="pause" data-target="${order.id}/${op.id}">${icon("pause", 13)} Pause</button>
            <button class="btn" data-w-act="block" data-target="${order.id}/${op.id}">${icon("alert", 13)} Problem</button>
            <button class="btn done-btn" data-w-act="done" data-target="${order.id}/${op.id}">${icon("check", 13)} Done</button>
          </div>
        </div>
      </div>`;
    } else if (pausedMine) {
      const { order, op } = pausedMine;
      const st = D.station(op.stationId);
      const item = D.item(order, op.itemId);
      const avail = D.opAvail(order, op);
      const showQty = item && item.qty > 1;
      html += `<div class="worker-section">
        <div class="hero-task paused" data-w-order="${order.id}">
          <div class="ht-top"><div class="grow">
            <div class="stat-line">${icon("pause", 12)} Paused — ${esc(st.name)}${op.group ? ` · ${esc(op.group)}` : ""}</div>
            <h1>${esc(order.product)}</h1>
            <div class="sub">${order.num !== order.product ? esc(order.num) + " · " : ""}${order.client && order.client !== order.product ? esc(order.client) + " · " : ""}logged ${fmtDur(D.opElapsed(op))}</div>
          </div></div>
          ${showQty ? `<div class="qty-stepper">
            <button class="step-btn" data-w-act="qty-" data-target="${order.id}/${op.id}" ${op.qtyDone <= 0 ? "disabled" : ""}>−</button>
            <span class="qv">${op.qtyDone}<small> / ${item.qty} pcs</small></span>
            <button class="step-btn" data-w-act="qty+" data-target="${order.id}/${op.id}" ${op.qtyDone >= avail ? "disabled" : ""}>＋</button>
          </div>` : ""}
          <div class="ht-actions">
            <button class="btn" data-w-act="done" data-target="${order.id}/${op.id}">${icon("check", 13)} Done</button>
            <button class="btn done-btn" style="color:#b35c00" data-w-act="start" data-target="${order.id}/${op.id}">${icon("play", 12)} Resume</button>
          </div>
        </div>
      </div>`;
    }

    if (doneToday > 0) {
      html += `<div class="done-today">${icon("check-circle", 15)} ${doneToday} step${doneToday > 1 ? "s" : ""} completed today — keep it up!</div>`;
    }

    /* personal to-do list (admin can assign into it too) */
    const todos = D.todosFor(me.id).filter(t => !t.done);
    html += `<div class="worker-section">
      <h2>${icon("todo", 16)} My to-dos <span class="count-badge">${todos.length}</span></h2>
      <div class="panel"><div class="todo-list">
        ${todos.length ? todos.map(t => Todo.itemHtml(t)).join("") : `<div class="t-caption" style="padding:8px 16px 4px">Nothing on your list</div>`}
        ${Todo.addRow(me.id, "Add a to-do…")}
      </div></div>
    </div>`;

    html += `<div class="worker-section">
      <h2>Up next <span class="count-badge">${queue.length}</span></h2>
      ${queue.length ? queue.map(({ order, op }) => this.taskRow(order, op)).join("")
        : (!running ? `<div class="worker-empty"><span class="big">${icon("sparkles", 44)}</span><h3>All caught up!</h3><p class="muted">No jobs waiting for you. Check Stations for unclaimed work.</p></div>`
                    : `<div class="empty-mini" style="border:none">Nothing else queued for you.</div>`)}
    </div>`;

    return `<div class="view-anim">${html}</div>`;
  },

  taskRow(order, op) {
    const st = D.station(op.stationId);
    const due = fmtDue(order.due);
    const blocked = op.status === "blocked";
    const item = D.item(order, op.itemId);
    const showQty = item && item.qty > 1;
    return `<div class="task-row" data-w-order="${order.id}">
      <div class="ico-wrap">${stIcon(st, 21)}</div>
      <div class="grow">
        <b>${esc(order.product)}</b>
        <div class="l2">
          ${order.num !== order.product ? `<span class="mono" style="font-size:11.5px">${esc(order.num)}</span>` : ""}
          <span>${stIcon(st, 13)} ${esc(st.name)}</span>
          ${op.group ? `<span class="task-tag">${esc(op.group)}</span>` : ""}
          ${order.items.length > 1 && item ? `<span class="task-tag" style="background:var(--teal-soft);color:var(--teal)">${esc(item.name)}</span>` : ""}
          ${showQty ? `<span class="qty-pill ${op.qtyDone > 0 ? "part" : ""}">${op.qtyDone}/${item.qty}</span>` : ""}
          <span class="due-chip ${due.cls}">${due.label}</span>
          ${prioHtml(order.priority)}
          ${blocked ? `<span class="pill blocked"><span class="dot"></span>${esc(op.blockNote || "Blocked")}</span>` : ""}
        </div>
      </div>
      ${blocked
        ? `<button class="btn subtle" data-w-act="start" data-target="${order.id}/${op.id}">Unblock & start</button>`
        : `<button class="btn primary start-btn" data-w-act="start" data-target="${order.id}/${op.id}">${icon("play", 12)} Start</button>`}
    </div>`;
  },

  /* ---------------- Station queues ---------------- */
  stationView() {
    const me = App.me;
    const stId = this.station || me.station || D.stationsOf("prod")[0].id;
    this.station = stId;
    const q = D.stationQueue(stId);
    return `<div class="view-anim">
      <div class="station-pick">
        ${D.stationsOf("prod").map(st => {
          const n = D.stationQueue(st.id).length;
          return `<button class="${st.id === stId ? "active" : ""}" data-w-station="${st.id}">${stIcon(st, 13)} ${esc(st.name)}${n ? ` · ${n}` : ""}</button>`;
        }).join("")}
      </div>
      ${q.length ? q.map(({ order, op }) => {
        const mine = op.assigneeId === me.id;
        const assignee = D.member(op.assigneeId);
        const due = fmtDue(order.due);
        const item = D.item(order, op.itemId);
        return `<div class="task-row" data-w-order="${order.id}">
          <div class="ico-wrap">${op.status === "running" ? '<span class="pill running" style="padding:0;background:none"><span class="dot"></span></span>' : op.status === "blocked" ? icon("ban", 18) : icon("list", 18)}</div>
          <div class="grow">
            <b>${esc(order.product)}</b>
            <div class="l2">
              ${order.num !== order.product ? `<span class="mono" style="font-size:11.5px">${esc(order.num)}</span>` : ""}
              ${op.group ? `<span class="task-tag">${esc(op.group)}</span>` : ""}
              ${order.items.length > 1 && item ? `<span class="task-tag" style="background:var(--teal-soft);color:var(--teal)">${esc(item.name)}</span>` : ""}
              ${item && item.qty > 1 ? `<span class="qty-pill ${op.qtyDone > 0 ? "part" : ""}">${op.qtyDone}/${item.qty}</span>` : ""}
              <span class="due-chip ${due.cls}">${due.label}</span>
              ${prioHtml(order.priority)}
              ${assignee ? `<span class="row" style="gap:5px">${avatarHtml(assignee, "sm")} ${mine ? "You" : esc(assignee.name)}</span>` : `<span class="muted">Unclaimed</span>`}
              ${op.status === "running" ? `<span class="pill running"><span class="dot"></span><span data-timer="${order.id}/${op.id}" data-timer-style="clock">${fmtClock(D.opElapsed(op))}</span></span>` : ""}
            </div>
          </div>
          ${op.status !== "running" && op.status !== "blocked"
            ? `<button class="btn ${op.assigneeId && !mine ? "" : "primary"} start-btn" data-w-act="start" data-target="${order.id}/${op.id}">${icon("play", 12)} Start</button>`
            : op.status === "blocked" ? pillHtml("blocked") : ""}
        </div>`;
      }).join("") : `<div class="worker-empty"><span class="big">${icon("leaf", 44)}</span><h3>Queue is empty</h3><p class="muted">No orders waiting at this station.</p></div>`}
    </div>`;
  },

  /* ---------------- Flow (read-only overview) ---------------- */
  flowView() {
    const s = Store.state;
    const ready = s.orders.filter(o => !o.shipped && o.type !== "eng" && o.ops.length && o.ops.every(op => op.status === "done"));
    return `<div class="view-anim">
      ${D.stationsOf("prod").map(st => {
        const q = D.stationQueue(st.id);
        if (!q.length) return "";
        return `<div class="worker-section">
          <h2>${stIcon(st, 15)} ${esc(st.name)} <span class="count-badge">${q.length}</span></h2>
          ${q.map(({ order, op }) => {
            const due = fmtDue(order.due);
            const assignee = D.member(op.assigneeId);
            const item = D.item(order, op.itemId);
            return `<div class="task-row" data-w-order="${order.id}" style="cursor:pointer">
              <div class="ico-wrap">${op.status === "running" ? '<span class="pill running" style="padding:0;background:none"><span class="dot"></span></span>' : op.status === "blocked" ? icon("ban", 16) : icon("clock", 16)}</div>
              <div class="grow">
                <b>${order.num !== order.product ? esc(order.num) + " · " : ""}${esc(order.product)}</b>
                <div class="l2">
                  ${op.group ? `<span class="task-tag">${esc(op.group)}</span>` : ""}
                  ${item && item.qty > 1 ? `<span class="qty-pill ${op.qtyDone > 0 ? "part" : ""}">${op.qtyDone}/${item.qty}</span>` : ""}
                  <span class="due-chip ${due.cls}">${due.label}</span>${assignee ? esc(assignee.name) : ""}
                </div>
              </div>
              ${stepsMini(order)}
            </div>`;
          }).join("")}
        </div>`;
      }).join("")}
      ${ready.length ? `<div class="worker-section">
        <h2><span style="color:var(--green)">${icon("check-circle", 15)}</span> Ready to ship <span class="count-badge">${ready.length}</span></h2>
        ${ready.map(o => `<div class="task-row" data-w-order="${o.id}">
          <div class="ico-wrap">${icon("box", 19)}</div>
          <div class="grow"><b>${esc(o.num)} · ${esc(o.product)}</b><div class="l2">${esc(o.client)}</div></div>
          ${pillHtml("ready")}
        </div>`).join("")}
      </div>` : ""}
    </div>`;
  },
};
