# Releasing `privhaven-check`

This verifier is meant to be **obtainable and inspectable** — publishing it is what turns
PrivHaven's "you can independently verify your report" from a claim into a fact. Everything here is
manual on purpose: publishing is outward-facing and irreversible.

## ⚠️ Identity / firewall — read first

Per the Mitikasha **entity/identity firewall**, this package must be owned by the **company, not a
person**:

- **GitHub:** publish under the **`mitikasha-llc` organization** — `github.com/mitikasha-llc/privhaven-check`
  (public). **Not a personal account.**
  ⚠️ **Corrected 2026-07-18:** this file used to say "the `mitikasha` org". **No such org exists.**
  `mitikasha` is a personal **User** account (with 0 public repos), so following the old instruction
  would have made this the first public repo tied to a personal identity — the exact firewall breach
  the section exists to prevent. The org must be **created first** (GitHub UI:
  <https://github.com/account/organizations/new>, Free plan is fine — the API cannot create orgs);
  `mitikasha` itself is unavailable as an org name because the user account holds it.
  `mitikasha-llc` was verified available on 2026-07-18 and matches `author: "Mitikasha LLC"`.
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

**Prerequisites** (both are manual and neither can be scripted):

1. **Create the org** — <https://github.com/account/organizations/new>, name `mitikasha-llc`, Free plan.
2. **Authenticate npm as the Mitikasha account** — `npm adduser` (interactive; browser/OTP).
   `npm whoami` must print a Mitikasha-owned account, never a personal one.

Then run the whole release in one step:

```sh
scripts/first-release.sh mitikasha-llc
```

It verifies the org exists and npm is authenticated, prints both identities and requires a typed
`YES` before anything is published, rewrites the package URLs to the real org, runs the tests, refuses
to continue unless `dist/check.html`'s sha256 is the one recorded in `MANIFEST.md`, then creates the
public repo, publishes to npm, tags, and attaches the offline artifact to a GitHub release.

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
