import { describe, expect, it } from 'vitest';
import {
  addTableColumn,
  addTableRow,
  applyImageFilter,
  deleteSection,
  duplicateSection,
  mergeTableCellRight,
  moveSection,
  setSectionHidden,
  sortTableByColumn
} from '../src/lib/editing';
import { parseReportHtml } from '../src/lib/htmlParser';

const html = `<!doctype html><html><body><main>
  <header><h1>Cover</h1></header>
  <section><h2>Table</h2><table><thead><tr><th>Name</th><th>Score</th></tr></thead><tbody><tr><td>B</td><td>2</td></tr><tr><td>A</td><td>1</td></tr></tbody></table></section>
  <section><h2>Image</h2><img src="data:image/png;base64,AAAA" alt="old"></section>
</main></body></html>`;

describe('report editing operations', () => {
  it('duplicates, hides, moves, and deletes sections while preserving stable section ids', () => {
    let report = parseReportHtml(html);
    const tableSectionId = report.sections[1].id;

    report = duplicateSection(report, tableSectionId);
    expect(report.sections).toHaveLength(4);
    expect(report.sections[2].title).toContain('Table');

    report = setSectionHidden(report, report.sections[2].id, true);
    expect(report.sections[2].hidden).toBe(true);

    report = moveSection(report, report.sections[2].id, -1);
    expect(report.sections[1].hidden).toBe(true);

    report = deleteSection(report, report.sections[1].id);
    expect(report.sections.map((section) => section.title)).toEqual(['Cover', 'Table', 'Image']);
  });

  it('adds rows and columns, sorts table rows, and merges cells', () => {
    let report = parseReportHtml(html);
    const tableNode = report.sections[1].editableNodes.find((node) => node.kind === 'table')!;

    report = addTableRow(report, report.sections[1].id, tableNode.id, 1);
    report = addTableColumn(report, report.sections[1].id, tableNode.id, 2);
    report = sortTableByColumn(report, report.sections[1].id, tableNode.id, 0, 'asc');
    report = mergeTableCellRight(report, report.sections[1].id, tableNode.id, 1, 0);

    const sectionHtml = report.sections[1].html;
    expect(sectionHtml).toContain('<td>A</td>');
    expect(sectionHtml).toContain('colspan="2"');
    expect(sectionHtml).toContain('<th></th>');
  });

  it('applies non-destructive image visual adjustments as inline styles', () => {
    let report = parseReportHtml(html);
    const imageNode = report.sections[2].editableNodes.find((node) => node.kind === 'image')!;

    report = applyImageFilter(report, report.sections[2].id, imageNode.id, {
      rotation: 90,
      brightness: 110,
      contrast: 95,
      blur: 2
    });

    expect(report.sections[2].html).toContain('rotate(90deg)');
    expect(report.sections[2].html).toContain('brightness(110%)');
    expect(report.sections[2].html).toContain('contrast(95%)');
    expect(report.sections[2].html).toContain('blur(2px)');
  });
});
