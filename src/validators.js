// Public value validators — faithful ports of the PrivHaven engine's `validators.rs`.
//
// These are STANDARD, published algorithms (Luhn, IBAN mod-97, ABA checksum, SSN structure,
// email/phone shape). They are the only "engine" the checker contains: none of the proprietary
// matcher/classifier (which decides *which column is which type*) lives here. A report asserts
// "column X is N of type T, K validated by validator V"; the checker re-runs V over X to confirm.

const digitsOf = (s) => [...s].filter((c) => c >= '0' && c <= '9').map((c) => c.charCodeAt(0) - 48);
const hasAlpha = (s) => /[A-Za-z]/.test(s);

/** Credit-card PAN: digits/spaces/dashes only, length 12–19, Luhn-valid. Strong. */
export function luhn(s) {
  if (hasAlpha(s)) return false;
  const d = digitsOf(s);
  if (d.length < 12 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let v = d[i];
    if (alt) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** IBAN: 2 country letters + 2 check digits + BBAN, mod-97 == 1. Strong. */
export function iban(s) {
  const t = [...s].filter((c) => !/\s/.test(c)).join('').toUpperCase();
  if (t.length < 15 || t.length > 34 || !/^[A-Z0-9]+$/.test(t)) return false;
  if (!/^[A-Z]{2}/.test(t.slice(0, 2)) || !/^[0-9]{2}/.test(t.slice(2, 4))) return false;
  const rearranged = t.slice(4) + t.slice(0, 4);
  let rem = 0;
  for (const c of rearranged) {
    const val = c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 65 + 10;
    rem = val < 10 ? (rem * 10 + val) % 97 : (rem * 100 + val) % 97;
  }
  return rem === 1;
}

/** US ABA routing: 9 digits, weighted checksum mod 10 == 0. Strong. */
export function aba(s) {
  if (hasAlpha(s)) return false;
  const d = digitsOf(s);
  if (d.length !== 9) return false;
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum !== 0 && sum % 10 === 0;
}

/** US SSN: 9 digits, structural validity (no checksum). Weak — leans on the header signal. */
export function ssnStructural(s) {
  if (hasAlpha(s)) return false;
  const d = digitsOf(s);
  if (d.length !== 9) return false;
  const area = d[0] * 100 + d[1] * 10 + d[2];
  const group = d[3] * 10 + d[4];
  const serial = d[5] * 1000 + d[6] * 100 + d[7] * 10 + d[8];
  return area >= 1 && area <= 899 && area !== 666 && group >= 1 && serial >= 1;
}

/** Email: one `@`, non-empty local + domain, alphabetic TLD ≥ 2, no spaces. Medium. */
export function email(s) {
  s = s.trim();
  if (s.includes(' ')) return false;
  const at = s.indexOf('@');
  if (at < 0) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (local === '' || domain === '' || domain.includes('@') || !domain.includes('.')) return false;
  const tld = domain.split('.').pop() ?? '';
  return tld.length >= 2 && /^[A-Za-z]+$/.test(tld);
}

/** Phone: separators + 10–11 digits (NANP), or `+` and 8–15 digits (E.164). Medium. */
export function phone(s) {
  const t = s.trim();
  if (t === '' || ![...t].every((c) => (c >= '0' && c <= '9') || ' -()+.'.includes(c))) return false;
  const n = digitsOf(t).length;
  return t.startsWith('+') ? n >= 8 && n <= 15 : n === 10 || n === 11;
}

/**
 * validator_name (as recorded in each finding) -> the public validator.
 * `header` (DOB) has no value validator — it is header-led, so a DOB finding cannot be
 * value-checked from the file alone (reported as `not-value-checkable`, never a failure).
 */
export const VALIDATORS = {
  'ssn-structural': ssnStructural,
  luhn,
  'email-format': email,
  'phone-format': phone,
  'iban-mod97': iban,
  'aba-checksum': aba,
  header: null,
};

/**
 * Strong checksum validators used by the bonus completeness sweep — a checksum makes a
 * false-positive vanishingly unlikely, so a column that validates here but has no finding is a
 * credible "missed column". SSN/email/phone are excluded (structural/format only ⇒ too noisy).
 */
export const CHECKSUM_TYPES = [
  { type: 'credit_card', validator: luhn },
  { type: 'iban', validator: iban },
  { type: 'aba_routing', validator: aba },
];
