import { describe, expect, it } from 'vitest';
import {
  findImportCandidates,
  getSlideDescriptors,
  parseHtml,
  parseReportHtml
} from '../src/lib/htmlParser';
import { serializeReportHtml } from '../src/lib/htmlSerializer';
import {
  copyEditableNodes,
  deleteEditableNodes,
  duplicateEditableNodes,
  groupEditableNodes,
  insertConnector,
  insertShapeAfterNode,
  pasteEditableNodes,
  ungroupEditableNode
} from '../src/lib/editing';

describe('HTML import adapters', () => {
  it('imports explicit div slides without also importing nested semantic sections', () => {
    const document = parseHtml(`<!doctype html><html><body>
      <div class="slide-portrait" data-slide="1"><h1>Title</h1><section><p>Body</p></section></div>
      <div class="slide"><h1>Second</h1></div>
    </body></html>`);

    expect(getSlideDescriptors(document).map(({ adapter }) => adapter)).toEqual(['slide', 'slide']);
    const report = parseReportHtml(document.documentElement.outerHTML);
    expect(report.sections.map((section) => section.title)).toEqual(['Title', 'Second']);
    expect(report.sections.map((section) => section.kind)).toEqual(['slide', 'slide']);
    expect(report.sections[0].editableNodes.some((node) => node.text === 'Body')).toBe(true);
  });

  it('imports fig-canvas nodes and keeps declared edge relationships', () => {
    const report = parseReportHtml(`<!doctype html><html><body>
      <div class="fig-canvas" data-canvas-id="flow">
        <div class="fig-node" data-node-id="start" data-x="10" data-y="20">Start</div>
        <div class="fig-node" data-node-id="finish" data-x="100" data-y="20">Finish</div>
        <div class="fig-edge" data-edge-id="edge-1" data-from="start" data-to="finish" data-start-anchor="right" data-end-anchor="left"></div>
        <svg><path d="M0 0 L10 10" /></svg>
      </div>
    </body></html>`);

    expect(report.sections).toHaveLength(1);
    expect(report.sections[0].kind).toBe('canvas');
    expect(report.sections[0].editableNodes.filter((node) => node.kind === 'shape')).toHaveLength(2);
    const edge = report.sections[0].editableNodes.find((node) => node.kind === 'connector');
    expect(edge?.diagram).toEqual({
      role: 'edge',
      objectId: 'edge-1',
      fromObjectId: 'start',
      toObjectId: 'finish',
      startAnchor: 'right',
      endAnchor: 'left'
    });
    expect(report.sections[0].editableNodes.some((node) => node.kind === 'chart')).toBe(false);

    const saved = serializeReportHtml(report);
    expect(saved.html).toContain('data-htmlpoint-source-section-id="section-1"');
    expect(saved.html).toContain('data-htmlpoint-object-id="start"');
    const reopened = parseReportHtml(saved.html);
    expect(reopened.sections[0].id).toBe(report.sections[0].id);
    expect(reopened.sections[0].editableNodes.find((node) => node.kind === 'connector')?.id).toBe(
      edge?.id
    );
  });

  it('exposes candidate regions instead of silently splitting unknown markup', () => {
    const document = parseHtml(`<!doctype html><html><body>
      <main><div><h1>Candidate A</h1><p>Text</p></div><div><h2>Candidate B</h2></div></main>
    </body></html>`);
    expect(getSlideDescriptors(document)).toHaveLength(0);
    expect(findImportCandidates(document).map((candidate) => candidate.label)).toEqual([
      'Candidate A',
      'Candidate B'
    ]);
    const report = parseReportHtml(document.documentElement.outerHTML);
    expect(report.sections).toHaveLength(0);
    expect(report.importCandidates).toHaveLength(2);
    const selected = parseReportHtml(document.documentElement.outerHTML, {
      selectedCandidatePath: report.importCandidates![1].domPath
    });
    expect(selected.sections).toHaveLength(1);
    expect(selected.sections[0].title).toBe('Candidate B');
    expect(selected.sections[0].sourceRef?.adapter).toBe('candidate');
  });

  it('keeps inserted shape and connector references through serialization', () => {
    let report = parseReportHtml(
      '<!doctype html><html><body><section><h1>Diagram</h1></section></body></html>'
    );
    const sectionId = report.sections[0].id;
    const first = insertShapeAfterNode(report, sectionId, undefined, 'rect', 'A');
    expect(first.insertedNodeId).toBeTruthy();
    report = first.report;
    const second = insertShapeAfterNode(report, sectionId, first.insertedNodeId, 'ellipse', 'B');
    expect(second.insertedNodeId).toBeTruthy();
    report = second.report;
    const connector = insertConnector(report, sectionId, first.insertedNodeId!, second.insertedNodeId!);
    expect(connector.insertedNodeId).toBeTruthy();
    const edge = connector.report.sections[0].editableNodes.find((node) => node.kind === 'connector');
    expect(edge?.diagram?.fromObjectId).toBe(
      report.sections[0].editableNodes.find((node) => node.id === first.insertedNodeId)?.diagram?.objectId
    );
    const reopened = parseReportHtml(serializeReportHtml(connector.report).html);
    expect(reopened.sections[0].editableNodes.filter((node) => node.kind === 'shape')).toHaveLength(2);
    expect(reopened.sections[0].editableNodes.find((node) => node.kind === 'connector')?.diagram).toMatchObject({
      fromObjectId: edge?.diagram?.fromObjectId,
      toObjectId: edge?.diagram?.toObjectId
    });
  });

  it('duplicates, groups, ungroups, and deletes diagram objects atomically', () => {
    let report = parseReportHtml('<!doctype html><html><body><section><h1>Diagram</h1></section></body></html>');
    const sectionId = report.sections[0].id;
    const first = insertShapeAfterNode(report, sectionId, undefined, 'rect', 'A');
    report = first.report;
    const second = insertShapeAfterNode(report, sectionId, first.insertedNodeId, 'rect', 'B');
    report = second.report;
    const duplicated = duplicateEditableNodes(report, sectionId, [first.insertedNodeId!, second.insertedNodeId!]);
    report = duplicated.report;
    expect(report.sections[0].editableNodes.filter((node) => node.kind === 'shape')).toHaveLength(4);
    const shapes = report.sections[0].editableNodes.filter((node) => node.kind === 'shape');
    report = groupEditableNodes(report, sectionId, [shapes[0].id, shapes[1].id]);
    const grouped = report.sections[0].editableNodes.find((node) => node.id === shapes[0].id) ?? report.sections[0].editableNodes[0];
    report = ungroupEditableNode(report, sectionId, grouped.id);
    report = deleteEditableNodes(report, sectionId, [shapes[0].id]);
    expect(report.sections[0].editableNodes.filter((node) => node.kind === 'shape')).toHaveLength(3);
  });

  it('round-trips diagram objects through the application clipboard payload', () => {
    let report = parseReportHtml('<!doctype html><html><body><section><h1>Diagram</h1></section></body></html>');
    const sectionId = report.sections[0].id;
    const first = insertShapeAfterNode(report, sectionId, undefined, 'rect', 'A');
    report = first.report;
    const clipboard = copyEditableNodes(report, sectionId, [first.insertedNodeId!]);
    expect(clipboard?.type).toBe('htmlpoint-diagram-clipboard');
    const pasted = pasteEditableNodes(report, sectionId, clipboard!);
    expect(pasted.insertedNodeId).toBeTruthy();
    expect(pasted.report.sections[0].editableNodes.filter((node) => node.kind === 'shape')).toHaveLength(2);
    expect(
      pasted.report.sections[0].editableNodes
        .filter((node) => node.kind === 'shape')
        .map((node) => node.diagram?.objectId)
    ).toHaveLength(2);
  });
});
