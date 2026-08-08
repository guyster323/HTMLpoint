import { describe, expect, it } from 'vitest';
import { addImageMosaic } from '../src/lib/editing';
import { editorSessionReducer, emptyEditorSession } from '../src/lib/editorSession';
import { parseReportHtml } from '../src/lib/htmlParser';
import { buildPreviewHtml } from '../src/lib/preview';

const bareImageHtml = `<!doctype html><html><body><main>
  <section><h2>Evidence</h2><img src="data:image/png;base64,BBBB" alt="rack" style="width: 400px; height: 200px;"></section>
</main></body></html>`;

describe('image mosaic', () => {
  it('preserves the source image and stores a normalized pixelated duplicate crop', () => {
    let report = parseReportHtml(bareImageHtml);
    const section = report.sections[0];
    const image = section.editableNodes.find((node) => node.kind === 'image')!;

    report = addImageMosaic(report, section.id, image.id, {
      left: 10,
      top: 20,
      width: 35,
      height: 40
    });

    const html = report.sections[0].html;
    expect(html).toContain('data-htmlpoint-image-mosaic="true"');
    expect(html).toContain('left:10%');
    expect(html).toContain('top:20%');
    expect(html).toContain('width:35%');
    expect(html).toContain('height:40%');
    expect(html).toContain('image-rendering:pixelated');
    expect(html).toContain('data-htmlpoint-image-mosaic-source="true"');
    expect(html.match(/src="data:image\/png;base64,BBBB"/g)).toHaveLength(2);
    expect(report.sections[0].editableNodes.filter((node) => node.kind === 'image')).toHaveLength(1);
    expect(report.operations.at(-1)).toMatchObject({ type: 'image', label: '이미지 모자이크 추가' });
  });

  it('rejects unsupported structures and regions that are too small', () => {
    let report = parseReportHtml(bareImageHtml);
    const section = report.sections[0];
    const image = section.editableNodes.find((node) => node.kind === 'image')!;
    expect(addImageMosaic(report, section.id, image.id, { left: 10, top: 10, width: 1, height: 40 })).toBe(report);

    report = parseReportHtml(`<!doctype html><html><body><main><section><div><img src="data:image/png;base64,BBBB"></div></section></main></body></html>`);
    const framedSection = report.sections[0];
    const framedImage = framedSection.editableNodes.find((node) => node.kind === 'image')!;
    expect(addImageMosaic(report, framedSection.id, framedImage.id, { left: 10, top: 10, width: 40, height: 40 })).toBe(report);
  });

  it('keeps saved mosaic regions reversible through commit history', () => {
    const report = parseReportHtml(bareImageHtml);
    const section = report.sections[0];
    const image = section.editableNodes.find((node) => node.kind === 'image')!;
    let session = editorSessionReducer(emptyEditorSession(), { type: 'load', report });
    session = editorSessionReducer(session, {
      type: 'commit',
      updateReport: (current) => addImageMosaic(current, section.id, image.id, { left: 10, top: 10, width: 40, height: 40 })
    });
    expect(session.report?.sections[0].html).toContain('data-htmlpoint-image-mosaic="true"');
    session = editorSessionReducer(session, { type: 'undo' });
    expect(session.report?.sections[0].html).not.toContain('data-htmlpoint-image-mosaic="true"');
  });

  it('includes the direct iframe mosaic protocol without source-document runtime state', () => {
    const report = parseReportHtml(bareImageHtml);
    const section = report.sections[0];
    const image = section.editableNodes.find((node) => node.kind === 'image')!;
    const preview = buildPreviewHtml(report, section.id, 'ko', image.id);

    expect(preview).toContain('htmlpoint-set-image-mosaic-mode');
    expect(preview).toContain('htmlpoint-add-image-mosaic');
    expect(preview).toContain('htmlpoint-image-mosaic-ready');
    expect(report.sections[0].html).not.toContain('htmlpoint-add-image-mosaic');
  });
});
