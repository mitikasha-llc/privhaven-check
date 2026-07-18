# Release manifest

Each release publishes the SHA-256 of every distributable artifact here (and in the GitHub
Release), so the copy you run, CLI, npm package, or offline `dist/check.html`, is provably the
copy that was published. A PrivHaven report can cite the checker version + hash it targets.

All artifacts are built from a single tagged commit, so nothing drifts between surfaces.

The release workflow (`.github/workflows/release.yml`) regenerates these on each tag.

| Artifact | SHA-256 |
|---|---|
| `dist/check.html`, v0.1.1 (offline single file) | `sha256:2be6a5251a8a347873d99854a781188dfc1f7530cf032b00da94a9c710cb3207` |
| npm `privhaven-check@0.1.0` | via the registry: `npm view privhaven-check@0.1.0 dist.integrity` |

> Reproduce the offline artifact's hash from a clean checkout:
> ```sh
> npm run build:html && shasum -a 256 dist/check.html
> ```

## Bundled reference data

| File | SHA-256 | Notes |
|---|---|---|
| ruleset descriptor `2026.06.0` | `sha256:a530f68edc3ad1f89a7815eac36e2910066823925f4a6dd06cdac7c1084a91f3` | recomputed by the checker; matches `report.ruleset.sha256` |

> To reproduce the ruleset hash independently:
> ```sh
> printf '2026.06.0\nus_ssn:ssn-structural:tokenize\ncredit_card:luhn:tokenize\nemail:email-format:tokenize\nphone:phone-format:tokenize\niban:iban-mod97:tokenize\naba_routing:aba-checksum:tokenize\ndob:header:mask' | shasum -a 256
> ```
