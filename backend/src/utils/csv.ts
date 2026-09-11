function neutralizeSpreadsheetFormula(value: string): string {
  if (/^[\t\r]/.test(value) || /^\s*[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

/** Encode a value as an RFC 4180 cell and prevent spreadsheet formula execution. */
export function encodeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${neutralizeSpreadsheetFormula(text).replace(/"/g, '""')}"`;
}

/** Build an Excel-compatible UTF-8 CSV document. */
export function encodeCsv(rows: unknown[][]): string {
  return `\uFEFF${rows.map((row) => row.map(encodeCsvCell).join(',')).join('\r\n')}`;
}
