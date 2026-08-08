import { describe, expect, it } from 'vitest';
import { addImageArrowAnnotation, applyImageFilter, cropImage } from '../src/lib/editing';
import { editorSessionReducer, emptyEditorSession } from '../src/lib/editorSession';
import { parseReportHtml } from '../src/lib/htmlParser';
import { buildPreviewHtml } from '../src/lib/preview';

const bareImageHtml = `<!doctype html><html><body><main>
  <section><h2>Evidence</h2><img src="data:image/png;base64,AAAA" alt="contactor" style="width: 320px; height: 180px;"></section>
</main></body></html>`;

describe('image arrow annotation', () => {
  it('preserves the source image and stores normalized SVG arrow geometry', () => {
    let report = parseReportHtml(bareImageHtml);
    const section = report.sections[0];
    const image = section.editableNodes.find((node) => node.kind === 'image')!;

    report = addImageArrowAnnotation(report, section.id, image.id, {
      startX: 12.5,
      startY: 25,
      endX: 87.5,
      endY: 75
    });

    expect(report.sections[0].html).toContain('data-htmlpoint-image-annotation-host="true"');
    expect(report.sections[0].html).toContain('data-htmlpoint-image-arrow="true"');
    expect(report.sections[0].html).toContain('viewBox="0 0 100 100"');
    expect(report.sections[0].html).toContain('x1="12.5"');
    expect(report.sections[0].html).toContain('y2="75"');
    expect(report.sections[0].html).toContain('src="data:image/png;base64,AAAA"');
    expect(report.sections[0].html).toContain('width: 320px');
    expect(report.sections[0].editableNodes.filter((node) => node.kind === 'chart')).toHaveLength(0);
    expect(report.operations.at(-1)).toMatchObject({ type: 'image', label: '이미지 화살표 주석 추가' });
  });

  it('leaves framed, cropped, and rotated images unchanged', () => {
    const unsupported = `<!doctype html><html><body><main><section>
      <div class="frame"><img src="data:image/png;base64,AAAA" style="transform: rotate(10deg);"></div>
    </section></main></body></html>`;
    let report = parseReportHtml(unsupported);
    const section = report.sections[0];
    const image = section.editableNodes.find((node) => node.kind === 'image')!;
    const original = report;

    report = addImageArrowAnnotation(report, section.id, image.id, {
      startX: 10,
      startY: 10,
      endX: 90,
      endY: 90
    });

    expect(report).toBe(original);
  });

  it('keeps the annotation reversible through the editor commit history', () => {
    const report = parseReportHtml(bareImageHtml);
    const section = report.sections[0];
    const image = section.editableNodes.find((node) => node.kind === 'image')!;
    let session = editorSessionReducer(emptyEditorSession(), { type: 'load', report });

    session = editorSessionReducer(session, {
      type: 'commit',
      updateReport: (current) =>
        addImageArrowAnnotation(current, section.id, image.id, {
          startX: 20,
          startY: 30,
          endX: 80,
          endY: 70
        })
    });
    expect(session.report?.sections[0].html).toContain('data-htmlpoint-image-arrow="true"');

    session = editorSessionReducer(session, { type: 'undo' });
    expect(session.report?.sections[0].html).not.toContain('data-htmlpoint-image-arrow="true"');

    session = editorSessionReducer(session, { type: 'redo' });
    expect(session.report?.sections[0].html).toContain('data-htmlpoint-image-arrow="true"');
  });

  it('includes the iframe arrow-mode protocol without persisting preview-only drag state', () => {
    const report = parseReportHtml(bareImageHtml);
    const section = report.sections[0];
    const image = section.editableNodes.find((node) => node.kind === 'image')!;
    const preview = buildPreviewHtml(report, section.id, 'ko', image.id);

    expect(preview).toContain('htmlpoint-set-image-arrow-mode');
    expect(preview).toContain('htmlpoint-add-image-arrow');
    expect(preview).toContain('setPointerCapture');
    expect(report.sections[0].html).not.toContain('htmlpoint-add-image-arrow');
  });

  it('rejects crop and non-zero rotation after an arrow has been saved', () => {
    let report = parseReportHtml(bareImageHtml);
    const section = report.sections[0];
    const image = section.editableNodes.find((node) => node.kind === 'image')!;
    report = addImageArrowAnnotation(report, section.id, image.id, {
      startX: 10,
      startY: 10,
      endX: 90,
      endY: 90
    });
    const annotatedImage = report.sections[0].editableNodes.find((node) => node.kind === 'image')!;

    expect(cropImage(report, section.id, annotatedImage.id, 10)).toBe(report);
    expect(applyImageFilter(report, section.id, annotatedImage.id, { rotation: 15 })).toBe(report);
  });
});
