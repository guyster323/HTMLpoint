import { describe, expect, it } from 'vitest';
import { editTextNode, replaceImageSource, setTableCellText, updateTranslationText } from '../src/lib/editing';
import { parseReportHtml } from '../src/lib/htmlParser';
import { serializeReportHtml } from '../src/lib/htmlSerializer';

const sampleHtml = `<!doctype html>
<html lang="ko">
<head>
  <title>Sample</title>
  <style>@media print { section { break-inside: avoid; } }</style>
</head>
<body>
<main>
  <header><h1>원본 제목</h1><button data-lang="ko">KOR</button><button data-lang="en">ENG</button></header>
  <section id="overview"><h2>개요</h2><p>첫 문단</p><table><tbody><tr><th>A</th><td>1</td></tr></tbody></table></section>
  <section><h2>이미지</h2><figure><img src="data:image/png;base64,AAAA" alt="old"><figcaption>사진</figcaption></figure></section>
</main>
<script>
(() => {
  const translations = [
    ['header h1', 'Original title'],
    ['#overview h2', 'Overview']
  ];
  translations.forEach(([selector, en]) => {
    const el = document.querySelector(selector);
    if (el) el.innerHTML = en;
  });
})();
</script>
</body>
</html>`;

describe('HTML report parsing and serialization', () => {
  it('turns header and sections into slide sections with editable nodes, assets, and language metadata', () => {
    const report = parseReportHtml(sampleHtml, { fileName: 'sample.html' });

    expect(report.title).toBe('Sample');
    expect(report.sections).toHaveLength(3);
    expect(report.sections.map((section) => section.kind)).toEqual(['header', 'section', 'section']);
    expect(report.sections[1].title).toBe('개요');
    expect(report.assets).toEqual([
      expect.objectContaining({ kind: 'image', embedded: true, alt: 'old' })
    ]);
    expect(report.languages).toEqual(['ko', 'en']);
    expect(report.translations).toEqual([
      expect.objectContaining({ selector: 'header h1', enHtml: 'Original title' }),
      expect.objectContaining({ selector: '#overview h2', enHtml: 'Overview' })
    ]);
    expect(report.sections[1].editableNodes.some((node) => node.kind === 'table')).toBe(true);
  });

  it('edits text, tables, images, and English translation entries without removing CSS or scripts', () => {
    let report = parseReportHtml(sampleHtml);
    const overview = report.sections[1];
    const paragraph = overview.editableNodes.find((node) => node.tagName === 'p');
    const table = overview.editableNodes.find((node) => node.kind === 'table');
    const image = report.sections[2].editableNodes.find((node) => node.kind === 'image');

    expect(paragraph).toBeDefined();
    expect(table).toBeDefined();
    expect(image).toBeDefined();

    report = editTextNode(report, overview.id, paragraph!.id, '수정된 문단', 'ko');
    report = setTableCellText(report, overview.id, table!.id, 0, 1, '42');
    report = replaceImageSource(report, report.sections[2].id, image!.id, 'data:image/png;base64,BBBB', 'new');
    report = updateTranslationText(report, 'header h1', 'Updated English title');

    const saved = serializeReportHtml(report);

    expect(saved.html).toContain('@media print');
    expect(saved.html).toContain('수정된 문단');
    expect(saved.html).toContain('<td>42</td>');
    expect(saved.html).toContain('data:image/png;base64,BBBB');
    expect(saved.html).toContain("['header h1', 'Updated English title']");
    expect(saved.html).toContain('<script>');
    expect(saved.html).not.toContain('data-htmlpoint-node-id');
    expect(saved.changedSections).toContain('개요');
  });
});
