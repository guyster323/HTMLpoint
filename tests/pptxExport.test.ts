import { describe, expect, it } from 'vitest';
import { parseReportHtml } from '../src/lib/htmlParser';
import { exportRenderedDocumentToPptx, PptxExportError } from '../src/lib/export/pptx';
import { createRenderedDocumentSnapshot } from '../src/lib/renderSnapshot';

describe('PPTX export', () => {
  it('creates a real PPTX with editable text, table, shape, and connector objects', async () => {
    const report = parseReportHtml(`<!doctype html><html><body>
      <section style="width:640px;height:360px">
        <h1 style="left:20px;top:12px;width:300px;height:36px">Export title</h1>
        <table style="left:20px;top:70px;width:300px;height:80px"><tbody><tr><th>A</th><td>B</td></tr></tbody></table>
        <div class="fig-node" data-node-id="a" data-x="20" data-y="180" data-width="100" data-height="50">A</div>
        <div class="fig-node" data-node-id="b" data-x="240" data-y="180" data-width="100" data-height="50">B</div>
        <div class="fig-edge" data-edge-id="ab" data-from="a" data-to="b"></div>
        <img src="data:image/png;base64,iVBORw0KGgo=" alt="pixel" style="left:400px;top:20px;width:20px;height:20px">
      </section>
    </body></html>`);
    const snapshot = createRenderedDocumentSnapshot(report);
    const result = await exportRenderedDocumentToPptx(snapshot, { pageSize: '16:9' });

    expect(result.data[0]).toBe(0x50);
    expect(result.data[1]).toBe(0x4b);
    expect(result.report.pageCount).toBe(1);
    expect(result.report.nativeObjectCount).toBeGreaterThanOrEqual(4);
    expect(result.report.errors).toEqual([]);
  });

  it('does not report success when a fatal asset warning is present', async () => {
    const report = parseReportHtml('<!doctype html><html><body><section><img alt="missing"></section></body></html>');
    const snapshot = createRenderedDocumentSnapshot(report);
    await expect(exportRenderedDocumentToPptx(snapshot)).rejects.toBeInstanceOf(PptxExportError);
  });

  it('creates a slide for each of three source pages', async () => {
    const report = parseReportHtml(`<!doctype html><html><body>
      <section><h1>One</h1></section>
      <section><h1>Two</h1></section>
      <section><h1>Three</h1></section>
    </body></html>`);
    const result = await exportRenderedDocumentToPptx(
      createRenderedDocumentSnapshot(report),
      { pageSize: '4:3' }
    );
    expect(result.report.pageCount).toBe(3);
    expect(result.data.slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
  });
});
