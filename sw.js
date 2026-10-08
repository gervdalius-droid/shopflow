/* ============================================================
   ShopFlow service worker — the app keeps working without a network.

   All the shop's data already lives in localStorage; what a dropped
   connection used to take away was the app ITSELF, because every file is
   fetched from GitHub Pages. This caches the shell so the workshop can
   open ShopFlow on a dead WiFi and carry on, and so it can be installed
   to a tablet's home screen.

   BUILD is rewritten by tools/deploy-pages.sh with the git sha, so a new
   deploy lands in a new cache and the old one is dropped on activate.
   ============================================================ */
const BUILD = "dev";
const CACHE = `shopflow-${BUILD}`;

/* The shell. Optional files (realdata.js is dev-only, sync-config.js only
   exists once the shop is wired to Supabase) must not fail the install. */
const SHELL = [
  ".", "index.html", "styles.css",
  "icons.js", "i18n.js", "data.js", "app.js", "manager.js", "worker.js",
  "wb.js", "scan.js", "gpm.js", "swood.js", "reports.js", "insights.js", "files.js", "bridge.js", "sync.js",
  "manifest.json",
  "icons/icon-192.png", "icons/icon-512.png",
  "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
];
const OPTIONAL = ["sync-config.js", "realdata.js", "../hub/core.js"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll is all-or-nothing; one 404 would leave the shop with no offline
    // app at all, so each file is added on its own and misses are tolerated.
    await Promise.allSettled(SHELL.map(u => cache.add(new Request(u, { cache: "reload" }))));
    await Promise.allSettled(OPTIONAL.map(u => cache.add(new Request(u, { cache: "reload" }))));
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("shopflow-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

/* The page asks for the update once the user accepts it, so a shopfloor
   screen is never swapped out from under someone mid-task. */
self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
  if (e.data === "build") e.source && e.source.postMessage({ build: BUILD });
});

const putIfOk = async (req, res) => {
  if (res && res.ok && res.type === "basic") (await caches.open(CACHE)).put(req, res.clone());
  return res;
};

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase and friends: never our business

  // A navigation must survive being offline — that is the whole point.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try { return await putIfOk(req, await fetch(req)); }
      catch (_) {
        return (await caches.match("index.html")) || (await caches.match(".")) ||
          new Response("<h1>ShopFlow is offline</h1><p>Reconnect once to install the app, then it opens without a network.</p>",
            { headers: { "Content-Type": "text/html" } });
      }
    })());
    return;
  }

  // Deployed assets carry ?v=<sha>, so a given URL can never change content:
  // serve those straight from the cache. Unversioned URLs are what a developer
  // is editing right now, so those go to the network first.
  const versioned = url.searchParams.has("v");
  e.respondWith((async () => {
    if (versioned) {
      const hit = await caches.match(req);
      if (hit) return hit;
      try { return await putIfOk(req, await fetch(req)); } catch (_) { return caches.match(req, { ignoreSearch: true }); }
    }
    try { return await putIfOk(req, await fetch(req)); }
    catch (_) {
      return (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
