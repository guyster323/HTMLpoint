import { ChartDataRow } from '../types/htmlpoint';

export function serializeChartCsvRows(rows: ChartDataRow[]): string {
  const hasCoordinates = rows.some((row) => row.x !== undefined || row.y !== undefined);
  return rows
    .map((row) =>
      hasCoordinates
        ? [row.label, row.x ?? '', row.y ?? '', row.value].join(',')
        : [row.label, row.value].join(',')
    )
    .join('\n');
}

export function parseChartCsvRows(value: string): ChartDataRow[] {
  return value
    .split(/\r?\n/)
    .map((line) => parseChartCsvLine(line))
    .filter((row): row is ChartDataRow => Boolean(row));
}

function parseChartCsvLine(line: string): ChartDataRow | null {
  const cells = line.split(',').map((cell) => cell.trim());
  const label = cells[0];
  if (!label) {
    return null;
  }

  if (cells.length >= 4) {
    const x = Number(cells[1]);
    const y = Number(cells[2]);
    const value = Number(cells[3]);
    if ([x, y, value].every(Number.isFinite)) {
      return { label, x, y, value };
    }
    return null;
  }

  if (cells.length === 3) {
    const x = Number(cells[1]);
    const y = Number(cells[2]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { label, x, y, value: y };
    }
    return null;
  }

  const value = Number(cells[1]);
  return Number.isFinite(value) ? { label, value } : null;
}
