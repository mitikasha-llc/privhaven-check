#!/usr/bin/env node
// privhaven-check — verify a PrivHaven compliance report against your own copy of the file,
// entirely offline, using only public algorithms. Nothing is uploaded; no PrivHaven engine runs.
//
//   privhaven-check <report.json> <input.csv> [--hash sha256:...] [--json] [--threshold N]
//
// Exit codes (CI-friendly):  0 = verified · 1 = a check failed (MISMATCH) · 2 = usage / I/O error.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runChecks } from '../src/index.js';

const sha256Hex = (x) =>
  'sha256:' + createHash('sha256').update(typeof x === 'string' ? Buffer.from(x, 'utf8') : x).digest('hex');

function parseArgs(argv) {
  const pos = [];
  const opts = { json: false, hash: undefined, threshold: 2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--hash') opts.hash = argv[++i];
    else if (a === '--threshold') opts.threshold = Number(argv[++i]);
    else if (a === '-h' || a === '--help') opts.help = true;
    else pos.push(a);
  }
  return { pos, opts };
}

const USAGE = `privhaven-check <report.json> <input.csv> [options]

Verify a PrivHaven compliance report against your own copy of the original file.
Runs entirely on your machine; the file is never uploaded and no PrivHaven engine runs.

Options:
  --hash <sha256:...>  Assert the report hash printed on your report/PDF.
  --threshold <N>      Min checksum hits for a missed-column warning (default 2).
  --json               Emit machine-readable JSON.
  -h, --help           Show this help.

Exit: 0 verified · 1 a check failed (MISMATCH) · 2 usage/I-O error.`;

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m' };
const color = process.stdout.isTTY;
const paint = (s, c) => (color ? c + s + C.reset : s);
const MARK = { pass: ['✓', C.green], fail: ['✗', C.red], warn: ['!', C.yellow], skip: ['–', C.dim], info: ['·', C.dim] };

async function main() {
  const { pos, opts } = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(USAGE); return 0; }
  if (pos.length < 2) { console.error(USAGE); return 2; }
  const [reportPath, inputPath] = pos;

  let report, inputBytes, inputText;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (e) { console.error(`error: could not read report "${reportPath}": ${e.message}`); return 2; }
  try {
    inputBytes = await readFile(inputPath);
    inputText = inputBytes.toString('utf8');
  } catch (e) { console.error(`error: could not read input "${inputPath}": ${e.message}`); return 2; }

  let result;
  try {
    result = await runChecks({ report, inputBytes, inputText, claimedHash: opts.hash, sha256Hex, sweepThreshold: opts.threshold });
  } catch (e) { console.error(`error: verification failed to run: ${e.message}`); return 2; }

  if (opts.json) {
    console.log(JSON.stringify({ ok: result.ok, checks: result.checks }, null, 2));
  } else {
    console.log(paint('\nPrivHaven report verification', C.bold));
    console.log(paint(`report: ${reportPath}   input: ${inputPath}\n`, C.dim));
    for (const c of result.checks) {
      const [m, col] = MARK[c.status] ?? ['?', ''];
      console.log(`  ${paint(m, col)} ${paint(c.title, C.bold)}`);
      if (c.detail) for (const line of String(c.detail).match(/.{1,96}(\s|$)/g) ?? [c.detail]) console.log(`      ${paint(line.trim(), C.dim)}`);
    }
    const fails = result.checks.filter((c) => c.status === 'fail').length;
    const warns = result.checks.filter((c) => c.status === 'warn').length;
    console.log('');
    if (result.ok) console.log(paint(`VERIFIED — no mismatches${warns ? ` (${warns} advisory warning${warns > 1 ? 's' : ''})` : ''}.`, C.green));
    else console.log(paint(`NOT VERIFIED — ${fails} mismatch${fails > 1 ? 'es' : ''}. See the ✗ lines above.`, C.red));
    console.log('');
  }
  return result.ok ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(2); });
