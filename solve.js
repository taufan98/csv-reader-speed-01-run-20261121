// Fast drop-in for csv-reader 1.0.0 (make.fun's own reference program).
// SPDX-License-Identifier: MIT
//
// Same answers as csv-reader 1.0.0 on every input {text, header}:
// {columns, rows, errors}. Semantics (from the reference, vendor/csv-reader):
//   - U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not doubled
//     ("" inside is one quote, each CRLF or lone CR inside is read as LF);
//     what follows its closing quote up to the next comma or line break is
//     appended as it stands (quote_junk, when the field ends); a quote that
//     never closes is a literal character and the text after it is read again
//     as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows are
//     padded with "" (short_row, with fields: its count) or cut (long_row,
//     with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met, a record's
//     short_row/long_row when it ends; line is the 1-based line its record
//     starts on, row its index in rows (null for the header).
//
// Speed: the reference reads one character at a time and builds every field
// a character at a time. This reader instead scans with native indexOf and
// slices whole fields at once. The common cases stay on a fast path:
//   - an unquoted field is one slice up to the next comma or LF (a CR in the
//     span, or a CR just before the LF, is the only thing that diverts it);
//   - a quoted field with no doubled quote and no CR/LF inside is one slice
//     between its quotes.
// Only the rare broken shapes (stray CR, doubled quotes, embedded line
// breaks, junk after a closing quote, an unterminated quote) fall back to
// the segment-scanning helpers below, which still slice between specials
// instead of reading a character at a time.

/** endKind: 0 = comma, 1 = line break, 2 = end of text. */

/**
 * Slow unquoted read, from `start`, starting with `init` already in the
 * value: reads up to the next comma or line break, dropping a CR not
 * followed by LF (stray_cr, in order). Returns
 * [value, endKind, newPos, linesAdded, charsAdded].
 */
function readUnquotedSlow(text, n, start, init, recordLine, recordRow, errors) {
  let value = init;
  let added = 0;
  let p = start;
  let lines = 0;
  while (true) {
    const c1 = text.indexOf(',', p);
    const c2 = text.indexOf('\n', p);
    const c3 = text.indexOf('\r', p);
    let m = -1;
    let kind = 0;
    if (c1 !== -1) {
      m = c1;
      kind = 0;
    }
    if (c2 !== -1 && (m === -1 || c2 < m)) {
      m = c2;
      kind = 1;
    }
    if (c3 !== -1 && (m === -1 || c3 < m)) {
      m = c3;
      kind = 2;
    }
    if (m === -1) {
      value += text.slice(p);
      added += n - p;
      return [value, 2, n, lines, added];
    }
    if (kind === 0) {
      value += text.slice(p, m);
      added += m - p;
      return [value, 0, m + 1, lines, added];
    }
    if (kind === 1) {
      value += text.slice(p, m);
      added += m - p;
      return [value, 1, m + 1, lines + 1, added];
    }
    if (text.charCodeAt(m + 1) === 10) {
      value += text.slice(p, m);
      added += m - p;
      return [value, 1, m + 2, lines + 1, added];
    }
    errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    value += text.slice(p, m);
    added += m - p;
    p = m + 1;
  }
}

/**
 * Slow quoted read, from the opening quote at `open`, with the closing
 * quote already known at `close`: folds "" to one quote and each CRLF or
 * lone CR inside to LF, counting the lines they add. Returns
 * [value, afterClose, newLine].
 */
