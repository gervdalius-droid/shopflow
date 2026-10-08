/* ============================================================
   files.js — drawings and photos, on the job and on the task

   WHERE THE BYTES GO, and why. Supabase Storage holds the file — that is the
   copy the whole shop reads. Two things sit in front of it:

     • IndexedDB   a local cache, so a preview is instant and a drawing still
                   opens with no network
     • a thumbnail in state, a few KB, so every device can SEE an attachment
                   before it has fetched the full thing

   State never carries the file itself: Sync.push() sends the WHOLE state
   document on every change, so a drawing living there would be re-uploaded
   every time anyone edited anything.

   An upload that fails is marked, not lost — flush() retries on boot and when
   the network returns, so a photo taken on a tablet with no signal still
   reaches the shop. With no bucket configured at all it degrades to
   local-only and says so on the file itself.
   ============================================================ */
"use strict";

const Files = {
  DB: "shopflow.files", STORE: "blobs", VERSION: 1,
  MAX_BYTES: 12 * 1024 * 1024,      // a phone photo, not a CAD archive
  FULL_PX: 2000,                    // plenty to read a dimension off a drawing
  THUMB_PX: 220,
  BUCKET: "shopflow",

  _db: null,
  _urls: new Map(),

  /* ---------- the local blob store ---------- */
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB, this.VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.STORE)) db.createObjectStore(this.STORE);
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },
  async _tx(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, mode);
      const req = fn(tx.objectStore(this.STORE));
      tx.onerror = () => reject(tx.error);
      if (req) req.onsuccess = () => resolve(req.result);
      else tx.oncomplete = () => resolve();
    });
  },
  putBlob(id, blob) { return this._tx("readwrite", (s) => s.put(blob, id)); },
  getBlob(id) { return this._tx("readonly", (s) => s.get(id)); },
  delBlob(id) { return this._tx("readwrite", (s) => s.delete(id)); },

  /* ---------- making a file small enough to be useful ---------- */
  isImage: (type) => /^image\//.test(type || ""),

  async _draw(file, maxPx, quality) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", quality));
    return { blob, w, h, dataUrl: canvas.toDataURL("image/jpeg", quality) };
  },

  /* ---------- attaching ---------- */
  async attach(file, { orderId = null, opId = null } = {}, byId) {
    if (!file) return null;
    if (file.size > this.MAX_BYTES)
      throw new Error(`${file.name} is ${Math.round(file.size / 1048576)} MB — the limit is ${this.MAX_BYTES / 1048576} MB`);

    const id = uid("f");
    let blob = file, w = null, h = null, thumb = "";

    if (this.isImage(file.type)) {
      /* A 4000px photo of a drawing is no more readable at the saw than a
         2000px one, and it is ten times the bytes to move. */
      const full = await this._draw(file, this.FULL_PX, 0.85);
      if (full.blob && full.blob.size < file.size) blob = full.blob;
      w = full.w; h = full.h;
      thumb = (await this._draw(file, this.THUMB_PX, 0.7)).dataUrl;
    }

    await this.putBlob(id, blob);             // cached locally so the preview is instant
    const meta = M.addFileMeta({
      id, name: file.name, type: file.type || "application/octet-stream",
      size: blob.size, w, h, thumb, orderId, opId,
      path: this.path(id),
      store: this.storage() ? "uploading" : "local",
      devices: [this.deviceId()],
    }, byId);

    if (this.storage()) this.upload(id, blob);   // resolves the status either way
    return meta;
  },

  /* ---------- uploading ----------
     Storage is where an attachment really lives; IndexedDB is a cache in front
     of it. An upload that fails is not lost — it is marked and retried, so a
     drawing added on a tablet with no signal still reaches the shop later. */
  async upload(id, blob) {
    const st = this.storage();
    if (!st) return false;
    try {
      if (!blob) blob = await this.getBlob(id);
      if (!blob) { M.setFileStore(id, "missing"); return false; }
      const meta = D.file(id);
      const { error } = await st.upload(this.path(id), blob, {
        upsert: true, contentType: (meta && meta.type) || blob.type || "application/octet-stream",
      });
      if (error) throw error;
      M.setFileStore(id, "stored");
      if (typeof App !== "undefined" && App.me) App.render();
      return true;
    } catch (e) {
      M.setFileStore(id, "pending", (e && e.message) || "upload failed");
      if (typeof App !== "undefined" && App.me) App.render();
      return false;
    }
  },

  /* Anything that never made it up, tried again — on boot and when the network
     comes back. Only files this device actually holds can be retried. */
  async flush() {
    if (!this.storage()) return 0;
    let n = 0;
    for (const f of D.files()) {
      if (f.store === "stored" || !this.here(f)) continue;
      if (await this.upload(f.id)) n++;
    }
    return n;
  },

  boot() {
    if (typeof window === "undefined") return;
    window.addEventListener("online", () => this.flush());
    setTimeout(() => this.flush(), 4000);     // after sync has had a chance to sign in
  },

  /* Which device holds the full copy. Not identity — just "was it this one". */
  DEV_KEY: "shopflow.device",
  deviceId() {
    let d = localStorage.getItem(this.DEV_KEY);
    if (!d) { d = uid("dev"); localStorage.setItem(this.DEV_KEY, d); }
    return d;
  },
  here(meta) { return (meta.devices || []).includes(this.deviceId()); },

  /* ---------- the copy that travels ---------- */
  storage() {
    if (typeof Sync === "undefined" || !Sync.configured() || !Sync.client || App._localOnly) return null;
    return Sync.client.storage.from(this.BUCKET);
  },
  path(id) { return `${(typeof SYNC_CONFIG !== "undefined" && SYNC_CONFIG.workspace) || "shop"}/${id}`; },

  /* Local first — it is instant and works with no network. Then the bucket. */
  async url(id) {
    if (this._urls.has(id)) return this._urls.get(id);
    const blob = await this.getBlob(id).catch(() => null);
    if (blob) {
      const u = URL.createObjectURL(blob);
      this._urls.set(id, u);
      return u;
    }
    const st = this.storage();
    if (!st) return null;
    const { data, error } = await st.download(this.path(id));
    if (error || !data) return null;
    await this.putBlob(id, data).catch(() => {});   // keep it for next time
    M.markFileHere(id);
    const u = URL.createObjectURL(data);
    this._urls.set(id, u);
    return u;
  },

  async remove(id, byId) {
    const st = this.storage();
    if (st) {
      const { error } = await st.remove([this.path(id)]);
      /* If the copy that everyone else reads cannot be removed, removing the
         local record would only hide it from this device. */
      if (error && D.file(id) && D.file(id).store === "stored") {
        Toast.show("Could not remove it from the shop's storage — try again when you are online",
          { emoji: "alert", ms: 5000 });
        return false;
      }
    }
    await this.delBlob(id).catch(() => {});
    if (this._urls.has(id)) { URL.revokeObjectURL(this._urls.get(id)); this._urls.delete(id); }
    M.removeFile(id, byId);
    return true;
  },

  /* ---------- previews ---------- */
  chipsHtml(files, { canEdit = false } = {}) {
    if (!files.length) return "";
    return `<div class="file-chips">
      ${files.map(f => `<button class="file-chip ${this.isImage(f.type) ? "img" : "doc"}" data-file="${f.id}" title="${esc(f.name)}">
        ${f.thumb ? `<img src="${f.thumb}" alt="${esc(f.name)}">`
          : `<span class="ico">${icon(/pdf/.test(f.type) ? "quote" : "box", 18)}</span>`}
        <span class="nm">${esc(f.name)}</span>
        ${this.stateHtml(f)}
        ${canEdit ? `<span class="rm" data-file-rm="${f.id}" title="Remove">${icon("x", 11)}</span>` : ""}
      </button>`).join("")}
    </div>`;
  },

  /* Where this file actually is. Silence means "in the shop's storage, where
     everyone can reach it" — the only state that needs no explanation. */
  stateHtml(f) {
    if (f.store === "stored") return "";
    if (f.store === "uploading") return `<span class="f-state up" title="Uploading…">${icon("arrow-up", 10)}</span>`;
    if (f.store === "pending") return `<span class="f-state wait" title="${esc(f.storeNote || "Waiting to upload")}">${icon("cloud-off", 10)}</span>`;
    if (f.store === "missing") return `<span class="f-state gone" title="The file is not on this device">${icon("alert", 10)}</span>`;
    return `<span class="f-state wait" title="On this device only — set up storage to share it">${icon("cloud-off", 10)}</span>`;
  },

  dropHtml(id, label = "Add a drawing or photo") {
    return `<div class="file-drop" data-drop="${id}">
      <span class="ico">${icon("import", 17)}</span>
      <span><b>${esc(label)}</b><span class="t-caption">Drop it here, or click to choose — images are shrunk to fit</span></span>
      <input type="file" id="${id}" multiple accept="image/*,application/pdf" hidden>
    </div>`;
  },

  /* Wires a drop zone. onPick receives the chosen File list. */
  bindDrop(root, id, onPick) {
    const zone = $(`[data-drop="${id}"]`, root), input = $("#" + id, root);
    if (!zone || !input) return;
    zone.onclick = () => input.click();
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add("over"); };
    zone.ondragleave = () => zone.classList.remove("over");
    zone.ondrop = (e) => {
      e.preventDefault(); zone.classList.remove("over");
      if (e.dataTransfer.files.length) onPick([...e.dataTransfer.files]);
    };
    input.onchange = () => { if (input.files.length) onPick([...input.files]); input.value = ""; };
  },

  bindChips(root, { onRemove } = {}) {
    $$("[data-file]", root).forEach(b => b.onclick = (e) => {
      if (e.target.closest("[data-file-rm]")) return;
      this.viewer(b.dataset.file);
    });
    $$("[data-file-rm]", root).forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const f = D.file(b.dataset.fileRm);
      if (!f || !confirm(`Remove ${f.name}?`)) return;
      this.remove(f.id, App.me.id).then(() => { App.render(); if (onRemove) onRemove(); });
    });
  },

  /* Full-screen, because a drawing you cannot read is not an attachment. */
  async viewer(id) {
    const f = D.file(id);
    if (!f) return;
    const root = $("#modal-root");
    root.innerHTML = `<div class="file-view" id="file-view">
      <div class="fv-bar">
        <b>${esc(f.name)}</b>
        <span class="t-caption">${f.w ? `${f.w}×${f.h} · ` : ""}${Math.round(f.size / 1024)} KB</span>
        <span class="grow"></span>
        <a class="btn ghost" id="fv-dl" download="${esc(f.name)}">Download</a>
        <button class="icon-btn" id="fv-close">${icon("x", 17)}</button>
      </div>
      <div class="fv-body" id="fv-body">
        ${f.thumb ? `<img src="${f.thumb}" class="fv-blur" alt="">` : ""}
        <div class="sync-spinner"></div>
      </div>
    </div>`;
    $("#fv-close", root).onclick = () => { root.innerHTML = ""; };
    $("#file-view", root).onclick = (e) => { if (e.target.id === "file-view") root.innerHTML = ""; };

    const url = await this.url(id);
    const body = $("#fv-body", root);
    if (!body) return;                                   // closed while loading
    if (!url) {
      body.innerHTML = `<div class="fv-missing">${icon("cloud-off", 26)}
        <b>The full file is not on this device</b>
        <span>${this.storage()
          ? "It was added on another device and has not finished uploading there yet."
          : "It was added on another device, and the shop's file storage is not set up — see SETUP-CLOUD.md."}</span>
        ${f.thumb ? `<img src="${f.thumb}" alt="${esc(f.name)}">` : ""}</div>`;
      return;
    }
    $("#fv-dl", root).href = url;
    body.innerHTML = this.isImage(f.type)
      ? `<img src="${url}" alt="${esc(f.name)}">`
      : `<iframe src="${url}" title="${esc(f.name)}"></iframe>`;
  },
};
