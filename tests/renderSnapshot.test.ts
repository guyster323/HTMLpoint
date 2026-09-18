import { describe, expect, it } from 'vitest';
import { parseReportHtml } from '../src/lib/htmlParser';
import {
  createRenderedDocumentSnapshot,
  getReportRevision,
  validateRenderedDocumentSnapshot
} from '../src/lib/renderSnapshot';

describe('rendered document snapshots', () => {
  it('extracts document coordinates, text runs, capabilities, and fallback warnings', () => {
    const report = parseReportHtml(`<!doctype html><html><body>
      <section id="page" style="width:640px;height:360px">
        <h1 style="left:20px;top:12px;width:300px;height:36px">Title <strong>Bold</strong></h1>
        <div class="fig-node" data-node-id="box" data-x="20" data-y="80" data-width="140" data-height="60">Box</div>
        <div class="fig-edge" data-edge-id="link" data-from="box" data-to="missing"></div>
        <img alt="Missing" style="left:500px;top:300px;width:200px;height:100px">
        <svg class="chart"><rect width="10" height="10" /></svg>
      </section>
    </body></html>`);

    const snapshot = createRenderedDocumentSnapshot(report);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.pages[0]).toMatchObject({ width: 640, height: 360 });
    const heading = snapshot.pages[0].objects.find((object) => object.kind === 'text');
    expect(heading?.bounds).toMatchObject({ x: 20, y: 12, width: 300, height: 36 });
    expect(heading?.textRuns?.map((run) => run.text)).toEqual(['Title', 'Bold']);
    expect(heading?.textRuns?.[1].bold).toBe(true);
    expect(snapshot.pages[0].objects.some((object) => object.capabilities.includes('editable-shape'))).toBe(true);
    expect(snapshot.pages[0].warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-asset', severity: 'error' }),
        expect.objectContaining({ code: 'broken-connector', severity: 'error' }),
        expect.objectContaining({ code: 'picture-fallback' })
      ])
    );
  });

  it('rejects snapshots created from a different document revision', () => {
    const report = parseReportHtml('<!doctype html><html><body><section><p>Text</p></section></body></html>');
    const snapshot = createRenderedDocumentSnapshot(report);
    expect(snapshot.reportRevision).toBe(getReportRevision(report));
    expect(validateRenderedDocumentSnapshot(report, snapshot)).toEqual({ ok: true });
    const changed = {
      ...report,
      updatedAt: report.updatedAt + 1
    };
    expect(validateRenderedDocumentSnapshot(changed, snapshot)).toMatchObject({ ok: false });
  });

  it('applies persisted layout offsets before resolving connector geometry', () => {
    const report = parseReportHtml(`<!doctype html><html><body>
      <section style="width:640px;height:360px">
        <div class="fig-canvas">
          <div class="fig-node" data-node-id="a" data-x="40" data-y="40" data-width="80" data-height="40" data-htmlpoint-layout-x="20">A</div>
          <div class="fig-node" data-node-id="b" data-x="240" data-y="40" data-width="80" data-height="40">B</div>
          <div class="fig-edge" data-edge-id="e" data-from="a" data-to="b"></div>
        </div>
      </section>
    </body></html>`);
    const snapshot = createRenderedDocumentSnapshot(report);
    const node = snapshot.pages[0].objects.find((object) => object.diagram?.objectId === 'a');
    const connector = snapshot.pages[0].objects.find((object) => object.kind === 'connector');
    expect(node?.bounds.x).toBe(60);
    expect(connector?.bounds.x).toBe(100);
    expect(connector?.bounds.width).toBe(180);
  });
});
