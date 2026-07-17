// The five checks. Given a parsed report + the auditor's own copy of the input file, confirm the
// report's claims using ONLY public algorithms (validators.js) + SHA-256. No PrivHaven engine.
//
// Result model: each check is { id, title, status, detail }. status ∈
//   'pass'  — verified
//   'fail'  — a claim did not hold (a MISMATCH)
//   'warn'  — advisory (e.g. a possibly-missed column)
//   'skip'  — not applicable (e.g. soundness on a v1 report with no locators)
//   'info'  — context, never a failure
// `ok` is true iff there are zero 'fail' checks.

import { canonicalJson } from './canonical.js';
import { columnValues, parseTable } from './csv.js';
import { rulesetHash } from './ruleset.js';
import { CHECKSUM_TYPES, VALIDATORS } from './validators.js';

/**
 * @param {object}   opts
 * @param {object}   opts.report      parsed report.json (the reproducible core)
 * @param {Uint8Array} opts.inputBytes raw input file bytes (for the identity hash)
 * @param {string}   opts.inputText   input decoded as UTF-8 (for CSV parsing)
 * @param {string=}  opts.claimedHash the reportHash from the PDF/UI to assert against (optional)
 * @param {(x:Uint8Array|string)=>Promise<string>|string} opts.sha256Hex `sha256:<hex>` provider
 * @param {number=}  opts.sweepThreshold min validating hits for a missed-column warning (default 2)
 */
export async function runChecks(opts) {
  const { report, inputBytes, inputText, claimedHash, sha256Hex, sweepThreshold = 2 } = opts;
  const checks = [];
  const add = (id, title, status, detail) => checks.push({ id, title, status, detail });

  // 1. IDENTITY — is this the same file the report was made over?
  try {
    const got = await sha256Hex(inputBytes);
    const declared = (report?.run?.inputs ?? []).map((i) => i.sha256);
    if (declared.length === 0) add('identity', 'Input identity', 'skip', 'Report declares no input hash.');
    else if (declared.includes(got)) add('identity', 'Input identity', 'pass', `Input SHA-256 matches ${got}.`);
    else add('identity', 'Input identity', 'fail', `MISMATCH: input is ${got}; report expects ${declared.join(', ')}. This is not the file the report was made over.`);
  } catch (e) {
    add('identity', 'Input identity', 'fail', `Could not hash input: ${e.message}`);
  }

  // 2. INTEGRITY — recompute the report hash over the canonical core.
  try {
    const recomputed = await sha256Hex(canonicalJson(report));
    if (!claimedHash) add('integrity', 'Report hash', 'info', `Recomputed report hash: ${recomputed}. Pass --hash <value from your report/PDF> to assert it.`);
    else if (recomputed === claimedHash) add('integrity', 'Report hash', 'pass', `Recomputed hash matches the report hash (${recomputed}). The report is unaltered.`);
    else add('integrity', 'Report hash', 'fail', `MISMATCH: recomputed ${recomputed}; you supplied ${claimedHash}. The report.json has been altered, or the hash is for a different report.`);
  } catch (e) {
    add('integrity', 'Report hash', 'fail', `Could not canonicalize/hash the report: ${e.message}`);
  }

  // 3. RULESET — recompute the ruleset hash from the published descriptor.
  try {
    const version = report?.ruleset?.version;
    const declared = report?.ruleset?.sha256;
    const recomputed = await rulesetHash(version, sha256Hex);
    if (recomputed === null) add('ruleset', 'Ruleset identity', 'warn', `Unknown ruleset version "${version}" — no bundled descriptor to check against. Update privhaven-check or fetch rulesets/${version}.txt.`);
    else if (recomputed === declared) add('ruleset', 'Ruleset identity', 'pass', `Ruleset ${version} hash matches (${recomputed}).`);
    else add('ruleset', 'Ruleset identity', 'fail', `MISMATCH: ruleset ${version} descriptor hashes to ${recomputed}; report records ${declared}. The report ran under a different rule set than it names.`);
  } catch (e) {
    add('ruleset', 'Ruleset identity', 'fail', `Could not check ruleset: ${e.message}`);
  }

  // 4. SOUNDNESS — re-validate each cited column with the public validator (v2 reports only).
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const located = findings.filter((f) => typeof f.column === 'string');
  let table = null;
  if (located.length === 0) {
    if (findings.length > 0) add('soundness', 'Per-finding soundness', 'skip', 'This report has no per-finding column locators (schema v1). Soundness needs a v2 (located) report — recompute the report hash and re-run in the app instead.');
    else add('soundness', 'Per-finding soundness', 'info', 'No findings to check.');
  } else {
    try {
      table = parseTable(inputText);
    } catch (e) {
      add('soundness', 'Per-finding soundness', 'fail', `Could not parse the input as CSV: ${e.message}`);
    }
    if (table) {
      for (const f of located) {
        const label = `${f.type} @ ${f.column}`;
        const validator = VALIDATORS[f.validator];
        const cells = columnValues(table, f.column);
        if (cells === null) { add('soundness', `Finding: ${label}`, 'fail', `MISMATCH: report cites column "${f.column}", which is not in the file's header.`); continue; }
        if (validator === undefined) { add('soundness', `Finding: ${label}`, 'warn', `Unknown validator "${f.validator}" — cannot re-check.`); continue; }
        if (validator === null) { add('soundness', `Finding: ${label}`, 'info', `Type "${f.type}" is header-led (validator "${f.validator}") — not value-checkable from the file alone. Column present with ${cells.length} non-empty cell(s).`); continue; }
        const validated = cells.filter((v) => validator(v)).length;
        const countOk = f.count === undefined || f.count === cells.length;
        const validatedOk = f.validated === undefined || f.validated === validated;
        if (countOk && validatedOk) add('soundness', `Finding: ${label}`, 'pass', `${cells.length} non-empty cell(s); ${validated} pass ${f.validator} — matches the report.`);
        else add('soundness', `Finding: ${label}`, 'fail', `MISMATCH: report says count=${f.count}, validated=${f.validated}; the file has ${cells.length} non-empty cell(s), ${validated} passing ${f.validator}.`);
      }
    }
  }

  // 5. COMPLETENESS (bonus) — sweep every column with the strong checksum validators; a column
  //    that validates but has no finding is a credible missed column. Checksum types only.
  try {
    if (!table && inputText) { try { table = parseTable(inputText); } catch { /* handled below */ } }
    if (table) {
      const claimedCols = new Set(located.map((f) => f.column));
      for (const { type, validator } of CHECKSUM_TYPES) {
        for (const col of table.header) {
          if (claimedCols.has(col)) continue;
          const cells = columnValues(table, col) ?? [];
          const hits = cells.filter((v) => validator(v)).length;
          if (hits >= sweepThreshold) add('completeness', `Sweep: ${type} @ ${col}`, 'warn', `Column "${col}" has ${hits} value(s) that pass the ${type} checksum but no finding covers it — a possible missed column.`);
        }
      }
      if (!checks.some((c) => c.id === 'completeness')) add('completeness', 'Completeness sweep', 'pass', 'No un-reported column passes a strong checksum validator.');
    } else {
      add('completeness', 'Completeness sweep', 'skip', 'No parsed table available for the sweep.');
    }
  } catch (e) {
    add('completeness', 'Completeness sweep', 'warn', `Sweep could not run: ${e.message}`);
  }

  const ok = !checks.some((c) => c.status === 'fail');
  return { ok, checks };
}
