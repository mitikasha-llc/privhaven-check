// Deterministic CSV parser: a faithful port of the engine's `parse.rs` dialect, so the checker
// splits cells exactly as the engine did (or the counts would diverge). Quoting: `"` opens/closes
// a field, `""` is an escaped quote. Outside quotes: `,` ends a field, `\n` ends a row, `\r` is
// dropped. A final unterminated row is emitted. Empty cells are preserved as "".

/** Parse into { header: string[], rows: string[][] }. */
export function parseTable(input) {
  const rows = parseRows(input);
  if (rows.length === 0) return { header: [], rows: [] };
  const [header, ...data] = rows;
  return { header, rows: data };
}

export function parseRows(input) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const chars = [...input];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (inQuotes) {
      if (c === '"') {
        if (chars[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (c === '\r') {
      // dropped
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Non-empty cell values of a named column. Mirrors the engine, whose `Field.values` are
 * `Option<String>` with empty ⇒ `None`, so empty cells are excluded from a column's population,
 * which is the population `count`/`validated` were computed over.
 */
export function columnValues(table, name) {
  const idx = table.header.indexOf(name);
  if (idx < 0) return null; // column not present
  const out = [];
  for (const r of table.rows) {
    const v = r[idx];
    if (v !== undefined && v !== '') out.push(v);
  }
  return out;
}
