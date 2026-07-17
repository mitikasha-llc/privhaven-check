# privhaven-check

**An engine-free, offline verifier for [PrivHaven](https://privhaven.com) compliance reports.**

A PrivHaven report is *evidence, not certification*: it attests which personal data was found and
handled in a file. `privhaven-check` lets a third party confirm that evidence **against their own
copy of the file**, using only public algorithms — no PrivHaven engine, and nothing is ever
uploaded.

> **Status: scaffold (v0.1).** The checks run and are tested. Full per-finding soundness needs the
> **v2 (located-findings) report** — see [Report versions](#report-versions). The one thing this
> tool cannot self-prove — that its canonical JSON is byte-identical to the engine's — is locked by
> a CI cross-check (see the [design doc](https://privhaven.com), `docs/VERIFIER_REDESIGN.md`).

## Why trust this (and not have to)

The usual objection to a vendor's verifier — "you could make it always say PASS" — doesn't apply:

- **Public source.** Everything here is readable; there is no hidden engine. It contains only
  standard algorithms (Luhn, IBAN mod-97, ABA checksum, SSN structure, SHA-256).
- **Offline.** It makes no network requests. Run it air-gapped. Your file never leaves your machine.
- **Hash-pinned.** Releases publish the SHA-256 of every artifact (`MANIFEST`), and a report can
  cite the checker version it targets — so the copy you run is the copy that was published.

## Use it

### Terminal / CI

```sh
npx privhaven-check report.json your-file.csv --hash sha256:<the hash on your report>
```

Exit codes: **`0`** verified · **`1`** a check failed (a `MISMATCH`) · **`2`** usage / I-O error —
so it drops into a pipeline or a pre-signing gate. `--json` emits machine-readable output.

```sh
node bin/privhaven-check.js test/fixtures/sample.report.json test/fixtures/sample.input.csv \
  --hash sha256:25393abf2a5ab80340719ee75819fdbb0d830dde998b5c4baa6e4b133d65adb6
```

### Browser (zero install)

Open `web/check.html` (served), or the self-contained `dist/check.html` (build with
`npm run build:html`) for a fully **offline** single file. Drop in your `report.json` and your
original file; it verifies locally.

## What it checks

| # | Check | Proves |
|---|---|---|
| 1 | **Identity** | `SHA-256(your file)` matches the input hash the report records — same file. |
| 2 | **Integrity** | Recomputed report hash matches the one on your report — unaltered. |
| 3 | **Ruleset** | The named ruleset version hashes to the value the report records — same rules. |
| 4 | **Soundness** | Every reported finding re-validates at its cited column with the public validator. |
| 5 | **Completeness** (bonus) | Sweeps all columns with the strong checksums; flags a column that validates but has no finding — a possible *missed* column. |

### What it does and doesn't prove

- **Does:** every finding the report makes is a real, correctly-validated instance at a citable
  location, and the report is tamper-evident.
- **Doesn't:** a legal compliance conclusion (that's your auditor's), or full *completeness* — that
  the engine missed nothing. Completeness for checksum types is spot-checked by #5; the rest stays
  with the (private) engine, and PrivHaven discloses its detection limits separately.

Soundness is **strong** for checksum types (`credit_card`, `iban`, `aba_routing`) and **structural**
for `us_ssn` / `email` / `phone`. Header-led types (`dob`) can't be value-checked from the file
alone and are reported as such, never as a failure.

## Report versions

- **v2** (`privhaven.compliance-report/v2`) — findings carry a `column` locator; all five checks run.
- **v1** — aggregate findings with no locators; checks 1–3 run, soundness is **skipped** (not
  failed) with a note to recompute the hash and re-run in the app.

## Develop

```sh
npm test               # node --test (no dependencies)
npm run make-fixture   # regenerate test/fixtures/sample.report.json
npm run build:html     # dist/check.html (offline single file)
```

No runtime dependencies. Node ≥ 18.

## License

MIT — see [LICENSE](LICENSE). The PrivHaven detection engine is **not** part of this repository and
remains proprietary; this verifier deliberately contains none of it.
