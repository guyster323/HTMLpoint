import { describe, expect, it } from 'vitest';
import { updateChartData, insertTableAfterNode, insertImageAfterNode, resizeImage } from '../src/lib/editing';
import { parseReportHtml } from '../src/lib/htmlParser';
import { getRibbonGroupsForTab } from '../src/components/Ribbon';
import { buildPreviewHtml } from '../src/lib/preview';

const html = `<!doctype html><html><body><main>
  <section>
    <h2>Chart</h2>
    <p>Intro</p>
    <svg aria-label="rack bars" viewBox="0 0 220 140">
      <rect x="40" y="20" width="100" height="20" fill="#2457a6"><title>Rack A: 10 sec</title></rect>
      <text x="20" y="35">Rack A</text><text x="150" y="35">10s</text>
      <rect x="40" y="60" width="50" height="20" fill="#d45a38"><title>Rack B: 5 sec</title></rect>
      <text x="20" y="75">Rack B</text><text x="100" y="75">5s</text>
    </svg>
    <img src="data:image/png;base64,AAAA" alt="plot" style="width: 320px; height: 180px;">
  </section>
</main></body></html>`;

describe('v1.5/v2 editing improvements', () => {
  it('uses tab-specific ribbon groups and no longer labels file actions as Clipboard', () => {
    expect(getRibbonGroupsForTab('Home').map((group) => group.title)).toContain('File');
    expect(getRibbonGroupsForTab('Home').map((group) => group.title)).not.toContain('Clipboard');
    expect(getRibbonGroupsForTab('Insert').map((group) => group.title)).toEqual(['Insert Objects']);
    expect(getRibbonGroupsForTab('Table').map((group) => group.title)).toContain('Table Tools');
    expect(getRibbonGroupsForTab('Image').map((group) => group.title)).toContain('Image Tools');
    expect(getRibbonGroupsForTab('Review').map((group) => group.title)).toContain('Review');
    expect(getRibbonGroupsForTab('Export').map((group) => group.title)).toContain('Export');
  });

  it('extracts editable SVG bar chart data and updates it back into chart markup', () => {
    let report = parseReportHtml(html);
    const section = report.sections[0];
    const chart = section.editableNodes.find((node) => node.kind === 'chart')!;

    expect(chart.chart?.editable).toBe(true);
    expect(chart.chart?.rows.slice(0, 2)).toEqual([
      expect.objectContaining({ label: 'Rack A', value: 10 }),
      expect.objectContaining({ label: 'Rack B', value: 5 })
    ]);

    report = updateChartData(report, section.id, chart.id, [
      { label: 'Rack A', value: 20 },
      { label: 'Rack B', value: 8 }
    ]);

    expect(report.sections[0].html).toContain('Rack A: 20');
    expect(report.sections[0].html).toContain('Rack B: 8');
    expect(report.sections[0].html).toContain('width="100"');
    expect(report.sections[0].html).toContain('width="40"');
    expect(report.sections[0].html).toContain('20s');
    expect(report.sections[0].html).toContain('8s');
  });

  it('inserts table and image objects from ribbon-level commands', () => {
    let report = parseReportHtml(html);
    const section = report.sections[0];
    const paragraph = section.editableNodes.find((node) => node.tagName === 'p')!;

    report = insertTableAfterNode(report, section.id, paragraph.id, 2, 3).report;
    expect(report.sections[0].html).toContain('data-htmlpoint-inserted="table"');
    expect(report.sections[0].editableNodes.some((node) => node.kind === 'table')).toBe(true);

    const nextParagraph = report.sections[0].editableNodes.find((node) => node.tagName === 'p')!;
    report = insertImageAfterNode(
      report,
      section.id,
      nextParagraph.id,
      'data:image/png;base64,BBBB',
      'inserted.png'
    ).report;
    expect(report.sections[0].html).toContain('data-htmlpoint-inserted="image"');
    expect(report.sections[0].html).toContain('inserted.png');
  });

  it('reads image size from inline style and supports drag-resize preview messaging', () => {
    let report = parseReportHtml(html);
    const section = report.sections[0];
    const image = section.editableNodes.find((node) => node.kind === 'image')!;

    expect(image.image?.width).toBe('320');
    expect(image.image?.height).toBe('180');

    report = resizeImage(report, section.id, image.id, { width: 480, height: 270, unit: 'px' });
    expect(report.sections[0].html).toContain('width="480"');
    expect(report.sections[0].html).toContain('height="270"');

    const preview = buildPreviewHtml(report, section.id, 'ko', image.id);
    expect(preview).toContain('htmlpoint-resize-image');
    expect(preview).toContain('pointerdown');
  });
});
