import { describe, expect, it } from 'vitest';
import { parseChartCsvRows, serializeChartCsvRows } from '../src/lib/chartCsv';

describe('chart CSV helpers', () => {
  it('serializes simple bar rows as label,value', () => {
    expect(
      serializeChartCsvRows([
        { label: 'A', value: 10 },
        { label: 'B', value: 20 }
      ])
    ).toBe('A,10\nB,20');
  });

  it('round-trips point rows with x and y coordinates', () => {
    const csv = serializeChartCsvRows([
      { label: 'Point 1', x: 10, y: 90, value: 90 },
      { label: 'Point 2', x: 50, y: 60, value: 60 }
    ]);

    expect(csv).toBe('Point 1,10,90,90\nPoint 2,50,60,60');
    expect(parseChartCsvRows(csv)).toEqual([
      { label: 'Point 1', x: 10, y: 90, value: 90 },
      { label: 'Point 2', x: 50, y: 60, value: 60 }
    ]);
  });
});
