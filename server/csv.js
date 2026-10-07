// Quote fields, and neutralise spreadsheet formula injection (=, +, -, @ prefixes).
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvRow = (cells) => cells.map(csvCell).join(',');

export const EBIRD_HEADER = [
  'Common Name', 'Genus', 'Species', 'Species Count', 'Species Comments',
  'Location Name', 'Latitude', 'Longitude', 'Date', 'Start Time',
  'State/Province', 'Country Code', 'Protocol', 'Number of Observers',
  'Duration', 'All observations reported?', 'Distance Covered', 'Area Covered',
  'Checklist Comments',
];
