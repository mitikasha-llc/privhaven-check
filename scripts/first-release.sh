#!/usr/bin/env bash
# First release of privhaven-check — run AFTER creating the GitHub org.
#
#   scripts/first-release.sh <org-name>
#
# Everything outward-facing lives here so it happens once, deliberately, with the identity
# checked first. Re-runnable up to the point it actually publishes.
set -euo pipefail

ORG="${1:-}"
[ -n "$ORG" ] || { echo "usage: scripts/first-release.sh <org-name>   (e.g. mitikasha-llc)"; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "0. Identity check (entity/identity firewall)"
gh api "orgs/$ORG" --jq '"github org: " + .login + " (" + (.type) + ")"' \
  || { echo "!! org '$ORG' not found or not visible to this token. Create it first, or re-auth."; exit 1; }
NPM_USER="$(npm whoami 2>/dev/null || true)"
[ -n "$NPM_USER" ] || { echo "!! npm not authenticated — run 'npm adduser' as the MITIKASHA npm account (not a personal one), then re-run."; exit 1; }
echo "npm user: $NPM_USER"
# whoami is NOT publish capability: with 2FA=auth-and-writes, publish needs a fresh OTP and a
# non-interactive run cannot prompt for one. Check BEFORE creating the public repo — on the first
# release this ordering was wrong and the repo went public while npm still refused, leaving the
# README's `npx` line advertised and 404ing.
if [ "$(npm profile get 2>/dev/null | awk -F": " '"'"'/two-factor auth/{print $2}'"'"')" != "disabled" ]; then
  if [ ! -t 0 ]; then
    echo "!! npm 2FA is on and this is not an interactive terminal — publish would 403 AFTER the"
    echo "   public repo is created. Re-run from a real terminal, or publish with --otp."
    exit 1
  fi
fi
echo
read -r -p "Publish PUBLICLY as org='$ORG', npm user='$NPM_USER'? [type YES] " ok
[ "$ok" = "YES" ] || { echo "aborted."; exit 1; }

say "1. Point package URLs at the real org"
node -e '
const fs=require("fs"); const org=process.argv[1];
const p=JSON.parse(fs.readFileSync("package.json","utf8"));
p.homepage=`https://github.com/${org}/privhaven-check#readme`;
p.repository={type:"git",url:`git+https://github.com/${org}/privhaven-check.git`};
p.bugs={url:`https://github.com/${org}/privhaven-check/issues`};
fs.writeFileSync("package.json", JSON.stringify(p,null,2)+"\n");
console.log("package.json URLs ->", org);
' "$ORG"
git add package.json
git diff --cached --quiet || git commit -q -m "chore(release): point package URLs at the $ORG org"

say "2. Pre-flight (must be green before anything is published)"
npm test
npm run build:html
BUILT="$(shasum -a 256 dist/check.html | awk '{print $1}')"
grep -q "$BUILT" MANIFEST.md || { echo "!! dist/check.html sha256 $BUILT is NOT in MANIFEST.md — refusing to publish"; exit 1; }
echo "artifact hash matches MANIFEST.md: $BUILT"

say "3. GitHub (public, under the org)"
gh repo create "$ORG/privhaven-check" --public --source=. --remote=origin --push

say "4. npm"
npm publish

say "5. Tag + GitHub release with the offline artifact"
VER="v$(node -p 'require("./package.json").version')"
git tag "$VER" && git push origin "$VER"
gh release create "$VER" dist/check.html \
  --title "privhaven-check $VER" \
  --notes "Engine-free verifier for PrivHaven reports. Offline dist/check.html sha256: $BUILT"

say "Done. Now wire the rest (RELEASE.md §After the first publish)"
cat <<EOF
  1. privhaven /verify page — add the CLI (npx privhaven-check report.json file.csv)
     and the offline download; the page deliberately mentions neither today.
  2. privhaven CI — the verify-cross-check job in ci-full.yml auto-activates now
     that the package resolves on npm.
  3. Add NPM_TOKEN as a repo secret so .github/workflows/release.yml handles v* tags.
EOF
