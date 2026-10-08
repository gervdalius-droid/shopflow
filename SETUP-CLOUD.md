# ShopFlow — go multi-device: GitHub Pages (app) + Supabase (data + login)

GitHub hosts the app for free and reachable anywhere; Supabase (free) holds the
shared data and provides the **login**. The shop password gates everything — the
public key alone can't read or write anything. Instant sync across devices.

You do the **Supabase** part (5 min, your account). I do the **GitHub** deploy.

## 1. Create the Supabase project
1. Sign up / log in at **supabase.com** → **New project** (free tier). Name it e.g. `shopflow`, set a database password (save it), pick a nearby region.
2. When it's ready, open **SQL Editor** → paste & run [`supabase/schema.sql`](supabase/schema.sql).

## 2. Create the shared shop login
1. Left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Email: e.g. `shop@northwood.example` · Password: the **shop password** your team will type.
   Tick **Auto-confirm** if shown. (This one account is the whole team's login.)

## 3. Copy two values
**Project Settings → API**: copy the **Project URL** and the **anon public key**.
Send me those two + the shop email — they're not secrets. I'll wire up the rest.

## 4. (I do this) Deploy to GitHub Pages
```bash
cp sync-config.example.js sync-config.js     # fill URL + anonKey + shopEmail
bash tools/deploy-pages.sh                   # publishes to gervdalius-droid.github.io/shopflow-app
```

## 5. Seed the data once, then share
- Open the live URL on the device that has your **real data** (your Northwood Furniture import),
  sign in with the shop password → **Settings → Cloud sync → "Upload this device →"**.
- Share the URL + shop password with the team. Each device signs in once (stays signed
  in), picks their name on the PIN pad, and sees the same live data instantly.

## Security
- **Login:** Supabase Auth. The database is locked to signed-in sessions (`to authenticated`
  in the schema), so without the shop password nothing is readable or writable — the public
  anon key by itself grants nothing. Change the password anytime in Supabase → Authentication.
- **PINs:** stay as the fast "which teammate am I" pick after login; hashed.
- Want per-person logins later (each manager their own account)? Easy add on this foundation.
- The shopfloor PC just opens the same URL and runs the scanners.

---

## AI assessment (`ai-insights` function)

Reports can ask Claude to read the shop's own numbers and say what is working,
what is costing money, and what to do in what order.

**The Anthropic key lives on the server, never in a browser.** ShopFlow runs on
shared shop tablets; a key in localStorage is a key anyone standing at the
machine can read. The browser sends only the briefing, authenticated with the
shop login you already use.

Deploy it once:

```sh
# from the repo root, with the Supabase CLI logged in
supabase functions deploy ai-insights --project-ref niveinyzkkwtreeeaziv
supabase secrets set ANTHROPIC_API_KEY=sk-ant-…   --project-ref niveinyzkkwtreeeaziv
```

No CLI? Paste `supabase/functions/ai-insights/index.ts` into
**Supabase → Edge Functions → Deploy a new function**, name it `ai-insights`,
and add `ANTHROPIC_API_KEY` under **Edge Functions → Secrets**. Get the key from
console.anthropic.com → API keys.

Until it is deployed, Reports shows "Not connected" and the briefing it *would*
send — so you can read every line of your own data before any of it leaves.

**What it costs.** One assessment is a few thousand tokens in and a couple
thousand out on `claude-opus-5` — roughly $0.02–$0.05. It runs only when
somebody presses the button, and the result is stored, so nobody pays twice for
the same answer.

**What is sent.** The last 90 days as numbers plus identifiers: work-order
numbers, products, customer names, stations, hours, materials, delivery dates.
No prices, no invoices, no PINs. The function refuses anything over 200 KB and
accepts only a briefing — it is not a general Claude proxy, so the shop login
cannot be turned into free API credit for something else.

**Who can use it.** Anyone who may see Reports (`reports.view`) and is signed in
to the shop workspace.

---

## Attachments (Supabase Storage)

Drawings and photos attach to a project or to a single task, and the file lives
in **Supabase Storage** — that is the copy the whole shop reads. In front of it:
a local IndexedDB cache so previews are instant and a drawing still opens with
no network, and a small thumbnail in the workspace document so every device can
see an attachment before it has fetched the full thing.

The file itself is never in the workspace document: `Sync.push()` sends the
whole thing on every change, so a drawing living there would be re-uploaded
every time anyone edited anything.

Create the bucket and its policies once:

```sh
supabase login                                   # once, opens a browser
supabase link --project-ref niveinyzkkwtreeeaziv
supabase db push                                 # applies supabase/migrations/
```

No CLI? Paste `supabase/migrations/0001_attachments_bucket.sql` into
**Supabase → SQL editor** and run it.

The bucket is **private** — 12 MB per file, images and PDFs only — and readable
only by a signed-in session, the same shop login that protects the workspace
row. The anon key on its own reads nothing.

**Before it exists**, attachments still work: they are kept on the device that
added them and marked as such on the file itself, with an amber cloud badge.
Nothing is lost. Once the bucket is there, ShopFlow retries every waiting file
on the next load, so the drawings you attached in the meantime upload
themselves.

**If a tablet is offline** when somebody attaches a photo, the same thing
happens — marked, kept, and retried when the network returns.

