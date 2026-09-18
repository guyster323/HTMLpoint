import { describe, expect, it } from 'vitest';
import { parseReportHtml } from '../src/lib/htmlParser';
import { evaluateDocumentQuality, qualitySummary } from '../src/lib/documentQuality';
import { createRenderedDocumentSnapshot } from '../src/lib/renderSnapshot';

describe('document quality report', () => {
  it('turns snapshot warnings into navigable document issues', () => {
    const report = parseReportHtml('<!doctype html><html><body><section><img alt="missing"></section></body></html>');
    const quality = evaluateDocumentQuality(createRenderedDocumentSnapshot(report));
    expect(quality.errors).toBe(1);
    expect(quality.issues[0]).toMatchObject({
      code: 'missing-asset',
      sectionId: report.sections[0].id,
      canNavigate: true
    });
    expect(qualitySummary(quality)).toBe('오류 1개 · 경고 0개');
  });

  it('reports a clean document without placeholder issues', () => {
    const report = parseReportHtml('<!doctype html><html><body><section><p style="width:240px;height:40px">짧은 문장</p></section></body></html>');
    const quality = evaluateDocumentQuality(createRenderedDocumentSnapshot(report));
    expect(quality.issues).toEqual([]);
    expect(qualitySummary(quality)).toBe('문서 품질 경고가 없습니다.');
  });
});
