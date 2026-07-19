import { describe, expect, it } from 'vitest';
import { updateChartData } from '../src/lib/editing';
import { parseReportHtml } from '../src/lib/htmlParser';

const verticalBarHtml = `<!doctype html><html><body><main><section>
  <h2>Vertical bars</h2>
  <svg viewBox="0 0 200 180" role="img" aria-label="Vertical bars">
    <line x1="10" y1="150" x2="190" y2="150" />
    <rect x="30" y="100" width="30" height="50" fill="#2457a6"><title>A: 10 units</title></rect>
    <text x="45" y="94" text-anchor="middle">10u</text>
    <rect x="90" y="50" width="30" height="100" fill="#d45a38"><title>B: 20 units</title></rect>
    <text x="105" y="44" text-anchor="middle">20u</text>
  </svg>
</section></main></body></html>`;

const labelBarHtml = `<!doctype html><html><body><main><section>
  <h2>Labeled bars</h2>
  <svg viewBox="0 0 240 180" role="img" aria-label="Labeled bars">
    <rect width="240" height="180" fill="#ffffff" />
    <line x1="20" y1="150" x2="220" y2="150" />
    <rect x="40" y="100" width="34" height="50" fill="#64748b" />
    <text x="57" y="94" text-anchor="middle">10.5</text>
    <rect x="100" y="50" width="34" height="100" fill="#16a34a" />
    <text x="117" y="44" text-anchor="middle">21.0</text>
    <text x="57" y="168" text-anchor="middle">Before</text>
    <text x="117" y="168" text-anchor="middle">After</text>
  </svg>
</section></main></body></html>`;

const linePointHtml = `<!doctype html><html><body><main><section>
  <h2>Line points</h2>
  <svg viewBox="0 0 120 120" role="img" aria-label="Line points">
    <path d="M 10 90 L 50 60 L 90 30" fill="none" stroke="#2457a6" />
    <circle cx="10" cy="90" r="4" fill="#2457a6" />
    <circle cx="50" cy="60" r="4" fill="#2457a6" />
    <circle cx="90" cy="30" r="4" fill="#2457a6" />
  </svg>
</section></main></body></html>`;

describe('V2 chart data editing', () => {
  it('updates vertical SVG bars by height and y position instead of width only', () => {
    let report = parseReportHtml(verticalBarHtml);
    const section = report.sections[0];
    const chart = section.editableNodes.find((node) => node.kind === 'chart')!;

    expect(chart.chart?.editable).toBe(true);
    expect(chart.chart?.rows.map((row) => row.value)).toEqual([10, 20]);

    report = updateChartData(report, section.id, chart.id, [
      { label: 'A', value: 20 },
      { label: 'B', value: 10 }
    ]);

    expect(report.sections[0].html).toContain('x="30" y="50" width="30" height="100"');
    expect(report.sections[0].html).toContain('x="90" y="100" width="30" height="50"');
    expect(report.sections[0].html).toContain('A: 20');
    expect(report.sections[0].html).toContain('20u');
    expect(report.sections[0].html).toContain('10u');
  });

  it('extracts and edits SVG bars that use visible numeric labels without title tags', () => {
    let report = parseReportHtml(labelBarHtml);
    const section = report.sections[0];
    const chart = section.editableNodes.find((node) => node.kind === 'chart')!;

    expect(chart.chart?.kind).toBe('svg-bar-label');
    expect(chart.chart?.editable).toBe(true);
    expect(chart.chart?.rows.map((row) => row.value)).toEqual([10.5, 21]);

    report = updateChartData(report, section.id, chart.id, [
      { label: 'Before', value: 21 },
      { label: 'After', value: 10.5 }
    ]);

    expect(report.sections[0].html).toContain('x="40" y="50" width="34" height="100"');
    expect(report.sections[0].html).toContain('x="100" y="100" width="34" height="50"');
    expect(report.sections[0].html).toContain('>21<');
    expect(report.sections[0].html).toContain('>10.5<');
  });

  it('extracts and edits SVG line/circle point coordinates', () => {
    let report = parseReportHtml(linePointHtml);
    const section = report.sections[0];
    const chart = section.editableNodes.find((node) => node.kind === 'chart')!;

    expect(chart.chart?.kind).toBe('svg-point');
    expect(chart.chart?.editable).toBe(true);
    expect(chart.chart?.rows[0]).toEqual(expect.objectContaining({ label: 'Point 1', x: 10, y: 90, value: 90 }));

    report = updateChartData(report, section.id, chart.id, [
      { label: 'Point 1', x: 10, y: 80, value: 80 },
      { label: 'Point 2', x: 50, y: 50, value: 50 },
      { label: 'Point 3', x: 90, y: 20, value: 20 }
    ]);

    expect(report.sections[0].html).toContain('d="M 10 80 L 50 50 L 90 20"');
    expect(report.sections[0].html).toContain('cx="10" cy="80"');
    expect(report.sections[0].html).toContain('cx="90" cy="20"');
  });
});
