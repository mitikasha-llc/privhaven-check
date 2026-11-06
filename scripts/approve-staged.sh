#!/usr/bin/env bash
# Verify a STAGED privhaven-check version against its git tag, then approve it on npm.
#
# release.yml only STAGES a version (npm trusted publishing, "stage publish" permission).
# Approving it is the human step, with 2FA. This script makes sure what you approve is
# exactly the tagged source: it downloads the staged tarball and compares every file,
# both ways, with `git archive <tag>`. Any difference, or any step it cannot complete,
# stops it before approval. It never approves on a failed read.
#
# Usage (after `npm login` as the org identity, in your own terminal):
#   scripts/approve-staged.sh            # version from package.json
#   scripts/approve-staged.sh 0.1.4      # a specific version
#   scripts/approve-staged.sh 0.1.4 <stage-id>   # skip the stage-id lookup
set -euo pipefail

PKG=privhaven-check
REPO="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-$(node -p "require('$REPO/package.json').version")}"
TAG="v$VERSION"
STAGE_ID="${2:-}"

die() { echo "✘ $*" >&2; exit 1; }
ok() { echo "✔ $*"; }

# --- 1. who is signed in --------------------------------------------------------
WHO="$(npm whoami 2>/dev/null)" || die "npm is not signed in. Run: npm login"
ok "npm user: $WHO"
read -r -p "  Is '$WHO' the Mitikasha org identity (not a personal account)? [y/N] " a
[ "$a" = "y" ] || die "stopped: wrong npm identity"

# --- 2. the tag exists and is on origin/main -------------------------------------
git -C "$REPO" fetch -q --tags origin
git -C "$REPO" rev-parse -q --verify "$TAG^{commit}" >/dev/null || die "no git tag $TAG"
TAG_SHA="$(git -C "$REPO" rev-parse "$TAG^{commit}")"
git -C "$REPO" merge-base --is-ancestor "$TAG_SHA" origin/main ||
  die "$TAG ($TAG_SHA) is not on origin/main"
ok "$TAG = $TAG_SHA, on origin/main"

# --- 3. find the stage id ----------------------------------------------------------
if [ -z "$STAGE_ID" ]; then
  LIST="$(npm stage list "$PKG" 2>&1)" || die "npm stage list failed:
$LIST"
  echo "$LIST"
  # Lines naming this version; the stage id is whatever token npm prints with it.
  echo
  read -r -p "  Paste the stage id for $PKG@$VERSION from the list above: " STAGE_ID
  [ -n "$STAGE_ID" ] || die "no stage id given"
fi
VIEW="$(npm stage view "$STAGE_ID" 2>&1)" || die "npm stage view $STAGE_ID failed:
$VIEW"
echo "$VIEW"
echo "$VIEW" | grep -q "$VERSION" || die "stage $STAGE_ID does not mention version $VERSION"
ok "stage $STAGE_ID is $PKG@$VERSION"

# --- 4. download the staged tarball and the tagged source ----------------------------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/phc-stage.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/dl" "$WORK/staged" "$WORK/tag"
( cd "$WORK/dl" && npm stage download "$STAGE_ID" >/dev/null ) || die "npm stage download failed"
TGZ="$(find "$WORK/dl" -name '*.tgz' | head -1)"
[ -n "$TGZ" ] || die "download produced no .tgz"
tar -xzf "$TGZ" -C "$WORK/staged"
[ -d "$WORK/staged/package" ] || die "tarball has no package/ directory"
git -C "$REPO" archive "$TAG" | tar -x -C "$WORK/tag"
ok "downloaded $(basename "$TGZ") (sha1 $(shasum "$TGZ" | awk '{print $1}'))"

# --- 5. compare: staged files must be byte-identical to the tag ------------------
STAGED_VER="$(node -p "require('$WORK/staged/package/package.json').version")"
[ "$STAGED_VER" = "$VERSION" ] || die "staged package.json says $STAGED_VER, expected $VERSION"

# What SHOULD be in the tarball: npm's own file list for the tagged source.
EXPECTED="$( cd "$WORK/tag" && npm pack --dry-run --json --ignore-scripts 2>/dev/null |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const f of JSON.parse(s)[0].files)console.log(f.path)})' | sort )"
[ -n "$EXPECTED" ] || die "could not compute the expected file list from $TAG"
ACTUAL="$(cd "$WORK/staged/package" && find . -type f | sed 's|^\./||' | sort)"

bad=0
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "✘ file lists differ (< in tag only, > in staged only):"
  diff <(echo "$EXPECTED") <(echo "$ACTUAL") || true
  bad=1
fi
while IFS= read -r f; do
  [ -f "$WORK/tag/$f" ] || continue
  cmp -s "$WORK/staged/package/$f" "$WORK/tag/$f" || { echo "✘ DIFFERS: $f"; bad=1; }
done <<< "$ACTUAL"
[ "$bad" -eq 0 ] || die "staged package does NOT match $TAG. Do not approve. Reject with: npm stage reject $STAGE_ID"
ok "all $(echo "$ACTUAL" | wc -l | tr -d ' ') files are byte-identical to $TAG"

# --- 6. approve (2FA) ------------------------------------------------------------------
read -r -p "  Approve and publish $PKG@$VERSION now? [y/N] " a
[ "$a" = "y" ] || die "not approved; nothing published"
npm stage approve "$STAGE_ID"
ok "approved. Check: npm view $PKG@$VERSION version"
