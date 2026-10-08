/* ============================================================
   ShopFlow — Manager views
   Shell, Dashboard, Board, Orders, Warehouse, Team, Activity,
   Settings, Order detail drawer, New order modal.
   ============================================================ */
"use strict";

const Mgr = {
  /* ---------------- Shell ---------------- */
  shell() {
    const eng = App.isEngineer();
    // engineers only count/see engineering projects; managers see all active
    const active = Store.state.orders.filter(o => !o.archived && (!eng || o.type === "eng"));
    const attention = active.filter(o => {
      const st = D.orderStatus(o);
      return st === "blocked" || (fmtDue(o.due).cls === "overdue" && st !== "ready");
    }).length;
    const low = D.lowStock().length;
    const myTodos = D.openTodoCount(App.me.id);
    // engineers get a focused workspace (design projects + shared tools); managers get everything
    const myOps = App.isWorker() ? D.workerQueue(App.me.id).length : 0;
    const nav = eng ? [
      ["dashboard", "dashboard", "Dashboard"],
      ["projects", "compass", "Projektavimas", active.length],
      ["todo", "todo", "To-Do", myTodos],
      ["planner", "columns", "Planner", D.myGTaskCount(App.me.id)],
      ["whiteboard", "board", "Whiteboard"],
      ["activity", "history", "Activity"],
      ...(App.can("reports.view") ? [["reports", "chart", "Reports"]] : []),
    ] : [
      // everyone gets the same cockpit — Settings is the only thing a role can hide
      ["dashboard", "dashboard", "Dashboard"],
      ...(App.isWorker() ? [["mywork", "wrench", "My Work", myOps]] : []),
      ["board", "kanban", "Production Board"],
      ["projects", "folder", "Projects", active.length],
      ["warehouse", "warehouse", "Warehouse", low, "low"],
      ["todo", "todo", "To-Do", myTodos],
      ["planner", "columns", "Planner", D.myGTaskCount(App.me.id)],
      ["scan", "scan", "Scan Station"],
      ["team", "users", "Team"],
      ["whiteboard", "board", "Whiteboard"],
      ["activity", "history", "Activity"],
      ...(App.can("reports.view") ? [["reports", "chart", "Reports"]] : []),
      ...(App.can("settings") ? [["settings", "sliders", "Settings"]] : []),
    ];
    const navActive = (id) => id === "projects"
      ? ["projects", "orders"].includes(App.view)
      : App.view === id;
    return `<div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="mark" style="color:var(--accent)">${icon("logo", 23, "", 1.7)}</span> ShopFlow</div>
        ${nav.map(([id, ico, label, count, warn]) => `
          <button class="nav-item ${navActive(id) ? "active" : ""}" data-nav="${id}">
            <span class="ico">${icon(ico, 17)}</span> ${label}
            ${count ? `<span class="count-badge" ${warn ? `style="background:var(--red-soft);color:var(--red)"` : ""}>${count}</span>` : ""}
          </button>`).join("")}
        <div class="spacer"></div>
        ${(() => {
          const n = D.attention(App.me.id).count;
          return n ? `<button class="nav-item ${App.view === "attention" ? "active" : ""}" data-nav="attention" style="color:var(--red)">
            <span class="ico">${icon("alert", 16)}</span> Needs attention <span class="count-badge" style="background:var(--red-soft);color:var(--red)">${n}</span>
          </button>` : "";
        })()}
        <button class="nav-item bench-switch" id="bench-btn" title="Big-button screen for a bench tablet">
          <span class="ico">${icon("wrench", 16)}</span> Bench mode
        </button>
        <button class="user-chip" id="logout-btn" title="Sign out">
          ${avatarHtml(App.me, "md")}
          <span class="meta"><b>${esc(App.me.name)}</b><span>${esc(App.me.trade)}</span></span>
          <span class="out">${icon("power", 15)}</span>
        </button>
      </aside>
      <div class="main">
        <div class="topbar">
          <h1 id="page-title">${this.titles[App.view] || ""}</h1>
          <div class="grow"></div>
          <div class="search-box" id="topbar-search">${icon("search", 14)}<span style="flex:1">Search</span><kbd>⌘K</kbd></div>
          ${Offline.badgeHtml()}
          ${Notif.bellHtml(App.me.id)}
          <button class="icon-btn" id="theme-btn" title="Toggle appearance">${icon("moon", 16)}</button>
          ${App.can("orders.create") && App.view !== "planner" && !App.isEngineer() ? `<button class="btn" id="swood-btn" title="Import a SWOOD Report Lists to Excel export">${icon("import", 14)} Import SWOOD</button>` : ""}
          ${App.can("orders.create") || App.view === "planner" ? `<button class="btn primary" id="new-order-btn">${icon("plus", 14)} ${App.view === "planner" ? "New project" : App.isEngineer() ? "New Project" : "New Order"}</button>` : ""}
        </div>
        <div class="content ${["board", "orders", "projects", "whiteboard", "scan", "planner"].includes(App.view) ? "no-pad" : ""}" id="content">${this.viewHtml()}</div>
      </div>
      ${this.mobileNav(nav, navActive, attention)}
    </div>`;
  },

  titles: {
    dashboard: "Dashboard", projects: "Projects", board: "Production Board", orders: "Projects",
    mywork: "My Work", attention: "Needs attention", warehouse: "Warehouse", todo: "To-Do", planner: "Planner", scan: "Scan Station", team: "Team", whiteboard: "Whiteboard", activity: "Activity", reports: "Reports", settings: "Settings",
  },

  viewHtml() {
    // engineers only reach their own workspace views
    if (App.isEngineer() && !["dashboard", "projects", "orders", "todo", "planner", "whiteboard", "activity", "reports"].includes(App.view)) App.view = "dashboard";
    if (App.view === "settings" && !App.can("settings")) App.view = "dashboard";   // never reachable by URL either
    if (App.view === "reports" && !App.can("reports.view")) App.view = "dashboard";
    switch (App.view) {
      case "dashboard": return this.dashboard();
      case "mywork": return this.myWork();
      case "board": return this.board();
      case "orders": this.projectsTab = "list"; App.view = "projects"; return this.projects();
      case "projects": return this.projects();
      case "warehouse": return Warehouse.view();
      case "todo": return Todo.view();
      case "planner": return GPM.view();
      case "scan": return ScanStation.view();
      case "team": return this.team();
      case "whiteboard": return WB.view();
      case "activity": return Activity.view();
      case "reports": return Reports.view();
      case "attention": return this.attention();
      case "settings": return this.settings();
      default: return this.dashboard();
    }
  },

  /* ---- phone navigation ----
     The sidebar can't fit a phone, so the same nav appears as a bottom bar:
     the first four destinations plus a sheet holding the rest, the profile
     and sign-out. Hidden above 760px, where the sidebar takes over. */
  /* a tab bar has ~70px per label — long names must be shortened, not clipped */
  SHORT_NAV: { dashboard: "Home", board: "Board", projects: "Projects", mywork: "My Work",
               warehouse: "Stock", todo: "To-Do", planner: "Planner", scan: "Scan", reports: "Reports",
               team: "Team", whiteboard: "Board", activity: "Activity", settings: "Settings" },

  mobileNav(nav, navActive, attention) {
    const primary = nav.slice(0, 4);
    const rest = nav.slice(4);
    const moreOpen = App.moreOpen;
    return `
      <nav class="mobile-nav">
        ${primary.map(([id, ico, label, count, warn]) => `
          <button class="${navActive(id) && !moreOpen ? "active" : ""}" data-nav="${id}">
            <span class="ico">${icon(ico, 20)}${count ? `<i class="dot ${warn ? "warn" : ""}"></i>` : ""}</span>${esc(this.SHORT_NAV[id] || label)}
          </button>`).join("")}
        <button class="${moreOpen ? "active" : ""}" id="nav-more">
          <span class="ico">${icon("menu", 20)}</span>More
        </button>
      </nav>
      ${moreOpen ? `<div class="more-scrim" id="more-scrim"></div>
      <div class="more-sheet">
        <div class="more-grab"></div>
        <div class="more-grid">
          ${rest.map(([id, ico, label, count, warn]) => `
            <button data-nav="${id}">
              <span class="ico">${icon(ico, 20)}</span><span class="grow">${esc(label)}</span>
              ${count ? `<span class="count-badge" ${warn ? `style="background:var(--red-soft);color:var(--red)"` : ""}>${count}</span>` : ""}
            </button>`).join("")}
        </div>
        ${attention ? `<button class="btn more-attention" data-nav="attention">
          ${icon("alert", 15)} Needs attention <span class="count-badge">${attention}</span>
        </button>` : ""}
        <div class="more-actions">
          ${App.can("orders.create") && !App.isEngineer() ? `<button class="btn" id="more-swood">${icon("import", 15)} Import SWOOD</button>` : ""}
          <button class="btn" id="more-bench">${icon("wrench", 15)} Bench mode</button>
          <button class="btn" id="more-theme">${icon("moon", 15)} Appearance</button>
        </div>
        <div class="more-build">ShopFlow · build ${esc(App.build())}</div>
        <button class="more-user" id="more-logout">
          ${avatarHtml(App.me, "md")}
          <span class="grow"><b>${esc(App.me.name)}</b><span>${esc(App.me.trade || App.me.role)}</span></span>
          <span class="out">${icon("power", 16)}</span>
        </button>
      </div>` : ""}`;
  },

  bindMobileNav(root) {
    const more = $("#nav-more", root);
    if (more) more.onclick = () => { App.moreOpen = !App.moreOpen; App.render(); };
    const close = () => { App.moreOpen = false; App.render(); };
    const scrim = $("#more-scrim", root);
    if (scrim) scrim.onclick = close;
    const sw = $("#more-swood", root);
    if (sw) sw.onclick = () => { App.moreOpen = false; App.render(); SwoodImport.open(); };
    const bench = $("#more-bench", root);
    if (bench) bench.onclick = () => { App.moreOpen = false; App.setBenchMode(true); };
    const th = $("#more-theme", root);
    if (th) th.onclick = () => {
      const cur = document.documentElement.getAttribute("data-theme");
      App.applyTheme(cur === "dark" ? "light" : "dark");
    };
    const out = $("#more-logout", root);
    if (out) out.onclick = () => { App.moreOpen = false; App.logout(); };
  },

  /* ---- My Work (cockpit) ----
     The same hero task + queue a worker gets on the bench tablet, rendered
     inside the full shell so they can jump straight from their own job to
     the board, the project or the warehouse. */
  myWork() {
    return `<div class="view-anim mywork-pad">${Wkr.myWork()}</div>`;
  },

  bind(root) {
    $$("[data-nav]", root).forEach(b => b.onclick = () => {
      App.moreOpen = false;
      App.navigate(b.dataset.nav, b.dataset.filter ? { filter: b.dataset.filter } : {});
    });
    this.bindMobileNav(root);
    $("#logout-btn", root).onclick = () => App.logout();
    const bench = $("#bench-btn", root);
    if (bench) bench.onclick = () => App.setBenchMode(true);
    Notif.bindBell(root);
    $("#topbar-search", root).onclick = () => Palette.open();
    $("#theme-btn", root).onclick = () => {
      const cur = document.documentElement.getAttribute("data-theme");
      App.applyTheme(cur === "dark" ? "light" : "dark");
    };
    const sw = $("#swood-btn", root);
    if (sw) sw.onclick = () => SwoodImport.open();
    const newBtn = $("#new-order-btn", root);
    if (newBtn) newBtn.onclick = () => App.view === "planner" ? GPM.newProjectModal() : NewOrder.open();

    const bindView = {
      dashboard: () => this.bindDashboard(root),
      mywork: () => { Wkr.bindWork(root); Todo.bind(root); },
      board: () => this.bindBoard(root),
      projects: () => this.bindProjects(root),
      warehouse: () => Warehouse.bind(root),
      reports: () => Reports.bind(root),
      attention: () => this.bindAttention(root),
      todo: () => Todo.bind(root),
      planner: () => GPM.bind(root),
      scan: () => ScanStation.bind(root),
      team: () => this.bindTeam(root),
      whiteboard: () => WB.bind(root),
      activity: () => Activity.bind(root),
      settings: () => this.bindSettings(root),
    }[App.view];
    if (bindView) bindView();
  },

  /* ---------------- Projects hub (multi-view + scope) ---------------- */
  projectsTab: null,
  projectsScope: null, // "prod" | "eng"

  currentTab() {
    if (App.viewParams.tab) { this.projectsTab = App.viewParams.tab; App.viewParams.tab = null; }
    if (App.viewParams.scope) { this.projectsScope = App.viewParams.scope; App.viewParams.scope = null; }
    if (!this.projectsTab) this.projectsTab = D.pref(App.me.id, "projectsTab", "list");
    if (!this.projectsScope) this.projectsScope = D.pref(App.me.id, "projectsScope", "prod");
    if (App.isEngineer()) this.projectsScope = "eng"; // engineers only see projektavimas
    return this.projectsTab;
  },

  scopeType() { return this.projectsScope === "eng" ? "eng" : "prod"; },

  projects() {
    let tab = this.currentTab();
    const scope = this.projectsScope;
    const tabs = [
      ["list", "list", "List"],
      ["board", "kanban", "Board"],
      ["timeline", "gantt", "Timeline"],
      ["calendar", "calendar", "Calendar"],
      ["workload", "users", "Workload"],
      ...(App.isManager() ? [["portfolios", "archive", "Portfolios"]] : []),
    ];
    if (!tabs.some(t => t[0] === tab)) { tab = "list"; this.projectsTab = "list"; }
    const body = {
      list: () => `<div class="tab-pad">${this.orders()}</div>`,
      board: () => this.board(scope === "eng" ? "eng" : "prod"),
      timeline: () => this.timeline(),
      calendar: () => `<div class="tab-pad">${this.calendar()}</div>`,
      workload: () => `<div class="tab-pad">${this.workload()}</div>`,
      portfolios: () => `<div class="tab-pad">${this.portfolios()}</div>`,
    }[tab]();
    return `<div style="display:flex;flex-direction:column;height:100%">
      <div class="vtabs">
        ${tabs.map(([id, ico, label]) => `
          <button class="vtab ${tab === id ? "active" : ""}" data-vtab="${id}">
            <span class="ico">${icon(ico, 14)}</span>${label}
          </button>`).join("")}
        ${tab !== "portfolios" && App.isManager() ? `<div class="segmented scope-seg" id="scope-seg">
          <button data-scope="prod" class="${scope !== "eng" ? "active" : ""}">${icon("factory", 13)} Production</button>
          <button data-scope="eng" class="${scope === "eng" ? "active" : ""}">${icon("pencil", 13)} Engineering</button>
        </div>` : ""}
      </div>
      <div class="projects-body">${body}</div>
    </div>`;
  },

  bindProjects(root) {
    $$("[data-vtab]", root).forEach(b => b.onclick = () => {
      this.projectsTab = b.dataset.vtab;
      M.setPref(App.me.id, "projectsTab", b.dataset.vtab);
      Router.push(); App.render();
    });
    $$("[data-scope]", root).forEach(b => b.onclick = () => {
      this.projectsScope = b.dataset.scope;
      M.setPref(App.me.id, "projectsScope", b.dataset.scope);
      App.render();
    });
    const tab = this.projectsTab;
    if (tab === "list") this.bindOrders(root);
    if (tab === "board") this.bindBoard(root);
    if (tab === "timeline") this.bindTimeline(root);
    if (tab === "calendar") this.bindCalendar(root);
    if (tab === "workload") this.bindWorkload(root);
    if (tab === "portfolios") this.bindPortfolios(root);
  },

  /* ---------------- Portfolios ---------------- */
  portfolios() {
    const s = Store.state;
    return `<div class="view-anim">
      <div class="portfolio-grid">
        ${s.portfolios.map(p => {
          const r = D.portfolioRollup(p.id);
          const open = r.orders.filter(o => !o.archived);
          const eng = r.orders.filter(o => o.type === "eng").length;
          const due = isFinite(r.maxDue) ? fmtDue(r.maxDue) : null;
          /* The card opens the portfolio; the pencil edits it. It used to be
             one big button with nowhere to rename or delete from — the editor
             existed and nothing could reach it. */
          const c = D.jobColor("pf:" + p.id);
          return `<div class="portfolio-card" style="--job:var(--${c});--job-soft:var(--${c}-soft)">
            <button class="pf-main" data-portfolio="${p.id}">
              <div class="ph">
                <span class="ico pf-ico">${pfIcon(p, 21)}</span>
                <span class="grow"><b>${esc(p.name)}</b>
                <span>${r.orders.length} project${r.orders.length === 1 ? "" : "s"}${eng ? ` · ${eng} engineering` : ""}${open.length ? "" : " · all done"}</span></span>
                ${due ? `<span class="due-chip ${due.cls}">${due.label}</span>` : ""}
              </div>
              <div class="prog-row">
                <div class="progress ${r.pct === 100 ? "done" : ""}"><i style="width:${r.pct}%"></i></div>
                <span class="t-caption">${r.done}/${r.total} tasks</span>
              </div>
              <div class="pills">
                ${Object.entries(r.statuses).map(([st, n]) => pillHtml(st, `${n} ${D.statusLabel[st]}`)).join("")}
              </div>
            </button>
            <button class="icon-btn pf-edit" data-pf-edit="${p.id}" title="Rename, change the icon, or delete">${icon("pencil", 14)}</button>
          </div>`;
        }).join("")}
        <button class="portfolio-card portfolio-new" id="pf-add">＋ New portfolio</button>
      </div>
      <div class="t-caption" style="margin-top:14px;max-width:760px;line-height:1.55">
        <span>A portfolio is a job you file by hand. To put a project in one, open the project and set its Portfolio.</span><br>
        <span>Projects nobody filed are grouped anyway — by the name they share and by customer — so the board still shows one row per job.</span>
      </div>
    </div>`;
  },

  bindPortfolios(root) {
    $$("[data-portfolio]", root).forEach(b => b.onclick = () => {
      this.ordersFilter = "all";
      this.portfolioFilter = b.dataset.portfolio;
      this.projectsTab = "list";
      App.render();
    });
    $$("[data-pf-edit]", root).forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      this.portfolioModal(b.dataset.pfEdit);
    });
    $("#pf-add", root).onclick = () => this.portfolioModal();
  },

  portfolioModal(pid) {
    const p = pid ? D.portfolio(pid) : null;
    Modal.open(`
      <header><h2>${p ? "Edit portfolio" : "New portfolio"}</h2><button class="icon-btn" data-close>✕</button></header>
      <div class="modal-body">
        <div class="form-row">
          <div class="field"><label>Name</label><input class="input" id="pf-name" value="${esc(p?.name || "")}" placeholder="e.g. Hotel Vilnius fit-out"></div>
          <div class="field"><label>Icon</label><button class="mat-ico" id="pf-icon" type="button" data-ic="${p?.ic || "folder"}" style="cursor:pointer">${pfIcon(p || { ic: "folder" }, 19)}</button></div>
        </div>
        <div class="field"><label>Colour</label>
          <div class="swatches" id="pf-colors">
            <button type="button" class="sw sw-auto ${p && p.color ? "" : "on"}" data-c="" title="Chosen from the name — stable, and never red">A</button>
            ${["blue", "indigo", "teal", "purple", "green", "orange", "red", "gray"].map(c =>
              `<button type="button" class="sw ${p && p.color === c ? "on" : ""}" data-c="${c}" style="--sw:var(--${c})" title="${c}"></button>`).join("")}
          </div>
        </div>
        ${p ? `<button class="btn danger" id="pf-del" style="align-self:flex-start">Delete portfolio</button>` : ""}
      </div>
      <footer>
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="pf-save">${p ? "Save" : "Create"}</button>
      </footer>
    `, (modal) => {
      $$("[data-close]", modal).forEach(b => b.onclick = () => Modal.close());
      const iconBtn = $("#pf-icon", modal);
      iconBtn.onclick = () => Popover.open(iconBtn, `<div class="icon-grid">${PORTFOLIO_IC_KEYS.map(k => `<button data-ic="${k}" title="${k}">${icon(k, 17)}</button>`).join("")}</div>`, (pop) => {
        $$("[data-ic]", pop).forEach(ib => ib.onclick = () => {
          iconBtn.dataset.ic = ib.dataset.ic;
          iconBtn.innerHTML = icon(ib.dataset.ic, 19);
          Popover.close();
        });
      });
      let color = (p && p.color) || "";
      $$("#pf-colors .sw", modal).forEach(b => b.onclick = () => {
        color = b.dataset.c;
        $$("#pf-colors .sw", modal).forEach(x => x.classList.toggle("on", x === b));
      });
      $("#pf-save", modal).onclick = () => {
        const name = $("#pf-name", modal).value.trim();
        if (!name) { $("#pf-name", modal).focus(); return; }
        if (p) M.updatePortfolio(p.id, { name, ic: iconBtn.dataset.ic || "folder", color: color || null });
        else M.addPortfolio(name, "📁", App.me.id, iconBtn.dataset.ic || "folder", color || null);
        Modal.close(); App.render();
        Toast.show(p ? "Portfolio updated" : `Portfolio “${name}” created`, { emoji: "🗄" });
      };
      const del = $("#pf-del", modal);
      if (del) del.onclick = () => {
        M.deletePortfolio(p.id, App.me.id);
        Modal.close(); App.render();
        Toast.show("Portfolio deleted — projects kept", { emoji: "🗑" });
      };
    });
  },

  /* ---------------- Timeline (Gantt) ---------------- */
  DAY_W: 34,

  tlRange() {
    const active = Store.state.orders.filter(o => !o.archived && (o.type || "prod") === this.scopeType());
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let start = today.getTime() - 7 * DAY;
    let end = today.getTime() + 21 * DAY;
    for (const o of active) {
      if (o.due + 4 * DAY > end) end = o.due + 4 * DAY;
      if (o.createdAt - 2 * DAY < start) start = Math.max(o.createdAt - 2 * DAY, today.getTime() - 30 * DAY);
    }
    return { start, end, days: Math.round((end - start) / DAY) + 1 };
  },

  timeline() {
    const { start, days } = this.tlRange();
    const W = this.DAY_W;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const active = Store.state.orders.filter(o => !o.archived && (o.type || "prod") === this.scopeType()).sort((a, b) => a.due - b.due);
    const dayList = Array.from({ length: days }, (_, i) => new Date(start + i * DAY));

    /* month header segments */
    const months = [];
    for (const d of dayList) {
      const key = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      if (!months.length || months[months.length - 1].key !== key) months.push({ key, n: 0 });
      months[months.length - 1].n++;
    }

    const todayX = Math.round((today.getTime() - start) / DAY) * W;

    return `<div class="tl-scroll view-anim">
      <div class="tl">
        <div class="tl-head">
          <div class="tl-label-col">Order</div>
          <div>
            <div class="tl-months">${months.map(m => `<div class="tl-month" style="width:${m.n * W}px">${m.key}</div>`).join("")}</div>
            <div class="tl-days">${dayList.map(d => {
              const wd = d.getDay();
              const isToday = d.getTime() === today.getTime();
              return `<div class="tl-day ${wd === 0 || wd === 6 ? "weekend" : ""} ${isToday ? "today" : ""}">${d.getDate()}</div>`;
            }).join("")}</div>
          </div>
        </div>
        <div class="tl-body">
          ${active.map(o => {
            const st = D.orderStatus(o);
            const cls = { running: "s-running", paused: "s-paused", blocked: "s-blocked", queued: "s-queued", ready: "s-ready" }[st] || "s-queued";
            const p = D.progress(o);
            const barStart = Math.max(o.createdAt, start);
            const x = Math.round((barStart - start) / DAY) * W;
            const wDays = Math.max(1, Math.round((o.due - barStart) / DAY) + 1);
            const w = wDays * W - 6;
            const cur = D.currentOp(o);
            return `<div class="tl-row">
              <div class="tl-label-col tl-row-label" data-order="${o.id}">
                <b>${esc(o.num)} · ${esc(o.product)}</b>
                <span>${cur ? esc(D.station(cur.stationId)?.name || "") : "Ready to ship"} · ${p.done}/${p.total}</span>
              </div>
              <div class="tl-canvas" style="width:${days * W}px">
                ${dayList.map((d, i) => (d.getDay() === 0 || d.getDay() === 6) ? `<div class="tl-grid-day weekend" style="left:${i * W}px"></div>` : "").join("")}
                <div class="tl-today-line" style="left:${todayX + W / 2}px"></div>
                <div class="tl-bar ${cls}" data-tl-bar="${o.id}" style="left:${x + 3}px;width:${w}px">
                  <span class="fill" style="width:${p.pct}%"></span>
                  <span>${o.priority === "rush" ? "🔥 " : ""}${esc(o.num)}</span>
                  ${w > 150 ? `<span style="font-weight:560;opacity:.75">${esc(o.product.slice(0, Math.floor(w / 9)))}</span>` : ""}
                  <span class="tl-handle" data-tl-handle="${o.id}" title="Drag to change due date"></span>
                </div>
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>
      <div class="tl-legend">
        <span><i style="background:var(--blue)"></i>In production</span>
        <span><i style="background:var(--orange)"></i>Paused</span>
        <span><i style="background:var(--red)"></i>Blocked</span>
        <span><i style="background:var(--gray)"></i>Not started</span>
        <span><i style="background:var(--green)"></i>Ready</span>
        <span style="margin-left:auto">Bars run from order creation to due date — drag the right edge to reschedule</span>
      </div>
    </div>`;
  },

  bindTimeline(root) {
    $$(".tl-row-label", root).forEach(el => el.onclick = () => Drawer.open(el.dataset.order));
    let drag = null; // {orderId, bar, startX, origW, days}
    $$("[data-tl-handle]", root).forEach(h => {
      h.onpointerdown = (e) => {
        e.preventDefault(); e.stopPropagation();
        const bar = h.closest(".tl-bar");
        drag = { orderId: h.dataset.tlHandle, bar, startX: e.clientX, origW: bar.offsetWidth, days: 0 };
        bar.classList.add("resizing");
        h.setPointerCapture(e.pointerId);
      };
      h.onpointermove = (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.startX;
        drag.days = Math.round(dx / this.DAY_W);
        const w = Math.max(this.DAY_W - 6, drag.origW + drag.days * this.DAY_W);
        drag.bar.style.width = w + "px";
      };
      h.onpointerup = () => {
        if (!drag) return;
        const { orderId, days, bar } = drag;
        bar.classList.remove("resizing");
        drag = null;
        if (days !== 0) {
          const o = D.order(orderId);
          const snap = Store.snapshot();
          M.updateOrderLogged(orderId, { due: o.due + days * DAY }, App.me.id);
          App.render();
          Toast.show(`${o.num} due ${fmtDate(o.due)}`, { emoji: "📅", undo: () => { Store.restore(snap); App.render(); } });
        }
      };
    });
    $$("[data-tl-bar]", root).forEach(bar => {
      bar.onclick = (e) => {
        if (e.target.closest("[data-tl-handle]")) return;
        Drawer.open(bar.dataset.tlBar);
      };
    });
  },

  /* ---------------- Calendar (month) ---------------- */
  calY: null, calM: null,

  calendar() {
    const now = new Date();
    if (this.calY === null) { this.calY = now.getFullYear(); this.calM = now.getMonth(); }
    const first = new Date(this.calY, this.calM, 1);
    const title = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    /* grid starts Monday */
    const gridStart = new Date(first);
    gridStart.setDate(1 - ((first.getDay() + 6) % 7));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d;
    });
    const rows = cells[35].getMonth() === this.calM ? 42 : 35;

    const byDay = (d) => {
      const a = d.getTime(), b = a + DAY;
      return Store.state.orders.filter(o => o.due >= a && o.due < b && (o.type || "prod") === this.scopeType())
        .sort((x, y) => (x.archived - y.archived) || prioRank(x) - prioRank(y));
    };

    return `<div class="view-anim">
      <div class="cal-head">
        <h2>${title}</h2>
        <button class="icon-btn" id="cal-prev">‹</button>
        <button class="icon-btn" id="cal-next">›</button>
        <button class="btn ghost" id="cal-today" style="padding:6px 13px;font-size:12.5px">Today</button>
        <div class="grow"></div>
        <span class="t-caption">Chips sit on their due date — drag to reschedule</span>
      </div>
      <div class="cal-grid">
        ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => `<div class="cal-dow">${d}</div>`).join("")}
        ${cells.slice(0, rows).map(d => {
          const inMonth = d.getMonth() === this.calM;
          const isToday = d.getTime() === today.getTime();
          const orders = byDay(d);
          const shown = orders.slice(0, 3);
          return `<div class="cal-cell ${inMonth ? "" : "other"} ${isToday ? "today" : ""}" data-cal-day="${d.getTime()}">
            <span class="d">${d.getDate()}</span>
            ${shown.map(o => {
              const st = D.orderStatus(o);
              return `<div class="cal-chip s-${st}" ${o.archived ? "" : `draggable="true"`} data-cal-order="${o.id}" title="${esc(o.num)} · ${esc(o.product)}">
                <span>${o.priority === "rush" ? "🔥 " : ""}${esc(o.num)} ${esc(o.product)}</span>
              </div>`;
            }).join("")}
            ${orders.length > 3 ? `<div class="cal-more">+${orders.length - 3} more</div>` : ""}
          </div>`;
        }).join("")}
      </div>
    </div>`;
  },

  bindCalendar(root) {
    $("#cal-prev", root).onclick = () => { this.calM--; if (this.calM < 0) { this.calM = 11; this.calY--; } App.render(); };
    $("#cal-next", root).onclick = () => { this.calM++; if (this.calM > 11) { this.calM = 0; this.calY++; } App.render(); };
    $("#cal-today", root).onclick = () => { const n = new Date(); this.calY = n.getFullYear(); this.calM = n.getMonth(); App.render(); };
    let dragId = null;
    $$("[data-cal-order]", root).forEach(chip => {
      chip.onclick = () => Drawer.open(chip.dataset.calOrder);
      chip.ondragstart = (e) => {
        dragId = chip.dataset.calOrder;
        chip.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragId);
      };
      chip.ondragend = () => { chip.classList.remove("dragging"); dragId = null; };
    });
    $$("[data-cal-day]", root).forEach(cell => {
      cell.ondragover = (e) => { e.preventDefault(); cell.classList.add("drag-over"); };
      cell.ondragleave = () => cell.classList.remove("drag-over");
      cell.ondrop = (e) => {
        e.preventDefault(); cell.classList.remove("drag-over");
        const id = e.dataTransfer.getData("text/plain") || dragId;
        if (!id) return;
        const o = D.order(id);
        const newDue = parseInt(cell.dataset.calDay) + 12 * 3600000;
        if (new Date(newDue).toDateString() === new Date(o.due).toDateString()) return;
        const snap = Store.snapshot();
        M.updateOrderLogged(id, { due: newDue }, App.me.id);
        App.render();
        Toast.show(`${o.num} due ${fmtDate(newDue)}`, { emoji: "🗓", undo: () => { Store.restore(snap); App.render(); } });
      };
    });
  },

  /* ---------------- Workload ---------------- */
  workload() {
    if (this.scopeType() === "eng") return this.workloadEng(); // design = tracked by projects, not tasks
    const engScope = false;
    const workers = Store.state.members.filter(m => m.role === "worker");
    const loads = workers.map(m => {
      const jobs = [];
      for (const o of Store.state.orders) {
        if (o.archived || (o.type === "eng") !== engScope) continue;
        for (const op of o.ops)
          if (op.assigneeId === m.id && op.status !== "done")
            jobs.push({ order: o, op, remMins: Math.max(op.estMins - Math.round(D.opElapsed(op) / 60000), 15) });
      }
      jobs.sort((a, b) => prioRank(a.order) - prioRank(b.order) || a.order.due - b.order.due);
      return { m, jobs, total: jobs.reduce((s, j) => s + j.remMins, 0) };
    });
    const maxLoad = Math.max(...loads.map(l => l.total), 480);
    const COLORS = ["var(--blue)", "var(--indigo)", "var(--teal)", "var(--purple)", "var(--orange)", "var(--green)"];

    return `<div class="view-anim">
      <div class="section-title"><h2 class="muted" style="font-weight:500">Estimated remaining work per person — a full day is 8h</h2></div>
      <div class="panel">
        ${loads.map(({ m, jobs, total }) => {
          const run = D.runningOpOf(m.id);
          const over = total > 480;
          return `<div class="wl-row">
            <div class="wl-who">
              ${avatarHtml(m, "md")}
              <span class="meta"><b>${esc(m.name)}</b><span>${run ? `🟢 on ${esc(run.order.num)}` : esc(m.trade)}</span></span>
            </div>
            <div class="wl-bar-area">
              ${jobs.length ? `<div class="wl-bar">
                ${jobs.map((j, i) => `<div class="wl-seg" data-order="${j.order.id}"
                  style="width:${Math.max(j.remMins / maxLoad * 100, 4)}%;background:${COLORS[i % COLORS.length]}"
                  title="${esc(j.order.num)} · ${esc(D.station(j.op.stationId)?.name || "")} · ~${fmtDur(j.remMins * 60000)}">${esc(j.order.num)}</div>`).join("")}
              </div>` : `<div class="t-caption" style="padding:3px 0">No assigned work — free for new jobs</div>`}
            </div>
            <div class="wl-total ${over ? "wl-over" : ""}">
              <b>${fmtDur(total * 60000)}</b>
              <span>${jobs.length} job${jobs.length === 1 ? "" : "s"}${over ? " · over capacity" : ""}</span>
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>`;
  },

  /* Engineering workload — by project (a designer carries projects, not part-minutes) */
  workloadEng() {
    const CAP = 4; // soft concurrent-project capacity per engineer
    const COLORS = ["var(--blue)", "var(--indigo)", "var(--teal)", "var(--purple)", "var(--orange)", "var(--green)"];
    const engProjects = Store.state.orders.filter(o => o.type === "eng" && !o.archived);
    let people = Store.state.members.filter(m => m.role === "engineer");
    // include a manager only if they actually carry a design project
    Store.state.members.filter(m => m.role === "manager").forEach(m => {
      if (engProjects.some(o => o.ops.some(op => op.assigneeId === m.id && op.status !== "done"))) people.push(m);
    });
    const loads = people.map(m => {
      const projects = engProjects.filter(o => o.ops.some(op => op.assigneeId === m.id && op.status !== "done"));
      projects.sort((a, b) => prioRank(a) - prioRank(b) || a.due - b.due);
      return { m, projects };
    });
    const unassigned = engProjects.filter(o => !o.ops.some(op => op.assigneeId && op.status !== "done"));
    const maxP = Math.max(...loads.map(l => l.projects.length), CAP);

    return `<div class="view-anim">
      <div class="section-title"><h2 class="muted" style="font-weight:500">Active design projects per person — a comfortable load is ${CAP} at once</h2></div>
      <div class="panel">
        ${loads.map(({ m, projects }) => {
          const over = projects.length > CAP;
          const run = D.runningOpOf(m.id);
          return `<div class="wl-row">
            <div class="wl-who">
              ${avatarHtml(m, "md")}
              <span class="meta"><b>${esc(m.name)}</b><span>${run && run.order.type === "eng" ? `on ${esc(run.order.num)}` : esc(m.trade)}</span></span>
            </div>
            <div class="wl-bar-area">
              ${projects.length ? `<div class="wl-bar">
                ${projects.map((o, i) => {
                  const cur = D.currentOp(o); const due = fmtDue(o.due);
                  return `<div class="wl-seg" data-order="${o.id}"
                    style="width:${100 / maxP}%;background:${COLORS[i % COLORS.length]}"
                    title="${esc(o.num)} · ${cur ? esc(D.station(cur.stationId)?.name || "") : "ready to hand off"} · ${due.label}">${esc(o.num)}</div>`;
                }).join("")}
              </div>` : `<div class="t-caption" style="padding:3px 0">No active design projects — free for new work</div>`}
            </div>
            <div class="wl-total ${over ? "wl-over" : ""}">
              <b>${projects.length}</b>
              <span>project${projects.length === 1 ? "" : "s"}${over ? " · over capacity" : ""}</span>
            </div>
          </div>`;
        }).join("")}
      </div>
      ${unassigned.length ? `<div class="panel" style="margin-top:14px">
        <header><h2>${icon("compass", 15)} Unassigned projects <span class="count-badge">${unassigned.length}</span></h2></header>
        <div class="panel-list">
          ${unassigned.sort((a, b) => prioRank(a) - prioRank(b) || a.due - b.due).map(o => {
            const cur = D.currentOp(o); const due = fmtDue(o.due);
            return `<button class="panel-row" data-order="${o.id}">
              <span style="color:var(--text-3)">${cur ? stIcon(D.station(cur.stationId), 17) : icon("check-circle", 17)}</span>
              <span class="grow"><b>${o.num !== o.product ? esc(o.num) + " · " : ""}${esc(o.product)}</b><span>${cur ? `at ${esc(D.station(cur.stationId)?.name || "")}` : "ready to hand off"} · needs an engineer</span></span>
              <span class="due-chip ${due.cls}">${due.label}</span>
            </button>`;
          }).join("")}
        </div>
      </div>` : ""}
    </div>`;
  },

  bindWorkload(root) {
    $$(".wl-seg", root).forEach(seg => seg.onclick = () => Drawer.open(seg.dataset.order));
    $$(".panel-row[data-order]", root).forEach(b => b.onclick = () => Drawer.open(b.dataset.order));
  },

  /* ---------------- Dashboard ---------------- */
  dashboard() {
    if (App.isEngineer()) return this.engineerDashboard();
    const s = Store.state;
    const active = s.orders.filter(o => !o.archived);
    const inProd = active.filter(o => ["running", "paused"].includes(D.orderStatus(o)) || o.ops.some(op => op.status === "done"));
    const weekEnd = Date.now() + 7 * DAY;
    const dueWeek = active.filter(o => o.due <= weekEnd && D.orderStatus(o) !== "ready");
    const overdue = active.filter(o => fmtDue(o.due).cls === "overdue" && D.orderStatus(o) !== "ready");
    const blocked = active.filter(o => D.orderStatus(o) === "blocked");
    const ready = active.filter(o => o.type !== "eng" && D.orderStatus(o) === "ready");
    const engActive = active.filter(o => o.type === "eng");
    const low = D.lowStock();
    const shortfalls = D.demandShortfalls();       // measured against the work in hand
    const runningOps = [];
    for (const o of active) for (const op of o.ops) if (op.status === "running") runningOps.push({ order: o, op });

    const attention = [...blocked, ...overdue.filter(o => !blocked.includes(o))];

    const bkDays = Store.exportOverdueDays();
    const nagging = bkDays >= EXPORT_NAG_DAYS && !App._nagHidden;   // "Not now" lasts this session

    return `<div class="view-anim">
      ${nagging ? `<div class="backup-nag">
        <span style="color:var(--orange)">${icon("save", 20)}</span>
        <span class="grow"><b>No backup downloaded in ${bkDays} days</b>
          <span>Everything lives in this browser. Download a copy you can keep off the machine.</span></span>
        <button class="btn" id="nag-export">Export backup</button>
        <button class="icon-btn" id="nag-hide" title="Not now">${icon("x", 15)}</button>
      </div>` : ""}
      <div class="kpis">
        <div class="kpi" data-goto="orders"><span class="val">${active.length}</span><span class="lbl">Open orders</span><span class="sub muted">${inProd.length} in production</span></div>
        <div class="kpi" data-goto="orders" data-f="week"><span class="val">${dueWeek.length}</span><span class="lbl">Due this week</span><span class="sub muted">${fmtDate(Date.now())} – ${fmtDate(weekEnd)}</span></div>
        <div class="kpi ${overdue.length ? "warn" : ""}" data-goto="orders" data-f="overdue"><span class="val">${overdue.length}</span><span class="lbl">Overdue</span><span class="sub" style="color:var(--red)">${overdue.length ? "needs action" : ""}</span></div>
        <div class="kpi ${shortfalls.length ? "warn" : low.length ? "warn" : ""}" data-goto="warehouse" data-wtab="${shortfalls.length ? "demand" : "materials"}"><span class="val">${shortfalls.length || low.length}</span><span class="lbl">${shortfalls.length ? "Short for the jobs" : "Low stock"}</span><span class="sub" style="color:var(--red)">${
          shortfalls.length ? `${D.blockedByStock().length} project${D.blockedByStock().length === 1 ? "" : "s"} waiting` : low.length ? "reorder soon" : ""}</span></div>
        <div class="kpi ${ready.length ? "ok" : ""}" data-goto="orders" data-f="ready"><span class="val">${ready.length}</span><span class="lbl">Ready to ship</span><span class="sub" style="color:var(--green)">${ready.length ? "good to go" : ""}</span></div>
      </div>

      <div class="flow-strip-wrap">
        <div class="t-label" style="margin-bottom:12px">Production flow — every task, right now</div>
        <div class="flow-strip">
          ${D.stationsOf("prod").map(st => {
            const q = D.stationQueue(st.id);
            return `<div class="flow-station" data-station="${st.id}">
              <div class="head"><span class="ico">${stIcon(st, 15)}</span><b>${esc(st.name)}</b></div>
              <div class="n ${q.length ? "" : "zero"}">${q.length}</div>
              <div class="flow-chips">
                ${q.slice(0, 3).map(({ order, op }) =>
                  `<span class="flow-chip ${op.status === "running" ? "running" : ""} ${op.status === "blocked" ? "blocked" : ""}" title="${esc(order.num)}${op.group ? " · " + esc(op.group) : ""}">${esc(order.num)}${op.group ? "·" + esc(op.group[0]) : ""} ${op.status === "running" ? "●" : ""}${op.status === "blocked" ? "✕" : ""}</span>`).join("")}
                ${q.length > 3 ? `<span class="flow-chip">+${q.length - 3} more</span>` : ""}
              </div>
            </div>`;
          }).join("")}
          <div class="flow-station" data-station="__ready">
            <div class="head"><span class="ico" style="color:var(--green)">${icon("check-circle", 15)}</span><b>Ready</b></div>
            <div class="n ${ready.length ? "" : "zero"}" style="color:var(--green)">${ready.length}</div>
            <div class="flow-chips">${ready.slice(0, 3).map(o => `<span class="flow-chip">${esc(o.num)}</span>`).join("")}</div>
          </div>
        </div>
      </div>

      <div class="dash-grid">
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="panel">
            <header><h2>${icon("alert", 15)} Needs attention</h2><button class="link" data-goto="orders">View all</button></header>
            <div class="panel-list">
              ${attention.length || low.length || shortfalls.length ? `
                ${attention.slice(0, 5).map(o => {
                  const st = D.orderStatus(o); const due = fmtDue(o.due); const cur = D.currentOp(o);
                  return `<button class="panel-row" data-order="${o.id}">
                    <span style="color:var(--red)">${icon(st === "blocked" ? "ban" : "clock", 17)}</span>
                    <span class="grow"><b>${o.num !== o.product ? esc(o.num) + " · " : ""}${esc(o.product)}</b>
                    <span>${st === "blocked" ? esc(cur?.blockNote || "Blocked") : `at ${esc(D.station(cur?.stationId)?.name || "—")}`}</span></span>
                    <span class="due-chip ${due.cls}">${due.label}</span>
                    ${pillHtml(st, D.statusLabelFor(o, st))}
                  </button>`;
                }).join("")}
                ${shortfalls.slice(0, 4).map(r => `<button class="panel-row" data-goto="warehouse" data-wtab="demand">
                  <span style="color:var(--red)">${icon("trend-down", 17)}</span>
                  <span class="grow"><b>${esc(r.name)}</b><span>${r.lines.length} project${r.lines.length === 1 ? "" : "s"} need ${r.need} ${esc(r.unit)}${
                    r.stock === null ? " · not in the warehouse" : ` · ${r.stock} on the shelf`}</span></span>
                  <span class="low-badge">${Math.round(r.short * 100) / 100} short</span>
                </button>`).join("")}
                ${!shortfalls.length ? low.slice(0, 4).map(m => `<button class="panel-row" data-goto="warehouse">
                  <span style="color:var(--red)">${icon("trend-down", 17)}</span>
                  <span class="grow"><b>${esc(m.name)}</b><span>only ${m.qty} ${esc(m.unit)} left · min ${m.minQty}</span></span>
                  <span class="low-badge">Low stock</span>
                </button>`).join("") : ""}`
              : `<div class="empty-mini"><span class="big">${icon("sparkles", 26)}</span>All clear — nothing blocked, overdue or low</div>`}
            </div>
          </div>

          <div class="panel">
            <header><h2><span class="pill running" style="padding:2px 8px"><span class="dot"></span></span> On the floor right now</h2></header>
            <div class="panel-list">
              ${runningOps.length ? runningOps.map(({ order, op }) => {
                const m = D.member(op.assigneeId); const st = D.station(op.stationId);
                const item = D.item(order, op.itemId);
                return `<button class="panel-row" data-order="${order.id}">
                  ${avatarHtml(m, "md")}
                  <span class="grow"><b>${esc(m ? m.name : "—")} · ${esc(st.name)}${op.group ? ` · ${esc(op.group)}` : ""}</b>
                  <span>${esc(order.num)} — ${esc(order.product)}${item && item.qty > 1 ? ` · ${op.qtyDone}/${item.qty} pcs` : ""}</span></span>
                  <span class="pill running"><span class="dot"></span><span class="t-num" data-timer="${order.id}/${op.id}" data-timer-style="clock">${fmtClock(D.opElapsed(op))}</span></span>
                </button>`;
              }).join("") : `<div class="empty-mini"><span class="big">${icon("zzz", 26)}</span>Nobody has a job running</div>`}
            </div>
          </div>

          ${engActive.length ? `<div class="panel">
            <header><h2>${icon("pencil", 15)} Engineering</h2><button class="link" data-goto-eng>View all</button></header>
            <div class="panel-list">
              ${engActive.map(o => {
                const cur = D.currentOp(o); const st = cur ? D.station(cur.stationId) : null;
                const due = fmtDue(o.due); const p = D.progress(o);
                return `<button class="panel-row" data-order="${o.id}">
                  <span style="color:var(--text-2)">${st ? stIcon(st, 17) : icon("check-circle", 17)}</span>
                  <span class="grow"><b>${o.num !== o.product ? esc(o.num) + " · " : ""}${esc(o.product)}</b>
                  <span>${st ? `at ${esc(st.name)}` : "complete"} · ${p.done}/${p.total} stages${cur && cur.assigneeId ? ` · ${esc(D.member(cur.assigneeId)?.name || "")}` : ""}</span></span>
                  <span class="due-chip ${due.cls}">${due.label}</span>
                  ${pillHtml(D.orderStatus(o), D.statusLabelFor(o, D.orderStatus(o)))}
                </button>`;
              }).join("")}
            </div>
          </div>` : ""}
        </div>

        <div class="panel">
          <header><h2>Recent activity</h2><button class="link" data-goto="activity">View all</button></header>
          <div class="panel-list">
            ${s.activity.slice(0, 9).map(a => {
              const m = D.member(a.who);
              return `<div class="activity-row">
                ${avatarHtml(m, "sm")}
                <span class="txt"><b>${esc(m ? m.name : "Someone")}</b> ${activityHtml(a.text)}</span>
                <span class="when">${fmtAgo(a.ts)}</span>
              </div>`;
            }).join("")}
          </div>
        </div>
      </div>
    </div>`;
  },

  /* Engineer dashboard — design projects only, no production/warehouse noise */
  engineerDashboard() {
    const s = Store.state;
    const eng = s.orders.filter(o => o.type === "eng" && !o.archived);
    const weekEnd = Date.now() + 7 * DAY;
    const dueWeek = eng.filter(o => o.due <= weekEnd && D.orderStatus(o) !== "ready");
    const overdue = eng.filter(o => fmtDue(o.due).cls === "overdue" && D.orderStatus(o) !== "ready");
    const ready = eng.filter(o => D.orderStatus(o) === "ready"); // done → ready to hand off
    const mine = eng.filter(o => o.ops.some(op => D.opAssignedTo(op, App.me.id) && op.status !== "done"));
    const engStations = D.stationsOf("eng");
    return `<div class="view-anim">
      <div class="kpis">
        <div class="kpi" data-goto="projects"><span class="val">${eng.length}</span><span class="lbl">Active projects</span><span class="sub muted">projektavimas</span></div>
        <div class="kpi" data-goto="projects"><span class="val">${mine.length}</span><span class="lbl">Assigned to me</span><span class="sub muted">in progress</span></div>
        <div class="kpi ${overdue.length ? "warn" : ""}" data-goto="projects"><span class="val">${overdue.length}</span><span class="lbl">Overdue</span><span class="sub" style="color:var(--red)">${overdue.length ? "needs action" : ""}</span></div>
        <div class="kpi ${ready.length ? "ok" : ""}" data-goto="projects"><span class="val">${ready.length}</span><span class="lbl">Ready to hand off</span><span class="sub" style="color:var(--green)">${ready.length ? "to production" : ""}</span></div>
      </div>

      <div class="flow-strip-wrap">
        <div class="t-label" style="margin-bottom:12px">Design flow — projects at each stage</div>
        <div class="flow-strip">
          ${engStations.map(st => {
            const q = D.stationQueue(st.id);
            return `<div class="flow-station" data-station="${st.id}">
              <div class="head"><span class="ico">${stIcon(st, 15)}</span><b>${esc(st.name)}</b></div>
              <div class="n ${q.length ? "" : "zero"}">${q.length}</div>
              <div class="flow-chips">${q.slice(0, 3).map(({ order }) => `<span class="flow-chip">${esc(order.num)}</span>`).join("")}${q.length > 3 ? `<span class="flow-chip">+${q.length - 3}</span>` : ""}</div>
            </div>`;
          }).join("")}
          <div class="flow-station" data-station="__ready">
            <div class="head"><span class="ico" style="color:var(--green)">${icon("factory", 15)}</span><b>Hand off</b></div>
            <div class="n ${ready.length ? "" : "zero"}" style="color:var(--green)">${ready.length}</div>
            <div class="flow-chips">${ready.slice(0, 3).map(o => `<span class="flow-chip">${esc(o.num)}</span>`).join("")}</div>
          </div>
        </div>
      </div>

      <div class="dash-grid">
        <div class="panel">
          <header><h2>${icon("compass", 15)} My design projects</h2><button class="link" data-goto="projects">View all</button></header>
          <div class="panel-list">
            ${eng.length ? eng.slice(0, 8).map(o => {
              const cur = D.currentOp(o); const st = cur ? D.station(cur.stationId) : null; const due = fmtDue(o.due); const p = D.progress(o);
              return `<button class="panel-row" data-order="${o.id}">
                <span style="color:var(--text-2)">${st ? stIcon(st, 17) : icon("check-circle", 17)}</span>
                <span class="grow"><b>${o.num !== o.product ? esc(o.num) + " · " : ""}${esc(o.product)}</b><span>${st ? `at ${esc(st.name)}` : "ready to hand off"} · ${p.done}/${p.total} stages</span></span>
                <span class="due-chip ${due.cls}">${due.label}</span>${pillHtml(D.orderStatus(o), D.statusLabelFor(o, D.orderStatus(o)))}
              </button>`;
            }).join("") : `<div class="empty-mini"><span class="big">${icon("compass", 26)}</span>No design projects yet</div>`}
          </div>
        </div>
        <div class="panel">
          <header><h2>Recent activity</h2><button class="link" data-goto="activity">View all</button></header>
          <div class="panel-list">
            ${s.activity.filter(a => { const o = a.orderId ? D.order(a.orderId) : null; return !o || o.type === "eng"; }).slice(0, 9).map(a => {
              const mem = D.member(a.who);
              return `<div class="activity-row">${avatarHtml(mem, "sm")}<span class="txt"><b>${esc(mem ? mem.name : "Someone")}</b> ${activityHtml(a.text)}</span><span class="when">${fmtAgo(a.ts)}</span></div>`;
            }).join("")}
          </div>
        </div>
      </div>
    </div>`;
  },

  bindDashboard(root) {
    $$("[data-goto]", root).forEach(b => b.onclick = () => {
      if (b.dataset.wtab) Warehouse.tab = b.dataset.wtab;    // land on the right tab, not just the view
      App.navigate(b.dataset.goto, { filter: b.dataset.f });
    });
    const nagGo = $("#nag-export", root), nagHide = $("#nag-hide", root);
    if (nagGo) nagGo.onclick = () => { App.navigate("settings"); setTimeout(() => $("#set-export")?.click(), 80); };
    if (nagHide) nagHide.onclick = () => { App._nagHidden = true; App.render(); };
    $$("[data-goto-eng]", root).forEach(b => b.onclick = () => {
      this.projectsScope = "eng"; M.setPref(App.me.id, "projectsScope", "eng");
      App.navigate("projects", { tab: "list" });
    });
    $$("[data-order]", root).forEach(b => b.onclick = () => Drawer.open(b.dataset.order));
    $$(".flow-station", root).forEach(b => b.onclick = () => {
      if (App.isEngineer()) App.navigate("projects", { tab: "board" });
      else App.navigate("board", { focus: b.dataset.station });
    });
  },

  /* ---------------- Board ---------------- */
  board(kind = "prod") {
    const s = Store.state;
    const bp = D.pref(App.me.id, "board", {});
    const density = bp.density || "comfortable";
    const filterWho = bp.assignee || "";
    const filterPrio = bp.prio || "";
    const hideEmpty = !!bp.hideEmpty;
    const byJob = bp.byJob !== false;      // grouping is the default; it is what the shop asked for

    // columns already partition by station kind, so mixed projects (e.g. a design
    // project with production tasks) still surface their tasks on the right board
    const matches = ({ order, op }) =>
      (!filterWho || (op && op.assigneeId === filterWho)) &&
      (!filterPrio || order.priority === filterPrio);

    const ready = s.orders.filter(o => !o.archived && o.type === (kind === "eng" ? "eng" : "prod") && o.ops.length && o.ops.every(op => op.status === "done"))
      .filter(o => (!filterPrio || o.priority === filterPrio) && !filterWho);

    const cols = D.stationsOf(kind).map(st => ({ st, q: D.stationQueue(st.id).filter(matches) }))
      .filter(c => !hideEmpty || c.q.length);

    return `<div class="view-anim" style="display:flex;flex-direction:column;height:100%">
      <div class="board-toolbar">
        <select class="select" id="bf-who">
          <option value="">Everyone</option>
          ${s.members.filter(m => kind === "eng" ? (m.role === "engineer" || m.role === "manager") : m.role === "worker").map(m => `<option value="${m.id}" ${filterWho === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}
        </select>
        <select class="select" id="bf-prio">
          <option value="">All priorities</option>
          ${["rush", "high", "normal", "low"].map(p => `<option value="${p}" ${filterPrio === p ? "selected" : ""}>${p === "rush" ? "🔥 Rush" : p[0].toUpperCase() + p.slice(1)}</option>`).join("")}
        </select>
        <div class="grow"></div>
        <div class="segmented" id="bf-density">
          <button data-d="comfortable" class="${density === "comfortable" ? "active" : ""}">Comfortable</button>
          <button data-d="compact" class="${density === "compact" ? "active" : ""}">Compact</button>
        </div>
        <div class="row" style="gap:8px;font-size:12.5px;color:var(--text-2);font-weight:560">
          Group by job ${switchHtml("byJob", byJob)}
        </div>
        <div class="row" style="gap:8px;font-size:12.5px;color:var(--text-2);font-weight:560">
          Hide empty ${switchHtml("hideEmpty", hideEmpty)}
        </div>
      </div>
      ${byJob
        ? this.boardLanes(cols, ready, kind, density)
        : `<div class="board-wrap"><div class="board ${density === "compact" ? "compact" : ""}">
        ${cols.map(({ st, q }) => `<div class="board-col" data-drop="${st.id}">
          <header><span class="ico">${stIcon(st, 15)}</span><b>${esc(st.name)}</b><span class="count-badge">${q.length}</span></header>
          <div class="board-col-cards">
            ${q.length ? q.map(({ order, op }) => this.orderCard(order, op)).join("")
              : `<div class="col-empty">No tasks here</div>`}
          </div>
        </div>`).join("")}
        <div class="board-col" data-drop="__ready">
          <header><span class="ico" style="color:var(--green)">${icon("check-circle", 15)}</span><b>${kind === "eng" ? "Complete" : "Ready to ship"}</b><span class="count-badge">${ready.length}</span></header>
          <div class="board-col-cards">
            ${ready.length ? ready.map(o => this.orderCard(o, null)).join("") : `<div class="col-empty">Nothing ready yet</div>`}
          </div>
        </div>
      </div></div>`}
    </div>`;
  },

  /* ---------------- the board, one row per job ----------------
     Same columns, same cards, same drag and drop — but a customer's job is a
     lane across them, so "where is GI_SI?" is one glance along a row instead
     of hunting three cards through five columns. */
  boardLanes(cols, ready, kind, density) {
    const all = [...cols.flatMap(c => c.q.map(x => x.order)), ...ready];
    const groups = D.jobGroups([...new Map(all.map(o => [o.id, o])).values()]);
    const readyLabel = kind === "eng" ? "Complete" : "Ready to ship";
    const collapsed = D.pref(App.me.id, "boardLanes", {}) || {};

    const heads = [
      ...cols.map(({ st, q }) => `<div class="bg-head-cell">
        <span class="ico">${stIcon(st, 14)}</span><b>${esc(st.name)}</b><span class="count-badge">${q.length}</span>
      </div>`),
      `<div class="bg-head-cell"><span class="ico" style="color:var(--green)">${icon("check-circle", 14)}</span><b>${readyLabel}</b><span class="count-badge">${ready.length}</span></div>`,
    ].join("");

    const lane = (g) => {
      const due = g.due ? fmtDue(g.due) : null;
      const shut = !!collapsed[g.key];
      const cells = [
        ...cols.map(({ st, q }) => ({
          drop: st.id,
          cards: q.filter(x => g.orders.some(o => o.id === x.order.id)),
        })),
        { drop: "__ready", cards: ready.filter(o => g.orders.some(x => x.id === o.id)).map(o => ({ order: o, op: null })) },
      ];
      return `<div class="bg-lane ${shut ? "shut" : ""}">
        <div class="bg-lane-head" style="--job:var(--${g.color});--job-soft:var(--${g.color}-soft)">
          <button class="bg-lane-toggle" data-lane="${esc(g.key)}" title="${shut ? "Expand" : "Collapse"}">
            ${icon(shut ? "chev-right" : "chev-down", 14)}
          </button>
          <span class="grow">
            <b>${esc(g.label)}</b>
            <span class="bg-lane-sub">${g.single ? esc(g.client || "one project")
              : `${g.orders.length} <span>pieces</span>${g.client ? ` · ${esc(g.client)}` : ""}`}</span>
            <span class="bg-lane-prog"><span class="progress ${g.pct === 100 ? "done" : ""}"><i style="width:${g.pct}%"></i></span></span>
          </span>
          ${g.overdue ? `<span class="due-chip bad" title="${g.overdue} of ${g.orders.length} past due">${g.overdue} <span>late</span></span>`
            : due ? `<span class="due-chip ${due.cls}">${due.label}</span>` : ""}
        </div>
        ${cells.map(c => `<div class="bg-cell ${c.cards.length ? "" : "none"}" data-drop="${c.drop}">${
          c.cards.map(({ order, op }) => this.orderCard(order, op)).join("")}</div>`).join("")}
      </div>`;
    };

    return `<div class="board-wrap">
      <div class="board-grid ${density === "compact" ? "compact" : ""}" style="--bg-cols:${cols.length + 1}">
        <div class="bg-head"><div class="bg-corner">${icon("folder", 13)} <span>Job</span></div>${heads}</div>
        ${groups.length ? groups.map(lane).join("")
          : `<div class="bg-empty">Nothing on this board yet</div>`}
      </div>
    </div>`;
  },

  /* A card = one TASK (lane op) — an order with parallel lanes appears in several columns */
  orderCard(order, op) {
    const due = fmtDue(order.due);
    const p = D.progress(order);
    const assignee = op ? D.member(op.assigneeId) : null;
    const short = D.orderShortages(order).length;
    const item = op ? D.item(order, op.itemId) : null;
    const multi = order.items.length > 1;
    const showNum = order.num !== order.product;
    const showClient = order.client && order.client !== order.product;
    return `<div class="order-card" draggable="true" data-order="${order.id}" ${op ? `data-op="${op.id}"` : ""}>
      <div class="top">
        ${showNum ? `<span class="num">${esc(order.num)}</span>` : ""}
        ${prioHtml(order.priority)}
        ${short ? `<span title="Material shortage" style="color:var(--red)">${icon("trend-down", 13)}</span>` : ""}
        <span class="grow"></span>
        ${D.projectLink(order) ? `<button class="od-shortcut" data-od-open="${order.id}" title="Open project files in OneDrive">${icon("cloud", 13)}</button>` : ""}
        ${op && App.can("orders.assign") ? `<button class="od-shortcut card-block ${op.status === "blocked" ? "on" : ""}" data-card-block="${order.id}:${op.id}" title="${op.status === "blocked" ? "Edit or clear this problem" : "Report a problem"}">${icon("ban", 13)}</button>` : ""}
        <span class="due-chip ${due.cls}">${due.label}</span>
      </div>
      <div class="title">${esc(order.product)}</div>
      ${showClient || (item && item.qty > 1) ? `<div class="client">${showClient ? esc(order.client) : ""}${showClient && item && item.qty > 1 ? " · " : ""}${item && item.qty > 1 ? `${item.qty} ${esc(order.unit)}` : ""}</div>` : ""}
      ${op && (op.group || multi) ? `<div class="row" style="gap:5px;flex-wrap:wrap">
        ${op.group ? `<span class="task-tag">${esc(op.group)}</span>` : ""}
        ${multi && item ? `<span class="task-tag" style="background:var(--teal-soft);color:var(--teal)">${esc(item.name)}</span>` : ""}
        ${item && item.qty > 1 && op.qtyDone > 0 ? `<span class="qty-pill part">${op.qtyDone}/${item.qty}</span>` : ""}
      </div>` : ""}
      ${op && op.status === "running" ? `<div class="runner"><span class="pill running" style="padding:0;background:none"><span class="dot"></span></span>${esc(assignee ? assignee.name : "Running")}<span class="t t-num" data-timer="${order.id}/${op.id}" data-timer-style="clock">${fmtClock(D.opElapsed(op))}</span></div>` : ""}
      ${op && op.status === "blocked" ? `<div class="blocked-note">${icon("ban", 12)} ${esc(op.blockNote || "Blocked")}</div>` : ""}
      <div class="bottom">
        ${stepsMini(order)}
        <span class="grow"></span>
        <span class="t-caption t-num">${p.done}/${p.total}</span>
        ${assignee ? avatarHtml(assignee, "sm") : (op ? `<span class="avatar sm" style="--av-c1:transparent;--av-c2:transparent;border:1.5px dashed var(--border-strong);color:var(--text-3)">+</span>` : "")}
      </div>
    </div>`;
  },

  bindBoard(root) {
    const setBp = (patch) => {
      const bp = { ...D.pref(App.me.id, "board", {}), ...patch };
      M.setPref(App.me.id, "board", bp);
      App.render();
    };
    $("#bf-who", root).onchange = (e) => setBp({ assignee: e.target.value });
    $("#bf-prio", root).onchange = (e) => setBp({ prio: e.target.value });
    $$("#bf-density button", root).forEach(b => b.onclick = () => setBp({ density: b.dataset.d }));
    const sw = $('[data-switch="hideEmpty"]', root);
    if (sw) sw.onclick = () => setBp({ hideEmpty: !D.pref(App.me.id, "board", {}).hideEmpty });
    const swJob = $('[data-switch="byJob"]', root);
    if (swJob) swJob.onclick = () => setBp({ byJob: D.pref(App.me.id, "board", {}).byJob === false });
    $$("[data-lane]", root).forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const shut = { ...(D.pref(App.me.id, "boardLanes", {}) || {}) };
      shut[b.dataset.lane] = !shut[b.dataset.lane];
      M.setPref(App.me.id, "boardLanes", shut);
      App.render();
    });

    $$("[data-od-open]", root).forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const link = D.projectLink(D.order(b.dataset.odOpen));
      if (link) { window.open(link, "_blank", "noopener"); Toast.show("Opening project files…", { emoji: "cloud" }); }
    });
    /* A problem is noticed looking AT the board, not after opening the project
       and hunting for the right step — so it can be reported from the card. */
    $$("[data-card-block]", root).forEach(b => b.onclick = (e) => {
      e.stopPropagation(); e.preventDefault();
      const [orderId, opId] = b.dataset.cardBlock.split(":");
      OrderDetail.blockDialog(orderId, opId);      // the dialog lives with the project detail
    });
    let dragRef = null; // {orderId, opId}
    $$(".order-card", root).forEach(card => {
      card.onclick = () => Drawer.open(card.dataset.order);
      card.ondragstart = (e) => {
        dragRef = { orderId: card.dataset.order, opId: card.dataset.op || null };
        card.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", JSON.stringify(dragRef));
      };
      card.ondragend = () => { card.classList.remove("dragging"); dragRef = null; };
    });
    $$("[data-drop]", root).forEach(col => {
      col.ondragover = (e) => { e.preventDefault(); col.classList.add("drag-over"); };
      col.ondragleave = () => col.classList.remove("drag-over");
      col.ondrop = (e) => {
        e.preventDefault(); col.classList.remove("drag-over");
        let ref = dragRef;
        try { ref = JSON.parse(e.dataTransfer.getData("text/plain")) || dragRef; } catch (_) { /* keep dragRef */ }
        if (!ref) return;
        const snap = Store.snapshot();
        const o = D.order(ref.orderId);
        const target = col.dataset.drop;
        const op = ref.opId ? o.ops.find(x => x.id === ref.opId) : null;
        if (op && target !== "__ready" && op.stationId === target) return; // no-op
        const ok = target === "__ready"
          ? M.moveLane(o.id, o.items[0].id, null, "__ready", App.me.id)
          : op
            ? M.moveLane(o.id, op.itemId, op.group, target, App.me.id)
            : M.moveOrderToStation(o.id, target, App.me.id);
        if (!ok) {
          Toast.show(op
            ? `${D.station(target)?.name || "That station"} isn't in this task's route`
            : `Several part groups pass ${D.station(target)?.name || "there"} — open ${o.num} and reopen the step you need`, { emoji: "🤔", ms: 4200 });
          return;
        }
        App.render();
        const name = target === "__ready" ? "Ready" : D.station(target).name;
        Toast.show(`${o.num}${op && op.group ? " · " + op.group : ""} moved to ${name}`, { emoji: "✦", undo: () => { Store.restore(snap); App.render(); } });
      };
    });
    if (App.viewParams.focus) {
      const col = $(`[data-drop="${App.viewParams.focus}"]`, root);
      if (col) col.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      App.viewParams.focus = null; // once — don't re-scroll on every re-render
    }
  },

  /* ---------------- Orders ---------------- */
  ordersFilter: "all",
  orderSearch: "",
  portfolioFilter: null,

  defaultCols: { station: true, progress: true, assignee: true, due: true, status: true },

  orders() {
    if (App.viewParams.filter) { this.ordersFilter = App.viewParams.filter; App.viewParams.filter = null; }
    const s = Store.state;
    const f = this.ordersFilter;
    const q = this.orderSearch.trim().toLowerCase();
    const groupBy = D.pref(App.me.id, "ordersGroup", "none");
    const cols = { ...this.defaultCols, ...D.pref(App.me.id, "ordersCols", {}) };
    let list = s.orders.filter(o => (o.type || "prod") === this.scopeType());
    if (this.portfolioFilter) list = list.filter(o => o.portfolioId === this.portfolioFilter);
    const weekEnd = Date.now() + 7 * DAY;

    list = list.filter(o => {
      const st = D.orderStatus(o);
      if (f === "active") return !o.archived;
      if (f === "production") return !o.archived && ["running", "paused"].includes(st);
      if (f === "blocked") return st === "blocked";
      if (f === "ready") return st === "ready";
      if (f === "overdue") return !o.archived && fmtDue(o.due).cls === "overdue" && st !== "ready";
      if (f === "week") return !o.archived && o.due <= weekEnd;
      if (f === "archive") return o.archived;
      if (f === "attention") return !o.archived && (st === "blocked" || (fmtDue(o.due).cls === "overdue" && st !== "ready"));
      return true;
    });
    if (q) list = list.filter(o =>
      o.num.toLowerCase().includes(q) || o.product.toLowerCase().includes(q) || o.client.toLowerCase().includes(q));
    list.sort((a, b) => (a.archived - b.archived) || prioRank(a) - prioRank(b) || a.due - b.due);

    const filters = [
      ["all", "All"], ["active", "Active"], ["production", "In production"],
      ["blocked", "Blocked"], ["ready", "Ready"], ["overdue", "Overdue"], ["archive", "Archive"],
    ];

    /* Grouping */
    let groups;
    if (groupBy === "none") groups = [{ label: null, items: list }];
    else if (groupBy === "status") {
      const orderOf = ["blocked", "running", "paused", "queued", "ready", "shipped"];
      const icoOf = { blocked: "ban", running: "play", paused: "pause", queued: "clock", ready: "check-circle", shipped: "truck" };
      groups = orderOf.map(k => ({ label: D.statusLabel[k], icon: icon(icoOf[k], 14), items: list.filter(o => D.orderStatus(o) === k) }));
    } else if (groupBy === "station") {
      groups = s.stations.map(st => ({ label: st.name, icon: stIcon(st, 14), items: list.filter(o => !o.archived && D.currentOp(o)?.stationId === st.id) }));
      groups.push({ label: "Ready to ship", icon: icon("check-circle", 14), items: list.filter(o => !o.archived && !D.currentOp(o)) });
      groups.push({ label: "Archived", icon: icon("archive", 14), items: list.filter(o => o.archived) });
    } else if (groupBy === "priority") {
      groups = ["rush", "high", "normal", "low"].map(p => ({ label: p === "rush" ? "Rush" : p[0].toUpperCase() + p.slice(1), icon: prioIcon(p, 14) || icon("check", 14), items: list.filter(o => o.priority === p) }));
    } else if (groupBy === "portfolio") {
      groups = s.portfolios.map(p => ({ label: p.name, icon: pfIcon(p, 14), items: list.filter(o => o.portfolioId === p.id) }));
      groups.push({ label: "No portfolio", icon: icon("folder", 14), items: list.filter(o => !o.portfolioId) });
    } else if (groupBy === "job") {
      /* the same grouping the board draws lanes from — a customer's pieces
         together, worst first, without anyone maintaining a portfolio */
      groups = D.jobGroups(list).map(g => ({
        label: g.label,
        color: g.color,
        icon: g.pf ? pfIcon(g.pf, 14) : icon(g.single ? "building" : "folder", 14),
        sub: g.single ? "" : `${g.orders.length} <span>pieces</span>${g.client ? ` · ${esc(g.client)}` : ""}`,
        items: g.orders,
      }));
    } else { // client
      const clients = [...new Set(list.map(o => o.client))].sort((a, b) => a.localeCompare(b));
      groups = clients.map(c => ({ label: c, icon: icon("building", 14), items: list.filter(o => o.client === c) }));
    }
    groups = groups.filter(g => g.items.length);

    const pf = this.portfolioFilter ? D.portfolio(this.portfolioFilter) : null;

    return `<div class="view-anim">
      <div class="toolbar">
        ${pf ? `<button class="fchip active" id="pf-clear" title="Clear portfolio filter">${pfIcon(pf, 13)} ${esc(pf.name)} ✕</button>` : ""}
        <div class="filter-chips">
          ${filters.map(([id, label]) => `<button class="fchip ${f === id || (f === "attention" && id === "all") ? "active" : ""}" data-f="${id}">${label}</button>`).join("")}
        </div>
        <div class="grow"></div>
        <div class="search-box" style="min-width:230px">${icon("search", 14)}<input id="order-search" placeholder="Search orders…" value="${esc(this.orderSearch)}"></div>
        <button class="btn" id="view-opts">${icon("sliders", 14)} View</button>
      </div>
      ${groups.length ? groups.map(g => `
        ${g.label !== null ? `<div class="group-head" ${g.color ? `style="--job:var(--${g.color})"` : ""}><span class="${g.color ? "gh-ico" : ""}">${g.icon || ""}</span> ${esc(g.label)}${
          g.sub ? ` <span class="gh-sub">${g.sub}</span>` : ""} <span class="count-badge">${g.items.length}</span></div>` : ""}
        <div class="table-card" style="margin-bottom:14px">${this.orderTable(g.items, cols)}</div>
      `).join("") : `<div class="table-card"><div class="empty-state"><span class="big">${icon("inbox", 40)}</span><h3>No orders match</h3><p>Try a different filter or search.</p></div></div>`}
    </div>`;
  },

  orderTable(list, cols) {
    return `<table class="orders">
      <thead><tr>
        <th>Order</th>
        ${cols.station ? "<th>Station</th>" : ""}
        ${cols.progress ? "<th>Progress</th>" : ""}
        ${cols.assignee ? "<th>Assignee</th>" : ""}
        ${cols.due ? "<th>Due</th>" : ""}
        ${cols.status ? "<th>Status</th>" : ""}
      </tr></thead>
      <tbody>
        ${list.map(o => {
          const st = D.orderStatus(o);
          const active = o.archived ? [] : D.activeOps(o);
          const cur = active[0] || null;
          const stn = cur ? D.station(cur.stationId) : null;
          const p = D.progress(o); const due = fmtDue(o.due);
          const assignee = cur ? D.member(cur.assigneeId) : null;
          const packed = D.packedSummary(o);
          const pfo = o.portfolioId ? D.portfolio(o.portfolioId) : null;
          return `<tr data-order="${o.id}">
            <td class="ord-cell" style="min-width:220px"><b>${o.num !== o.product ? esc(o.num) + " · " : ""}${esc(o.product)} ${o.priority !== "normal" ? prioHtml(o.priority) : ""} ${D.orderShortages(o).length ? `<span style="color:var(--red)">${icon("trend-down", 13)}</span>` : ""}${D.projectLink(o) ? `<button class="od-shortcut" data-od-open="${o.id}" title="Open project files in OneDrive">${icon("cloud", 13)}</button>` : ""}</b><span>${o.client && o.client !== o.product ? esc(o.client) + " · " : ""}${o.qty} ${esc(o.unit)}${o.qty > 1 ? ` · ${packed.done}/${packed.total} ${esc(packed.label)}` : ""}${pfo ? ` · ${esc(pfo.name)}` : ""}</span></td>
            ${cols.station ? `<td>${o.archived ? `<span class="station-cell">${icon("archive", 14)} ${o.type === "eng" ? "Delivered" : "Archived"}</span>` : stn ? `<span class="station-cell">${stIcon(stn, 14)} ${esc(stn.name)}${active.length > 1 ? ` <span class="count-badge" title="${active.length} tasks active in parallel">+${active.length - 1}</span>` : ""}</span>` : `<span class="station-cell" style="color:var(--green)">${icon("check-circle", 14)} ${o.type === "eng" ? "Complete" : "Ready"}</span>`}</td>` : ""}
            ${cols.progress ? `<td><div class="progress-cell"><div class="progress ${p.pct === 100 ? "done" : ""}"><i style="width:${p.pct}%"></i></div><span class="t-caption">${p.done}/${p.total}</span></div></td>` : ""}
            ${cols.assignee ? `<td>${assignee ? `<span class="row" style="gap:7px">${avatarHtml(assignee, "sm")}<span style="font-size:13px">${esc(assignee.name)}</span></span>` : `<span class="muted" style="font-size:13px">—</span>`}</td>` : ""}
            ${cols.due ? `<td><span class="due-chip ${o.archived ? "" : due.cls}">${o.archived ? fmtDate(o.archivedAt || o.shippedAt || o.due) : due.label}</span></td>` : ""}
            ${cols.status ? `<td>${pillHtml(st, D.statusLabelFor(o, st))}</td>` : ""}
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
  },

  bindOrders(root) {
    $$(".fchip", root).forEach(b => b.onclick = () => { this.ordersFilter = b.dataset.f; App.render(); });
    $$("[data-od-open]", root).forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const link = D.projectLink(D.order(b.dataset.odOpen));
      if (link) { window.open(link, "_blank", "noopener"); Toast.show("Opening project files…", { emoji: "cloud" }); }
    });
    $$("tr[data-order]", root).forEach(tr => tr.onclick = () => Drawer.open(tr.dataset.order));
    const search = $("#order-search", root);
    if (search) {
      search.oninput = () => {
        this.orderSearch = search.value;
        const pos = search.selectionStart;
        App.render();
        const s2 = $("#order-search");
        if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); }
      };
    }
    $("#view-opts", root).onclick = (e) => this.viewOptionsPopover(e.currentTarget);
    const pfClear = $("#pf-clear", root);
    if (pfClear) pfClear.onclick = () => { this.portfolioFilter = null; App.render(); };
  },

  viewOptionsPopover(anchor) {
    const groupBy = D.pref(App.me.id, "ordersGroup", "none");
    const cols = { ...this.defaultCols, ...D.pref(App.me.id, "ordersCols", {}) };
    const colDefs = [["station", "Station"], ["progress", "Progress"], ["assignee", "Assignee"], ["due", "Due date"], ["status", "Status"]];
    Popover.open(anchor, `
      <div class="opt-title">Group by</div>
      <div class="opt-row">
        <select class="select" id="po-group" style="flex:1">
          ${[["none", "None"], ["job", "Job (customer's pieces)"], ["status", "Status"], ["station", "Station"], ["priority", "Priority"], ["client", "Client"], ["portfolio", "Portfolio"]]
            .map(([v, l]) => `<option value="${v}" ${groupBy === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <div class="opt-sep"></div>
      <div class="opt-title">Columns</div>
      ${colDefs.map(([k, l]) => `<div class="opt-row"><span class="grow">${l}</span>${switchHtml("col:" + k, cols[k])}</div>`).join("")}
    `, (pop) => {
      $("#po-group", pop).onchange = (e) => { M.setPref(App.me.id, "ordersGroup", e.target.value); App.render(); };
      $$("[data-switch]", pop).forEach(sw => sw.onclick = () => {
        const key = sw.dataset.switch.split(":")[1];
        const cur = { ...this.defaultCols, ...D.pref(App.me.id, "ordersCols", {}) };
        cur[key] = !cur[key];
        M.setPref(App.me.id, "ordersCols", cur);
        sw.classList.toggle("on", cur[key]);
        App.render();
      });
    });
  },

  /* ---------------- Team ---------------- */
  team() {
    const s = Store.state;
    return `<div class="view-anim">
      <div class="section-title">
        <h2 class="muted" style="font-weight:500">${s.members.length} people · ${s.members.filter(m => D.runningOpOf(m.id)).length} working now</h2>
        ${App.can("team.manage") ? `<button class="btn subtle" id="add-member-btn">${icon("plus", 13)} Add member</button>` : ""}
      </div>
      <div class="team-grid">
        ${s.members.map(m => {
          const run = D.runningOpOf(m.id);
          const doneToday = D.doneTodayBy(m.id);
          const queue = (m.role === "worker" || m.role === "engineer") ? D.workerQueue(m.id).length : null;
          return `<button class="member-card" ${App.can("team.manage") ? `data-member="${m.id}"` : `style="cursor:default"`}>
            <div class="mtop">
              ${avatarHtml(m, "lg")}
              <span class="meta">
                <b>${esc(m.name)}</b>
                <span class="mrole">${m.trade ? `<span class="mtrade">${esc(m.trade)}</span>` : ""}<span class="role-badge ${m.role}">${m.role}</span></span>
              </span>
            </div>
            ${run
              ? `<div class="now active"><span class="pill running" style="padding:0;background:none"><span class="dot"></span></span>${esc(D.station(run.op.stationId).name)} · ${esc(run.order.num)}<span class="grow"></span><span class="t-num" data-timer="${run.order.id}/${run.op.id}" data-timer-style="clock">${fmtClock(D.opElapsed(run.op))}</span></div>`
              : `<div class="now">${icon("zzz", 14)} Not clocked on a job</div>`}
            <div class="mstats">
              <div class="mstat"><b>${doneToday}</b><span>done today</span></div>
              ${queue !== null ? `<div class="mstat"><b>${queue}</b><span>in queue</span></div>` : ""}
              ${m.station ? `<div class="mstat"><b>${stIcon(D.station(m.station), 15)}</b><span>${esc(D.station(m.station)?.name || "")}</span></div>` : ""}
            </div>
          </button>`;
        }).join("")}
      </div>
    </div>`;
  },

  bindTeam(root) {
    const add = $("#add-member-btn", root);
    if (add) add.onclick = () => this.memberModal();
    $$("[data-member]", root).forEach(b => b.onclick = () => this.memberModal(b.dataset.member));
  },

  memberModal(memberId) {
    const m = memberId ? D.member(memberId) : null;
    const s = Store.state;
    Modal.open(`
      <header><h2>${m ? "Edit member" : "Add team member"}</h2><button class="icon-btn" data-close>✕</button></header>
      <div class="modal-body">
        <div class="form-row">
          <div class="field"><label>Name</label><input class="input" id="mm-name" value="${esc(m?.name || "")}" placeholder="e.g. Tomas"></div>
          <div class="field"><label>Trade / title</label><input class="input" id="mm-trade" value="${esc(m?.trade || "")}" placeholder="e.g. Assembly"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Role</label>
            <select class="select" id="mm-role">
              <option value="worker" ${m?.role === "worker" ? "selected" : ""}>Worker — shopfloor (production only)</option>
              <option value="engineer" ${m?.role === "engineer" ? "selected" : ""}>Engineer — design / projektavimas</option>
              <option value="manager" ${m?.role === "manager" ? "selected" : ""}>Manager — full access</option>
            </select>
          </div>
          <div class="field"><label>Home station</label>
            <select class="select" id="mm-station">
              <option value="">None</option>
              <optgroup label="Production">${D.stationsOf("prod").map(st => `<option value="${st.id}" ${m?.station === st.id ? "selected" : ""}>${esc(st.name)}</option>`).join("")}</optgroup>
              <optgroup label="Engineering">${D.stationsOf("eng").map(st => `<option value="${st.id}" ${m?.station === st.id ? "selected" : ""}>${esc(st.name)}</option>`).join("")}</optgroup>
            </select>
          </div>
        </div>
        <div class="field"><label>${m ? "Reset PIN (leave blank to keep current)" : "PIN code (4 digits) — used to sign in"}</label>
          <div class="pin-input-row">
            ${[0,1,2,3].map(i => `<input maxlength="1" inputmode="numeric" pattern="[0-9]" type="password" class="pin-cell" data-i="${i}" autocomplete="off">`).join("")}
          </div>
          ${m ? `<span class="t-caption">Existing PINs are stored hashed and can't be shown — set a new one to change it.</span>` : ""}
        </div>
        ${m && m.id !== App.me.id ? `<button class="btn danger" id="mm-remove" style="align-self:flex-start">Remove from team</button>` : ""}
      </div>
      <footer>
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="mm-save">${m ? "Save changes" : "Add member"}</button>
      </footer>
    `, (modal) => {
      $$("[data-close]", modal).forEach(b => b.onclick = () => Modal.close());
      const cells = $$(".pin-cell", modal);
      cells.forEach((c, i) => {
        c.oninput = () => {
          c.value = c.value.replace(/\D/g, "").slice(0, 1);
          if (c.value && i < 3) cells[i + 1].focus();
        };
        c.onkeydown = (e) => { if (e.key === "Backspace" && !c.value && i > 0) cells[i - 1].focus(); };
      });
      const removeBtn = $("#mm-remove", modal);
      if (removeBtn) removeBtn.onclick = () => {
        const snap = Store.snapshot();
        M.removeMember(m.id, App.me.id);
        Modal.close(); App.render();
        Toast.show(`${m.name} removed`, { undo: () => { Store.restore(snap); App.render(); } });
      };
      $("#mm-save", modal).onclick = () => {
        const name = $("#mm-name", modal).value.trim();
        const trade = $("#mm-trade", modal).value.trim();
        const role = $("#mm-role", modal).value;
        const station = $("#mm-station", modal).value || null;
        const pin = cells.map(c => c.value).join("");
        if (!name) { $("#mm-name", modal).focus(); return; }
        if (pin && pin.length !== 4) { cells[pin.length]?.focus(); Toast.show("PIN must be 4 digits", { emoji: "🔢" }); return; }
        if (m) {
          if (!pin && !m.pinHash) { cells[0]?.focus(); Toast.show("Set a PIN for this member", { emoji: "🔢" }); return; }
          M.updateMember(m.id, { name, trade, role, station });
          if (pin) M.setPin(m.id, pin, App.me.id);
          Toast.show(pin ? "Member updated · PIN reset" : "Member updated", { emoji: "✓" });
        } else {
          if (pin.length !== 4) { cells[0]?.focus(); Toast.show("Set a 4-digit PIN", { emoji: "🔢" }); return; }
          M.addMember({ name, trade, role, station, pin }, App.me.id);
          Toast.show(`${name} added to the team`, { emoji: "👋" });
        }
        Modal.close(); App.render();
      };
    });
  },

  /* ---------------- Settings ---------------- */
  settings() {
    const sh = D.shift();
    const theme = localStorage.getItem("shopflow.theme") || "auto";
    const s = Store.state;
    return `<div class="view-anim settings-wrap">
      <div class="panel">
        <div class="settings-row">
          <span class="grow"><b>Workshop name</b><span>Shown on the sign-in screen</span></span>
          <input class="input" style="width:220px" id="set-name" value="${esc(s.shopName)}">
        </div>
        <div class="settings-row">
          <span class="grow"><b>Appearance</b><span>Follows your system by default</span></span>
          <div class="segmented" id="set-theme">
            ${["auto", "light", "dark"].map(t => `<button data-t="${t}" class="${theme === t ? "active" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}
          </div>
        </div>
        <div class="settings-row">
          <span class="grow"><b>Language</b><span>Interface language for this device</span></span>
          <div class="segmented" id="set-lang">
            ${[["en", "English"], ["lt", "Lietuvių"]].map(([v, lbl]) => `<button data-l="${v}" class="${(typeof I18N !== "undefined" ? I18N.lang : "en") === v ? "active" : ""}">${lbl}</button>`).join("")}
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="settings-head">
          <b>Working hours</b>
          <span>Time on a task is counted against these hours only. Evenings, weekends and breaks never add to a job — a task left running overnight costs nothing.</span>
        </div>
        <div class="settings-row">
          <span class="grow"><b>Working days</b><span>A day off contributes no time at all</span></span>
          <div class="day-picker" id="set-days">
            ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => `
              <button data-day="${i}" class="${sh.days.includes(i) ? "on" : ""}">${d}</button>`).join("")}
          </div>
        </div>
        <div class="settings-row">
          <span class="grow"><b>Shift</b><span>${D.shiftDayMs() > 0 ? `${fmtDur(D.shiftDayMs())} of work per day after breaks` : "No working time — check the times below"}</span></span>
          <div class="row" style="gap:8px;align-items:center">
            <input class="input time-input" type="time" id="set-shift-start" value="${esc(sh.start)}">
            <span class="t-caption">to</span>
            <input class="input time-input" type="time" id="set-shift-end" value="${esc(sh.end)}">
          </div>
        </div>
        <div class="settings-row">
          <span class="grow"><b>Breaks</b><span>Not counted as work</span></span>
          <div class="break-list">
            ${(sh.breaks || []).map((b, i) => `
              <div class="break-row">
                <input class="input time-input" type="time" data-brk="${i}/from" value="${esc(b.from)}">
                <span class="t-caption">–</span>
                <input class="input time-input" type="time" data-brk="${i}/to" value="${esc(b.to)}">
                <button class="mini-btn danger" data-brk-del="${i}" title="Remove break">✕</button>
              </div>`).join("")}
            <button class="add-inline" id="set-brk-add">＋ Add a break</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="settings-head">
          <b>Automatic time tracking</b>
          <span>Scanning a part is the timer. The first scan at a station starts the clock, later scans keep it going, and it stops on its own — nobody has to press start or stop.</span>
        </div>
        <div class="settings-row">
          <span class="grow"><b>Track time from scans</b><span>${sh.auto ? "On — the Scan Station drives the clock" : "Off — tasks are timed with the Start / Pause buttons"}</span></span>
          <div class="segmented" id="set-auto">
            <button data-auto="1" class="${sh.auto ? "active" : ""}">On</button>
            <button data-auto="0" class="${!sh.auto ? "active" : ""}">Off</button>
          </div>
        </div>
        <div class="settings-row">
          <span class="grow"><b>Stop after</b><span>How long the clock keeps running once the scanning stops</span></span>
          <div class="row" style="gap:8px;align-items:center">
            <input class="input" type="number" min="5" max="240" step="5" id="set-idle" value="${sh.idleMins}" style="width:84px">
            <span class="t-caption">minutes of quiet</span>
          </div>
        </div>
      </div>

      ${[["prod", "Workflow stations", "The production steps every order can flow through — rename, reorder, add your own", "＋ Add station"],
         ["eng", "Engineering stages", "The stages engineering projects go through — brief, design, approval…", "＋ Add stage"]].map(([kind, title, sub, addLabel]) => {
        const stationsOfKind = D.stationsOf(kind);
        return `<div class="panel">
        <div class="settings-row" style="border-top:none">
          <span class="grow"><b>${title}</b><span>${sub}</span></span>
          <button class="btn subtle" data-st-add="${kind}">${addLabel}</button>
        </div>
        <div>
          ${stationsOfKind.map((st, i) => `
            <div class="station-edit-row" data-st="${st.id}">
              <button class="ico-pick" data-st-icon="${st.id}" title="Change icon">${stIcon(st, 18)}</button>
              <input class="input" data-st-name="${st.id}" value="${esc(st.name)}">
              <input class="input est-input" data-st-est="${st.id}" type="number" min="5" value="${st.estMins}" title="Default estimate (min)">
              <span class="t-caption">min</span>
              ${(() => {
                const crew = D.stationDefaults(st.id).map(id => D.member(id));
                return `<button class="assign-select crew-btn st-who" data-st-who="${st.id}" title="Who new tasks here go to">
                  ${crew.length ? `<span class="avatar-stack">${crew.slice(0, 3).map(m => avatarHtml(m, "sm")).join("")}</span>
                    <span>${esc(crew.slice(0, 2).map(m => m.name.split(" ")[0]).join(", "))}${crew.length > 2 ? ` +${crew.length - 2}` : ""}</span>`
                    : `<span>— nobody —</span>`}
                  ${icon("chev-down", 12)}
                </button>`;
              })()}
              <button class="mini-btn" data-st-move="${st.id}/-1" ${i === 0 ? "disabled" : ""}>↑</button>
              <button class="mini-btn" data-st-move="${st.id}/1" ${i === stationsOfKind.length - 1 ? "disabled" : ""}>↓</button>
              <button class="mini-btn danger" data-st-del="${st.id}" title="Delete station">✕</button>
            </div>`).join("")}
        </div>
      </div>`;
      }).join("")}

      <div class="panel">
        <div class="settings-row" style="border-top:none;align-items:flex-start">
          <span class="grow"><b>Project files (OneDrive)</b><span>Base folder where each project has a subfolder named by its code — projects then auto-open with one click. Leave blank to link each project by hand.</span></span>
          <div style="display:flex;flex-direction:column;gap:8px;width:340px">
            <input class="input" id="set-od-base" value="${esc(s.oneDrive?.baseUrl || "")}" placeholder="https://onedrive.live.com/…/Projektai">
            <div class="row" style="gap:8px">
              <input class="input" id="set-od-tpl" value="${esc(s.oneDrive?.template || "{base}/{code}")}" style="flex:1;font-family:var(--font-mono);font-size:12px" title="Link template — {base}, {code}, {name}">
            </div>
            <div class="t-caption" id="set-od-preview" style="word-break:break-all"></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="settings-row" style="border-top:none;align-items:flex-start">
          <span class="grow"><b>Scan stations (QR / barcode)</b><span>Open a station kiosk on a device at each machine — a USB/Bluetooth scanner or the camera then advances every part you scan. Give a scanner a prefix (e.g. <span class="mono">EDGE#</span>) to route it to a station automatically when several share one PC.</span></span>
          <div style="display:flex;flex-direction:column;gap:6px;width:340px">
            ${D.stationsOf("prod").map(st => {
              const pfx = Object.keys(s.scan?.prefixes || {}).find(k => s.scan.prefixes[k] === st.id) || "";
              return `<div class="row" style="gap:8px">
                <span class="row" style="gap:7px;flex:1;min-width:0"><span style="color:var(--text-2)">${stIcon(st, 15)}</span><b style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(st.name)}</b></span>
                <input class="input" data-scan-prefix="${st.id}" value="${esc(pfx)}" placeholder="prefix" style="width:88px;font-family:var(--font-mono);font-size:12px;padding:6px 9px">
                <button class="btn subtle" data-scan-open="${st.id}" style="padding:6px 12px;font-size:12.5px">${icon("scan", 13)} Kiosk</button>
              </div>`;
            }).join("")}
            <div class="t-caption">Label token also understood: <span class="mono">SF|orderId|itemId|part</span>, or any code containing the project (e.g. <span class="mono">SA_GA_VIRT_404</span>).</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="settings-row" style="border-top:none">
          <span class="grow"><b>Cloud sync</b><span>Share this workspace live across every device. ${typeof Sync !== "undefined" && Sync.configured() ? "Connected to Supabase." : "Not set up yet — see SETUP-CLOUD.md, then add sync-config.js."}</span></span>
          <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
            ${typeof Sync !== "undefined" ? Sync.badge() : `<span class="sync-badge off">Local only</span>`}
            ${typeof Sync !== "undefined" && Sync.configured() ? `<div class="row" style="gap:8px">
              <button class="btn subtle" id="sync-pull">Pull from cloud</button>
              <button class="btn" id="sync-push">Upload this device →</button>
            </div>
            <button class="btn ghost" id="sync-logout" style="padding:5px 12px;font-size:12.5px">Sign out of workspace (this device)</button>` : ""}
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="settings-head">
          <b>Permissions</b>
          <span>Everyone sees the same screens. This is only about what each role may change — managers always keep everything.</span>
        </div>
        ${["engineer", "worker"].map(role => `
          <div class="perm-role">
            <div class="perm-role-head">
              <span class="role-badge ${role}">${role}</span>
              <span class="grow"></span>
              <button class="add-inline" data-perm-reset="${role}">Reset to defaults</button>
            </div>
            ${CAPS.map(c => `
              <label class="perm-row">
                <input type="checkbox" data-perm="${role}/${c.id}" ${D.roleCan(role, c.id) ? "checked" : ""}>
                <span class="grow"><b>${c.label}</b><span>${c.hint}</span></span>
              </label>`).join("")}
          </div>`).join("")}
      </div>

      <div class="panel">
        <div class="settings-row">
          <span class="grow"><b>Export data</b><span>${(() => {
            const at = (Store.state.backupMeta || {}).lastExportAt;
            const d = Store.exportOverdueDays();
            if (!at) return "Download all orders, stock & team as a JSON backup file — never exported on this device";
            return `Last downloaded ${fmtAgo(at)}${d >= EXPORT_NAG_DAYS ? " — overdue" : ""}`;
          })()}</span></span>
          <button class="btn ${Store.exportOverdueDays() >= EXPORT_NAG_DAYS ? "primary" : ""}" id="set-export">Export</button>
        </div>
        <div class="settings-row">
          <span class="grow"><b>Save a restore point</b><span>Name the current state so you can roll back to it later — kept until you delete it</span></span>
          <button class="btn subtle" id="set-savepoint">${icon("save", 14)} Save now</button>
        </div>
        <div class="settings-row">
          <span class="grow"><b>Import a backup</b><span>Restore everything from a JSON file you exported earlier — current data is replaced (undoable)</span></span>
          <button class="btn subtle" id="set-import">Import…</button>
          <input type="file" id="set-import-file" accept="application/json,.json" hidden>
        </div>
        ${(() => {
          const u = Store.usage();
          const mb = Store.fmtBytes;
          const pct = Math.min(100, Math.round(u.total / u.quota * 100));
          const mine = u.keys.filter(k => k.key.startsWith("shopflow"));
          const others = u.keys.filter(k => !k.key.startsWith("shopflow"));
          const otherBytes = others.reduce((n, k) => n + k.bytes, 0);
          /* Two different stores, two different stories. The vault is sized
             against free disk; the little one is the 5 MB the whole domain
             shares, and all ShopFlow leaves in it is an index for the hub. */
          const vpct = u.vaultQuota ? Math.min(100, Math.round(u.vaultUsed / u.vaultQuota * 100)) : 0;
          return `<div class="settings-row st-row">
            <span class="grow"><b>Storage on this device</b>
              ${u.vault ? `
                <span>Your workshop is kept in this browser's large store, which the browser sizes against free disk${
                  u.vaultQuota ? ` — ${mb(u.vaultUsed)} of about ${mb(u.vaultQuota)} available` : ""}.</span>
                <div class="st-bar ${vpct > 90 ? "bad" : vpct > 70 ? "warn" : ""}"><i style="width:${Math.max(vpct, 1)}%"></i></div>
                <div class="st-legend">
                  <span><b>${mb(u.docBytes)}</b> this workshop's data</span>
                  <span><b>${mb(u.backupBytes)}</b> ${u.backupCount} restore point${u.backupCount === 1 ? "" : "s"}</span>
                  ${u.thumbCount ? `<span><b>${mb(u.thumbBytes)}</b> ${u.thumbCount} attachment preview${u.thumbCount === 1 ? "" : "s"}</span>` : ""}
                  <span class="st-tot"><b>${mb(u.total)}</b> in the small store shared with the hub, offers and invoices</span>
                </div>`
              : `
                <span>Every app on this domain shares one browser store of about ${mb(u.quota)} — ShopFlow, the hub, offers, invoices.</span>
                <div class="st-bar ${pct > 90 ? "bad" : pct > 70 ? "warn" : ""}"><i style="width:${pct}%"></i></div>
                <div class="st-legend">
                  <span><b>${mb(u.docBytes)}</b> this workshop's data</span>
                  <span><b>${mb(u.backupBytes)}</b> ${u.backupCount} local backup${u.backupCount === 1 ? "" : "s"}</span>
                  ${u.thumbCount ? `<span><b>${mb(u.thumbBytes)}</b> ${u.thumbCount} attachment preview${u.thumbCount === 1 ? "" : "s"}</span>` : ""}
                  ${otherBytes ? `<span><b>${mb(otherBytes)}</b> other apps on this domain</span>` : ""}
                  <span class="st-tot"><b>${mb(u.total)}</b> of ${mb(u.quota)} used</span>
                </div>
                ${u.over ? `<div class="mc-warn" style="margin-top:8px">${icon("alert", 15)}<span>Nearly full. Freeing the local backups is safe when cloud sync is connected — the cloud holds the current data either way.</span></div>` : ""}`}
            </span>
            <button class="btn ${!u.vault && u.over ? "primary" : "subtle"}" id="set-storage">Details…</button>
          </div>` + (() => {
          const all = Store._backups(); const n = all.length; const named = all.filter(b => b.keep).length;
          return `<div class="settings-row">
            <span class="grow"><b>Restore from a backup</b><span>${n
              ? `${named ? `${named} named restore point${named > 1 ? "s" : ""} · ` : ""}${n - named} automatic snapshot${n - named === 1 ? "" : "s"} on this device`
              : "Automatic backups appear here as you work"}</span></span>
            ${n ? `<button class="btn subtle" id="set-backups">Restore…</button>` : `<span class="muted t-caption">none yet</span>`}
          </div>`;
        })(); })()}
        ${typeof REAL_SEED !== "undefined" ? `<div class="settings-row">
          <span class="grow"><b>Restore Northwood Furniture backup</b><span>Reload the real data imported from the 2026-07-17 backup — current changes will be lost</span></span>
          <button class="btn subtle" id="set-real">Restore backup</button>
        </div>` : ""}
        <div class="settings-row">
          <span class="grow"><b>Load demo workshop</b><span>Sample data for exploring — current changes will be lost</span></span>
          <button class="btn danger" id="set-reset">Load demo</button>
        </div>
      </div>
      <div class="t-caption" style="text-align:center">ShopFlow · local-first, saved in this browser · build ${esc(App.build())}</div>
    </div>`;
  },

  exportBackup() {
    const blob = new Blob([Store.snapshot()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shopflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    Store.markExported();                       // so the overdue reminder resets
    App.render();
  },

  /* What is in the browser store, largest first, and the two safe ways to get
     room back. Deliberately shows other apps' keys too — they share the quota
     and hiding them would make ShopFlow look like the whole problem. */
  storageModal() {
    const u = Store.usage();
    const mb = Store.fmtBytes;
    /* key names are identifiers, not prose — the translator must leave them alone */
    const rows = (list, label) => list.slice(0, 10).map(x => `<div class="st-line">
      <span class="grow mono" data-notranslate>${esc(x.key)}</span><b>${mb(x.bytes)}</b></div>`).join("")
      || `<div class="t-caption">${label}</div>`;
    const live = typeof Sync !== "undefined" && Sync.status === "live";

    Modal.open(`
      <header><h2>Storage on this device</h2><button class="icon-btn" data-close>${icon("x", 15)}</button></header>
      <div class="modal-body">
        <p style="font-size:13.5px;color:var(--text-2)">
          ShopFlow writes every change to this browser first, so the shop keeps working when the
          wifi drops, and pushes it to the cloud afterwards.
          ${u.vault
            ? `Your workshop lives in IndexedDB, which the browser sizes against free disk${
                u.vaultQuota ? ` — <b>${mb(u.vaultUsed)}</b> of about <b>${mb(u.vaultQuota)}</b>` : ""},
               so it is not competing for the small store any more. All that is left there is a
               ${mb(u.total)} index the hub reads.`
            : `This browser is using the small store every app on the domain shares —
               about ${mb(u.quota)} between ShopFlow, the hub, offers and invoices — and
               <b>${mb(u.total)}</b> of it is in use.`}
          ${live ? "Sync is connected, so the current data is in the cloud as well as here."
                 : "Sync is <b>not</b> connected, so this device is the only copy — export a backup before freeing anything."}
        </p>

        <div class="t-label ins-h">Biggest keys in the browser store</div>
        ${rows(u.keys, "nothing stored")}

        <div class="t-label ins-h">Inside this workshop's data</div>
        ${rows(u.sections, "no data")}
        ${u.thumbCount ? `<div class="t-caption" style="margin-top:6px">${u.thumbCount} attachment previews account for ${mb(u.thumbBytes)} of that — they travel with the data so every device can see a drawing without downloading it.</div>` : ""}
      </div>
      <footer>
        <button class="btn subtle" id="st-export">${icon("download", 13)} Export a backup</button>
        <div class="grow"></div>
        <button class="btn ghost" data-close>Close</button>
        ${u.backupCount ? `<button class="btn ${live ? "primary" : "danger"}" id="st-free">Free ${mb(u.backupBytes)} of local backups</button>` : ""}
      </footer>`, (m) => {
      $("#st-export", m).onclick = () => { Modal.close(); Mgr.exportBackup(); };
      $("#st-free", m).onclick = async () => {
        const freed = u.backupBytes;
        await Store.clearBackups();
        Modal.close(); App.render();
        Toast.show(`Freed ${mb(freed)} — local restore points cleared`, { emoji: "check", ms: 5000 });
      };
    });
  },

  setStationCrew(stId, ids) {
    if (D.stationDefaults(stId).join(",") === ids.join(",")) { App.render(); return; }
    const r = M.setStationDefault(stId, ids, App.me.id);
    App.render();
    if (!r) return;
    const st = D.station(stId);
    if (!r.ids.length) { Toast.show("New tasks here start unassigned", { emoji: "users" }); return; }
    const names = r.ids.map(id => D.member(id).name).join(", ");
    /* The setting on its own only helps future work; everything already on the
       board would stay blank, which is the state being complained about. */
    if (!r.pending) { Toast.show(`${names} now get new ${st.name} tasks`, { emoji: "users", ms: 4500 }); return; }
    Modal.open(`
      <header><h2>Also take the ones already there?</h2><button class="icon-btn" data-close>${icon("x", 15)}</button></header>
      <div class="modal-body">
        <p style="font-size:13.5px;color:var(--text-2);line-height:1.6">
          <b>${esc(names)}</b> · <b>${esc(st.name)}</b><br>
          <span>${r.ids.length > 1 ? "New tasks at this stage go to these people from now on."
                                      : "New tasks at this stage go to this person from now on."}</span><br>
          <span>Already on the board and picked up by nobody:</span> <b>${r.pending}</b>
        </p>
      </div>
      <footer>
        <div class="grow"></div>
        <button class="btn ghost" data-close>Leave them</button>
        <button class="btn primary" id="sd-all"><span>Take them too</span> — ${r.pending}</button>
      </footer>`, (m) => {
      $$("[data-close]", m).forEach(b => b.onclick = () => Modal.close());
      $("#sd-all", m).onclick = () => {
        const n = M.assignPendingAtStation(stId, r.ids, App.me.id);
        Modal.close(); App.render();
        Toast.show(`${n} task${n === 1 ? "" : "s"} assigned to ${names}`, { emoji: "check", ms: 5000 });
      };
    });
  },

  bindSettings(root) {
    $("#set-name", root).onchange = (e) => {
      Store.state.shopName = e.target.value.trim() || "My Workshop"; Store.save();
      Toast.show("Workshop renamed", { emoji: "✓" });
    };
    $$("#set-theme button", root).forEach(b => b.onclick = () => { App.applyTheme(b.dataset.t); App.render(); });
    $$("#set-lang button", root).forEach(b => b.onclick = () => I18N.set(b.dataset.l));

    /* OneDrive base folder */
    const odBase = $("#set-od-base", root), odTpl = $("#set-od-tpl", root), odPrev = $("#set-od-preview", root);
    const sampleOrder = Store.state.orders[0];
    const renderPreview = () => {
      const base = odBase.value.trim();
      if (!base) { odPrev.innerHTML = `<span class="muted">No base folder — projects are linked individually.</span>`; return; }
      const preview = (odTpl.value.trim() || "{base}/{code}")
        .replace("{base}", base.replace(/\/+$/, ""))
        .replace("{code}", encodeURIComponent(D.slug(sampleOrder?.num || "WO-1041")))
        .replace("{name}", encodeURIComponent(D.slug(sampleOrder?.product || "Project")));
      odPrev.innerHTML = `${icon("cloud", 12)} e.g. ${sampleOrder ? esc(sampleOrder.num) : "WO-1041"} → <span class="mono">${esc(preview)}</span>`;
    };
    const saveOd = () => { M.setOneDrive({ baseUrl: odBase.value.trim(), template: odTpl.value.trim() || "{base}/{code}" }, App.me.id); renderPreview(); };
    odBase.oninput = renderPreview; odTpl.oninput = renderPreview;
    odBase.onchange = saveOd; odTpl.onchange = saveOd;
    renderPreview();

    /* Scan stations */
    $$("[data-scan-prefix]", root).forEach(inp => inp.onchange = () => {
      const stId = inp.dataset.scanPrefix;
      // clear any old prefix that pointed here, then set the new one
      const prefixes = Store.state.scan?.prefixes || {};
      Object.keys(prefixes).forEach(k => { if (prefixes[k] === stId) M.setScanPrefix(k, null); });
      const v = inp.value.trim();
      if (v) M.setScanPrefix(v, stId);
      Toast.show(v ? `Scanner prefix “${v}” → ${D.station(stId).name}` : "Prefix cleared", { emoji: "scan" });
    });
    $$("[data-scan-open]", root).forEach(b => b.onclick = () => {
      ScanStation.stationId = b.dataset.scanOpen;
      App.navigate("scan");
    });
    const syncPush = $("#sync-push", root);
    if (syncPush) syncPush.onclick = async () => {
      if (!confirm("Upload THIS device's data to the cloud, overwriting the shared copy? Do this once, from the device that has the correct data.")) return;
      await Sync.push(true); Toast.show("Uploaded to cloud", { emoji: "cloud" });
    };
    const syncPull = $("#sync-pull", root);
    if (syncPull) syncPull.onclick = async () => { await Sync.pull(); Toast.show("Pulled latest from cloud", { emoji: "cloud" }); };
    const syncLogout = $("#sync-logout", root);
    if (syncLogout) syncLogout.onclick = () => { if (confirm("Sign this device out of the shared workspace? You'll need the shop password to sign back in.")) Sync.logout(); };

    $("#set-export", root).onclick = () => this.exportBackup();
    const stBtn = $("#set-storage", root);
    if (stBtn) stBtn.onclick = () => this.storageModal();

    /* Named restore point — the one a person makes before a risky change */
    /* ---- working hours ---- */
    $$("[data-day]", root).forEach(b => b.onclick = () => {
      const d = +b.dataset.day;
      const days = D.shift().days.includes(d)
        ? D.shift().days.filter(x => x !== d)
        : [...D.shift().days, d].sort();
      M.setShift({ days }, App.me.id); App.render();
    });
    const shStart = $("#set-shift-start", root), shEnd = $("#set-shift-end", root);
    if (shStart) shStart.onchange = () => { M.setShift({ start: shStart.value }, App.me.id); App.render(); };
    if (shEnd) shEnd.onchange = () => { M.setShift({ end: shEnd.value }, App.me.id); App.render(); };
    $$("[data-brk]", root).forEach(inp => inp.onchange = () => {
      const [i, side] = inp.dataset.brk.split("/");
      const breaks = D.shift().breaks.map((b, n) => (n === +i ? { ...b, [side]: inp.value } : b));
      M.setShift({ breaks }, App.me.id); App.render();
    });
    $$("[data-brk-del]", root).forEach(b => b.onclick = () => {
      M.setShift({ breaks: D.shift().breaks.filter((_, n) => n !== +b.dataset.brkDel) }, App.me.id);
      App.render();
    });
    const brkAdd = $("#set-brk-add", root);
    if (brkAdd) brkAdd.onclick = () => {
      M.setShift({ breaks: [...D.shift().breaks, { from: "14:00", to: "14:15" }] }, App.me.id);
      App.render();
    };
    $$("[data-auto]", root).forEach(b => b.onclick = () => {
      M.setShift({ auto: b.dataset.auto === "1" }, App.me.id); App.render();
      Toast.show(b.dataset.auto === "1" ? "Scans now drive the clock" : "Back to manual Start / Pause", { emoji: "clock" });
    });
    const idle = $("#set-idle", root);
    if (idle) idle.onchange = () => {
      M.setShift({ idleMins: Math.max(5, Math.min(240, parseInt(idle.value) || 30)) }, App.me.id);
      App.render();
    };

    $$("[data-perm]", root).forEach(cb => cb.onchange = () => {
      const [role, cap] = cb.dataset.perm.split("/");
      M.setPerm(role, cap, cb.checked, App.me.id);
      App.render();
      const c = CAPS.find(x => x.id === cap);
      Toast.show(`${role}s ${cb.checked ? "can now" : "can no longer"} ${(c ? c.label : cap).toLowerCase()}`, { emoji: "lock" });
    });
    $$("[data-perm-reset]", root).forEach(b => b.onclick = () => {
      const role = b.dataset.permReset;
      M.resetPerms(role, App.me.id); App.render();
      Toast.show(`${role} permissions reset`, { emoji: "history" });
    });

    const spBtn = $("#set-savepoint", root);
    if (spBtn) spBtn.onclick = () => {
      const when = new Date().toLocaleString(isLT() ? "lt-LT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      Modal.open(`
        <header><h2>Save a restore point</h2><button class="icon-btn" data-close>✕</button></header>
        <div class="modal-body">
          <div class="t-caption">A snapshot of everything as it is right now, kept on this device until you delete it. Automatic backups will never push it out.</div>
          <div class="field"><label>Name it</label><input class="input" id="sp-name" value="${esc(when)}" autocomplete="off"></div>
        </div>
        <footer><button class="btn" data-close>Cancel</button>
          <button class="btn primary" id="sp-go">${icon("save", 14)} Save restore point</button></footer>`, (m) => {
        const inp = $("#sp-name", m);
        const go = () => {
          const entry = Store.savePoint(inp.value, App.me.id);
          Modal.close(); App.render();
          Toast.show(entry ? `Restore point “${entry.reason}” saved` : "Couldn't save — device storage is full", { emoji: entry ? "save" : "alert" });
        };
        $("#sp-go", m).onclick = go;
        inp.onkeydown = (e) => { if (e.key === "Enter") go(); };
      });
    };
    $("#set-import", root).onclick = () => $("#set-import-file", root).click();
    $("#set-import-file", root).onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const snap = Store.snapshot();
        try { Store.importJSON(reader.result); }
        catch (err) { Toast.show("Import failed — not a valid ShopFlow backup file", { emoji: "alert" }); return; }
        App.logout();
        Toast.show("Backup imported", { emoji: "check", undo: () => { Store.restore(snap); App.render(); } });
      };
      reader.readAsText(file);
    };
    const bkBtn = $("#set-backups", root);
    if (bkBtn) bkBtn.onclick = () => {
      const list = Store._backups();
      const fmtBk = (ts) => new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const rows = (b) => `<div class="settings-row" style="border:none;background:var(--surface-2);border-radius:10px;padding:10px 14px">
            <span class="grow bk-row"><span style="display:flex;flex-direction:column;min-width:0">
              <b>${esc(b.keep ? b.reason : fmtBk(b.ts))}</b>
              <span>${b.keep ? fmtBk(b.ts) + (b.by && D.member(b.by) ? " · " + esc(D.member(b.by).name) : "") : esc(b.reason || "auto")}</span>
            </span>${b.keep ? `<span class="bk-tag">saved</span>` : ""}</span>
            ${b.keep ? `<button class="icon-btn" data-bk-del="${b.ts}" title="Delete this restore point">${icon("trash", 14)}</button>` : ""}
            <button class="btn subtle" data-bk="${b.ts}">Restore</button>
          </div>`;
      const named = list.filter(b => b.keep), auto = list.filter(b => !b.keep);
      Modal.open(`<h3 style="margin:0 0 4px">Restore a backup</h3>
        <p class="t-caption" style="margin:0 0 14px">Roll back to a snapshot saved on this device. Your current data is backed up first, so this is undoable.</p>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto">
          ${named.length ? `<div class="t-label">Your restore points</div>${named.map(rows).join("")}` : ""}
          ${auto.length ? `<div class="t-label" style="margin-top:6px">Automatic</div>${auto.map(rows).join("")}` : ""}
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" id="bk-close">Close</button></div>`,
        (m) => {
          $("#bk-close", m).onclick = () => Modal.close();
          $$("[data-bk-del]", m).forEach(btn => btn.onclick = () => {
            Store.deleteBackup(parseInt(btn.dataset.bkDel));
            Modal.close(); App.render();
            Toast.show("Restore point deleted", { emoji: "trash" });
          });
          $$("[data-bk]", m).forEach(btn => btn.onclick = async () => {
            const snap = Store.snapshot();
            btn.disabled = true;
            if (await Store.restoreBackup(parseInt(btn.dataset.bk))) {
              Modal.close(); App.logout();
              Toast.show("Backup restored", { emoji: "history", undo: () => { Store.restore(snap); App.render(); } });
            } else { btn.disabled = false; Toast.show("That backup could not be read", { emoji: "alert" }); }
          });
        });
    };
    $("#set-reset", root).onclick = () => {
      const snap = Store.snapshot();
      Store.loadDemo(); App.logout();
      Toast.show("Demo workshop loaded", { undo: () => { Store.restore(snap); App.render(); } });
    };
    const realBtn = $("#set-real", root);
    if (realBtn) realBtn.onclick = () => {
      const snap = Store.snapshot();
      Store.loadReal(); App.logout();
      Toast.show("Northwood Furniture backup restored", { undo: () => { Store.restore(snap); App.render(); } });
    };

    /* Stations editor */
    $$("[data-st-add]", root).forEach(b => b.onclick = () => {
      const kind = b.dataset.stAdd;
      M.addStation({ name: kind === "eng" ? "New stage" : "New station", estMins: 60, kind }, App.me.id);
      App.render();
    });
    $$("[data-st-icon]", root).forEach(b => b.onclick = (e) => {
      const id = b.dataset.stIcon;
      Popover.open(b, `<div class="icon-grid">${STATION_IC_KEYS.map(k => `<button data-ic="${k}" title="${k}">${icon(k, 17)}</button>`).join("")}</div>`, (pop) => {
        $$("[data-ic]", pop).forEach(ib => ib.onclick = () => {
          M.updateStation(id, { ic: ib.dataset.ic });
          Popover.close(); App.render();
        });
      });
    });
    $$("[data-st-name]", root).forEach(inp => inp.onchange = () => {
      M.updateStation(inp.dataset.stName, { name: inp.value.trim() || "Station" }, App.me.id);
      App.render();
    });
    $$("[data-st-est]", root).forEach(inp => inp.onchange = () => {
      M.updateStation(inp.dataset.stEst, { estMins: parseInt(inp.value) || 60 });
    });
    $$("[data-st-who]", root).forEach(btn => btn.onclick = () => {
      const stId = btn.dataset.stWho, st = D.station(stId);
      const picked = new Set(D.stationDefaults(stId));
      /* Everybody is listed, with the people whose trade fits this kind of
         station first. Filtering them out would be tidier right up until the
         person you actually wanted is the one not shown. */
      const fits = (m) => st.kind === "eng"
        ? (m.role === "manager" || m.role === "engineer")
        : (m.role === "worker" || m.role === "manager");
      const eligible = [...Store.state.members].sort((a, b) =>
        (fits(b) - fits(a)) || a.name.localeCompare(b.name));
      const firstOther = eligible.findIndex(m => !fits(m));
      Popover.open(btn, `<div class="crew-pick">
        ${eligible.map((m, i) => `${i === firstOther && i > 0 ? `<div class="crew-sep">Anyone else</div>` : ""}
          <label class="crew-row">
          <input type="checkbox" data-sw-m="${m.id}" ${picked.has(m.id) ? "checked" : ""}>
          ${avatarHtml(m, "sm")}<span class="grow">${esc(m.name)}</span>
          <span class="t-caption">${esc(m.trade || m.role)}</span>
        </label>`).join("")}
        <button class="crew-clear" data-sw-none>Nobody</button>
      </div>`, (pop) => {
        $$("[data-sw-m]", pop).forEach(c => c.onchange = () => {
          c.checked ? picked.add(c.dataset.swM) : picked.delete(c.dataset.swM);
        });
        $("[data-sw-none]", pop).onclick = () => { Popover.close(); this.setStationCrew(stId, []); };
        /* applied once, when the picker closes: choosing two people should be
           one line in the history and one question about the work already
           waiting, not one of each per checkbox */
        pop._onClose = () => this.setStationCrew(stId, [...picked]);
      });
    });
    $$("[data-st-move]", root).forEach(b => b.onclick = () => {
      const [id, dir] = b.dataset.stMove.split("/");
      M.moveStation(id, parseInt(dir)); App.render();
    });
    $$("[data-st-del]", root).forEach(b => b.onclick = () => {
      const id = b.dataset.stDel;
      const st = D.station(id);
      const snap = Store.snapshot();
      if (!M.deleteStation(id, App.me.id)) {
        Toast.show(`Can't delete “${st.name}” — used by existing orders`, { emoji: "⚠️", ms: 4200 });
        return;
      }
      App.render();
      Toast.show(`Station “${st.name}” deleted`, { undo: () => { Store.restore(snap); App.render(); } });
    });
  },
};

/* ============================================================
   Warehouse
   ============================================================ */
const Warehouse = {
  filter: "all",
  search: "",
  tab: "materials", // materials | purchases | suppliers | articles

  view() {
    const open = D.openPurchases().length;
    const shortfalls = D.demandShortfalls().length;
    const tabs = [
      ["materials", "layers", "Materials", 0],
      ["demand", "trend-down", "What the jobs need", shortfalls, "warn"],
      ["purchases", "truck", "Purchase orders", open],
      ["suppliers", "handshake", "Suppliers", 0],
      ["articles", "box", "Articles (products)", 0],
    ];
    return `<div class="view-anim">
      <div class="toolbar" style="margin-bottom:10px">
        <div class="segmented">
          ${tabs.map(([id, ico, label, n, warn]) =>
            `<button class="${this.tab === id ? "active" : ""}" data-wtab="${id}">${icon(ico, 13)} ${label}${n ? ` <span class="seg-count ${warn || ""}">${n}</span>` : ""}</button>`).join("")}
        </div>
      </div>
      ${this.tab === "articles" ? this.articlesView()
        : this.tab === "demand" ? this.demandView()
        : this.tab === "purchases" ? this.purchasesView()
        : this.tab === "suppliers" ? this.suppliersView()
        : this.materialsView()}
    </div>`;
  },

  /* ============================================================
     Purchasing — the other half of the warehouse

     Low stock used to be a red badge and nothing else; somebody still had
     to remember what to order and from whom. A purchase order is a promise,
     so nothing here touches the shelves until a delivery is received, and
     receiving goes through the same stock movement as any other delivery.
     ============================================================ */
  PO_LABEL: { draft: "Draft", sent: "Ordered", received: "Received", cancelled: "Cancelled" },
  /* reusing the status palette; no dot, so "sent" doesn't inherit the pulse */
  PO_PILL: { draft: "queued", sent: "running", received: "done", cancelled: "queued" },
  poPill(po) { return `<span class="pill ${this.PO_PILL[po.status]}">${this.PO_LABEL[po.status]}</span>`; },

  /* ============================================================
     What the jobs need

     "Low stock" measures the shelf against a minimum somebody set once.
     This measures it against the work already accepted, which is the number
     that decides whether Monday happens.
     ============================================================ */
  demandView() {
    const rows = D.materialDemand();
    const short = rows.filter(r => r.short > 0);
    const unlinked = short.filter(r => !r.material);
    const canBuy = App.can("warehouse.edit");
    const fmtQ = (n) => (Math.round(n * 100) / 100).toLocaleString("lt-LT");

    return `<div>
      ${short.length ? `<div class="reorder-nag">
        <span style="color:var(--orange)">${icon("alert", 20)}</span>
        <span class="grow"><b>${short.length} material${short.length > 1 ? "s are" : " is"} short for the jobs in hand</b>
          <span>${D.blockedByStock().length} project${D.blockedByStock().length === 1 ? "" : "s"} need${D.blockedByStock().length === 1 ? "s" : ""} more than the shelf and the open orders can cover${
            unlinked.length ? ` · ${unlinked.length} not linked to any stock item yet` : ""}.</span></span>
        ${canBuy && short.some(r => r.material && r.material.supplierId)
          ? `<button class="btn" id="dm-draft">${icon("plus", 13)} Draft orders for the shortfall</button>` : ""}
      </div>` : ""}

      <div class="toolbar">
        <span class="t-caption">Every unconsumed material line on every unfinished project, added up</span>
      </div>

      <div class="table-card">
        ${rows.length ? `<table class="orders dm-table">
          <thead><tr>
            <th>Material &amp; the jobs waiting for it</th>
            <th class="num">Needed</th><th class="num">In stock</th>
            <th class="num">On order</th><th class="num">Short</th><th></th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `<tr class="${r.short > 0 ? "dm-short" : ""}" data-dm="${esc(r.key)}">
              <td>
                <span class="row" style="gap:10px;align-items:flex-start">
                  <span class="mat-ico">${r.material ? matIcon(r.material, 16) : icon("alert", 16)}</span>
                  <span class="ord-cell" style="min-width:0">
                    <b>${esc(r.name)}</b>
                    <span class="${r.material ? "mono" : ""}" ${r.material ? "" : `style="color:var(--orange)"`}>${
                      r.material ? esc(r.material.sku || "in the warehouse") : "not linked to stock"}</span>
                  </span>
                </span>
                <span class="dm-jobs">${r.lines.map(l =>
                  `<button class="tag-btn" data-dm-order="${l.order.id}" title="${esc(l.order.product)}">${esc(l.order.num)} · ${fmtQ(l.qty)} ${esc(r.unit)}</button>`).join("")}</span>
              </td>
              <td class="num"><b>${fmtQ(r.need)}</b> <small>${esc(r.unit)}</small></td>
              <td class="num">${r.stock === null ? `<span class="muted">—</span>`
                : `${fmtQ(r.stock)}${r.spot ? `<span class="dm-eta">on hand · one-off</span>` : ""}`}</td>
              <td class="num">${(() => {
                if (!r.material) return `<span class="muted">—</span>`;
                const d = D.onOrderDetail(r.material.id);
                if (!d.total) return `<span class="muted">—</span>`;
                return `${fmtQ(d.total)}
                  <span class="dm-eta ${d.late ? "late" : ""}">${
                    d.sent && d.expectedAt ? (d.late ? `overdue ${fmtDate(d.expectedAt)}` : fmtDate(d.expectedAt))
                    : d.sent ? "no date given"
                    : "draft — not sent"}</span>`;
              })()}</td>
              <td class="num">${(() => {
                if (r.short > 0) return `<span class="dm-gap">−${fmtQ(r.short)}</span>`;
                /* "covered" by a draft nobody sent is not covered. The draft
                   still counts against re-ordering, but it must not read green. */
                const d = r.material ? D.onOrderDetail(r.material.id) : null;
                const real = d ? r.need - (r.stock || 0) - d.sent : 0;
                return d && d.draft > 0 && real > 0
                  ? `<span class="dm-draft">draft only</span>`
                  : `<span class="dm-ok">${icon("check", 12)} covered</span>`;
              })()}</td>
              <td style="text-align:right;white-space:nowrap">
                ${canBuy ? `<button class="btn subtle" data-dm-fix="${esc(r.key)}" style="padding:5.5px 12px;font-size:12.5px">${
                  r.material ? "Edit" : `${icon("link", 12)} Link`}</button>` : ""}
              </td>
            </tr>`).join("")}
          </tbody>
        </table>` : `<div class="empty-state"><span class="big">${icon("check-circle", 40)}</span>
          <h3>Nothing is waiting on materials</h3>
          <p>Material lines on unfinished projects appear here, added up across every job.</p></div>`}
      </div>
    </div>`;
  },

  /* A supplier picker that can also add one. Typing a supplier's name into a
     dialog beats leaving, creating it, and coming back to start again. */
  supplierField(id, value) {
    return `${Picker.html(id, {
      value: value || "",
      placeholder: "Search suppliers…", empty: "— none —",
      actions: [{ value: "__new", label: "＋ Add a new supplier" }],
      options: D.suppliers().map(x => ({ value: x.id, label: x.name, sub: x.leadDays ? x.leadDays + " day lead" : (x.contact || "") })),
    })}
    <div class="sup-new" id="${id}-new" hidden>
      <input class="input" id="${id}-name" placeholder="Supplier name" autocomplete="off">
      <input class="input" id="${id}-lead" type="number" min="0" placeholder="lead days">
    </div>`;
  },
  bindSupplierField(id, root) {
    const sel = $("#" + id, root), box = $("#" + id + "-new", root);
    if (!sel || !box) return;
    const sync = () => { box.hidden = sel.value !== "__new"; };
    sel.addEventListener("change", sync); sync();
  },
  /* Called at save time: returns an id, creating the supplier if that is what
     was asked for, and reusing one that already has the name. */
  resolveSupplierField(id, root, byId) {
    const sel = $("#" + id, root);
    if (!sel) return null;
    if (sel.value !== "__new") return sel.value || null;
    const clean = String((($("#" + id + "-name", root) || {}).value) || "").trim();
    if (!clean) return null;
    const held = D.suppliers().find(x => x.name.trim().toLowerCase() === clean.toLowerCase());
    if (held) return held.id;
    const lead = (($("#" + id + "-lead", root) || {}).valueAsNumber);
    return M.addSupplier({ name: clean, leadDays: isNaN(lead) ? null : lead }, byId).id;
  },

  /* One row, and everything you can do about it: correct the name the
     designer typed, point it at real stock (or make stock out of it), and see
     exactly which jobs are waiting and for how much. */
  demandModal(key) {
    const r = D.demandRow(key);
    if (!r) return;
    const mats = [...Store.state.materials].sort((a, b) => a.name.localeCompare(b.name));
    const suggestion = r.material ? null : D.matchMaterial(r.name);
    const fmtQ = (n) => (Math.round(n * 100) / 100).toLocaleString("lt-LT");

    Modal.open(`
      <header>
        <span class="mat-ico" style="width:38px;height:38px">${r.material ? matIcon(r.material, 19) : icon("alert", 19)}</span>
        <h2 style="margin-left:2px">${esc(r.name)}</h2>
        <button class="icon-btn" data-close>${icon("x", 15)}</button>
      </header>
      <div class="modal-body">
        <div class="qty-hero">
          <span class="n ${r.short > 0 ? "low" : ""} t-num">${fmtQ(r.need)}</span>
          <span class="meta"><b>${esc(r.unit)} needed by ${r.lines.length} job${r.lines.length === 1 ? "" : "s"}</b>
            <span>${r.stock === null ? "nothing on the shelf — not linked to stock yet"
              : `${fmtQ(r.stock)} in stock${r.onOrder ? ` · ${fmtQ(r.onOrder)} on order` : ""}`}</span></span>
          ${r.short > 0 ? `<span class="low-badge" style="font-size:12px;padding:5px 10px">${fmtQ(r.short)} short</span>` : ""}
        </div>

        <div class="field"><label>Name the jobs are asking for</label>
          <input class="input" id="dm-name" value="${esc(r.name)}" ${r.material ? "disabled" : ""}>
          <span class="t-caption">${r.material
            ? "Linked to stock, so the warehouse owns the name — change it on the material itself."
            : `Renaming applies to all ${r.lines.length} job${r.lines.length === 1 ? "" : "s"} below.`}</span></div>

        ${r.material ? "" : `<div class="field"><label>Do you already have some?</label>
          <div class="row" style="gap:8px;align-items:center">
            <input class="input" id="dm-have" type="number" min="0" step="any" style="max-width:140px"
              value="${r.spot ? r.stock : ""}" placeholder="none">
            <span class="t-caption">${esc(r.unit)} on hand</span>
            ${r.spot ? `<button class="btn ghost" id="dm-have-clear" type="button">Forget it</button>` : ""}
          </div>
          <span class="t-caption">For a one-off — counted against these jobs without becoming a warehouse item.</span></div>`}

        <div class="field"><label>Stock item</label>
          ${Picker.html("dm-link", {
            value: r.material ? r.material.id : "",
            placeholder: `Search ${mats.length} stock items…`,
            empty: "— not in the warehouse —",
            actions: [{ value: "__new", label: "＋ Create a stock item from this name" }],
            options: mats.map(m => ({ value: m.id, label: m.name, sub: m.sku || "" })),
          })}
          ${suggestion ? `<span class="t-caption">Closest match in the warehouse: <b>${esc(suggestion.name)}</b>
            — <button class="link" id="dm-suggest" type="button">use it</button></span>` : ""}</div>

        <div id="dm-new" hidden>
          <div class="form-row">
            <div class="field"><label>SKU</label>
              <input class="input" id="dm-sku" value="${esc(D.suggestSku(r.name))}" placeholder="e.g. KNF-540">
              <span class="t-caption">Suggested from the name — change it if your codes read differently.</span></div>
            <div class="field" style="max-width:110px"><label>Unit</label><input class="input" id="dm-unit" value="${esc(r.unit || "pcs")}"></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Already on the shelf</label><input class="input" id="dm-qty" type="number" min="0" step="any" value="0"></div>
            <div class="field"><label>Min stock</label><input class="input" id="dm-min" type="number" min="0" step="any" value="0"></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Supplier</label>${this.supplierField("dm-sup")}</div>
          </div>
        </div>

        ${(() => {
          const d = r.material ? D.onOrderDetail(r.material.id) : null;
          if (!d || !d.total) return "";
          return `<div class="dm-onway ${d.late ? "late" : ""}">
            <span>${icon("truck", 17)}</span>
            <span class="grow"><b>${fmtQ(d.total)} ${esc(r.unit)} on the way</b>
              <span>${d.sent && d.expectedAt
                ? (d.late ? `was expected ${fmtDate(d.expectedAt)} — chase it` : `expected ${fmtDate(d.expectedAt)}`)
                : d.sent ? "ordered, no delivery date given"
                : "still a draft — nobody has sent it"}${d.count > 1 ? ` · ${d.count} orders` : ""}</span></span>
          </div>`;
        })()}

        <details class="sw-cols" id="dm-order" ${r.short > 0 ? "open" : ""}>
          <summary>Mark it as ordered${r.short > 0 ? ` — ${fmtQ(r.short)} ${esc(r.unit)} still missing` : ""}</summary>
          <div class="sw-cols-body">
            <div class="form-row">
              <div class="field" style="max-width:130px"><label>How much</label>
                <input class="input" id="dm-oqty" type="number" min="0" step="any" value="${r.short > 0 ? Math.round(r.short * 100) / 100 : ""}"></div>
              <div class="field" style="max-width:170px"><label>Expected</label>
                <input class="input" id="dm-oeta" type="date"></div>
              <div class="field"><label>Supplier</label>
                ${this.supplierField("dm-osup", (r.material && r.material.supplierId) || "")}</div>
            </div>
            <button class="btn" id="dm-order-go">${icon("truck", 13)} Record the order</button>
            <span class="t-caption" style="display:block;margin-top:6px">${r.material
              ? "Creates a purchase order so the delivery shows up in the warehouse."
              : "Creates the stock item first, then the purchase order."}</span>
          </div>
        </details>

        <div>
          <div class="t-label" style="margin-bottom:4px">Which jobs need it</div>
          <div class="sw-table">
            ${r.lines.map(l => `<div class="sw-row">
              <span class="grow"><b>${esc(l.order.num)} · ${esc(l.order.product)}</b>
                <span>${l.order.client ? esc(l.order.client) + " · " : ""}due ${fmtDate(l.order.due)}</span></span>
              <span class="qty-pill">${fmtQ(l.qty)} ${esc(r.unit)}</span>
              <button class="btn subtle" data-dm-goto="${l.order.id}" style="padding:5px 11px;font-size:12.5px">Open</button>
            </div>`).join("")}
          </div>
        </div>
      </div>
      <footer>
        <div class="grow"></div>
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="dm-save">Save</button>
      </footer>
    `, (m) => {
      Picker.bind(m);
      this.bindSupplierField("dm-sup", m);
      this.bindSupplierField("dm-osup", m);

      /* one-off stock: recorded against the name, saved as you leave the field
         so it is not lost by closing the dialog another way */
      const have = $("#dm-have", m);
      if (have) {
        const apply = () => {
          const v = have.value.trim();
          M.setSpotStock(key, v === "" ? null : have.valueAsNumber, "", App.me.id);
        };
        have.onchange = apply;
        const clear = $("#dm-have-clear", m);
        if (clear) clear.onclick = () => { M.setSpotStock(key, null, "", App.me.id); Modal.close(); App.render(); };
      }

      const sel = $("#dm-link", m), box = $("#dm-new", m);
      const sync = () => { box.hidden = sel.value !== "__new"; };
      sel.onchange = sync; sync();
      const sug = $("#dm-suggest", m);
      if (sug) sug.onclick = () => {
        sel.value = suggestion.id;
        $(".picker-input", sel.closest(".picker")).value = suggestion.name;
        sync();
      };
      $$("[data-dm-goto]", m).forEach(b => b.onclick = () => { Modal.close(); Drawer.open(b.dataset.dmGoto); });

      $("#dm-order-go", m).onclick = () => {
        const nameEl = $("#dm-name", m);
        if (nameEl && !nameEl.disabled) M.renameDemandMaterial(key, nameEl.value, App.me.id);
        const freshKey = r.material ? key : "name:" + D._stName((nameEl && nameEl.value.trim()) || r.name);
        const eta = $("#dm-oeta", m).value;
        const po = M.markDemandOrdered(freshKey, {
          qty: $("#dm-oqty", m).valueAsNumber,
          supplierId: this.resolveSupplierField("dm-osup", m, App.me.id),
          expectedAt: eta ? new Date(eta + "T12:00:00").getTime() : null,
          sku: $("#dm-sku", m) ? $("#dm-sku", m).value.trim() : "",
          unit: r.unit,
        }, App.me.id);
        Modal.close(); App.render();
        Toast.show(po
          ? `${po.num} recorded${eta ? ` — expected ${fmtDate(new Date(eta + "T12:00:00").getTime())}` : ""}`
          : "Nothing to order — set a quantity", { emoji: po ? "truck" : "info", ms: 4500 });
      };

      $("#dm-save", m).onclick = () => {
        if (have) { const v = have.value.trim(); M.setSpotStock(key, v === "" ? null : have.valueAsNumber, "", App.me.id); }
        const nameEl = $("#dm-name", m);
        if (nameEl && !nameEl.disabled) M.renameDemandMaterial(key, nameEl.value, App.me.id);
        // renaming changes the row's key, so find it again before linking
        const freshKey = r.material ? key : "name:" + D._stName((nameEl && nameEl.value.trim()) || r.name);
        if (sel.value === "__new") {
          M.stockFromDemand(freshKey, {
            sku: $("#dm-sku", m).value.trim(),
            unit: $("#dm-unit", m).value.trim() || r.unit,
            qty: $("#dm-qty", m).valueAsNumber || 0,
            minQty: $("#dm-min", m).valueAsNumber || 0,
            supplierId: this.resolveSupplierField("dm-sup", m, App.me.id),
          }, App.me.id);
          Toast.show(`${$("#dm-name", m) ? $("#dm-name", m).value.trim() : r.name} is now a stock item`, { emoji: "box" });
        } else if (sel.value !== (r.material ? r.material.id : "")) {
          M.linkDemandMaterial(freshKey, sel.value || null, App.me.id);
          Toast.show(sel.value ? "Linked to stock" : "Unlinked", { emoji: "check" });
        }
        Modal.close(); App.render();
      };
    });
  },

  purchasesView() {
    const list = D.purchases();
    const groups = D.reorderBySupplier();
    const need = groups.reduce((n, g) => n + g.lines.length, 0);
    const orphan = groups.filter(g => !g.supplier).reduce((n, g) => n + g.lines.length, 0);
    const canEdit = App.can("warehouse.edit");

    return `<div>
      ${need ? `<div class="reorder-nag">
        <span style="color:var(--orange)">${icon("trend-down", 20)}</span>
        <span class="grow"><b>${need} material${need === 1 ? " is" : "s are"} at or below the minimum</b>
          <span>${orphan
            ? `${orphan} of them ${orphan === 1 ? "has" : "have"} no supplier yet — set one on the material to include ${orphan === 1 ? "it" : "them"}.`
            : "Drafting groups them into one order per supplier. Nothing is sent until you say so."}</span></span>
        ${canEdit && need > orphan ? `<button class="btn" id="po-draft-all">${icon("plus", 13)} Draft orders</button>` : ""}
      </div>` : ""}
      <div class="toolbar">
        <span class="t-caption">${list.length} order${list.length === 1 ? "" : "s"} · ${D.openPurchases().length} still open</span>
        <div class="grow"></div>
        ${canEdit ? `<button class="btn primary" id="po-add">${icon("plus", 13)} New purchase order</button>` : ""}
      </div>
      <div class="table-card">
        ${list.length ? `<table class="orders">
          <thead><tr><th>Order</th><th>Supplier</th><th>Items</th><th>Expected</th><th>Status</th></tr></thead>
          <tbody>
            ${list.map(po => {
              const sup = D.supplier(po.supplierId);
              const out = D.poOutstanding(po);
              const late = po.status === "sent" && po.expectedAt && po.expectedAt < Date.now();
              return `<tr data-po="${po.id}">
                <td class="ord-cell"><b>${esc(po.num)}</b><span class="mono">${fmtDate(po.createdAt)}</span></td>
                <td>${sup ? esc(sup.name) : `<span class="muted">no supplier</span>`}</td>
                <td><span class="t-caption">${po.lines.length} line${po.lines.length === 1 ? "" : "s"}${out && po.status === "sent" ? ` · ${out} still to come` : ""}</span></td>
                <td>${po.expectedAt
                  ? `<span class="t-caption" ${late ? `style="color:var(--red)"` : ""}>${fmtDate(po.expectedAt)}${late ? " · overdue" : ""}</span>`
                  : `<span class="muted">—</span>`}</td>
                <td>${this.poPill(po)}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>` : `<div class="empty-state"><span class="big">${icon("truck", 40)}</span><h3>No purchase orders yet</h3><p>Order materials from your suppliers and receive them straight onto the shelf.</p></div>`}
      </div>
    </div>`;
  },

  suppliersView() {
    const list = D.suppliers();
    const canEdit = App.can("warehouse.edit");
    return `<div>
      <div class="toolbar">
        <span class="t-caption">Who you buy from, and how long they take</span>
        <div class="grow"></div>
        ${canEdit ? `<button class="btn primary" id="sup-add">${icon("plus", 13)} Add supplier</button>` : ""}
      </div>
      ${list.length ? `<div class="sup-grid">
        ${list.map(sup => {
          const mats = Store.state.materials.filter(m => m.supplierId === sup.id);
          const open = D.openPurchases().filter(p => p.supplierId === sup.id).length;
          return `<button class="sup-card" data-sup="${sup.id}">
            <div class="sup-head"><b>${esc(sup.name)}</b>${open ? `<span class="count-badge">${open} open</span>` : ""}</div>
            ${sup.contact ? `<span class="t-caption">${esc(sup.contact)}</span>` : ""}
            ${sup.email ? `<span class="t-caption mono">${esc(sup.email)}</span>` : ""}
            ${sup.phone ? `<span class="t-caption mono">${esc(sup.phone)}</span>` : ""}
            <div class="sup-foot">
              <span class="t-caption">${mats.length} material${mats.length === 1 ? "" : "s"}</span>
              ${sup.leadDays ? `<span class="t-caption">${icon("clock", 12)} ${sup.leadDays} day lead</span>` : ""}
            </div>
          </button>`;
        }).join("")}
      </div>` : `<div class="table-card"><div class="empty-state"><span class="big">${icon("handshake", 40)}</span><h3>No suppliers yet</h3><p>Add the places you buy from, then link them to your materials to order in one click.</p></div></div>`}
    </div>`;
  },

  articlesView() {
    const s = Store.state;
    return `<div>
      <div class="toolbar">
        <span class="t-caption">Standard products — ordering an article auto-creates its routing tasks per part group (facades, carcass…)</span>
        <div class="grow"></div>
        ${App.can("warehouse.edit") ? `<button class="btn primary" id="art-add">${icon("plus", 13)} New article</button>` : ""}
      </div>
      <div class="table-card">
        ${s.articles.length ? `<table class="orders">
          <thead><tr><th>Article</th><th>Unit</th><th>Part groups</th><th>Steps</th><th>Time / unit</th></tr></thead>
          <tbody>
            ${s.articles.map(a => {
              const groups = a.lanes.filter(l => l.group);
              const steps = a.lanes.reduce((n, l) => n + l.route.length, 0);
              const mins = a.lanes.reduce((n, l) => n + l.route.reduce((x, r) => x + r.mpu, 0), 0);
              return `<tr data-article="${a.id}">
                <td class="ord-cell"><b>${esc(a.name)}</b><span class="mono">${esc(a.sku)}</span></td>
                <td><span class="t-caption">${esc(a.unit)}</span></td>
                <td>${groups.length ? groups.map(l => `<span class="task-tag" style="margin-right:4px">${esc(l.group)}</span>`).join("") + `<span class="task-tag" style="background:var(--gray-soft);color:var(--text-2)">Final</span>` : `<span class="muted t-caption">single lane</span>`}</td>
                <td><span class="t-num" style="font-weight:650">${steps}</span></td>
                <td><span class="t-caption t-num">${fmtDur(mins * 60000)}</span></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>` : `<div class="empty-state"><span class="big">${icon("box", 40)}</span><h3>No articles yet</h3><p>Define your standard products to order them in one click.</p></div>`}
      </div>
    </div>`;
  },

  materialsView() {
    const s = Store.state;
    const q = this.search.trim().toLowerCase();
    let list = [...s.materials];
    if (this.filter === "low") list = list.filter(m => m.qty <= m.minQty);
    if (q) list = list.filter(m => m.name.toLowerCase().includes(q) || m.sku.toLowerCase().includes(q) || (m.location || "").toLowerCase().includes(q));
    list.sort((a, b) => (a.qty <= a.minQty ? 0 : 1) - (b.qty <= b.minQty ? 0 : 1) || a.name.localeCompare(b.name));
    const low = D.lowStock().length;

    return `<div>
      <div class="toolbar">
        <div class="filter-chips">
          <button class="fchip ${this.filter === "all" ? "active" : ""}" data-wf="all">All items</button>
          <button class="fchip ${this.filter === "low" ? "active" : ""}" data-wf="low">${icon("trend-down", 12)} Low stock${low ? ` · ${low}` : ""}</button>
        </div>
        <div class="grow"></div>
        <div class="search-box" style="min-width:230px">${icon("search", 14)}<input id="mat-search" placeholder="Search materials…" value="${esc(this.search)}"></div>
        ${App.can("warehouse.edit") ? `<button class="btn primary" id="mat-add">${icon("plus", 13)} Add material</button>` : ""}
      </div>
      <div class="table-card">
        ${list.length ? `<table class="orders">
          <thead><tr><th>Material</th><th>In stock</th><th>Min</th><th>Location</th><th>Last movement</th><th></th></tr></thead>
          <tbody>
            ${list.map(m => {
              const isLow = m.qty <= m.minQty;
              const onOrder = D.onOrder(m.id);
              const lm = D.lastMove(m.id);
              return `<tr data-mat="${m.id}">
                <td><span class="row" style="gap:11px"><span class="mat-ico">${matIcon(m, 17)}</span><span class="ord-cell"><b>${esc(m.name)}</b><span class="mono">${esc(m.sku)}</span></span></span></td>
                <td><span class="stock-qty ${isLow ? "low" : ""}">${m.qty} <small>${esc(m.unit)}</small> ${isLow ? `<span class="low-badge">Low</span>` : ""}</span>
                  ${onOrder ? `<span class="on-order-badge">＋${onOrder} on order</span>` : ""}</td>
                <td><span class="t-caption t-num">${m.minQty} ${esc(m.unit)}</span></td>
                <td>${m.location ? `<span class="loc-chip">${esc(m.location)}</span>` : `<span class="muted">—</span>`}</td>
                <td>${lm ? `<span class="t-caption">${lm.delta > 0 ? "＋" : "−"}${Math.abs(lm.delta)} · ${esc(lm.note || "")} · ${fmtAgo(lm.ts)}</span>` : `<span class="muted t-caption">—</span>`}</td>
                <td style="text-align:right;white-space:nowrap">
                  ${App.can("warehouse.edit") ? `<button class="btn subtle" data-receive="${m.id}" style="padding:5.5px 12px;font-size:12.5px">${icon("plus", 12)} Receive</button>` : ""}
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>` : `<div class="empty-state"><span class="big">${icon("warehouse", 40)}</span><h3>No materials</h3><p>Add your stock items to track them here.</p></div>`}
      </div>
    </div>`;
  },

  /* A purchase order: edit while it is a draft, receive once it is out */
  poModal(poId) {
    const po = D.purchase(poId); if (!po) return;
    const canEdit = App.can("warehouse.edit");
    const draft = po.status === "draft";
    const open = po.status === "sent";
    const sup = D.supplier(po.supplierId);
    const free = Store.state.materials.filter(m => !po.lines.some(l => l.materialId === m.id));
    const dateVal = (ts) => ts ? new Date(ts - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) : "";

    Modal.open(`
      <header>
        <h2>${esc(po.num)}</h2>
        ${this.poPill(po)}
        <button class="icon-btn" data-close>${icon("x", 15)}</button>
      </header>
      <div class="modal-body">
        <div class="form-row">
          <div class="field"><label>Supplier</label>
            ${draft && canEdit ? `<select class="select" id="po-sup">
              <option value="">— none —</option>
              ${D.suppliers().map(x => `<option value="${x.id}" ${x.id === po.supplierId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}
            </select>` : `<div class="readout">${sup ? esc(sup.name) : "—"}</div>`}
          </div>
          <div class="field"><label>Expected${sup && sup.leadDays && draft ? ` (lead ${sup.leadDays}d)` : ""}</label>
            ${po.status !== "received" && canEdit
              ? `<input class="input" id="po-exp" type="date" value="${dateVal(po.expectedAt)}">`
              : `<div class="readout">${po.expectedAt ? fmtDate(po.expectedAt) : "—"}</div>`}
          </div>
        </div>

        <div class="t-label" style="margin-bottom:4px">Items</div>
        <div class="po-lines">
          ${po.lines.length ? po.lines.map(l => {
            const m = D.material(l.materialId);
            const out = D.poLineOutstanding(l);
            return `<div class="po-line">
              <span class="mat-ico">${m ? matIcon(m, 16) : icon("box", 16)}</span>
              <span class="grow"><b>${esc(m ? m.name : "removed material")}</b>
                <span class="t-caption">${m ? `${m.qty} ${esc(m.unit)} in stock · min ${m.minQty}` : ""}</span></span>
              ${draft && canEdit
                ? `<input class="input po-qty" data-po-qty="${l.materialId}" type="number" min="0" step="any" value="${l.qty}">
                   <button class="mini-btn danger" data-po-rm="${l.materialId}" title="Remove">${icon("x", 12)}</button>`
                : `<span class="t-num t-caption">${l.qty}${m ? " " + esc(m.unit) : ""} ordered${l.received ? ` · ${l.received} received` : ""}</span>`}
              ${open && canEdit ? `<label class="po-recv"><span>Arriving now</span>
                <input class="input po-qty" data-po-recv="${l.id}" type="number" min="0" max="${out}" step="any" value="${out}"></label>` : ""}
            </div>`;
          }).join("") : `<span class="t-caption">Nothing on this order yet.</span>`}
        </div>
        ${draft && canEdit && free.length ? `<div class="po-add-row">
          ${Picker.html("po-newmat", {
            value: "", placeholder: `Search ${free.length} materials…`,
            options: free.map(m => ({ value: m.id, label: m.name, sub: `${m.sku ? m.sku + " · " : ""}${m.qty} ${m.unit} in stock` })),
          })}
          <input class="input" id="po-newqty" type="number" min="0" step="any" placeholder="Qty">
          <button class="btn" id="po-addline">${icon("plus", 12)} Add</button>
        </div>` : ""}

        <div class="field"><label>Notes</label>
          <textarea class="input" id="po-notes" rows="2" ${canEdit && po.status !== "received" ? "" : "disabled"}>${esc(po.notes || "")}</textarea></div>
      </div>
      <footer>
        ${draft && canEdit ? `<button class="btn danger ghost" id="po-del">Delete draft</button>` : ""}
        ${open && canEdit ? `<button class="btn danger ghost" id="po-cancel">Cancel order</button>` : ""}
        <div class="grow"></div>
        <button class="btn ghost" data-close>Close</button>
        ${draft && canEdit ? `<button class="btn primary" id="po-send" ${po.lines.length ? "" : "disabled"}>Mark as ordered</button>` : ""}
        ${open && canEdit ? `<button class="btn green" id="po-recv">Receive delivery</button>` : ""}
      </footer>
    `, (modal) => {
      Picker.bind(modal);
      $$("[data-close]", modal).forEach(b => b.onclick = () => Modal.close());
      const save = () => {
        const patch = {};
        const sel = $("#po-sup", modal); if (sel) patch.supplierId = sel.value || null;
        const exp = $("#po-exp", modal);
        if (exp) patch.expectedAt = exp.value ? new Date(exp.value + "T12:00").getTime() : null;
        const nts = $("#po-notes", modal); if (nts && !nts.disabled) patch.notes = nts.value.trim();
        M.updatePurchase(po.id, patch, App.me.id);
      };
      $$("[data-po-qty]", modal).forEach(inp => inp.onchange = () => {
        M.setPurchaseLine(po.id, inp.dataset.poQty, Math.max(0, parseFloat(inp.value) || 0), App.me.id);
        App.render();
      });
      $$("[data-po-rm]", modal).forEach(b => b.onclick = () => {
        save();
        M.setPurchaseLine(po.id, b.dataset.poRm, 0, App.me.id);
        App.render(); this.poModal(po.id);
      });
      const addLine = $("#po-addline", modal);
      if (addLine) addLine.onclick = () => {
        const q = parseFloat($("#po-newqty", modal).value);
        if (!q || q <= 0) { $("#po-newqty", modal).focus(); return; }
        save();
        M.setPurchaseLine(po.id, $("#po-newmat", modal).value, q, App.me.id);
        App.render(); this.poModal(po.id);
      };
      const send = $("#po-send", modal);
      if (send) send.onclick = () => {
        save();
        M.sendPurchase(po.id, App.me.id);
        Modal.close(); App.render();
        Toast.show(`${po.num} marked as ordered`, { emoji: "truck" });
      };
      const recv = $("#po-recv", modal);
      if (recv) recv.onclick = () => {
        save();
        const receipts = {};
        $$("[data-po-recv]", modal).forEach(inp => { receipts[inp.dataset.poRecv] = parseFloat(inp.value) || 0; });
        if (!M.receivePurchase(po.id, receipts, App.me.id)) { Toast.show("Nothing to receive — set a quantity above zero", { emoji: "info" }); return; }
        const after = D.purchase(po.id);
        Modal.close(); App.render();
        Toast.show(after.status === "received" ? `${po.num} received in full` : `Part of ${po.num} received — the rest stays on order`, { emoji: "box" });
      };
      const cancel = $("#po-cancel", modal);
      if (cancel) cancel.onclick = () => {
        if (!confirm(`Cancel ${po.num}? It stays on the list as a record.`)) return;
        M.cancelPurchase(po.id, App.me.id); Modal.close(); App.render();
      };
      const del = $("#po-del", modal);
      if (del) del.onclick = () => {
        if (!confirm(`Delete draft ${po.num}?`)) return;
        M.deletePurchase(po.id, App.me.id); Modal.close(); App.render();
      };
      // there is no close hook on Modal, so the header fields save as they change
      ["#po-sup", "#po-exp", "#po-notes"].forEach(sel => {
        const el = $(sel, modal);
        if (el && !el.disabled) el.onchange = save;
      });
    });
  },

  supplierModal(supId) {
    const sup = supId ? D.supplier(supId) : null;
    const mats = sup ? Store.state.materials.filter(m => m.supplierId === sup.id) : [];
    const locked = sup && D.supplierUsed(sup.id);
    Modal.open(`
      <header><h2>${sup ? esc(sup.name) : "New supplier"}</h2><button class="icon-btn" data-close>${icon("x", 15)}</button></header>
      <div class="modal-body">
        <div class="form-row">
          <div class="field"><label>Name</label><input class="input" id="sup-name" value="${esc(sup?.name || "")}" placeholder="e.g. Medienos centras"></div>
          <div class="field"><label>Contact person</label><input class="input" id="sup-contact" value="${esc(sup?.contact || "")}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Email</label><input class="input" id="sup-email" type="email" value="${esc(sup?.email || "")}"></div>
          <div class="field"><label>Phone</label><input class="input" id="sup-phone" value="${esc(sup?.phone || "")}"></div>
        </div>
        <div class="field" style="max-width:220px"><label>Typical lead time (days)</label>
          <input class="input" id="sup-lead" type="number" min="0" value="${sup?.leadDays ?? ""}" placeholder="e.g. 5"></div>
        <div class="field"><label>Notes</label><textarea class="input" id="sup-notes" rows="2">${esc(sup?.notes || "")}</textarea></div>
        ${sup ? `<div>
          <div class="t-label" style="margin-bottom:4px">Materials from this supplier</div>
          ${mats.length ? mats.map(m => `<div class="movement-row"><span class="note">${esc(m.name)}</span><span class="when">${m.qty} ${esc(m.unit)}</span></div>`).join("")
            : `<span class="t-caption">None yet — pick this supplier on a material to link it.</span>`}
        </div>` : ""}
        ${sup ? `<button class="btn danger" id="sup-del" style="align-self:flex-start" ${locked ? "disabled title='There is still an open order with this supplier'" : ""}>Delete supplier</button>` : ""}
      </div>
      <footer>
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="sup-save">${sup ? "Save supplier" : "Add supplier"}</button>
      </footer>
    `, (modal) => {
      $$("[data-close]", modal).forEach(b => b.onclick = () => Modal.close());
      $("#sup-save", modal).onclick = () => {
        const name = $("#sup-name", modal).value.trim();
        if (!name) { $("#sup-name", modal).focus(); return; }
        const patch = {
          name, contact: $("#sup-contact", modal).value.trim(),
          email: $("#sup-email", modal).value.trim(), phone: $("#sup-phone", modal).value.trim(),
          leadDays: parseInt($("#sup-lead", modal).value) || null,
          notes: $("#sup-notes", modal).value.trim(),
        };
        sup ? M.updateSupplier(sup.id, patch, App.me.id) : M.addSupplier(patch, App.me.id);
        Modal.close(); App.render();
      };
      const del = $("#sup-del", modal);
      if (del && !locked) del.onclick = () => {
        if (!confirm(`Delete ${sup.name}? Materials keep their stock but lose the link.`)) return;
        M.deleteSupplier(sup.id, App.me.id); Modal.close(); App.render();
      };
    });
  },

  bind(root) {
    $$("[data-wtab]", root).forEach(b => b.onclick = () => { this.tab = b.dataset.wtab; App.render(); });
    $$("[data-wf]", root).forEach(b => b.onclick = () => { this.filter = b.dataset.wf; App.render(); });
    const search = $("#mat-search", root);
    if (search) search.oninput = () => {
      this.search = search.value;
      const pos = search.selectionStart;
      App.render();
      const s2 = $("#mat-search");
      if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); }
    };
    const matAdd = $("#mat-add", root);
    if (matAdd) matAdd.onclick = () => this.addModal();
    if (App.can("warehouse.edit"))
      $$("tr[data-mat]", root).forEach(tr => tr.onclick = () => this.materialModal(tr.dataset.mat));
    $$("[data-receive]", root).forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      this.materialModal(b.dataset.receive, true);
    });
    const artAdd = $("#art-add", root);
    if (artAdd) artAdd.onclick = () => this.articleModal();

    /* demand */
    $$("[data-dm-order]", root).forEach(b => b.onclick = (e) => {
      e.stopPropagation(); Drawer.open(b.dataset.dmOrder);
    });
    if (App.can("warehouse.edit")) {
      $$("[data-dm-fix]", root).forEach(b => b.onclick = (e) => {
        e.stopPropagation(); this.demandModal(b.dataset.dmFix);
      });
      $$("tr[data-dm]", root).forEach(tr => tr.onclick = () => this.demandModal(tr.dataset.dm));
    }
    const dmDraft = $("#dm-draft", root);
    if (dmDraft) dmDraft.onclick = () => {
      const { created, skipped } = M.draftFromDemand(App.me.id);
      this.tab = "purchases"; App.render();
      Toast.show(created.length
        ? `${created.length} draft order${created.length === 1 ? "" : "s"} for the shortfall${skipped ? ` · ${skipped} material${skipped === 1 ? "" : "s"} skipped, no supplier` : ""}`
        : "Nothing to draft — the short materials have no supplier yet", { emoji: "truck", ms: 5000 });
    };

    /* purchasing */
    $$("tr[data-po]", root).forEach(tr => tr.onclick = () => this.poModal(tr.dataset.po));
    $$("[data-sup]", root).forEach(b => b.onclick = () => this.supplierModal(b.dataset.sup));
    const supAdd = $("#sup-add", root);
    if (supAdd) supAdd.onclick = () => this.supplierModal();
    const poAdd = $("#po-add", root);
    if (poAdd) poAdd.onclick = () => {
      const po = M.createPurchase({ supplierId: D.suppliers()[0]?.id || null, lines: [] }, App.me.id);
      App.render(); this.poModal(po.id);
    };
    const draftAll = $("#po-draft-all", root);
    if (draftAll) draftAll.onclick = () => {
      const { created, skipped } = M.draftReorder(App.me.id);
      App.render();
      if (!created.length) { Toast.show("Nothing to draft — every low material still needs a supplier", { emoji: "info" }); return; }
      Toast.show(`${created.length} draft order${created.length === 1 ? "" : "s"} ready to review${skipped ? ` · ${skipped} material${skipped === 1 ? "" : "s"} skipped, no supplier` : ""}`,
        { emoji: "truck", ms: 5000 });
      if (created.length === 1) this.poModal(created[0].id);
    };
    if (App.can("warehouse.edit"))
      $$("tr[data-article]", root).forEach(tr => tr.onclick = () => this.articleModal(tr.dataset.article));
  },

  /* ---------- Article editor (lanes + routes) ---------- */
  articleModal(articleId) {
    const a = articleId ? D.article(articleId) : null;
    // working copy of lanes
    const lanes = a ? JSON.parse(JSON.stringify(a.lanes)) : [
      { group: "Facades", route: [{ stationId: "cut", mpu: 6 }, { stationId: "edge", mpu: 5 }] },
      { group: "Carcass", route: [{ stationId: "cut", mpu: 8 }, { stationId: "edge", mpu: 6 }] },
      { group: null, route: [{ stationId: "asm", mpu: 15 }, { stationId: "pack", mpu: 5 }] },
    ];
    const prodStations = () => D.stationsOf("prod");
    const lanesHtml = () => lanes.map((lane, li) => `
      <div class="lane-edit" data-lane="${li}">
        <div class="lh">
          ${lane.group === null
            ? `<b style="font-size:12.5px">🔗 Final lane <span class="t-caption">(after all part groups)</span></b>`
            : `<input class="input" data-lane-name="${li}" value="${esc(lane.group)}" placeholder="Part group, e.g. Facades" style="padding:6px 10px;font-size:13px;font-weight:620">`}
          <span class="grow"></span>
          ${lane.group !== null ? `<button class="mini-btn danger" data-lane-del="${li}" title="Remove lane">✕</button>` : ""}
        </div>
        ${lane.route.map((r, ri) => `
          <div class="lane-step">
            <select class="select" data-step-st="${li}/${ri}">
              ${prodStations().map(st => `<option value="${st.id}" ${r.stationId === st.id ? "selected" : ""}>${esc(st.name)}</option>`).join("")}
            </select>
            <input class="input" data-step-mpu="${li}/${ri}" type="number" min="1" value="${r.mpu}">
            <span class="t-caption">min/unit</span>
            <button class="mini-btn danger" data-step-del="${li}/${ri}">✕</button>
          </div>`).join("")}
        <button class="add-inline" data-step-add="${li}">＋ Add step</button>
      </div>`).join("");

    Modal.open(`
      <header><h2>${a ? "Edit article" : "New article"}</h2><button class="icon-btn" data-close>✕</button></header>
      <div class="modal-body">
        <div class="form-row">
          <div class="field"><label>Name</label><input class="input" id="art-name" value="${esc(a?.name || "")}" placeholder="e.g. Base cabinet 600"></div>
          <div class="field"><label>SKU</label><input class="input" id="art-sku" value="${esc(a?.sku || "")}" placeholder="e.g. BC-600"></div>
        </div>
        <div class="field" style="max-width:140px"><label>Unit</label><input class="input" id="art-unit" value="${esc(a?.unit || "pcs")}"></div>
        <div class="field"><label>Routing lanes — part groups made in parallel, then the final lane</label>
          <div id="art-lanes">${lanesHtml()}</div>
          <button class="add-inline" id="art-add-lane" style="align-self:flex-start">＋ Add part group</button>
        </div>
        ${a ? `<button class="btn danger" id="art-del" style="align-self:flex-start">Delete article</button>` : ""}
      </div>
      <footer>
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="art-save">${a ? "Save article" : "Create article"}</button>
      </footer>
    `, (modal) => {
      $$("[data-close]", modal).forEach(b => b.onclick = () => Modal.close());
      const rerenderLanes = () => {
        $("#art-lanes", modal).innerHTML = lanesHtml();
        bindLanes();
      };
      const syncInputs = () => {
        $$("[data-lane-name]", modal).forEach(inp => { lanes[+inp.dataset.laneName].group = inp.value.trim() || "Group"; });
        $$("[data-step-st]", modal).forEach(sel => { const [li, ri] = sel.dataset.stepSt.split("/"); lanes[+li].route[+ri].stationId = sel.value; });
        $$("[data-step-mpu]", modal).forEach(inp => { const [li, ri] = inp.dataset.stepMpu.split("/"); lanes[+li].route[+ri].mpu = Math.max(1, parseInt(inp.value) || 1); });
      };
      const bindLanes = () => {
        $$("[data-step-add]", modal).forEach(b => b.onclick = () => {
          syncInputs();
          lanes[+b.dataset.stepAdd].route.push({ stationId: prodStations()[0].id, mpu: 10 });
          rerenderLanes();
        });
        $$("[data-step-del]", modal).forEach(b => b.onclick = () => {
          syncInputs();
          const [li, ri] = b.dataset.stepDel.split("/");
          lanes[+li].route.splice(+ri, 1);
          rerenderLanes();
        });
        $$("[data-lane-del]", modal).forEach(b => b.onclick = () => {
          syncInputs();
          lanes.splice(+b.dataset.laneDel, 1);
          rerenderLanes();
        });
      };
      bindLanes();
      $("#art-add-lane", modal).onclick = () => {
        syncInputs();
        const finalIdx = lanes.findIndex(l => l.group === null);
        const newLane = { group: "New group", route: [{ stationId: "cut", mpu: 10 }] };
        if (finalIdx >= 0) lanes.splice(finalIdx, 0, newLane); else lanes.push(newLane);
        rerenderLanes();
      };
      $("#art-save", modal).onclick = () => {
        const name = $("#art-name", modal).value.trim();
        if (!name) { $("#art-name", modal).focus(); return; }
        syncInputs();
        const cleaned = lanes.filter(l => l.route.length);
        if (!cleaned.length) { Toast.show("Add at least one routing step", { emoji: "⚠️" }); return; }
        const payload = {
          name, sku: $("#art-sku", modal).value.trim() || name.slice(0, 6).toUpperCase(),
          unit: $("#art-unit", modal).value.trim() || "pcs", lanes: cleaned,
        };
        if (a) M.updateArticle(a.id, payload, App.me.id);
        else M.addArticle(payload, App.me.id);
        Modal.close(); App.render();
        Toast.show(a ? "Article updated" : `Article “${name}” created`, { emoji: "📦" });
      };
      const del = $("#art-del", modal);
      if (del) del.onclick = () => {
        M.deleteArticle(a.id, App.me.id);
        Modal.close(); App.render();
        Toast.show("Article deleted — existing orders keep their routing", { emoji: "🗑" });
      };
    });
  },

  materialModal(matId, focusReceive) {
    const m = D.material(matId);
    if (!m) return;
    const isLow = m.qty <= m.minQty;
    const moves = D.materialMoves(matId).slice(0, 10);
    Modal.open(`
      <header>
        <span class="mat-ico" style="width:42px;height:42px">${matIcon(m, 21)}</span>
        <h2 style="margin-left:2px">${esc(m.name)}</h2>
        <button class="icon-btn" data-close>${icon("x", 15)}</button>
      </header>
      <div class="modal-body">
        <div class="qty-hero">
          <span class="n ${isLow ? "low" : ""} t-num">${m.qty}</span>
          <span class="meta"><b>${esc(m.unit)} in stock</b><span>min ${m.minQty} ${esc(m.unit)} · ${m.location ? "shelf " + esc(m.location) : "no location"}</span></span>
          ${(() => { const oo = D.onOrder(m.id); return oo ? `<span class="on-order-badge">${oo} ${esc(m.unit)} on order</span>` : ""; })()}
          ${isLow ? `<span class="low-badge" style="font-size:12px;padding:5px 10px">Low — reorder</span>` : ""}
        </div>
        <div class="stock-actions">
          <input class="input" id="stk-qty" type="number" min="0" step="any" placeholder="Qty" value="">
          <input class="input" id="stk-note" placeholder="Note (supplier, reason…)" style="flex:1;width:auto">
          <button class="btn danger" id="stk-use" title="Remove from stock">−</button>
          <button class="btn green" id="stk-recv" title="Add to stock">＋</button>
        </div>
        <div>
          <div class="t-label" style="margin-bottom:4px">Movements</div>
          ${moves.length ? moves.map(sm => {
            const w = D.member(sm.who);
            return `<div class="movement-row">
              <span class="delta ${sm.delta > 0 ? "pos" : "neg"} t-num">${sm.delta > 0 ? "＋" : "−"}${Math.abs(sm.delta)} ${esc(m.unit)}</span>
              <span class="note">${esc(sm.note || "")}</span>
              ${w ? avatarHtml(w, "sm") : ""}
              <span class="when">${fmtAgo(sm.ts)}</span>
            </div>`;
          }).join("") : `<span class="t-caption">No movements yet</span>`}
        </div>
        <div class="opt-sep" style="margin:2px 0"></div>
        <div class="form-row">
          <div class="field"><label>Name</label><input class="input" id="mat-name" value="${esc(m.name)}"></div>
          <div class="field"><label>SKU</label><input class="input" id="mat-sku" value="${esc(m.sku)}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Unit</label><input class="input" id="mat-unit" value="${esc(m.unit)}"></div>
          <div class="field"><label>Min stock (alert below)</label><input class="input" id="mat-min" type="number" min="0" value="${m.minQty}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Location / shelf</label><input class="input" id="mat-loc" value="${esc(m.location || "")}"></div>
          <div class="field"><label>Reorder up to</label>
            <input class="input" id="mat-reorder" type="number" min="0" step="any" value="${m.reorderQty ?? ""}" placeholder="${D.reorderTarget(m)} ${esc(m.unit)}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Supplier</label>
            ${Picker.html("mat-sup", {
              value: m.supplierId || "", placeholder: "Search suppliers…", empty: "— none —",
              options: D.suppliers().map(x => ({ value: x.id, label: x.name, sub: x.contact || "" })),
            })}</div>
          <div class="field"><label>&nbsp;</label><button class="btn danger" id="mat-del">Delete material</button></div>
        </div>
      </div>
      <footer>
        <button class="btn ghost" data-close>Close</button>
        <button class="btn primary" id="mat-save">Save changes</button>
      </footer>
    `, (modal) => {
      Picker.bind(modal);
      $$("[data-close]", modal).forEach(b => b.onclick = () => Modal.close());
      const qtyInp = $("#stk-qty", modal);
      if (focusReceive) setTimeout(() => qtyInp.focus(), 80);
      const doMove = (sign) => {
        const qv = parseFloat(qtyInp.value);
        if (!qv || qv <= 0) { qtyInp.focus(); return; }
        const note = $("#stk-note", modal).value.trim();
        if (sign > 0) M.receiveStock(m.id, qv, note, App.me.id);
        else M.adjustStock(m.id, -qv, note || "Used / written off", App.me.id);
        Modal.close(); App.render();
        const nm = D.material(m.id);
        Toast.show(`${sign > 0 ? "＋" : "−"}${qv} ${m.unit} ${m.name} — now ${nm.qty} ${m.unit}`, { emoji: sign > 0 ? "📦" : "📤" });
        if (nm.qty <= nm.minQty) Toast.show(`${m.name} is low — ${nm.qty} ${m.unit} left`, { emoji: "📉", ms: 4200 });
      };
      $("#stk-recv", modal).onclick = () => doMove(+1);
      $("#stk-use", modal).onclick = () => doMove(-1);
      $("#mat-save", modal).onclick = () => {
        M.updateMaterial(m.id, {
          name: $("#mat-name", modal).value.trim() || m.name,
          sku: $("#mat-sku", modal).value.trim(),
          unit: $("#mat-unit", modal).value.trim() || "pcs",
          minQty: parseFloat($("#mat-min", modal).value) || 0,
          location: $("#mat-loc", modal).value.trim(),
          supplierId: $("#mat-sup", modal).value || null,
          reorderQty: parseFloat($("#mat-reorder", modal).value) || null,
        }, App.me.id);
        Modal.close(); App.render();
        Toast.show("Material updated", { emoji: "✓" });
      };
      $("#mat-del", modal).onclick = () => {
        const snap = Store.snapshot();
        if (!M.deleteMaterial(m.id, App.me.id)) {
          Toast.show("Can't delete — needed by open orders", { emoji: "⚠️" });
          return;
        }
        Modal.close(); App.render();
        Toast.show(`${m.name} deleted`, { undo: () => { Store.restore(snap); App.render(); } });
      };
    });
  },

  addModal() {
    Modal.open(`
      <header><h2>Add material</h2><button class="icon-btn" data-close>✕</button></header>
      <div class="modal-body">
        <div class="form-row">
          <div class="field"><label>Name</label><input class="input" id="am-name" placeholder="e.g. Oak veneer 0.6 mm"></div>
          <div class="field"><label>SKU</label><input class="input" id="am-sku" placeholder="suggested from the name"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Unit</label><input class="input" id="am-unit" value="pcs"></div>
          <div class="field"><label>Icon</label><button class="mat-ico" id="am-icon" type="button" data-ic="box" style="cursor:pointer">${icon("box", 19)}</button></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Initial stock</label><input class="input" id="am-qty" type="number" min="0" step="any" value="0"></div>
          <div class="field"><label>Min stock (alert below)</label><input class="input" id="am-min" type="number" min="0" step="any" value="0"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Location / shelf</label><input class="input" id="am-loc" placeholder="e.g. B2"></div>
          <div class="field"><label>Supplier</label>${this.supplierField("am-sup")}</div>
        </div>
      </div>
      <footer>
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="am-save">Add material</button>
      </footer>
    `, (modal) => {
      Picker.bind(modal);
      this.bindSupplierField("am-sup", modal);
      $$("[data-close]", modal).forEach(b => b.onclick = () => Modal.close());

      /* follow the name until somebody types their own code, then stop */
      const nameEl = $("#am-name", modal), skuEl = $("#am-sku", modal);
      skuEl.oninput = () => { skuEl.dataset.touched = "1"; };
      nameEl.oninput = () => {
        if (skuEl.dataset.touched) return;
        skuEl.value = D.suggestSku(nameEl.value);
      };

      const iconBtn = $("#am-icon", modal);
      iconBtn.onclick = () => Popover.open(iconBtn, `<div class="icon-grid">${MATERIAL_IC_KEYS.map(k => `<button data-ic="${k}" title="${k}">${icon(k, 17)}</button>`).join("")}</div>`, (pop) => {
        $$("[data-ic]", pop).forEach(ib => ib.onclick = () => {
          iconBtn.dataset.ic = ib.dataset.ic;
          iconBtn.innerHTML = icon(ib.dataset.ic, 19);
          Popover.close();
        });
      });
      $("#am-save", modal).onclick = () => {
        const name = $("#am-name", modal).value.trim();
        if (!name) { $("#am-name", modal).focus(); return; }
        const mat = M.addMaterial({
          name,
          sku: $("#am-sku", modal).value.trim() || D.suggestSku(name),
          unit: $("#am-unit", modal).value.trim() || "pcs",
          qty: parseFloat($("#am-qty", modal).value) || 0,
          minQty: parseFloat($("#am-min", modal).value) || 0,
          location: $("#am-loc", modal).value.trim(),
          supplierId: this.resolveSupplierField("am-sup", modal, App.me.id),
          icon: "📦", ic: iconBtn.dataset.ic || "box",
        }, App.me.id);
        Modal.close(); App.render();
        Toast.show(`${mat.name} added to warehouse`, { emoji: "🏬" });
      };
    });
  },
};

/* ============================================================
   Notifications — in-app centre (bell), live toast + optional
   desktop alert. Managers confirm client approval → engineers hear.
   ============================================================ */
const Notif = {
  ICON: { client_ok: "handshake", info: "info", todo: "todo", mention: "at", task: "columns" },

  bellHtml(memberId) {
    const n = D.unreadCount(memberId);
    return `<button class="icon-btn notif-bell" id="notif-bell" title="Notifications" style="position:relative">
      ${icon("bell", 16)}${n ? `<span class="notif-dot">${n > 9 ? "9+" : n}</span>` : ""}
    </button>`;
  },

  bindBell(root) {
    const bell = $("#notif-bell", root);
    if (bell) bell.onclick = () => this.openPanel(bell);
  },

  openPanel(anchor) {
    const me = App.me.id;
    const list = D.notificationsFor(me).slice(0, 30);
    const canDesktop = typeof Notification !== "undefined";
    const permd = canDesktop && Notification.permission === "granted";
    Popover.open(anchor, `
      <div class="opt-row" style="padding:6px 10px 4px"><b class="grow" style="font-size:13px">Notifications</b>
        ${list.some(n => !n.read) ? `<button class="add-inline" id="nt-readall">Mark all read</button>` : ""}
      </div>
      <div class="opt-sep"></div>
      <div class="notif-list">
        ${list.length ? list.map(n => {
          const by = D.member(n.by);
          return `<button class="notif-item ${n.read ? "" : "unread"}" data-nt="${n.id}" ${n.orderId ? `data-nt-order="${n.orderId}"` : ""} ${n.gprojectId ? `data-nt-gp="${n.gprojectId}" data-nt-gt="${n.gtaskId}"` : ""}>
            <span class="notif-ic ${n.type === "client_ok" ? "ok" : ""}">${icon(this.ICON[n.type] || "info", 15)}</span>
            <span class="grow"><b>${activityHtml(n.text)}</b><span>${by ? esc(by.name) + " · " : ""}${fmtAgo(n.ts)}</span></span>
            ${n.read ? "" : `<span class="notif-unread-dot"></span>`}
          </button>`;
        }).join("") : `<div class="notif-empty">${icon("bell", 22)}<span>No notifications yet</span></div>`}
      </div>
      ${canDesktop && !permd ? `<div class="opt-sep"></div><button class="opt-row clickable" id="nt-desktop" style="font-size:12px;color:var(--accent-text)">${icon("bell", 14)} Enable desktop alerts</button>` : ""}
    `, (pop) => {
      const readall = $("#nt-readall", pop);
      if (readall) readall.onclick = (e) => { e.stopPropagation(); M.markAllNotifsRead(me); Popover.close(); App.render(); };
      const desk = $("#nt-desktop", pop);
      if (desk) desk.onclick = (e) => {
        e.stopPropagation();
        Notification.requestPermission().then(() => { Popover.close(); Toast.show(Notification.permission === "granted" ? "Desktop alerts on" : "Desktop alerts blocked", { emoji: "bell" }); });
      };
      $$("[data-nt]", pop).forEach(b => b.onclick = () => {
        M.markNotifRead(b.dataset.nt);
        Popover.close();
        if (b.dataset.ntGp && D.gproject(b.dataset.ntGp)) {
          GPM.openId = b.dataset.ntGp; GPM.tab = "board"; App.navigate("planner");
          GPM.openTask(b.dataset.ntGp, b.dataset.ntGt);
        } else if (b.dataset.ntOrder && D.order(b.dataset.ntOrder)) Drawer.open(b.dataset.ntOrder);
        else App.render();
      });
    });
  },

  /* live delivery: toast + optional desktop alert for notifications that
     arrived since this session last looked (fired from the storage sync) */
  flushLive() {
    if (!App.me) return;
    const fresh = D.notificationsFor(App.me.id).filter(n => n.ts > (App._notifSeenTs || 0));
    if (!fresh.length) return;
    App._notifSeenTs = Math.max(App._notifSeenTs || 0, ...fresh.map(n => n.ts));
    const n = fresh[0]; // newest
    Toast.show(n.text, { emoji: n.type === "client_ok" ? "handshake" : "bell", ms: 6000 });
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try { new Notification(Store.state.shopName + " · " + (n.type === "client_ok" ? "Client approved" : "Update"), { body: n.text }); } catch (e) {}
    }
  },
};

/* ============================================================
   To-Do — personal lists; managers can assign to anyone
   ============================================================ */
const Todo = {
  showDone: false,

  itemHtml(t, { showFor = false } = {}) {
    const by = D.member(t.by);
    const assignedByOther = t.by && t.by !== t.forId;
    const due = t.due ? fmtDue(t.due) : null;
    return `<div class="todo-item ${t.done ? "done" : ""}">
      <button class="todo-check" data-todo-toggle="${t.id}" aria-checked="${t.done}">${t.done ? icon("check", 13) : ""}</button>
      <span class="grow">
        <span class="todo-text">${esc(t.text)}</span>
        <span class="todo-meta">
          ${showFor ? `${avatarHtml(D.member(t.forId), "sm")} ` : ""}
          ${assignedByOther ? `assigned by ${esc(by?.name || "?")} · ` : ""}${fmtAgo(t.ts)}
          ${due && !t.done ? ` · <span class="due-chip ${due.cls}">${due.label}</span>` : ""}
          ${t.done && t.doneAt ? ` · done ${fmtAgo(t.doneAt)}` : ""}
        </span>
      </span>
      <button class="mini-btn danger" data-todo-del="${t.id}" title="Delete">${icon("x", 12)}</button>
    </div>`;
  },

  addRow(forId, ph) {
    return `<div class="todo-add">
      <input class="input" data-todo-input="${forId}" placeholder="${ph}">
      <input class="input" data-todo-due="${forId}" type="date" title="Due date (optional)">
      <button class="btn subtle" data-todo-add="${forId}">${icon("plus", 13)} Add</button>
    </div>`;
  },

  view() {
    const me = App.me;
    const mine = D.todosFor(me.id).filter(t => this.showDone || !t.done);
    const others = Store.state.members.filter(m => m.id !== me.id);
    return `<div class="view-anim" style="max-width:900px">
      <div class="toolbar">
        <h2 class="muted" style="font-weight:500">Personal to-dos — everyone sees their own; managers can assign to anyone</h2>
        <div class="grow"></div>
        <button class="fchip ${this.showDone ? "active" : ""}" id="todo-showdone">Show done</button>
      </div>

      <div class="panel" style="margin-bottom:16px">
        <header><h2>${icon("todo", 15)} My list <span class="count-badge">${D.openTodoCount(me.id)}</span></h2></header>
        <div class="todo-list">
          ${mine.length ? mine.map(t => this.itemHtml(t)).join("") : `<div class="empty-mini" style="border:none"><span class="big">${icon("sparkles", 24)}</span>Nothing on your list</div>`}
          ${this.addRow(me.id, "Add a to-do for yourself…")}
        </div>
      </div>

      ${me.role === "manager" ? `
      <div class="section-title"><h2>Team lists</h2></div>
      <div class="todo-grid">
        ${others.map(m => {
          const list = D.todosFor(m.id).filter(t => this.showDone || !t.done);
          return `<div class="panel">
            <header style="padding-bottom:10px">${avatarHtml(m, "md")}<h2 style="flex:1;margin-left:4px">${esc(m.name)}</h2><span class="count-badge">${D.openTodoCount(m.id)}</span></header>
            <div class="todo-list">
              ${list.length ? list.map(t => this.itemHtml(t)).join("") : `<div class="t-caption" style="padding:6px 16px 10px">No open to-dos</div>`}
              ${this.addRow(m.id, `Assign a task to ${esc(m.name)}…`)}
            </div>
          </div>`;
        }).join("")}
      </div>` : ""}
    </div>`;
  },

  bind(root) {
    const sd = $("#todo-showdone", root);
    if (sd) sd.onclick = () => { this.showDone = !this.showDone; App.render(); };
    $$("[data-todo-toggle]", root).forEach(b => b.onclick = () => {
      M.toggleTodo(b.dataset.todoToggle, App.me.id);
      App.render();
    });
    $$("[data-todo-del]", root).forEach(b => b.onclick = () => {
      const snap = Store.snapshot();
      M.deleteTodo(b.dataset.todoDel);
      App.render();
      Toast.show("To-do deleted", { undo: () => { Store.restore(snap); App.render(); } });
    });
    $$("[data-todo-add]", root).forEach(b => {
      const forId = b.dataset.todoAdd;
      const input = $(`[data-todo-input="${forId}"]`, root);
      const dueEl = $(`[data-todo-due="${forId}"]`, root);
      const add = () => {
        const text = input.value.trim();
        if (!text) { input.focus(); return; }
        M.addTodo({ text, forId, due: dueEl.value ? new Date(dueEl.value + "T12:00:00").getTime() : null }, App.me.id);
        App.render();
        const who = forId === App.me.id ? "your list" : (D.member(forId)?.name || "");
        Toast.show(`Added to ${who}`, { emoji: "todo" });
      };
      b.onclick = add;
      input.onkeydown = (e) => { if (e.key === "Enter") add(); };
    });
  },
};

/* ============================================================
   Activity (full audit trail)
   ============================================================ */
/* ============================================================
   Needs attention — the one screen to open first

   Nothing here is new information. It was spread across the warehouse, the
   board, the order list and the activity feed, and holding five screens in
   your head every morning is how things got lost.
   ============================================================ */
Object.assign(Mgr, {
  attention() {
    const a = D.attention(App.me.id);
    const sec = (id, ico, title, n, body, tone) => !n ? "" : `<div class="panel att-sec">
      <header><h2><span style="color:var(--${tone || "orange"})">${icon(ico, 15)}</span> ${title}</h2>
        <span class="att-n">${n}</span></header>
      <div class="panel-list">${body}</div>
    </div>`;

    const jobRow = (o, right, sub) => `<button class="panel-row" data-order="${o.id}">
      <span class="grow"><b>${esc(o.num)} · ${esc(o.product)}</b>
        <span>${o.client ? esc(o.client) + " · " : ""}${sub}</span></span>
      ${right}
    </button>`;

    const waitingHtml = a.shortfalls.slice(0, 8).map(r => {
      /* something short but arriving Thursday is a different problem from
         something short with nothing on the way — say which */
      const d = r.material ? D.onOrderDetail(r.material.id) : null;
      const eta = d && d.total
        ? (d.sent && d.expectedAt
            ? (d.late ? ` · ${Math.round(d.total)} was due ${fmtDate(d.expectedAt)}` : ` · ${Math.round(d.total)} arriving ${fmtDate(d.expectedAt)}`)
            : d.sent ? ` · ${Math.round(d.total)} ordered, no date` : ` · ${Math.round(d.total)} still only drafted`)
        : "";
      return `<button class="panel-row" data-goto="warehouse" data-wtab="demand">
        <span style="color:var(--${d && d.late ? "red" : "orange"})">${icon(d && d.total ? "truck" : "trend-down", 17)}</span>
        <span class="grow"><b>${esc(r.name)}</b>
          <span>${r.lines.length} project${r.lines.length === 1 ? "" : "s"} need ${r.need} ${esc(r.unit)}${
            r.stock === null ? " · not in the warehouse" : ` · ${r.stock} on the shelf`}${eta}</span></span>
        <span class="low-badge">${Math.round(r.short * 100) / 100} short</span>
      </button>`;
    }).join("");

    const blockedHtml = a.blocked.slice(0, 8).map(({ order, op }) => jobRow(order,
      `<span class="pill blocked"><span class="dot"></span>Blocked</span>`,
      `${esc((D.station(op.stationId) || {}).name || "—")}${op.blockNote ? " · " + esc(op.blockNote) : ""}`)).join("");

    const lateHtml = a.late.slice(0, 8).map(o => jobRow(o,
      `<span class="due-chip overdue">${fmtDue(o.due).label}</span>`,
      `at ${esc((D.station((D.currentOp(o) || {}).stationId) || {}).name || "—")}`)).join("");

    const staleHtml = a.stale.slice(0, 8).map(({ order, since }) => jobRow(order,
      `<span class="tag">${since ? fmtAgo(since) : "never"}</span>`,
      `nothing has moved on it`)).join("");

    const changedHtml = a.changed.slice(0, 10).map(c => {
      const m = D.member(c.who);
      return `<${c.orderId ? "button" : "div"} class="panel-row" ${c.orderId ? `data-order="${c.orderId}"` : ""}>
        ${avatarHtml(m, "sm")}
        <span class="grow"><b>${esc(m ? m.name : "Someone")}</b><span>${activityHtml(c.text)}</span></span>
        <span class="tag">${fmtAgo(c.ts)}</span>
      </${c.orderId ? "button" : "div"}>`;
    }).join("");

    const nothing = !a.count && !a.changed.length;
    return `<div class="view-anim" style="max-width:860px">
      <div class="toolbar">
        <span class="t-caption">${nothing ? "Nothing is waiting on you."
          : `${a.count} thing${a.count === 1 ? "" : "s"} to look at${a.changed.length ? ` · ${a.changed.length} change${a.changed.length === 1 ? "" : "s"} since you last looked` : ""}`}</span>
        <div class="grow"></div>
        ${a.changed.length ? `<button class="btn" id="att-seen">Mark changes as seen</button>` : ""}
      </div>

      ${sec("materials", "trend-down", "Waiting on materials", a.shortfalls.length, waitingHtml)}
      ${sec("blocked", "ban", "Blocked", a.blocked.length, blockedHtml, "red")}
      ${sec("late", "clock", "Past due", a.late.length, lateHtml, "red")}
      ${sec("stale", "zzz", `Not moved in ${D.STALE_DAYS} days`, a.stale.length, staleHtml, "gray")}
      ${sec("changed", "history", "Changed since you last looked", a.changed.length, changedHtml, "blue")}

      ${nothing ? `<div class="empty-state"><span class="big">${icon("check-circle", 40)}</span>
        <h3>All clear</h3><p>No shortages, nothing blocked or overdue, and nothing has gone quiet.</p></div>` : ""}
    </div>`;
  },

  bindAttention(root) {
    $$("[data-order]", root).forEach(b => b.onclick = () => Drawer.open(b.dataset.order));
    $$("[data-goto]", root).forEach(b => b.onclick = () => {
      if (b.dataset.wtab) Warehouse.tab = b.dataset.wtab;
      App.navigate(b.dataset.goto);
    });
    const seen = $("#att-seen", root);
    if (seen) seen.onclick = () => {
      M.setPref(App.me.id, "attentionSeen", Date.now());
      App.render();
      Toast.show("Caught up", { emoji: "check" });
    };
  },
});

const Activity = {
  who: "",
  search: "",
  project: "",      // one project's whole story
  kind: "",         // progress / materials / routing / …
  limit: 120,       // raised by "Show earlier", never a silent cutoff

  view() {
    const s = Store.state;
    const q = this.search.trim().toLowerCase();
    let list = [...s.activity].sort((a, b) => b.ts - a.ts);
    if (this.who) list = list.filter(a => a.who === this.who);
    if (this.project) {
      const o = D.order(this.project);
      list = list.filter(a => a.orderId === this.project || (o && a.text.includes(o.num)));
    }
    if (this.kind) list = list.filter(a => D.activityKind(a) === this.kind);
    if (q) list = list.filter(a => a.text.toLowerCase().includes(q));
    const total = list.length;
    const shown = list.slice(0, this.limit);

    /* group by day */
    const groups = [];
    let curKey = null;
    for (const a of shown) {
      const d = new Date(a.ts);
      const key = d.toDateString();
      if (key !== curKey) {
        curKey = key;
        const today = new Date().toDateString();
        const yest = new Date(Date.now() - DAY).toDateString();
        groups.push({ label: key === today ? "Today" : key === yest ? "Yesterday" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), items: [] });
      }
      groups[groups.length - 1].items.push(a);
    }

    return `<div class="view-anim" style="max-width:760px">
      <div class="toolbar">
        <div class="member-filter">
          <button class="fchip all-chip ${!this.who ? "active" : ""}" data-who="">Everyone</button>
          ${s.members.map(m => `<button class="fchip ${this.who === m.id ? "active" : ""}" data-who="${m.id}">${avatarHtml(m, "sm")} ${esc(m.name)}</button>`).join("")}
        </div>
        <div class="grow"></div>
        <div class="search-box" style="min-width:210px">${icon("search", 14)}<input id="act-search" placeholder="Search changes…" value="${esc(this.search)}"></div>
      </div>
      <div class="toolbar" style="margin-top:-4px">
        <select class="select" id="act-project" style="max-width:280px">
          <option value="">All projects</option>
          ${[...s.orders].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(o =>
            `<option value="${o.id}" ${this.project === o.id ? "selected" : ""}>${esc(o.num)} · ${esc(o.product)}${o.archived ? " (archived)" : ""}</option>`).join("")}
        </select>
        <div class="filter-chips">
          <button class="fchip ${!this.kind ? "active" : ""}" data-akind="">Everything</button>
          ${D.ACT_KINDS.map(([id, label]) => `<button class="fchip ${this.kind === id ? "active" : ""}" data-akind="${id}">${label}</button>`).join("")}
        </div>
      </div>
      ${this.project ? (() => {
        const o = D.order(this.project);
        return o ? `<div class="act-project">
          <span class="grow"><b>${esc(o.num)} · ${esc(o.product)}</b>
            <span>${total} change${total === 1 ? "" : "s"}${o.client ? " · " + esc(o.client) : ""}</span></span>
          <button class="btn subtle" id="act-open">Open project</button>
        </div>` : "";
      })() : ""}
      ${groups.length ? groups.map(g => `
        <div class="day-head">${g.label}</div>
        <div class="act-card">
          ${g.items.map(a => {
            const m = D.member(a.who);
            const clickable = a.orderId || a.materialId;
            const time = new Date(a.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            return `<${clickable ? "button" : "div"} class="act-row" ${a.orderId ? `data-act-order="${a.orderId}"` : a.materialId ? `data-act-mat="${a.materialId}"` : ""}>
              ${avatarHtml(m, "md")}
              <span class="txt"><b>${esc(m ? m.name : "Someone")}</b> ${activityHtml(a.text)}</span>
              <span class="when">${time}</span>
            </${clickable ? "button" : "div"}>`;
          }).join("")}
        </div>
      `).join("") : `<div class="empty-state"><span class="big">${icon("history", 40)}</span><h3>No activity found</h3><p>Try another person, project or search.</p></div>`}
      ${total > shown.length ? `<div style="display:flex;justify-content:center;padding:14px 0">
        <button class="btn" id="act-more">Show earlier — ${total - shown.length} more</button></div>`
        : total ? `<div class="t-caption" style="text-align:center;padding:12px 0">That is the whole history — ${total} change${total === 1 ? "" : "s"}</div>` : ""}
    </div>`;
  },

  bind(root) {
    /* any change of filter starts the window again, or "show earlier" would
       carry a depth that belonged to a different question */
    $$("[data-who]", root).forEach(b => b.onclick = () => { this.who = b.dataset.who; this.limit = 120; App.render(); });
    $$("[data-akind]", root).forEach(b => b.onclick = () => { this.kind = b.dataset.akind; this.limit = 120; App.render(); });
    const proj = $("#act-project", root);
    if (proj) proj.onchange = () => { this.project = proj.value; this.limit = 120; App.render(); };
    const more = $("#act-more", root);
    if (more) more.onclick = () => { this.limit += 200; App.render(); };
    const open = $("#act-open", root);
    if (open) open.onclick = () => Drawer.open(this.project);
    const search = $("#act-search", root);
    if (search) search.oninput = () => {
      this.search = search.value;
      this.limit = 120;
      const pos = search.selectionStart;
      App.render();
      const s2 = $("#act-search");
      if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); }
    };
    $$("[data-act-order]", root).forEach(b => b.onclick = () => {
      if (D.order(b.dataset.actOrder)) Drawer.open(b.dataset.actOrder);
    });
    $$("[data-act-mat]", root).forEach(b => b.onclick = () => {
      if (D.material(b.dataset.actMat)) Warehouse.materialModal(b.dataset.actMat);
    });
  },
};

/* ============================================================
   Order detail (drawer content) — shared by manager & worker
   ============================================================ */
const OrderDetail = {
  /* ============================================================
     The cabinets themselves

     Assembly on a SWOOD job is counted in modules, and "0/48" means nothing
     to the person holding the screwdriver. These are the cabinets, by name,
     and ticking one IS the progress report — so the count and the bench can
     never disagree.
     ============================================================ */
  /* The count is a guess made from SOLIDNAME; this is how the shop corrects it. */
  moduleCountModal(orderId) {
    const o = D.order(orderId);
    const mods = D.orderModules(o);
    const op = D.assemblyOp(o);
    const item = op ? D.item(o, op.itemId) : null;
    /* The number on screen is the checklist's if there is one, and the assembly
       line's quantity if there is not — which is the case for every job
       imported before cabinets were tracked. */
    const now = mods.length || (item ? item.qty : 0);
    const source = mods.length ? mods.map(m => m.name) : D.moduleNamesFromParts(o);
    const fresh = !mods.length;

    Modal.open(`
      <header><h2>How many cabinets?</h2><button class="icon-btn" data-close>${icon("x", 15)}</button></header>
      <div class="modal-body">
        <p style="font-size:13.5px;color:var(--text-2)">
          ${fresh
            ? `${item ? `<b>${esc(item.name)}</b> is set to <b>${now}</b>` : `This job is set to <b>${now}</b>`}, because the import counted
               the panels the cabinets are made of rather than the cabinets themselves.
               Put the real number in and the assembly, QC and packing steps all follow it${
                 source.length ? ", and you get a checklist to tick off cabinet by cabinet." : "."}`
            : `The import works the cabinets out from the SOLIDNAME column, and it currently makes
               <b>${now}</b>. If the real number is lower, it has been counting panels —
               several names for the same cabinet that never collapsed into one.`}
        </p>
        <div class="form-row">
          <div class="field" style="max-width:150px"><label>Cabinets in this job</label>
            <input class="input" id="mc-n" type="number" min="1" value="${now}"></div>
        </div>
        <div class="t-caption">${source.length
          ? `It will try to recover the real names first — ${esc(source.slice(0, 3).join(", "))}${source.length > 3 ? "…" : ""}
             — by trimming the part off the end or the front. Only if nothing groups cleanly does it number them.`
          : `This job kept no cabinet names — it was imported before they were recorded — so they will be
             numbered. You can rename any of them afterwards by clicking it.`}</div>
        <div id="mc-preview" style="margin-top:10px"></div>
      </div>
      <footer>
        <div class="grow"></div>
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="mc-go">Set the count</button>
      </footer>`, (m) => {
      const input = $("#mc-n", m), prev = $("#mc-preview", m);
      const paint = () => {
        const want = Math.max(1, Math.round(input.valueAsNumber || 0));
        const names = source.length === want ? source : D.regroupModules(source, want);
        prev.innerHTML = want === now && !fresh ? ""
          : names
            ? `<div class="mc-ok">${icon("check-circle", 15)}<span>${want} cabinets, named: <b>${esc(names.slice(0, 4).join(", "))}${names.length > 4 ? "…" : ""}</b></span></div>`
            : `<div class="mc-warn">${icon("alert", 15)}<span>${source.length
                ? `The names do not group into ${want}, so they will be numbered`
                : `They will be numbered`} <b>Cabinet 1…${want}</b>. You can rename any of them afterwards.</span></div>`;
      };
      input.oninput = paint; paint();
      $("#mc-go", m).onclick = () => {
        const r = M.setModuleCount(o.id, input.valueAsNumber, App.me.id);
        Modal.close(); App.render(); Drawer.refresh();
        if (r) Toast.show(`${r.count} cabinets — ${r.recovered ? "names recovered" : "numbered; rename any that need it"}`,
          { emoji: "check", ms: 4500 });
      };
    });
  },

  modulesHtml(o) {
    const mods = D.orderModules(o);
    const done = D.modulesDone(o), total = D.modulesTotal(o);
    const canEdit = App.can("orders.edit") || App.can("orders.assign");
    const op = D.assemblyOp(o);
    const st = op ? D.station(op.stationId) : null;

    /* which materials each cabinet needs, so you can see at a glance whether
       the parts for it have actually been cut yet */
    const boards = (name) => {
      const parts = (o.parts || []).filter(p => (p.solid || "").includes(name) || (p.name || "") === name);
      return [...new Set(parts.map(p => p.board))].filter(Boolean);
    };
    const cutFor = (board) => {
      const item = o.items.find(i => i.name === board);
      if (!item) return null;
      const first = o.ops.find(x => x.itemId === item.id);
      return first ? (first.status === "done" ? "done" : first.qtyDone > 0 ? "part" : "no") : null;
    };

    return `<div>
      <div class="t-label" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <span class="grow">Cabinets — ${done} of ${total} assembled${st ? ` · counted at ${esc(st.name)}` : ""}</span>
        ${canEdit ? `<button class="link" id="mod-count">${mods.length} <span>cabinets — not right?</span></button>` : ""}
        ${canEdit && done < total ? `<button class="link" id="mod-all">Tick all</button>` : ""}
        ${canEdit && done > 0 ? `<button class="link" id="mod-none">Clear</button>` : ""}
      </div>
      <div class="mod-list">
        ${mods.map(m => {
          const bs = boards(m.name);
          const blocked = bs.filter(b => cutFor(b) === "no");
          return `<label class="mod-row ${m.done >= (m.qty || 1) ? "on" : ""}">
            <input type="checkbox" data-mod="${m.id}" ${m.done >= (m.qty || 1) ? "checked" : ""} ${canEdit ? "" : "disabled"}>
            <span class="grow"><b ${canEdit ? `data-mod-name="${m.id}" title="Click to rename"` : ""}>${esc(m.name)}</b>
              ${bs.length ? `<span class="mod-mats">${bs.map(b => `<span class="mod-mat ${cutFor(b) || ""}">${esc(b)}</span>`).join("")}</span>` : ""}</span>
            ${(m.qty || 1) > 1 ? `<span class="qty-pill">${m.done}/${m.qty}</span>` : ""}
            ${blocked.length ? `<span class="mod-wait" title="Not cut yet: ${esc(blocked.join(", "))}">${icon("clock", 12)}</span>` : ""}
          </label>`;
        }).join("")}
      </div>
    </div>`;
  },

  showAllHist: false,

  html(o) {
    const st = D.orderStatus(o);
    const p = D.progress(o);
    const canEdit = App.can("orders.edit");        // due date, priority, notes, portfolio, files
    const canRoute = App.can("orders.route");      // add / move / remove steps
    const canMats = App.can("materials.use");
    const isEng = o.type === "eng";
    const due = fmtDue(o.due);
    const dueISO = new Date(o.due).toISOString().slice(0, 10);
    const shortages = D.orderShortages(o);
    const history = D.orderHistory(o.id);
    const shownHist = this.showAllHist ? history : history.slice(0, 6);
    const packed = D.packedSummary(o);

    return `
      <header>
        <div class="head-row">
          <span class="num">${esc(o.num)}</span>
          ${isEng ? `<span class="eng-badge">Engineering</span>` : ""}
          ${pillHtml(st, D.statusLabelFor(o, st))}
          ${prioHtml(o.priority)}
          <span class="grow"></span>
          ${D.projectLink(o) ? `<button class="icon-btn" id="od-od-quick" title="Open project files in OneDrive">${icon("cloud", 15)}</button>` : ""}
          ${canEdit ? `<button class="icon-btn" id="od-edit" title="Edit order details">${icon("pencil", 14)}</button>` : ""}
          <button class="icon-btn" data-close>${icon("x", 15)}</button>
        </div>
        <h1>${esc(o.product)}</h1>
        <div class="sub">${o.client && o.client !== o.product ? esc(o.client) + " · " : ""}${o.qty} ${esc(o.unit)} · created ${fmtDate(o.createdAt)}</div>
      </header>
      <div class="drawer-body">
        ${(() => {
          const link = D.projectLink(o);
          if (link) return `<button class="btn subtle project-link-btn" id="od-onedrive" title="${esc(link)}">
            ${icon("cloud-open", 16)} Open project files in OneDrive ${icon("external", 13)}
            ${D.projectLinkIsAuto(o) ? `<span class="auto-tag">auto</span>` : ""}
          </button>`;
          if (canEdit) return `<button class="btn ghost project-link-btn" id="od-onedrive-set">
            ${icon("link", 15)} Link OneDrive folder…
          </button>`;
          return "";
        })()}
        ${shortages.length ? `<div class="short-banner">${icon("trend-down", 14)} Material shortage: ${shortages.map(l => {
          const mat = D.material(l.materialId);
          return `${esc(mat.name)} (need ${l.qty}, have ${mat.qty} ${esc(mat.unit)})`;
        }).join(" · ")}</div>` : ""}

        ${isEng && o.clientApproved ? `<div class="approve-banner">
          ${icon("handshake", 15)} <span>Client approved the drawings — ${esc(D.member(o.clientApproved.by)?.name || "manager")} confirmed ${fmtAgo(o.clientApproved.at)}</span>
          ${App.isManager() ? `<button class="mini-act" id="od-unapprove">Revoke</button>` : ""}
        </div>` : ""}
        ${isEng && !o.clientApproved && App.isManager() ? `<button class="btn green project-link-btn" id="od-approve">
          ${icon("handshake", 15)} Confirm client approved the drawings
        </button>` : ""}

        <div class="meta-grid">
          <div class="meta-box"><span class="t-label">Due date</span>
            ${canEdit ? `<input type="date" id="od-due" value="${dueISO}">` : `<span class="v due-chip ${due.cls}" style="font-size:13.5px">${due.label}</span>`}
          </div>
          <div class="meta-box"><span class="t-label">Priority</span>
            ${canEdit ? `<select id="od-prio">
              ${["rush", "high", "normal", "low"].map(x => `<option value="${x}" ${o.priority === x ? "selected" : ""}>${x === "rush" ? "🔥 Rush" : x[0].toUpperCase() + x.slice(1)}</option>`).join("")}
            </select>` : `<span class="v">${o.priority === "normal" ? "Normal" : prioHtml(o.priority)}</span>`}
          </div>
          <div class="meta-box"><span class="t-label">Progress</span><span class="v"><div class="progress ${p.pct === 100 ? "done" : ""}" style="width:80px"><i style="width:${p.pct}%"></i></div> ${p.done}/${p.total} tasks</span></div>
          <div class="meta-box"><span class="t-label">Time logged</span>
            <span class="v t-num">${fmtDur(o.ops.reduce((a, op) => a + D.opElapsed(op), 0))}</span>
            <span class="t-caption">${D.shift().auto ? "counted from scans, working hours only" : "working hours only"}</span></div>
          ${!isEng && o.qty > 1 ? `<div class="meta-box"><span class="t-label">${esc(packed.label)}</span><span class="v ${packed.done === packed.total ? "" : ""}" style="${packed.done === packed.total ? "color:var(--green)" : ""}">${packed.done} / ${packed.total} ${esc(o.unit)}</span></div>` : ""}
          <div class="meta-box"><span class="t-label">Portfolio</span>
            ${canEdit ? `<select id="od-portfolio">
              <option value="">None</option>
              ${Store.state.portfolios.map(pf => `<option value="${pf.id}" ${o.portfolioId === pf.id ? "selected" : ""}>${esc(pf.name)}</option>`).join("")}
            </select>` : `<span class="v">${o.portfolioId ? esc(D.portfolio(o.portfolioId)?.name || "—") : "—"}</span>`}
          </div>
        </div>

        ${D.hasModules(o) ? this.modulesHtml(o) : ""}

        <div>
          <div class="t-label" style="margin-bottom:12px">${isEng ? "Stages" : "Routing — tasks per part group"}</div>
          ${(() => {
            const gaps = App.can("orders.route") ? D.swoodRouteGaps(o) : null;
            if (!gaps) return "";
            const n = gaps.add.reduce((k, a) => k + a.stations.length, 0) + (gaps.addFinal ? gaps.addFinal.length : 0);
            const names = [...new Set([
              ...gaps.add.flatMap(a => a.stations.map(st => st.name)),
              ...(gaps.addFinal || []).map(st => st.name)])];
            return `<div class="route-gap">
              <span style="color:var(--orange)">${icon("alert", 17)}</span>
              <span class="grow"><b>This job stops after cutting</b>
                <span>It was imported before the shop's own stations were matched by name, so ${n} step${n > 1 ? "s were" : " was"} never created: ${esc(names.join(", "))}. Adding them keeps everything already done.</span></span>
              <button class="btn" id="od-fixroute">${icon("plus", 13)} Add the missing steps</button>
            </div>`;
          })()}
          ${(() => {
            /* The assembly line is counted in cabinets, so its quantity is the
               cabinet count — and that is the number people look at and want to
               correct. Make it the control rather than a read-only label. */
            const asm = D.assemblyOp(o);
            return o.items.map(item => {
            const groups = D.itemGroups(o, item.id);
            const fin = D.itemFinished(o, item.id);
            const multi = o.items.length > 1 || groups.length > 0;
            const art = item.articleId ? D.article(item.articleId) : null;
            const isAsm = asm && asm.itemId === item.id && App.can("orders.edit");
            return `<div class="item-block">
              ${multi || o.items.length > 1 ? `<div class="item-head">
                <b>${esc(item.name)}${art ? ` <span class="t-caption mono">${esc(art.sku)}</span>` : ""}</b>
                ${item.qty > 1 ? `<span class="fin ${fin.done === item.qty ? "all" : ""}">${fin.done}/${item.qty} ${esc(fin.label)}</span>` : ""}
                ${isAsm
                  ? `<button class="qty-big qty-edit" id="od-asm-qty" title="How many cabinets is this really? Click to correct it">×${item.qty}</button>`
                  : `<span class="qty-big">×${item.qty}</span>`}
              </div>` : ""}
              ${[...groups, null].map(g => {
                const lane = D.laneOps(o, item.id, g);
                if (!lane.length) return "";
                return `${groups.length ? `<div class="lane-label">${g ? esc(g) : `${icon("arrow-down", 11)} <span class="merge">Final — needs all part groups</span>`}</div>` : ""}
                <div class="route">
                  ${lane.map((op, i) => this.opHtml(o, op, i, lane.length, item)).join("")}
                </div>`;
              }).join("")}
            </div>`;
          }).join(""); })()}
          ${canRoute ? `<button class="add-step-btn" id="od-add-step">＋ Add step</button>` : ""}
        </div>

        <div>
          <div class="t-label" style="margin-bottom:10px">Materials</div>
          ${(o.materials || []).map(l => {
            const mat = D.material(l.materialId);
            if (!mat) return "";
            const short = D.lineShort(l);
            const by = D.member(l.consumedBy);
            return `<div class="mat-line ${short ? "short" : ""} ${l.consumed ? "used" : ""}">
              <span class="mat-ico" style="width:32px;height:32px">${matIcon(mat, 16)}</span>
              <span class="grow"><b>${esc(mat.name)}</b>
                <span>${l.qty} ${esc(mat.unit)} needed${l.consumed
                  ? ` · ✓ used${by ? " by " + esc(by.name) : ""} ${l.consumedAt ? fmtAgo(l.consumedAt) : ""}`
                  : short ? ` · only ${mat.qty} ${esc(mat.unit)} in stock` : ` · ${mat.qty} ${esc(mat.unit)} in stock`}</span></span>
              ${!l.consumed && canMats ? `<button class="btn subtle" data-consume="${l.id}">Use</button>` : ""}
              ${canMats && !l.consumed ? `<button class="mini-btn danger" data-line-del="${l.id}">✕</button>` : ""}
            </div>`;
          }).join("") || `<div class="t-caption" style="margin-bottom:8px">No materials linked yet</div>`}
          ${canMats ? `<div class="mat-add-row">
            <select class="select" id="od-mat-sel">
              <option value="">Add material…</option>
              ${Store.state.materials.map(m => `<option value="${m.id}">${esc(m.name)} (${m.qty} ${esc(m.unit)})</option>`).join("")}
            </select>
            <input class="input" id="od-mat-qty" type="number" min="0" step="any" placeholder="Qty">
            <button class="btn subtle" id="od-mat-add">Add</button>
          </div>` : ""}
        </div>

        ${o.notes || canEdit ? `<div class="field">
          <label>Notes</label>
          ${(() => {
            const fs = D.filesFor({ orderId: o.id });
            return `<div class="od-files">
              ${fs.length ? Files.chipsHtml(fs, { canEdit }) : ""}
              ${canEdit ? Files.dropHtml("od-files-in", fs.length ? "Add another drawing" : "Add a drawing or photo") : ""}
            </div>`;
          })()}
          ${canEdit ? `<textarea class="input" id="od-notes" placeholder="Materials, hardware, client wishes…">${esc(o.notes)}</textarea>`
                  : `<div class="meta-box" style="font-size:13.5px;line-height:1.5">${esc(o.notes) || "—"}</div>`}
        </div>` : ""}

        ${(o.parts || []).length ? `<div>
          <div class="t-label" style="margin-bottom:8px">Part list — ${o.parts.length} panels${o.swood ? ` · imported from SWOOD ${fmtAgo(o.swood.importedAt)}` : ""}</div>
          <div class="parts-table">
            <div class="parts-head"><span>Code</span><span>Part</span><span>Size</span><span>Material</span><span>Edges</span></div>
            <div class="parts-body">
              ${o.parts.slice(0, this.showAllParts ? o.parts.length : 12).map(p => `<div class="parts-row">
                <span class="mono">${esc(p.code)}</span>
                <span>${esc(p.name)}</span>
                <span class="mono">${p.l}×${p.w}${p.qty > 1 ? ` ×${p.qty}` : ""}</span>
                <span class="muted">${esc(p.board)}</span>
                <span class="muted">${(p.edges || []).filter(Boolean).length || "—"}</span>
              </div>`).join("")}
            </div>
          </div>
          ${o.parts.length > 12 && !this.showAllParts ? `<button class="btn ghost" id="od-parts-all" style="margin-top:6px;padding:5px 12px;font-size:12.5px">Show all ${o.parts.length} parts</button>` : ""}
        </div>` : ""}

        <div>
          <div class="t-label" style="margin-bottom:8px">Comments — @mention a teammate to notify them</div>
          <div class="ocomment-list">
            ${(o.comments || []).map(c => commentRowHtml(c, { canDelete: App.isManager() || c.by === App.me.id })).join("")
              || `<span class="t-caption">No comments yet</span>`}
          </div>
          <div class="ocomment-add">${avatarHtml(App.me, "sm")}
            <input class="input" id="od-c-input" placeholder="Write a comment — type @ to mention…" autocomplete="off">
            <button class="btn subtle" id="od-c-add" title="Post comment">${icon("send", 13)}</button>
          </div>
        </div>

        <div>
          <div class="t-label" style="margin-bottom:8px">History — every change, by whom</div>
          ${shownHist.map(a => {
            const m = D.member(a.who);
            return `<div class="activity-row" style="border:none;padding:5px 0">
              ${avatarHtml(m, "sm")}
              <span class="txt"><b>${esc(m ? m.name : "?")}</b> ${activityHtml(a.text)}</span>
              <span class="when">${fmtAgo(a.ts)}</span>
            </div>`;
          }).join("") || `<span class="t-caption">No history yet</span>`}
          ${history.length > 6 && !this.showAllHist ? `<button class="btn ghost" id="od-hist-all" style="margin-top:6px;padding:5px 12px;font-size:12.5px">Show all ${history.length} entries</button>` : ""}
        </div>

        ${App.can("orders.finish") || App.can("orders.copy") || App.can("orders.delete") ? `<div class="drawer-actions">
          ${isEng && !o.archived && App.can("orders.finish") ? `<button class="btn primary" id="od-handoff" style="flex:1">${icon("factory", 15)} Hand off to production</button>` : ""}
          ${st === "ready" && !o.archived && App.can("orders.finish") ? `<button class="btn green" id="od-ship" style="flex:1">${icon(isEng ? "check-circle" : "truck", 15)} ${isEng ? "Deliver & archive" : "Ship & archive"}</button>` : ""}
          ${App.can("orders.copy") ? `<button class="btn" id="od-copy">${icon("copy", 15)} Copy ${isEng ? "project" : "order"}</button>` : ""}
          ${!o.archived && App.can("orders.finish") ? `<button class="btn" id="od-archive">${icon("archive", 15)} End project → Archive</button>` : ""}
          ${o.archived && App.can("orders.finish") ? `<button class="btn subtle" id="od-restore">${icon("history", 15)} Restore from archive</button>` : ""}
          ${App.can("orders.delete") ? `<button class="btn danger" id="od-delete">Delete ${isEng ? "project" : "order"}</button>` : ""}
        </div>` : ""}
        ${o.handedOffTo && D.order(o.handedOffTo) ? `<button class="panel-row" style="border:1px solid var(--border);border-radius:var(--r-md)" data-open-order="${o.handedOffTo}"><span style="color:var(--text-2)">${icon("factory", 16)}</span><span class="grow"><b>Handed off to ${esc(D.order(o.handedOffTo).num)}</b><span>Open the manufacturing project</span></span>${icon("chev-right", 14)}</button>` : ""}
        ${o.fromEngId && D.order(o.fromEngId) ? `<button class="panel-row" style="border:1px solid var(--border);border-radius:var(--r-md)" data-open-order="${o.fromEngId}"><span style="color:var(--text-2)">${icon("compass", 16)}</span><span class="grow"><b>From engineering ${esc(D.order(o.fromEngId).num)}</b><span>Open the design project</span></span>${icon("chev-right", 14)}</button>` : ""}
      </div>`;
  },

  opHtml(o, op, i, laneLen, item) {
    const st = D.station(op.stationId) || { name: "(removed station)", icon: "▫️" };
    const ready = D.opReady(o, op);
    const avail = D.opAvail(o, op);
    const canRoute = App.can("orders.route");
    const canAssign = App.can("orders.assign");
    const canAct = App.usesCockpit() || ready;      // in the cockpit every task row offers its actions
    const assignee = D.member(op.assigneeId);
    const elapsed = D.opElapsed(op);
    const nodeIcon = op.status === "done" ? icon("check", 13) : op.status === "blocked" ? icon("x", 13) : stIcon(st, 13);
    const last = i === laneLen - 1;
    const lane = D.laneOps(o, op.itemId, op.group);
    const canMoveUp = canRoute && op.status !== "done" && i > 0 && lane[i - 1].status !== "done";
    const canMoveDown = canRoute && op.status !== "done" && !last && lane[i + 1].status !== "done";
    const showQty = item && item.qty > 1;
    const waiting = !ready && op.status === "queued";
    return `<div class="route-op">
      <div class="rail">
        <div class="node ${op.status}">${nodeIcon}</div>
        ${!last ? `<div class="line ${op.status === "done" ? "done" : ""}"></div>` : ""}
      </div>
      <div class="body">
        <div class="r1">
          <b>${esc(st.name)}</b>
          ${showQty ? `<span class="qty-pill ${op.status === "done" ? "full" : op.qtyDone > 0 ? "part" : waiting ? "waiting" : ""}">${op.qtyDone}/${item.qty}</span>` : ""}
          ${op.status === "running" ? `<span class="pill running"><span class="dot"></span><span data-timer="${o.id}/${op.id}" data-timer-style="clock">${fmtClock(elapsed)}</span></span>` : ""}
          ${op.status === "paused" ? pillHtml("paused") : ""}
          ${op.status === "blocked" ? pillHtml("blocked") : ""}
          ${canRoute && op.status !== "done" ? `<span class="route-edit-controls">
            <button class="mini-btn" data-op-move="${op.id}/-1" ${canMoveUp ? "" : "disabled"} title="Move up">↑</button>
            <button class="mini-btn" data-op-move="${op.id}/1" ${canMoveDown ? "" : "disabled"} title="Move down">↓</button>
            <button class="mini-btn danger" data-op-del="${op.id}" title="Remove step">✕</button>
          </span>` : ""}
        </div>
        <div class="r2">
          ${(() => {
            const crew = D.opAssignees(op);
            if (!canAssign) return crew.length
              ? `<span class="row" style="gap:5px">${crew.map(m => avatarHtml(m, "sm")).join("")} ${esc(crew.map(m => m.name).join(", "))}</span>`
              : `<span>Unassigned</span>`;
            /* two people carry a carcass; one name was never enough */
            return `<button class="assign-select crew-btn" data-crew="${op.id}">
              ${crew.length ? `<span class="avatar-stack">${crew.slice(0, 3).map(m => avatarHtml(m, "sm")).join("")}</span>
                <span>${esc(crew.map(m => m.name.split(" ")[0]).join(", "))}${crew.length > 3 ? ` +${crew.length - 3}` : ""}</span>`
                : `<span>Unassigned</span>`}
              ${icon("chev-down", 12)}
            </button>`;
          })()}
          <span>· est ${fmtDur(op.estMins * 60000)}</span>
          ${elapsed > 0 ? `<span>· logged <span class="t-num" ${op.status === "running" ? `data-timer="${o.id}/${op.id}" data-timer-style="dur"` : ""}>${fmtDur(elapsed)}</span></span>` : ""}
          ${op.status === "done" && op.completedAt ? `<span>· done ${fmtAgo(op.completedAt)}${op.completedBy ? " by " + esc(D.member(op.completedBy)?.name || "?") : ""}</span>` : ""}
          ${waiting ? `<span class="avail-hint">· waiting for upstream</span>`
            : showQty && op.status !== "done" && avail < item.qty ? `<span class="avail-hint">· ${avail} available upstream</span>` : ""}
        </div>
        ${op.blockNote ? `<div class="r2" style="color:var(--red);font-weight:590">${icon("ban", 12)} ${esc(op.blockNote)}</div>` : ""}
        ${canAct && op.status !== "done" ? `<div class="ops-actions">
          ${op.status === "running"
            ? `<button class="btn" data-op-act="pause" data-op="${op.id}">${icon("pause", 12)} Pause</button>
               <button class="btn green" data-op-act="done" data-op="${op.id}">${icon("check", 12)} Complete</button>`
            : op.status === "blocked"
            ? `<button class="btn subtle" data-op-act="unblock" data-op="${op.id}">Unblock</button>`
            : `<button class="btn subtle" data-op-act="start" data-op="${op.id}" ${ready ? "" : "disabled"}>${icon("play", 11)} Start</button>
               ${(elapsed > 0 || ready) ? `<button class="btn green" data-op-act="done" data-op="${op.id}" ${ready ? "" : "disabled"}>${icon("check", 12)} Complete</button>` : ""}`}
          ${showQty && ready ? `<span class="qty-stepper" style="margin-left:auto">
            <button class="step-btn" data-op-qty="${op.id}/-1" ${op.qtyDone <= 0 ? "disabled" : ""} style="width:30px;height:30px;border-radius:9px;font-size:15px">−</button>
            <span class="qv" style="font-size:13px;min-width:44px">${op.qtyDone}<small>/${item.qty}</small></span>
            <button class="step-btn" data-op-qty="${op.id}/1" ${op.qtyDone >= avail ? "disabled" : ""} style="width:30px;height:30px;border-radius:9px;font-size:15px">＋</button>
          </span>` : ""}
          <button class="btn ghost" data-op-act="block" data-op="${op.id}">${op.status === "blocked" ? "Edit problem" : "Report problem"}</button>
        </div>` : ""}
        ${App.can("orders.route") && op.status === "done" ? `<div class="ops-actions"><button class="btn ghost" data-op-act="reopen" data-op="${op.id}">↩ Reopen</button></div>` : ""}
      </div>
    </div>`;
  },

  bind(el, o) {
    $$("[data-close]", el).forEach(b => b.onclick = () => Drawer.close());
    const inCockpit = App.usesCockpit();   // handlers below are all null-guarded:
                                           // a control the role can't use simply isn't rendered

    /* OneDrive project files */
    const openFiles = () => {
      const link = D.projectLink(o);
      if (link) { window.open(link, "_blank", "noopener"); Toast.show("Opening project files in OneDrive…", { emoji: "cloud" }); }
    };
    const odBtn = $("#od-onedrive", el);
    if (odBtn) odBtn.onclick = openFiles;
    const odQuick = $("#od-od-quick", el);
    if (odQuick) odQuick.onclick = openFiles;
    const odSet = $("#od-onedrive-set", el);
    if (odSet) odSet.onclick = () => this.linkDialog(o.id);

    $$("[data-op-act]", el).forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const act = b.dataset.opAct, opId = b.dataset.op;
        if (act === "start") M.startOp(o.id, opId, App.me.id);
        if (act === "pause") M.pauseOp(o.id, opId, App.me.id);
        if (act === "done") {
          if (!App.tapGuard()) return;            // reflex double-tap
          const op = o.ops.find(x => x.id === opId);
          const item = D.item(o, op.itemId);
          const next = M.completeOp(o.id, opId, App.me.id);
          if (op.status !== "done") {
            Toast.show(`Reported ${op.qtyDone} of ${item.qty} pcs — waiting for upstream`, { emoji: "⏳", ms: 4200 });
          } else if (next) {
            Toast.show(`Step done → next: ${D.station(next.stationId).name}`, { emoji: "✅" });
          } else {
            Toast.show(o.ops.every(x => x.status === "done") ? `${o.num} is ready to ship!` : "Step done", { emoji: "🎉" });
          }
        }
        if (act === "unblock") M.unblockOp(o.id, opId, App.me.id);
        if (act === "reopen") M.reopenOp(o.id, opId, App.me.id);
        if (act === "block") { this.blockDialog(o.id, opId); return; }
        App.render();
      };
    });

    /* ticking a cabinet reports it — no second number to reconcile */
    $$("[data-mod]", el).forEach(c => c.onchange = () => {
      const m = D.module(o, c.dataset.mod);
      M.setModuleDone(o.id, c.dataset.mod, c.checked ? (m.qty || 1) : 0, App.me.id);
      App.render(); Drawer.refresh();
    });
    const modAll = $("#mod-all", el);
    if (modAll) modAll.onclick = () => {
      for (const m of D.orderModules(o)) M.setModuleDone(o.id, m.id, m.qty || 1, App.me.id);
      App.render(); Drawer.refresh();
    };
    const modNone = $("#mod-none", el);
    if (modNone) modNone.onclick = () => {
      for (const m of D.orderModules(o)) M.setModuleDone(o.id, m.id, 0, App.me.id);
      App.render(); Drawer.refresh();
    };
    const modCount = $("#mod-count", el);
    if (modCount) modCount.onclick = () => this.moduleCountModal(o.id);
    const asmQty = $("#od-asm-qty", el);
    if (asmQty) asmQty.onclick = () => this.moduleCountModal(o.id);
    $$("[data-mod-name]", el).forEach(b => b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();          // do not toggle the tick
      const m = D.module(o, b.dataset.modName);
      const next = prompt(I18N.t("What is this cabinet called?"), m.name);
      if (next === null) return;
      M.renameModule(o.id, m.id, next, App.me.id);
      App.render(); Drawer.refresh();
    });

    /* picking a crew: a popover of tick boxes, because more than one person
       works a bench and a <select> can only ever say one name */
    $$("[data-crew]", el).forEach(btn => btn.onclick = () => {
      const opId = btn.dataset.crew;
      const op = o.ops.find(x => x.id === opId);
      const eligible = Store.state.members.filter(m =>
        (o.type === "eng" ? (m.role === "manager" || m.role === "engineer")
                          : (m.role === "worker" || m.role === "manager"))
        || D.opAssignedTo(op, m.id));
      Popover.open(btn, `<div class="crew-pick">
        ${eligible.map(m => `<label class="crew-row">
          <input type="checkbox" data-crew-m="${m.id}" ${D.opAssignedTo(op, m.id) ? "checked" : ""}>
          ${avatarHtml(m, "sm")}<span class="grow">${esc(m.name)}</span>
          <span class="t-caption">${esc(m.trade || m.role)}</span>
        </label>`).join("")}
        <button class="crew-clear" data-crew-none>Nobody</button>
      </div>`, (pop) => {
        const apply = () => {
          const ids = $$("[data-crew-m]", pop).filter(c => c.checked).map(c => c.dataset.crewM);
          M.setOpAssignees(o.id, opId, ids, App.me.id);
          App.render(); Drawer.refresh();
        };
        $$("[data-crew-m]", pop).forEach(c => c.onchange = apply);
        $("[data-crew-none]", pop).onclick = () => { M.setOpAssignees(o.id, opId, [], App.me.id); Popover.close(); App.render(); Drawer.refresh(); };
      });
    });

    /* Piece reporting (+/− produced qty) */
    $$("[data-op-qty]", el).forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const [opId, delta] = b.dataset.opQty.split("/");
      const op = o.ops.find(x => x.id === opId);
      const item = D.item(o, op.itemId);
      const before = op.qtyDone;
      M.reportQty(o.id, opId, op.qtyDone + parseInt(delta), App.me.id);
      if (op.status === "done" && before < item.qty) Toast.show(`${D.station(op.stationId).name} complete — all ${item.qty} pcs`, { emoji: "🎉" });
      App.render();
    });

    /* Routing editor */
    $$("[data-op-move]", el).forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const [opId, dir] = b.dataset.opMove.split("/");
      if (M.moveOp(o.id, opId, parseInt(dir), App.me.id)) App.render();
    });
    $$("[data-op-del]", el).forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const snap = Store.snapshot();
      if (M.removeOp(o.id, b.dataset.opDel, App.me.id)) {
        App.render();
        Toast.show("Step removed", { undo: () => { Store.restore(snap); App.render(); } });
      }
    });
    const addStep = $("#od-add-step", el);
    if (addStep) addStep.onclick = () => {
      const kind = o.type === "eng" ? "eng" : "prod";
      Popover.open(addStep, `
        <div class="opt-title">Add ${o.type === "eng" ? "stage" : "routing step"}</div>
        <div class="opt-row"><select class="select" id="as-station" style="flex:1">
          ${D.stationsOf(kind).map(st => `<option value="${st.id}">${esc(st.name)}</option>`).join("")}
        </select></div>
        ${o.items.length > 1 ? `<div class="opt-row"><select class="select" id="as-item" style="flex:1">
          ${o.items.map(it => `<option value="${it.id}">${esc(it.name)} ×${it.qty}</option>`).join("")}
        </select></div>` : ""}
        <div class="opt-row" id="as-group-row"></div>
        <div class="opt-row"><span class="grow" style="font-size:12.5px;color:var(--text-2)">Estimate</span>
          <input class="input" id="as-est" type="number" min="5" value="60" style="width:74px;text-align:right;padding:6px 9px"><span class="t-caption">min</span></div>
      <div class="opt-row"><button class="btn primary" id="as-add" style="flex:1">Add step</button></div>
      `, (pop) => {
        const sel = $("#as-station", pop);
        const itemSel = $("#as-item", pop);
        const groupRow = $("#as-group-row", pop);
        const renderGroups = () => {
          const itemId = itemSel ? itemSel.value : o.items[0].id;
          const groups = D.itemGroups(o, itemId);
          groupRow.innerHTML = groups.length ? `<select class="select" id="as-group" style="flex:1">
            ${groups.map(g => `<option value="${esc(g)}">${esc(g)} lane</option>`).join("")}
            <option value="">Final lane</option>
          </select>` : "";
        };
        renderGroups();
        if (itemSel) itemSel.onchange = renderGroups;
        sel.onchange = () => { $("#as-est", pop).value = D.station(sel.value)?.estMins || 60; };
        sel.onchange();
        $("#as-add", pop).onclick = () => {
          const itemId = itemSel ? itemSel.value : o.items[0].id;
          const groupSel = $("#as-group", pop);
          const group = groupSel && groupSel.value ? groupSel.value : null;
          M.addOp(o.id, sel.value, parseInt($("#as-est", pop).value) || 60, App.me.id, itemId, group);
          Popover.close(); App.render();
          Toast.show(`${D.station(sel.value).name} added to routing`, { emoji: "✦" });
        };
      });
    };

    /* Materials */
    $$("[data-consume]", el).forEach(b => b.onclick = () => {
      const line = o.materials.find(l => l.id === b.dataset.consume);
      const mat = D.material(line.materialId);
      const wasShort = D.lineShort(line);
      M.consumeLine(o.id, line.id, App.me.id);
      App.render();
      Toast.show(`Used ${line.qty} ${mat.unit} ${mat.name}`, { emoji: "📤" });
      const nm = D.material(mat.id);
      if (wasShort || nm.qty <= nm.minQty) Toast.show(`${mat.name}: ${nm.qty} ${mat.unit} left${nm.qty < 0 ? " — negative stock!" : " — low"}`, { emoji: "📉", ms: 4200 });
    });
    $$("[data-line-del]", el).forEach(b => b.onclick = () => {
      if (M.removeOrderMaterial(o.id, b.dataset.lineDel, App.me.id)) App.render();
    });
    const matAdd = $("#od-mat-add", el);
    if (matAdd) matAdd.onclick = () => {
      const sel = $("#od-mat-sel", el), qty = parseFloat($("#od-mat-qty", el).value);
      if (!sel.value) { sel.focus(); return; }
      if (!qty || qty <= 0) { $("#od-mat-qty", el).focus(); return; }
      M.addOrderMaterial(o.id, sel.value, qty, App.me.id);
      App.render();
    };

    const partsAll = $("#od-parts-all", el);
    if (partsAll) partsAll.onclick = () => { this.showAllParts = true; Drawer.refresh(); };

    /* History expand */
    const histAll = $("#od-hist-all", el);
    if (histAll) histAll.onclick = () => { this.showAllHist = true; Drawer.refresh(); };

    /* Comments — anyone on the job can post; @mentions notify */
    const cIn = $("#od-c-input", el), cAdd = $("#od-c-add", el);
    if (cIn) {
      const post = () => {
        const text = cIn.value.trim(); if (!text) return;
        const c = M.addOrderComment(o.id, text, App.me.id);
        cIn.value = "";
        Drawer.refresh(); App.render();
        const named = (c?.mentions || []).filter(id => id !== App.me.id).map(id => D.member(id)?.name).filter(Boolean);
        if (named.length) Toast.show(`${named.join(", ")} notified`, { emoji: "bell" });
        setTimeout(() => $("#od-c-input")?.focus(), 40);
      };
      Mentions.attach(cIn, post);
      if (cAdd) cAdd.onclick = post;
    }
    $$("[data-oc-del]", el).forEach(b => b.onclick = () => {
      M.deleteOrderComment(o.id, b.dataset.ocDel, App.me.id); Drawer.refresh();
    });

    if (inCockpit) {
      const editBtn = $("#od-edit", el);
      if (editBtn) editBtn.onclick = () => this.editOrderModal(o.id);
      const due = $("#od-due", el);
      if (due) due.onchange = () => {
        M.updateOrderLogged(o.id, { due: new Date(due.value + "T12:00:00").getTime() }, App.me.id);
        App.render();
      };
      const prio = $("#od-prio", el);
      if (prio) prio.onchange = () => { M.updateOrderLogged(o.id, { priority: prio.value }, App.me.id); App.render(); };
      /* attachments on the project — bind() is a different scope from the
         template, so the permission is read again here rather than borrowed */
      Files.bindChips(el, { onRemove: () => Drawer.refresh() });
      if (App.can("orders.edit")) Files.bindDrop(el, "od-files-in", async (picked) => {
        for (const f of picked) {
          try { await Files.attach(f, { orderId: o.id }, App.me.id); }
          catch (e) { Toast.show(e.message, { emoji: "alert", ms: 5000 }); }
        }
        App.render(); Drawer.refresh();
        Toast.show(`${picked.length} attached`, { emoji: "check" });
      });

      const notes = $("#od-notes", el);
      if (notes) notes.onchange = () => { M.updateOrderLogged(o.id, { notes: notes.value }, App.me.id); };
      const pf = $("#od-portfolio", el);
      if (pf) pf.onchange = () => { M.updateOrderLogged(o.id, { portfolioId: pf.value || null }, App.me.id); App.render(); };
      const ship = $("#od-ship", el);
      if (ship) ship.onclick = () => {
        M.shipOrder(o.id, App.me.id); Drawer.close(); App.render();
        Toast.show(`${o.num} ${o.type === "eng" ? "delivered" : "shipped"} & archived`, { emoji: o.type === "eng" ? "check-circle" : "truck" });
      };
      const copyBtn = $("#od-copy", el);
      if (copyBtn) copyBtn.onclick = () => this.copyOrderModal(o.id);
      const fixRoute = $("#od-fixroute", el);
      if (fixRoute) fixRoute.onclick = () => {
        const snap = Store.snapshot();
        const n = M.repairSwoodRoute(o.id, App.me.id);
        App.render(); Drawer.refresh();
        Toast.show(n ? `${n} step${n > 1 ? "s" : ""} added — nothing already done was touched` : "Nothing to add",
          { emoji: n ? "check" : "info", undo: n ? () => { Store.restore(snap); App.render(); Drawer.refresh(); } : null });
      };
      const archiveBtn = $("#od-archive", el);
      if (archiveBtn) archiveBtn.onclick = () => {
        const snap = Store.snapshot();
        M.archiveOrder(o.id, App.me.id); Drawer.close(); App.render();
        Toast.show(`${o.num} archived`, { emoji: "archive", undo: () => { Store.restore(snap); App.render(); } });
      };
      const restore = $("#od-restore", el);
      if (restore) restore.onclick = () => { M.unarchiveOrder(o.id, App.me.id); App.render(); Drawer.refresh(); Toast.show(`${o.num} restored`, { emoji: "history" }); };
      const handoff = $("#od-handoff", el);
      if (handoff) handoff.onclick = () => this.handoffModal(o.id);
      const approve = $("#od-approve", el);
      if (approve) approve.onclick = () => {
        const engineers = M.confirmClientApproval(o.id, App.me.id);
        Drawer.refresh(); App.render();
        Toast.show(engineers.length ? `Client approval confirmed — ${engineers.map(id => D.member(id)?.name).filter(Boolean).join(", ")} notified` : "Client approval confirmed", { emoji: "handshake", ms: 4000 });
      };
      const unapprove = $("#od-unapprove", el);
      if (unapprove) unapprove.onclick = () => { M.revokeClientApproval(o.id, App.me.id); Drawer.refresh(); App.render(); };
      $$("[data-open-order]", el).forEach(b => b.onclick = () => Drawer.open(b.dataset.openOrder));
      const del = $("#od-delete", el);
      if (del) del.onclick = () => {
        const snap = Store.snapshot();
        M.deleteOrder(o.id, App.me.id); Drawer.close(); App.render();
        Toast.show(`${o.num} deleted`, { undo: () => { Store.restore(snap); App.render(); } });
      };
    }
  },

  /* Copy a project — a fresh job from a proven one. The name must be free:
     two live projects with the same name is how the wrong one gets shipped. */
  copyOrderModal(orderId) {
    const o = D.order(orderId);
    const isEng = o.type === "eng";
    const suggested = D.uniqueName(o.product, n => D.projectNameTaken(n));
    Modal.open(`
      <header><h2>Copy ${isEng ? "project" : "order"}</h2><button class="icon-btn" data-close>✕</button></header>
      <div class="modal-body">
        <div class="t-caption"><b>${esc(o.num)}</b></div>
        <div class="t-caption">Copies the product structure and the full route. Progress, logged time and comments start fresh.</div>
        <div class="field"><label>New name</label>
          <input class="input" id="cp-name" value="${esc(suggested)}" autocomplete="off">
          <span class="t-caption" id="cp-warn" style="color:var(--red);min-height:15px"></span>
        </div>
        <label class="check-row"><input type="checkbox" id="cp-mats" checked> Copy the material list (nothing consumed yet)</label>
        <label class="check-row"><input type="checkbox" id="cp-assign"> Keep the same people assigned to each step</label>
      </div>
      <footer><button class="btn" data-close>Cancel</button>
        <button class="btn primary" id="cp-go">${icon("copy", 14)} Create copy</button></footer>`, (m) => {
      const name = $("#cp-name", m), warn = $("#cp-warn", m), go = $("#cp-go", m);
      const check = () => {
        const v = name.value.trim();
        const bad = !v ? "Give the copy a name" : D.projectNameTaken(v) ? "That name is already used by another project" : "";
        warn.textContent = bad; go.disabled = !!bad;
        return !bad;
      };
      name.oninput = check; check();
      name.onkeydown = (e) => { if (e.key === "Enter") go.click(); };
      go.onclick = () => {
        if (!check()) return;
        const copy = M.duplicateOrder(o.id, {
          name: name.value.trim(),
          copyMaterials: $("#cp-mats", m).checked,
          copyAssignees: $("#cp-assign", m).checked,
        }, App.me.id);
        Modal.close(); App.render();
        Drawer.open(copy.id);
        Toast.show(`${copy.num} created from ${o.num}`, { emoji: "copy" });
      };
    });
  },

  editOrderModal(orderId) {
    const o = D.order(orderId);
    Modal.open(`
      <header><h2>Edit order</h2><button class="icon-btn" data-close>✕</button></header>
      <div class="modal-body">
        <div class="field"><label>Product / job</label><input class="input" id="eo-product" value="${esc(o.product)}"></div>
        <div class="field"><label>Client</label>
          <input class="input" id="eo-client" value="${esc(o.client)}" list="shared-customers" autocomplete="off">
          ${typeof Bridge !== "undefined" ? Bridge.datalistHtml() : ""}</div>
        <div class="form-row">
          <div class="field"><label>Quantity</label>
            <input class="input" id="eo-qty" type="number" min="1" value="${o.qty}" ${o.swood ? "disabled" : ""}>
            ${o.swood
              ? `<span class="t-caption">Comes from the SWOOD part list — change it by re-importing.</span>`
              : o.items.length > 1
                ? `<span class="t-caption">Spread across ${o.items.length} lines, in proportion.</span>` : ""}</div>
          <div class="field"><label>Unit</label><input class="input" id="eo-unit" value="${esc(o.unit)}"></div>
        </div>
        <div class="field"><label>OneDrive folder link ${D.projectLinkIsAuto(o) ? `<span class="t-caption">— leave blank to use the auto link</span>` : ""}</label>
          <input class="input" id="eo-onedrive" value="${esc(o.oneDriveUrl || "")}" placeholder="${esc(D.projectLink(o) || "https://onedrive.live.com/…")}">
          ${D.projectLinkIsAuto(o) ? `<span class="t-caption">Auto: ${esc(D.projectLink(o))}</span>` : ""}
        </div>
        <div class="t-caption">Every change is recorded in the order history with your name.</div>
      </div>
      <footer>
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="eo-save">Save changes</button>
      </footer>
    `, (modal) => {
      $$("[data-close]", modal).forEach(b => b.onclick = () => Modal.close());
      $("#eo-save", modal).onclick = () => {
        const n = M.updateOrderLogged(o.id, {
          product: $("#eo-product", modal).value.trim() || o.product,
          client: $("#eo-client", modal).value.trim() || o.client,
          // a name a person actually submitted may create the shared record
          customerId: (typeof Bridge !== "undefined"
            && Bridge.resolveClient($("#eo-client", modal).value.trim() || o.client)) || o.customerId || null,
          unit: $("#eo-unit", modal).value.trim() || o.unit,
          oneDriveUrl: $("#eo-onedrive", modal).value.trim(),
        }, App.me.id);
        /* quantity is not a field on the order — it is the sum of the items,
           and every task counts against those, so it goes through its own
           mutation rather than being assigned over the top */
        const qEl = $("#eo-qty", modal);
        const q = qEl.disabled ? null : M.setOrderQty(o.id, qEl.valueAsNumber, App.me.id);
        Modal.close(); App.render(); Drawer.refresh();
        Toast.show(q
          ? `Now making ${q.qty} ${esc(o.unit || "pcs")}${q.reopened ? ` — ${q.reopened} task${q.reopened > 1 ? "s" : ""} reopened, there is more to make` : ""}`
          : n ? "Order updated — logged in history" : "No changes",
          { emoji: q || n ? "✓" : "•", ms: q && q.reopened ? 5200 : 3200 });
      };
    });
  },

  handoffModal(engId) {
    const eng = D.order(engId);
    Modal.open(`
      <header><h2>Hand off to production</h2><button class="icon-btn" data-close>${icon("x", 15)}</button></header>
      <div class="modal-body">
        <div class="t-caption">Creates a manufacturing project from <b>${esc(eng.num)} · ${esc(eng.product)}</b> and archives the design project. Client, portfolio and files carry over.</div>
        <div class="field"><label>Manufacturing routing — production steps this job goes through</label>
          <div class="route-picker">
            ${D.stationsOf("prod").map(st => `
              <div class="route-pick on" data-st="${st.id}">
                <span class="chk">✓</span>
                <span class="ico" style="color:var(--text-2)">${stIcon(st, 16)}</span><b>${esc(st.name)}</b>
                <input type="number" min="5" value="${st.estMins}" data-est onclick="event.stopPropagation()"><span class="unit">min</span>
              </div>`).join("")}
          </div>
        </div>
        <div class="t-caption">Tip: set the part count later (or via a scanned import) so progress is exact.</div>
      </div>
      <footer>
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="ho-create">${icon("factory", 14)} Create manufacturing project</button>
      </footer>
    `, (modal) => {
      $$("[data-close]", modal).forEach(b => b.onclick = () => Modal.close());
      $$(".route-pick", modal).forEach(rp => { rp.onclick = () => rp.classList.toggle("on"); });
      $("#ho-create", modal).onclick = () => {
        const route = $$(".route-pick.on", modal).map(rp => ({ stationId: rp.dataset.st, estMins: parseInt($("[data-est]", rp).value) || 60 }));
        if (!route.length) { Toast.show("Pick at least one station", { emoji: "alert" }); return; }
        const prod = M.handoffToProduction(engId, { route }, App.me.id);
        Modal.close(); Drawer.open(prod.id); App.render();
        Toast.show(`${prod.num} created from ${eng.num}`, { emoji: "factory", ms: 4000 });
      };
    });
  },

  linkDialog(orderId) {
    const o = D.order(orderId);
    const base = Store.state.oneDrive?.baseUrl;
    Modal.open(`
      <header><h2>Link project files</h2><button class="icon-btn" data-close>${icon("x", 15)}</button></header>
      <div class="modal-body">
        <div class="field"><label>OneDrive / SharePoint folder for ${esc(o.num)}</label>
          <input class="input" id="ld-url" placeholder="https://onedrive.live.com/…" value="${esc(o.oneDriveUrl || "")}">
        </div>
        ${base ? `<div class="t-caption">Tip: set a base folder in Settings and projects auto-link by code — no need to paste each one.</div>`
               : `<div class="t-caption">Paste this project's folder link, or set a base folder in Settings to auto-link every project by its code.</div>`}
      </div>
      <footer>
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="ld-save">Save link</button>
      </footer>
    `, (modal) => {
      $$("[data-close]", modal).forEach(b => b.onclick = () => Modal.close());
      const save = () => {
        M.updateOrderLogged(o.id, { oneDriveUrl: $("#ld-url", modal).value.trim() }, App.me.id);
        Modal.close(); Drawer.refresh();
        Toast.show("Project files linked", { emoji: "cloud" });
      };
      $("#ld-save", modal).onclick = save;
      $("#ld-url", modal).onkeydown = (e) => { if (e.key === "Enter") save(); };
    });
  },

  /* Opened from the card and from the step inside a project. If the step is
     already blocked it edits that note rather than making a second one, and
     offers the way out — "fixed" is as important to record as "stuck". */
  blockDialog(orderId, opId) {
    const o = D.order(orderId);
    const op = o && o.ops.find(x => x.id === opId);
    if (!op) return;
    const was = op.status === "blocked";
    const st = D.station(op.stationId);

    Modal.open(`
      <header><h2>${was ? "This step is blocked" : "Report a problem"}</h2><button class="icon-btn" data-close>${icon("x", 15)}</button></header>
      <div class="modal-body">
        <div class="t-caption" style="margin-bottom:10px">${esc(o.product || o.num)}${st ? ` · ${esc(st.name)}` : ""}</div>
        <div class="field"><label>What's blocking this step?</label>
          <input class="input" id="block-note" value="${esc(was ? (op.blockNote || "") : "")}"
            placeholder="e.g. Reik pakeisti 4 lankstus / neužsidaro durys"></div>
        <div class="t-caption" style="margin-top:8px">It shows on the card, on the project, and in Needs attention until it is cleared.</div>
      </div>
      <footer>
        ${was ? `<button class="btn" id="block-clear">${icon("check", 13)} Problem solved</button>` : ""}
        <div class="grow"></div>
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn danger" id="block-save">${icon("ban", 13)} ${was ? "Save" : "Mark blocked"}</button>
      </footer>
    `, (modal) => {
      $$("[data-close]", modal).forEach(b => b.onclick = () => Modal.close());
      const save = () => {
        const note = $("#block-note", modal).value.trim() || "Blocked";
        M.blockOp(orderId, opId, App.me.id, note);
        Modal.close(); App.render(); Drawer.refresh();
        Toast.show(was ? "Problem updated" : "Marked blocked — managers can see it", { emoji: "ban" });
      };
      $("#block-save", modal).onclick = save;
      const input = $("#block-note", modal);
      input.onkeydown = (e) => { if (e.key === "Enter") save(); };
      setTimeout(() => input.focus(), 60);
      const clear = $("#block-clear", modal);
      if (clear) clear.onclick = () => {
        M.unblockOp(orderId, opId, App.me.id);
        Modal.close(); App.render(); Drawer.refresh();
        Toast.show("Unblocked — back in the queue", { emoji: "check" });
      };
    });
  },
};

/* ============================================================
   New order modal — Standard articles / Custom job / Engineering
   ============================================================ */
const NewOrder = {
  mode: "articles", // articles | custom | eng
  draft: {},        // survives mode switches so typed fields aren't lost

  _pending: null,      // files chosen before the project exists

  open() {
    this.mode = App.isEngineer() ? "eng" : (Store.state.articles.length ? "articles" : "custom");
    this.draft = {};
    this._pending = [];
    this.render();
  },

  captureDraft(modal) {
    const v = (sel) => { const el = $(sel, modal); return el ? el.value : undefined; };
    this.draft = {
      product: v("#no-product") ?? this.draft.product,
      client: v("#no-client") ?? this.draft.client,
      portfolio: v("#no-portfolio") ?? this.draft.portfolio,
      due: v("#no-due") ?? this.draft.due,
      prio: v("#no-prio") ?? this.draft.prio,
      notes: v("#no-notes") ?? this.draft.notes,
    };
  },

  render() {
    const s = Store.state;
    const d = this.draft;
    const defaultDue = d.due || new Date(Date.now() + 14 * DAY).toISOString().slice(0, 10);
    const mode = this.mode;
    const isEng = mode === "eng";
    Modal.open(`
      <header><h2>${isEng ? "New engineering project" : "New order"}</h2><button class="icon-btn" data-close>✕</button></header>
      <div class="modal-body">
        ${App.isEngineer() ? "" : `<div class="segmented" style="align-self:flex-start">
          <button data-mode="articles" class="${mode === "articles" ? "active" : ""}">${icon("box", 13)} Standard articles</button>
          <button data-mode="custom" class="${mode === "custom" ? "active" : ""}">${icon("toolbox", 13)} Custom job</button>
          <button data-mode="eng" class="${mode === "eng" ? "active" : ""}">${icon("pencil", 13)} Engineering</button>
        </div>`}

        <div class="field"><label>${isEng ? "Project name" : "Product / job"}</label>
          <input class="input" id="no-product" value="${esc(d.product || "")}" placeholder="${isEng ? "e.g. Bar counter — drawings & CNC programs" : "e.g. Oak kitchen — Client St. 5"}"></div>
        <div class="form-row">
          <div class="field"><label>Client</label>
            <input class="input" id="no-client" value="${esc(d.client || "")}" placeholder="Client name" list="shared-customers" autocomplete="off">
            ${typeof Bridge !== "undefined" ? Bridge.datalistHtml() : ""}</div>
          <div class="field"><label>Portfolio</label>
            <select class="select" id="no-portfolio">
              <option value="">None</option>
              ${s.portfolios.map(p => `<option value="${p.id}" ${d.portfolio === p.id ? "selected" : ""}>${p.icon} ${esc(p.name)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="field"><label>Due date</label><input class="input" id="no-due" type="date" value="${defaultDue}"></div>
          <div class="field"><label>Priority</label>
            <select class="select" id="no-prio">
              ${[["normal", "Normal"], ["high", "High"], ["rush", "🔥 Rush"], ["low", "Low"]]
                .map(([v, l]) => `<option value="${v}" ${d.prio === v ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </div>
        </div>

        ${mode === "articles" ? `
        <div class="field"><label>Articles & quantities — routing tasks are created automatically per part group</label>
          <div id="no-lines">
            <div class="mat-add-row no-line" style="margin-bottom:7px">
              <select class="select" data-line-art>
                ${s.articles.map(a => `<option value="${a.id}">${esc(a.name)} (${esc(a.sku)})</option>`).join("")}
              </select>
              <input class="input" data-line-qty type="number" min="1" value="1">
              <button class="mini-btn danger" data-line-del style="visibility:hidden">✕</button>
            </div>
          </div>
          <button class="add-inline" id="no-add-line" style="align-self:flex-start">+ Add another article</button>
          <div class="t-caption" id="no-task-preview" style="margin-top:6px"></div>
        </div>` : ""}

        ${mode === "custom" ? `
        <div class="form-row">
          <div class="field"><label>Quantity</label><input class="input" id="no-qty" type="number" min="1" value="1"></div>
          <div class="field"><label>Unit</label><input class="input" id="no-unit" value="units"></div>
        </div>
        <div class="field"><label>Routing — which stations does this job go through?</label>
          <div class="route-picker">
            ${D.stationsOf("prod").map(st => `
              <div class="route-pick on" data-st="${st.id}">
                <span class="chk">✓</span>
                <span class="ico" style="color:var(--text-2)">${stIcon(st, 16)}</span><b>${esc(st.name)}</b>
                <input type="number" min="5" value="${st.estMins}" data-est onclick="event.stopPropagation()"><span class="unit">min</span>
              </div>`).join("")}
          </div>
        </div>` : ""}

        ${isEng ? `
        <div class="field"><label>Stages</label>
          <div class="route-picker">
            ${D.stationsOf("eng").map(st => `
              <div class="route-pick on" data-st="${st.id}">
                <span class="chk">✓</span>
                <span class="ico" style="color:var(--text-2)">${stIcon(st, 16)}</span><b>${esc(st.name)}</b>
                <input type="number" min="5" value="${st.estMins}" data-est onclick="event.stopPropagation()"><span class="unit">min</span>
              </div>`).join("")}
          </div>
        </div>` : ""}

        <div class="field"><label>Notes (optional)</label><textarea class="input" id="no-notes" placeholder="${isEng ? "Scope, references, links…" : "Materials, hardware, finishes…"}">${esc(d.notes || "")}</textarea></div>
        <div class="field"><label>Drawings &amp; photos</label>
          ${Files.dropHtml("no-files")}
          <div id="no-files-list">${this._pending && this._pending.length
            ? `<div class="file-chips">${this._pending.map((f, i) => `<button class="file-chip img" type="button" data-pend-rm="${i}">
                ${f.preview ? `<img src="${f.preview}" alt="">` : `<span class="ico">${icon("box", 18)}</span>`}
                <span class="nm">${esc(f.file.name)}</span><span class="rm">${icon("x", 11)}</span></button>`).join("")}</div>`
            : ""}</div></div>
      </div>
      <footer>
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary lg" id="no-create">${isEng ? "Create project" : "Create order"}</button>
      </footer>
    `, (modal) => {
      $$("[data-close]", modal).forEach(b => b.onclick = () => Modal.close());
      $$("[data-mode]", modal).forEach(b => b.onclick = () => {
        this.captureDraft(modal); // keep what's typed when switching modes
        this.mode = b.dataset.mode;
        this.render();
      });
      $$(".route-pick", modal).forEach(rp => { rp.onclick = () => rp.classList.toggle("on"); });

      /* article lines */
      const linesEl = $("#no-lines", modal);
      const preview = () => {
        const pv = $("#no-task-preview", modal);
        if (!pv) return;
        let tasks = 0, pcs = 0;
        $$(".no-line", modal).forEach(row => {
          const art = D.article($("[data-line-art]", row).value);
          const q = parseInt($("[data-line-qty]", row).value) || 0;
          if (art && q > 0) { tasks += art.lanes.reduce((n, l) => n + l.route.length, 0); pcs += q; }
        });
        pv.textContent = tasks ? `Will create ${tasks} tasks across part groups for ${pcs} pcs — e.g. Cutting runs separately for facades and carcass.` : "";
      };
      if (linesEl) {
        const bindLine = (row) => {
          $("[data-line-art]", row).onchange = preview;
          $("[data-line-qty]", row).oninput = preview;
          $("[data-line-del]", row).onclick = () => { row.remove(); preview(); };
        };
        $$(".no-line", linesEl).forEach(bindLine);
        $("#no-add-line", modal).onclick = () => {
          const row = $(".no-line", linesEl).cloneNode(true);
          $("[data-line-qty]", row).value = 1;
          $("[data-line-del]", row).style.visibility = "visible";
          linesEl.appendChild(row);
          bindLine(row);
          preview();
        };
        preview();
      }

      /* A project has no id until it is created, so the files wait here with a
         preview the person can check and remove before committing. */
      Files.bindDrop(modal, "no-files", async (picked) => {
        this._pending = this._pending || [];
        for (const file of picked) {
          const preview = Files.isImage(file.type)
            ? await Files._draw(file, 220, 0.7).then(r => r.dataUrl).catch(() => "")
            : "";
          this._pending.push({ file, preview });
        }
        this.captureDraft(modal);
        this.render();                              // re-render with the previews
      });
      $$("[data-pend-rm]", modal).forEach(b => b.onclick = () => {
        this._pending.splice(+b.dataset.pendRm, 1);
        this.captureDraft(modal);
        this.render();
      });

      $("#no-create", modal).onclick = () => {
        const mode2 = this.mode;
        const client = $("#no-client", modal).value.trim();
        let product = $("#no-product", modal).value.trim();
        if (!client) { $("#no-client", modal).focus(); return; }
        const base = {
          client,
          priority: $("#no-prio", modal).value,
          due: new Date($("#no-due", modal).value + "T12:00:00").getTime(),
          notes: $("#no-notes", modal).value.trim(),
          portfolioId: $("#no-portfolio", modal).value || null,
        };
        let order;
        if (mode2 === "articles") {
          const lines = $$(".no-line", modal).map(row => ({
            articleId: $("[data-line-art]", row).value,
            qty: parseInt($("[data-line-qty]", row).value) || 1,
          })).filter(l => l.qty > 0 && l.articleId && D.article(l.articleId));
          if (!lines.length) { Toast.show(Store.state.articles.length ? "Add at least one article" : "No articles yet — define them in Warehouse → Articles, or use Custom job", { emoji: "⚠️", ms: 4500 }); return; }
          if (!product) product = lines.map(l => `${D.article(l.articleId).name} ×${l.qty}`).join(", ");
          order = M.createOrder({ type: "prod", product, unit: "pcs", lines, ...base }, App.me.id);
        } else if (mode2 === "eng") {
          if (!product) { $("#no-product", modal).focus(); return; }
          const stages = $$(".route-pick.on", modal).map(rp => rp.dataset.st);
          if (!stages.length) { Toast.show("Pick at least one stage", { emoji: "⚠️" }); return; }
          order = M.createOrder({ type: "eng", product, stages, ...base }, App.me.id);
        } else {
          if (!product) { $("#no-product", modal).focus(); return; }
          const route = $$(".route-pick.on", modal).map(rp => ({
            stationId: rp.dataset.st,
            estMins: parseInt($("[data-est]", rp).value) || 60,
          }));
          if (!route.length) { Toast.show("Pick at least one station", { emoji: "⚠️" }); return; }
          order = M.createOrder({
            type: "prod", product,
            qty: parseInt($("#no-qty", modal).value) || 1,
            unit: $("#no-unit", modal).value.trim() || "units",
            route, ...base,
          }, App.me.id);
        }
        // a client name someone actually submitted may create the shared record
        if (typeof Bridge !== "undefined") {
          const cid = Bridge.resolveClient(client);
          if (cid) { order.customerId = cid; Store.save(); }
        }
        const waiting = this._pending || [];
        this._pending = [];
        Modal.close(); App.render();
        Toast.show(`${order.num} created — ${order.ops.length} tasks`, { emoji: "🎉" });
        Drawer.open(order.id);
        if (waiting.length) (async () => {
          for (const p of waiting) {
            try { await Files.attach(p.file, { orderId: order.id }, App.me.id); }
            catch (e) { Toast.show(e.message, { emoji: "alert", ms: 5000 }); }
          }
          App.render(); Drawer.refresh();
          Toast.show(`${waiting.length} file${waiting.length > 1 ? "s" : ""} attached to ${order.num}`, { emoji: "check" });
        })();
      };
    });
  },
};
