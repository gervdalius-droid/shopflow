/* ============================================================
   ShopFlow — cloud sync config (TEMPLATE)
   Copy to  sync-config.js  and fill in. It's git-ignored.
   Leave it absent to run fully local (no cloud).

   None of these are secrets — the URL, anon key and shop email are
   safe to be in the app. Data is protected by the shop LOGIN
   (Supabase Auth): without signing in, the key alone gets nothing.
   ============================================================ */
window.SYNC_CONFIG = {
  url:       "https://YOUR-PROJECT.supabase.co",  // Supabase → Project Settings → API → Project URL
  anonKey:   "YOUR-ANON-PUBLIC-KEY",              // Supabase → Project Settings → API → anon public key
  shopEmail: "shop@northwood.example",               // the shared login's email (you create this user in Supabase)
  workspace: "northwood",                      // all devices with the same id share the data
  table:     "workspaces",
};
