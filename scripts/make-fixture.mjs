// Generate an ILLUSTRATIVE v2 report.json for the sample CSV, so the CLI/browser tool can be run
// end-to-end. It builds the report the way the engine would (validators + canonical + hashes) —
// which makes it a good demo and a regression fixture, but note: a REAL report comes from the
// PrivHaven engine. The one thing this cannot self-check is that our canonical JSON is byte-equal
// to the engine's serde_json output — that is the CI cross-check in docs/VERIFIER_REDESIGN.md §7.
//
//   node scripts/make-fixture.mjs [input.csv] [out.report.json]

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { canonicalJson, columnValues, parseTable, rulesetHash, RULESETS } from '../src/index.js';
import { VALIDATORS } from '../src/validators.js';

const here = dirname(fileURLToPath(import.meta.url));
const sha256Hex = (x) =>
  'sha256:' + createHash('sha256').update(typeof x === 'string' ? Buffer.from(x, 'utf8') : x).digest('hex');

const RULESET_VERSION = '2026.06.0';
// Which columns the engine would classify, and as what. (In production the private matcher decides
// this; here we declare it for the sample.)
const COLUMN_TYPES = [
  ['card', 'credit_card'],
  ['email', 'email'],
  ['ssn', 'us_ssn'],
];

const META = Object.fromEntries(RULESETS[RULESET_VERSION].map(([type, validator, action]) => [type, { validator, action }]));

export async function buildReport(inputText, inputBytes) {
  const table = parseTable(inputText);
  const findings = COLUMN_TYPES.map(([column, type]) => {
    const { validator, action } = META[type];
    const cells = columnValues(table, column) ?? [];
    const validated = cells.filter((v) => VALIDATORS[validator]?.(v)).length;
    return { type, column, count: cells.length, validated, lowConfidence: 0, validator, action };
  }).sort((a, b) => a.type.localeCompare(b.type) || a.column.localeCompare(b.column));

  const core = {
    schema: 'privhaven.compliance-report/v2',
    engine: { version: '0.1.0', wasmSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' },
    ruleset: { version: RULESET_VERSION, sha256: await rulesetHash(RULESET_VERSION, sha256Hex) },
    run: {
      mode: 'scan',
      inputs: [{ sha256: await sha256Hex(inputBytes), bytes: inputBytes.length }],
      detection: { completeness: 'full' },
    },
    findings,
    residual: { riskScore: '0.42', riskComponents: [], remediation: ['Tokenize the identified direct identifiers before sharing.'] },
    frameworks: {
      hipaaSafeHarbor: { identifiersAddressed: 2, of: 18, notDetectable: ['names', 'biometric identifiers', 'full-face photos'] },
      pciDss: { panFound: 4, panHandled: 4 },
    },
  };
  const reportHash = await sha256Hex(canonicalJson(core));
  return { core, reportHash };
}

async function main() {
  const inPath = resolve(process.argv[2] ?? resolve(here, '../test/fixtures/sample.input.csv'));
  const outPath = resolve(process.argv[3] ?? resolve(here, '../test/fixtures/sample.report.json'));
  const bytes = await readFile(inPath);
  const { core, reportHash } = await buildReport(bytes.toString('utf8'), bytes);
  await writeFile(outPath, JSON.stringify(core, null, 2) + '\n');
  console.log(`wrote ${outPath}`);
  console.log(`reportHash: ${reportHash}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
