#!/usr/bin/env node
// Verify an npm tarball against a source tree WITHOUT extracting it.
//
//   node scripts/verify-staged-tarball.mjs <package.tgz> <tag-dir> <expected-list> <version>
//
// <expected-list> is a file of package-relative paths (one per line): npm's own file
// list for the tagged source. Exit 0 only when the archive holds exactly those files,
// each byte-identical to <tag-dir>/<path>, and package.json carries <version>.
//
// Why parse the tar by hand: extracting and comparing the extracted tree checks what
// THIS machine's tar wrote to THIS disk, not what npm will install. npm strips the first
// path component whatever its name, keeps the last of duplicate entries, and the Mac's
// disk is case-insensitive, so `Index.js` and `index.js` collapse into one file. Reading
// the raw headers sees every entry exactly as stored, and anything unusual is rejected
// rather than interpreted: only exact ustar headers, only regular files and directories,
// only under `package/`, no `..`, no absolute paths, no duplicates even by case, no
// pax/long-name records, and nothing but zeros after the end-of-archive marker.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const [tgzPath, tagDir, expectedPath, version] = process.argv.slice(2);
if (!tgzPath || !tagDir || !expectedPath || !version) {
  console.error('usage: verify-staged-tarball.mjs <package.tgz> <tag-dir> <expected-list> <version>');
  process.exit(2);
}

const problems = [];
const fail = (m) => problems.push(m);
const sha = (b) => createHash('sha256').update(b).digest('hex');

const tar = gunzipSync(readFileSync(tgzPath));
const cstr = (buf) => {
  const z = buf.indexOf(0);
  return buf.subarray(0, z === -1 ? buf.length : z).toString('utf8');
};
const octal = (buf) => parseInt(cstr(buf).trim() || '0', 8);

const files = new Map(); // package-relative path -> Buffer
const seenLower = new Set();
let off = 0;
let ended = false;
while (off + 512 <= tar.length) {
  const h = tar.subarray(off, off + 512);
  if (h.every((b) => b === 0)) {
    // End of archive. Everything after the first zero block must be zero too: a
    // reader that skips a lone zero block (or ignores the marker) would otherwise
    // find entries this check never compared.
    if (!tar.subarray(off).every((b) => b === 0)) fail('non-zero data after the end-of-archive marker');
    ended = true;
    break;
  }
  // Only exact POSIX ustar headers ("ustar\0" + "00", as npm writes them). GNU and v7
  // headers use bytes 345-500 for other things, so the name a reader builds from the
  // prefix field would depend on which format it assumes. Refuse rather than guess.
  if (h.subarray(257, 263).toString('latin1') !== 'ustar\0' || h.subarray(263, 265).toString('latin1') !== '00') {
    fail(`non-ustar tar header at offset ${off}`);
    break;
  }
  // Header checksum: the sum of all bytes with the checksum field read as spaces.
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  if (sum !== octal(h.subarray(148, 156))) {
    fail(`corrupt tar header at offset ${off}`);
    break;
  }
  const name = cstr(h.subarray(0, 100));
  const prefix = cstr(h.subarray(345, 500));
  const full = prefix ? `${prefix}/${name}` : name;
  const type = String.fromCharCode(h[156] || 48); // NUL means a regular file
  const size = octal(h.subarray(124, 136));
  const body = tar.subarray(off + 512, off + 512 + size);
  if (body.length !== size) fail(`truncated entry: ${full}`);
  off += 512 + Math.ceil(size / 512) * 512;

  if (type !== '0' && type !== '5') {
    fail(`unexpected entry type '${type}' (not a plain file or directory): ${full}`);
    continue;
  }
  if (!full.startsWith('package/')) {
    fail(`entry outside package/: ${full}`);
    continue;
  }
  const rel = full.slice('package/'.length).replace(/\/$/, '');
  if (rel === '' && type === '5') continue;
  const segs = rel.split('/');
  if (full.startsWith('/') || rel.includes('\\') || segs.some((s) => s === '' || s === '.' || s === '..')) {
    fail(`unsafe path: ${full}`);
    continue;
  }
  if (type === '5') continue;
  const lower = rel.toLowerCase();
  if (seenLower.has(lower)) {
    fail(`duplicate entry (exact or by case): ${rel}`);
    continue;
  }
  seenLower.add(lower);
  files.set(rel, Buffer.from(body));
}
if (!ended) fail('archive has no end-of-archive marker');

const expected = readFileSync(expectedPath, 'utf8').split('\n').filter(Boolean);
if (expected.length === 0) fail('expected file list is empty');
const exp = new Set(expected);
for (const p of expected) if (!files.has(p)) fail(`missing from staged: ${p}`);
for (const p of files.keys()) if (!exp.has(p)) fail(`extra in staged: ${p}`);
for (const p of expected) {
  const got = files.get(p);
  if (!got) continue;
  let want;
  try {
    want = readFileSync(join(tagDir, p));
  } catch {
    fail(`cannot read tag copy: ${p}`);
    continue;
  }
  if (sha(got) !== sha(want)) fail(`DIFFERS: ${p}`);
}
const pj = files.get('package.json');
if (pj) {
  let v = null;
  try {
    v = JSON.parse(pj.toString('utf8')).version;
  } catch {
    fail('staged package.json is not valid JSON');
  }
  if (v !== null && v !== version) fail(`staged package.json says ${v}, expected ${version}`);
}

if (problems.length) {
  for (const p of problems) console.log(`✘ ${p}`);
  process.exit(1);
}
console.log(`✔ all ${files.size} files are byte-identical to the tag (read from the archive, not extracted)`);
