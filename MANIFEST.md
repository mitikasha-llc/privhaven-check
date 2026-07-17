# Release manifest

Each release publishes the SHA-256 of every distributable artifact here (and in the GitHub
Release), so the copy you run — CLI, npm package, or offline `dist/check.html` — is provably the
copy that was published. A PrivHaven report can cite the checker version + hash it targets.

All artifacts are built from a single tagged commit, so nothing drifts between surfaces.

| Artifact | SHA-256 |
|---|---|
| `dist/check.html` (offline single file) | _filled at release_ |
| npm tarball (`privhaven-check-<version>.tgz`) | _filled at release_ |

## Bundled reference data

| File | SHA-256 | Notes |
|---|---|---|
| ruleset descriptor `2026.06.0` | `sha256:a530f68edc3ad1f89a7815eac36e2910066823925f4a6dd06cdac7c1084a91f3` | recomputed by the checker; matches `report.ruleset.sha256` |

> To reproduce the ruleset hash independently:
> ```sh
> printf '2026.06.0\nus_ssn:ssn-structural:tokenize\ncredit_card:luhn:tokenize\nemail:email-format:tokenize\nphone:phone-format:tokenize\niban:iban-mod97:tokenize\naba_routing:aba-checksum:tokenize\ndob:header:mask' | shasum -a 256
> ```
