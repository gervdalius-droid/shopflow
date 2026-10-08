#!/usr/bin/env bash
# ============================================================
#  ShopFlow → GitHub Pages deploy
#  Stages ONLY the public app + cloud config into ./deploy/ and
#  publishes it. Deliberately EXCLUDES realdata.js (your real
#  orders + hashed PINs) — that data lives in Supabase, never in
#  the public repo. Run from the repo root:  bash tools/deploy-pages.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=deploy
REPO="${SHOPFLOW_REPO:-shopflow-app}"          # override with SHOPFLOW_REPO=... if you like
APP=(index.html styles.css icons.js i18n.js data.js app.js manager.js worker.js wb.js scan.js gpm.js swood.js reports.js insights.js files.js bridge.js sync.js manifest.json sw.js)

if [ ! -f sync-config.js ]; then
  echo "✗ sync-config.js not found. Copy sync-config.example.js → sync-config.js and fill in your"
  echo "  Supabase URL + anon key first (see SETUP-CLOUD.md)."; exit 1
fi

echo "→ Staging public bundle in ./$OUT"
rm -rf "$OUT"; mkdir -p "$OUT"
for f in "${APP[@]}"; do cp "$f" "$OUT/"; done
cp sync-config.js "$OUT/"
mkdir -p "$OUT/icons"; cp icons/*.png "$OUT/icons/"    # home-screen / install icons
touch "$OUT/.nojekyll"                          # serve files as-is

# Cache-bust every asset: GitHub Pages serves these with max-age, and a
# shopfloor phone will happily keep an old styles.css for as long as it can.
# Stamping the URLs means a new build is picked up the moment it lands.
VER=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
python3 - "$OUT/index.html" "$VER" <<'PY'
import re, sys
path, ver = sys.argv[1], sys.argv[2]
html = open(path).read()
html = re.sub(r'(<script src="|<link rel="stylesheet" href=")([A-Za-z0-9._-]+\.(?:js|css))"',
              lambda m: f'{m.group(1)}{m.group(2)}?v={ver}"', html)
html = html.replace("</head>", f'  <meta name="shopflow-build" content="{ver}">\n</head>')
open(path, "w").write(html)
print(f"   stamped assets with ?v={ver}")
PY

# The service worker keys its cache on the build, so a deploy lands in a fresh
# cache and the previous one is dropped. Changing this file is also what makes
# the browser notice there is an update at all.
python3 - "$OUT/sw.js" "$VER" <<'PY'
import re, sys
path, ver = sys.argv[1], sys.argv[2]
src = open(path).read()
src, n = re.subn(r'^const BUILD = "[^"]*";', f'const BUILD = "{ver}";', src, count=1, flags=re.M)
if n != 1:
    sys.exit("✗ could not stamp BUILD in sw.js — did the constant move?")
open(path, "w").write(src)
print(f"   service worker cache → shopflow-{ver}")
PY

# safety: never publish real client data or a private key
FAIL=0
[ -f "$OUT/realdata.js" ] && { echo "✗ realdata.js leaked into bundle"; FAIL=1; }
if grep -rERl 'service_role|"pinHash"|-----BEGIN' "$OUT" >/dev/null 2>&1; then
  echo "✗ Bundle looks like it contains client data or a private key:"; grep -rEl 'service_role|"pinHash"' "$OUT"; FAIL=1
fi
[ "$FAIL" = 1 ] && { echo "Aborting."; exit 1; }

echo "→ Publishing to GitHub Pages (repo: $REPO, account: gervdalius-droid)"
cd "$OUT"
git init -q && git add -A && git -c user.email=deploy@shopflow -c user.name=deploy commit -qm "deploy" >/dev/null
git branch -M main
OWNER=$(gh api user -q .login)
if gh repo view "$REPO" >/dev/null 2>&1; then
  git push -f "https://github.com/$OWNER/$REPO.git" main >/dev/null 2>&1
else
  gh repo create "$REPO" --public --source=. --remote=origin --push >/dev/null
fi
# enable Pages (ignore error if already enabled)
gh api -X POST "repos/$OWNER/$REPO/pages" -f 'source[branch]=main' -f 'source[path]=/' >/dev/null 2>&1 || true
echo "✓ Deployed → https://$(gh api user -q .login).github.io/$REPO/"
echo "  (first publish can take 1–2 min to go live.)"
echo
echo "Next: open that URL, sign in with the shop password, then Settings → Cloud sync →"
echo "'Upload this device →' from the machine that has your real data — once."
