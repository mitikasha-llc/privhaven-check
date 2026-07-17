// Ruleset identity — the descriptor a report's `ruleset.sha256` is computed over.
//
// The engine (`ruleset.rs`) builds the descriptor as: the version, then for each detected type in
// a FIXED order, a `\n<type>:<validator_name>:<default_action>` line (no trailing newline). The
// hash is `sha256:<hex>` over those UTF-8 bytes. We rebuild it byte-for-byte here and recompute
// the hash, so an auditor confirms the report ran under the rules it names — none of the actual
// matching logic (the moat) is needed for that.
//
// A new ruleset version adds an entry below (and a copy at rulesets/<version>.txt for humans).

export const RULESETS = {
  '2026.06.0': [
    ['us_ssn', 'ssn-structural', 'tokenize'],
    ['credit_card', 'luhn', 'tokenize'],
    ['email', 'email-format', 'tokenize'],
    ['phone', 'phone-format', 'tokenize'],
    ['iban', 'iban-mod97', 'tokenize'],
    ['aba_routing', 'aba-checksum', 'tokenize'],
    ['dob', 'header', 'mask'],
  ],
};

/** Byte-exact descriptor for a version, or null if unknown. */
export function descriptorFor(version) {
  const types = RULESETS[version];
  if (!types) return null;
  let s = version;
  for (const [type, validator, action] of types) s += '\n' + type + ':' + validator + ':' + action;
  return s;
}

/** `sha256:<hex>` over the descriptor, or null for an unknown version. */
export async function rulesetHash(version, sha256Hex) {
  const d = descriptorFor(version);
  return d === null ? null : await sha256Hex(d);
}
