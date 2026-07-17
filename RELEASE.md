# Releasing `privhaven-check`

This verifier is meant to be **obtainable and inspectable** — publishing it is what turns
PrivHaven's "you can independently verify your report" from a claim into a fact. Everything here is
manual on purpose: publishing is outward-facing and irreversible.

## ⚠️ Identity / firewall — read first

Per the Mitikasha **entity/identity firewall**, this package must be owned by the **company, not a
person**:

- **GitHub:** create the repo under the **`mitikasha` org** — `github.com/mitikasha/privhaven-check`
  (public). Not a personal account.
- **npm:** publish from a **Mitikasha-owned npm account/org**, author `Mitikasha LLC` (already in
  `package.json`). Do **not** publish from a personal npm identity, and do not add personal names to
  author/contributor fields.
- The `LICENSE`, `author`, and all URLs already point at Mitikasha LLC / the org — keep it that way.

## Pre-flight (from a clean checkout)

```sh
npm test                                   # 10/10, no deps
npm run build:html && shasum -a 256 dist/check.html   # matches MANIFEST.md
```

And in the **privhaven** repo, run the live engine⇄verifier cross-check:

```sh
CHECKER=/path/to/privhaven-check just cross-check      # byte-identical + green
```

## First publish (manual, one-time)

```sh
# 1. GitHub (public, under the org)
gh repo create mitikasha/privhaven-check --public --source=. --remote=origin --push

# 2. npm (from the Mitikasha npm account)
npm login                                  # Mitikasha account
npm publish                                # publishConfig.access=public is set

# 3. Tag + GitHub release with the offline artifact attached
git tag v0.1.0 && git push origin v0.1.0
npm run build:html
gh release create v0.1.0 dist/check.html \
  --title "privhaven-check v0.1.0" \
  --notes "Engine-free verifier for PrivHaven reports. Offline dist/check.html sha256: $(shasum -a 256 dist/check.html | awk '{print $1}')"
```

## Automated releases (after the first)

`.github/workflows/release.yml` publishes to npm + attaches `dist/check.html` on any `v*` tag. It
needs one repo secret: **`NPM_TOKEN`** (an automation token from the Mitikasha npm account). Then a
release is just:

```sh
npm version patch    # or minor/major — bumps package.json + tags
git push --follow-tags
```

## After the first publish — wire the rest

1. **privhaven `/verify` page** currently advertises only the in-browser tool (honest — nothing else
   was obtainable). Now add the **CLI** (`npx privhaven-check report.json file.csv`) and the
   **offline download** to the "Verify a report now" section.
2. **privhaven CI** — the `verify-cross-check` job in `ci-full.yml` auto-activates once the package
   resolves on npm (it skips while unpublished), giving a true live cross-repo check.
3. **MANIFEST.md** — the release workflow refreshes the artifact hashes; confirm they're committed.
4. Consider `privhaven-check` in the **awesome-privacy / privacy-tool directories** (a real,
   inspectable open-source verifier is exactly what those reward) — but per the GTM firewall notes,
   confirm the surface before listing.
