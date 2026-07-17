// Hermetic tests — no engine, no committed fixture dependency. Validator vectors are copied from
// the engine's validators.rs #[test] blocks so a port drift fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { canonicalJson, descriptorFor, parseTable, columnValues, runChecks } from '../src/index.js';
import { luhn, iban, aba, ssnStructural, email, phone } from '../src/validators.js';

const here = dirname(fileURLToPath(import.meta.url));
const sha256Hex = (x) =>
  'sha256:' + createHash('sha256').update(typeof x === 'string' ? Buffer.from(x, 'utf8') : x).digest('hex');

test('validators match the engine vectors', () => {
  assert.ok(luhn('4111 1111 1111 1111'));
  assert.ok(luhn('4111-1111-1111-1111'));
  assert.ok(!luhn('4111 1111 1111 1112'));
  assert.ok(!luhn('1234'));
  assert.ok(!luhn('4111abcd11111111'));

  assert.ok(iban('GB82 WEST 1234 5698 7654 32'));
  assert.ok(!iban('GB00 WEST 1234 5698 7654 32'));
  assert.ok(!iban('not an iban'));

  assert.ok(aba('021000021'));
  assert.ok(!aba('021000022'));
  assert.ok(!aba('12345'));

  assert.ok(ssnStructural('123-45-6789'));
  assert.ok(ssnStructural('123456789'));
  assert.ok(!ssnStructural('666-45-6789'));
  assert.ok(!ssnStructural('000-45-6789'));
  assert.ok(!ssnStructural('123-00-6789'));
  assert.ok(!ssnStructural('12345'));

  assert.ok(email('jane.doe@example.com'));
  assert.ok(!email('jane.doe@example'));
  assert.ok(!email('not an email'));
  assert.ok(!email('a@@b.com'));

  assert.ok(phone('(415) 555-0132'));
  assert.ok(phone('+44 20 7946 0958'));
  assert.ok(!phone('12'));
  assert.ok(!phone('call me'));
});

test('canonical JSON sorts keys and is compact', () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(canonicalJson({ z: [{ y: 1, x: 2 }], a: 's' }), '{"a":"s","z":[{"x":2,"y":1}]}');
});

test('ruleset descriptor matches the published rulesets/2026.06.0.txt', async () => {
  const txt = await readFile(resolve(here, '../rulesets/2026.06.0.txt'), 'utf8');
  assert.equal(descriptorFor('2026.06.0'), txt.replace(/\n$/, ''));
  assert.equal(descriptorFor('nope'), null);
});

test('CSV dialect: quotes, escaped quotes, CRLF, empty cells', () => {
  const t = parseTable('a,b,c\r\n1,"x,y","he said ""hi""",\n,z,');
  assert.deepEqual(t.header, ['a', 'b', 'c']);
  assert.deepEqual(t.rows, [
    ['1', 'x,y', 'he said "hi"', ''],
    ['', 'z', ''],
  ]);
  assert.deepEqual(columnValues(t, 'a'), ['1']); // empty cell in row 2 excluded
});

// Build a small v2 report in-memory and run the full check suite.
async function buildV2() {
  const input = 'email,ssn,card\na@x.com,123-45-6789,4111111111111111\nb@y.org,001-23-4567,5555555555554444\n';
  const inputBytes = Buffer.from(input, 'utf8');
  const core = {
    schema: 'privhaven.compliance-report/v2',
    engine: { version: '0.1.0', wasmSha256: 'sha256:' + '0'.repeat(64) },
    ruleset: { version: '2026.06.0', sha256: sha256Hex(descriptorFor('2026.06.0')) },
    run: { mode: 'scan', inputs: [{ sha256: sha256Hex(inputBytes), bytes: inputBytes.length }], detection: { completeness: 'full' } },
    findings: [
      { type: 'credit_card', column: 'card', count: 2, validated: 2, lowConfidence: 0, validator: 'luhn', action: 'tokenize' },
      { type: 'email', column: 'email', count: 2, validated: 2, lowConfidence: 0, validator: 'email-format', action: 'tokenize' },
      { type: 'us_ssn', column: 'ssn', count: 2, validated: 2, lowConfidence: 0, validator: 'ssn-structural', action: 'tokenize' },
    ],
    residual: { riskScore: '0.42', riskComponents: [], remediation: [] },
    frameworks: { hipaaSafeHarbor: { identifiersAddressed: 2, of: 18, notDetectable: [] }, pciDss: { panFound: 2, panHandled: 2 } },
  };
  const reportHash = sha256Hex(canonicalJson(core));
  return { core, reportHash, inputBytes, inputText: input };
}

test('e2e: a faithful v2 report verifies green', async () => {
  const { core, reportHash, inputBytes, inputText } = await buildV2();
  const { ok, checks } = await runChecks({ report: core, inputBytes, inputText, claimedHash: reportHash, sha256Hex });
  assert.ok(ok, 'expected overall ok');
  const byId = (id) => checks.filter((c) => c.id === id);
  assert.equal(byId('identity')[0].status, 'pass');
  assert.equal(byId('integrity')[0].status, 'pass');
  assert.equal(byId('ruleset')[0].status, 'pass');
  assert.ok(byId('soundness').every((c) => c.status === 'pass' || c.status === 'info'));
  assert.ok(byId('completeness').every((c) => c.status !== 'fail'));
});

test('e2e: a tampered validated-count fails soundness', async () => {
  const { core, reportHash, inputBytes, inputText } = await buildV2();
  core.findings[0].validated = 1; // report claims 1 valid card; the file has 2
  const { ok, checks } = await runChecks({ report: core, inputBytes, inputText, claimedHash: reportHash, sha256Hex });
  assert.ok(!ok, 'expected overall NOT ok');
  assert.ok(checks.some((c) => c.id === 'soundness' && c.status === 'fail'));
});

test('e2e: an altered report body fails the hash', async () => {
  const { core, reportHash, inputBytes, inputText } = await buildV2();
  core.residual.riskScore = '0.99'; // change a core byte after the hash was taken
  const { ok, checks } = await runChecks({ report: core, inputBytes, inputText, claimedHash: reportHash, sha256Hex });
  assert.ok(!ok);
  assert.equal(checks.find((c) => c.id === 'integrity').status, 'fail');
});

test('a v1 (aggregate) report skips soundness rather than failing', async () => {
  const core = {
    schema: 'privhaven.compliance-report/v1',
    engine: { version: '0.1.0', wasmSha256: 'sha256:' + '0'.repeat(64) },
    ruleset: { version: '2026.06.0', sha256: sha256Hex(descriptorFor('2026.06.0')) },
    run: { mode: 'scan', inputs: [], detection: { completeness: 'full' } },
    findings: [{ type: 'us_ssn', count: 2, validated: 2, lowConfidence: 0, validator: 'ssn-structural', action: 'tokenize' }],
    residual: { riskScore: '0.1', riskComponents: [], remediation: [] },
    frameworks: { hipaaSafeHarbor: { identifiersAddressed: 1, of: 18, notDetectable: [] }, pciDss: { panFound: 0, panHandled: 0 } },
  };
  const { checks } = await runChecks({ report: core, inputBytes: Buffer.from(''), inputText: '', sha256Hex });
  assert.equal(checks.find((c) => c.id === 'soundness').status, 'skip');
});