function readQuotedSlow(text, n, open, line, close) {
  const parts = [];
  let p = open + 1;
  let ln = line;
  while (p < close) {
    const q = text.indexOf('"', p);
    const nl = text.indexOf('\n', p);
    const cr = text.indexOf('\r', p);
    let m = -1;
    let kind = 0;
    if (q !== -1 && q < close) {
      m = q;
      kind = 0;
    }
    if (nl !== -1 && nl < close && (m === -1 || nl < m)) {
      m = nl;
      kind = 1;
    }
    if (cr !== -1 && cr < close && (m === -1 || cr < m)) {
      m = cr;
      kind = 2;
    }
    if (m === -1) {
      parts.push(text.slice(p, close));
      break;
    }
    if (kind === 0) {
      // A quote before the close is one of a doubled pair.
      parts.push(text.slice(p, m + 1));
      p = m + 2;
      continue;
    }
    if (kind === 1) {
      parts.push(text.slice(p, m + 1));
      ln += 1;
      p = m + 1;
      continue;
    }
    parts.push(text.slice(p, m));
    parts.push('\n');
    ln += 1;
    p = text.charCodeAt(m + 1) === 10 ? m + 2 : m + 1;
  }
  return [parts.join(''), close + 1, ln];
}

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  outer: while (pos < n) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;

    fieldLoop: while (true) {
      if (text.charCodeAt(pos) === 34) {
        // Quoted field.
        quoted = true;
        const open = pos;
        const openLine = line;
        // The closing quote is the first '"' not followed by another '"'.
        let q = text.indexOf('"', pos + 1);
        let close = -1;
        let doubled = false;
        while (q !== -1) {
          if (text.charCodeAt(q + 1) !== 34) {
            close = q;
            break;
          }
          doubled = true;
          q = text.indexOf('"', q + 2);
        }
        let value;
        let after;
        if (close === -1) {
          // The quote never closes: literal character, text after it read
          // again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const r = readUnquotedSlow(text, n, open + 1, '"', recordLine, recordRow, errors);
          value = r[0];
          pos = r[2];
          line = openLine + r[3];
          fields.push(value);
          if (r[1] !== 0) break fieldLoop;
          continue fieldLoop;
        }
        // Any CR or LF inside the quotes?
        const nlIn = text.indexOf('\n', pos + 1);
        const crIn = text.indexOf('\r', pos + 1);
        if ((nlIn === -1 || nlIn >= close) && (crIn === -1 || crIn >= close)) {
          // No line break inside: one slice, folding "" when there is one.
          value = doubled ? text.slice(pos + 1, close).replaceAll('""', '"') : text.slice(pos + 1, close);
          after = close + 1;
        } else {
          const r = readQuotedSlow(text, n, open, openLine, close);
          value = r[0];
          after = r[1];
          line = r[2];
        }
        // What follows the closing quote.
        if (after >= n) {
          fields.push(value);
          pos = after;
          break fieldLoop;
        }
        const c = text.charCodeAt(after);
        if (c === 44) {
          fields.push(value);
          pos = after + 1;
          continue fieldLoop;
        }
        if (c === 10) {
          fields.push(value);
          pos = after + 1;
          line += 1;
          break fieldLoop;
        }
        if (c === 13 && text.charCodeAt(after + 1) === 10) {
          fields.push(value);
          pos = after + 2;
          line += 1;
          break fieldLoop;
        }
        // Junk after the closing quote, appended as it stands.
        const r = readUnquotedSlow(text, n, after, value, recordLine, recordRow, errors);
        if (r[4] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        pos = r[2];
        line += r[3];
        fields.push(r[0]);
        if (r[1] !== 0) break fieldLoop;
        continue fieldLoop;
      }

      // Unquoted field.
      quoted = false;
      const comma = text.indexOf(',', pos);
      const lf = text.indexOf('\n', pos);
      let end;
      let endKind;
      if (comma !== -1 && (lf === -1 || comma < lf)) {
        end = comma;
        endKind = 0;
      } else if (lf !== -1) {
        end = lf;
        endKind = 1;
      } else {
        end = n;
        endKind = 2;
      }
      const cr = text.indexOf('\r', pos);
      if (cr === -1 || cr >= end) {
        fields.push(text.slice(pos, end));
        if (endKind === 0) {
          pos = end + 1;
          continue fieldLoop;
        }
        if (endKind === 1) {
          pos = end + 1;
          line += 1;
        } else {
          pos = end;
        }
        break fieldLoop;
      }
      if (endKind === 1 && cr === end - 1) {
        // CRLF line break: the CR belongs to the break, not the field.
        // (cr is the first CR in the span, so no stray CR hides before it.)
        fields.push(text.slice(pos, end - 1));
        pos = end + 1;
        line += 1;
        break fieldLoop;
      }
      // A stray CR sits inside the field: slow path.
      const r = readUnquotedSlow(text, n, pos, '', recordLine, recordRow, errors);
      pos = r[2];
      line += r[3];
      fields.push(r[0]);
      if (r[1] !== 0) break fieldLoop;
      }

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue outer;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue outer;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
