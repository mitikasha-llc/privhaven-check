// Canonical JSON for a PrivHaven report core.
//
// The engine computes `reportHash` over this canonical form (serde_json `to_value` -> `to_vec`:
// BTreeMap key order + compact, no whitespace). The downloaded `report.json` is PRETTY-printed,
// so we must re-canonicalize the parsed object before hashing. Never hash the file bytes.
//
// Pure + isomorphic (no Node/browser APIs). Hashing is injected by the caller so this module
// stays environment-free (see bin/ and web/ for the SHA-256 provider).

/** Deterministic string: recursively key-sorted, compact separators. */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort(byCodePoint)) out[k] = sortValue(v[k]);
    return out;
  }
  return v;
}

// serde_json's BTreeMap<String> orders keys by UTF-8 byte order, which equals code-point order.
// JS's default Array.sort compares UTF-16 code units (differs for astral chars), so compare by
// code point explicitly. Report keys are ASCII, but this keeps us faithful for any input.
function byCodePoint(a, b) {
  const ac = [...a];
  const bc = [...b];
  const n = Math.min(ac.length, bc.length);
  for (let i = 0; i < n; i++) {
    const d = ac[i].codePointAt(0) - bc[i].codePointAt(0);
    if (d !== 0) return d;
  }
  return ac.length - bc.length;
}
