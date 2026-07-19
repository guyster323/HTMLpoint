import { describe, expect, it } from 'vitest';
import { deleteSection } from '../src/lib/editing';
import {
  editorSessionReducer,
  emptyEditorSession,
  emptySelection,
  normalizeSelection,
  selectionAfterSectionDelete
} from '../src/lib/editorSession';
import type { EditorSelection, EditorSessionState } from '../src/lib/editorSession';
import { parseReportHtml } from '../src/lib/htmlParser';
import { nextReportAfterSave } from '../src/lib/documentActions';

const html = `<!doctype html><html><body><main>
  <section><h2>First</h2><p>First detail</p></section>
  <section><h2>Middle</h2><p>Middle detail</p></section>
  <section><h2>Last</h2><p>Last detail</p></section>
</main></body></html>`;

function selectionFor(
  sectionId: string,
  nodeId: string,
  nodeIds: string[] = [nodeId]
): EditorSelection {
  return {
    sectionId,
    nodeId,
    nodeIds,
    cell: { row: 2, cell: 1 }
  };
}

describe('editor session selection', () => {
  it('keeps the exact empty selection reference when no report is loaded', () => {
    const selection = emptySelection();

    expect(normalizeSelection(null, selection)).toBe(selection);
  });

  it('falls back from an invalid section and node to the first valid section and node', () => {
    const report = parseReportHtml(html);
    const firstSection = report.sections[0];
    const firstNode = firstSection.editableNodes[0];
    const invalid = selectionFor('missing-section', 'missing-node', ['missing-node']);

    expect(normalizeSelection(report, invalid)).toEqual({
      sectionId: firstSection.id,
      nodeId: firstNode.id,
      nodeIds: [firstNode.id],
      cell: { row: 0, cell: 0 }
    });
  });

  it('selects the section that moves into a deleted middle section index', () => {
    const report = parseReportHtml(html);
    const deletedSectionIndex = 1;
    const deletedSection = report.sections[deletedSectionIndex];
    const current = selectionFor(deletedSection.id, deletedSection.editableNodes[0].id);
    const reportAfterDelete = deleteSection(report, deletedSection.id);
    const expectedSection = reportAfterDelete.sections[deletedSectionIndex];

    expect(
      selectionAfterSectionDelete(reportAfterDelete, deletedSectionIndex, current)
    ).toEqual({
      sectionId: expectedSection.id,
      nodeId: expectedSection.editableNodes[0].id,
      nodeIds: [expectedSection.editableNodes[0].id],
      cell: { row: 0, cell: 0 }
    });
  });

  it('selects the previous section after deleting the last section', () => {
    const report = parseReportHtml(html);
    const deletedSectionIndex = report.sections.length - 1;
    const deletedSection = report.sections[deletedSectionIndex];
    const current = selectionFor(deletedSection.id, deletedSection.editableNodes[0].id);
    const reportAfterDelete = deleteSection(report, deletedSection.id);
    const expectedSection = reportAfterDelete.sections[reportAfterDelete.sections.length - 1];

    expect(
      selectionAfterSectionDelete(reportAfterDelete, deletedSectionIndex, current)
    ).toEqual({
      sectionId: expectedSection.id,
      nodeId: expectedSection.editableNodes[0].id,
      nodeIds: [expectedSection.editableNodes[0].id],
      cell: { row: 0, cell: 0 }
    });
  });

  it('preserves a valid saved history selection including multi-select and cell state', () => {
    const report = parseReportHtml(html);
    const section = report.sections[1];
    const nodeIds = section.editableNodes.slice(0, 2).map((node) => node.id);
    const saved = selectionFor(section.id, nodeIds[1], nodeIds);

    expect(normalizeSelection(report, saved)).toBe(saved);
  });

  it('stores a same-event preview selection with its report commit and restores the pair through undo and redo', () => {
    const report = parseReportHtml(html);
    const firstSection = report.sections[0];
    const secondSection = report.sections[1];
    const initialSelection = selectionFor(
      firstSection.id,
      firstSection.editableNodes[0].id
    );
    const previewSelection = selectionFor(
      secondSection.id,
      secondSection.editableNodes[1].id
    );
    let state: EditorSessionState = {
      ...emptyEditorSession(),
      report,
      selection: initialSelection
    };

    state = editorSessionReducer(state, {
      type: 'commit',
      updateReport: (current) => ({ ...current, title: 'Edited from preview' }),
      updateSelection: () => previewSelection,
      historySelection: () => previewSelection
    });
    const editedReport = state.report!;

    expect(state.selection).toBe(previewSelection);
    expect(state.past).toEqual([{ report, selection: previewSelection }]);

    state = editorSessionReducer(state, { type: 'undo' });
    expect(state.report).toBe(report);
    expect(state.selection).toBe(previewSelection);
    expect(state.future).toEqual([{ report: editedReport, selection: previewSelection }]);

    state = editorSessionReducer(state, { type: 'redo' });
    expect(state.report).toBe(editedReport);
    expect(state.selection).toBe(previewSelection);
  });

  it('updates report and adjacent selection atomically for delete and keeps their undo redo order', () => {
    const report = parseReportHtml(html);
    const deletedSectionIndex = 1;
    const deletedSection = report.sections[deletedSectionIndex];
    const initialSelection = selectionFor(
      deletedSection.id,
      deletedSection.editableNodes[0].id
    );
    let state: EditorSessionState = {
      ...emptyEditorSession(),
      report,
      selection: initialSelection
    };

    state = editorSessionReducer(state, {
      type: 'commit',
      updateReport: (current) => deleteSection(current, deletedSection.id),
      updateSelection: ({ nextReport, current }) =>
        selectionAfterSectionDelete(nextReport, deletedSectionIndex, current)
    });
    const reportAfterDelete = state.report!;
    const selectionAfterDelete = state.selection;

    expect(selectionAfterDelete.sectionId).toBe(reportAfterDelete.sections[deletedSectionIndex].id);
    expect(state.past).toEqual([{ report, selection: initialSelection }]);

    state = editorSessionReducer(state, { type: 'undo' });
    expect(state.report).toBe(report);
    expect(state.selection).toBe(initialSelection);

    state = editorSessionReducer(state, { type: 'redo' });
    expect(state.report).toBe(reportAfterDelete);
    expect(state.selection).toBe(selectionAfterDelete);
  });

  it('preserves the Save As checkpoint path and dirty state through undo and redo', () => {
    const report = parseReportHtml(html, {
      fileName: 'original.html',
      sourcePath: 'C:\\reports\\original.html'
    });
    let state: EditorSessionState = editorSessionReducer(emptyEditorSession(), {
      type: 'load',
      report
    });

    state = editorSessionReducer(state, {
      type: 'commit',
      updateReport: (current) => ({
        ...current,
        title: 'Edited report',
        dirty: true
      })
    });
    const editedReport = state.report!;
    const savedReport = nextReportAfterSave(
      editedReport,
      'D:\\exports\\checkpoint.html'
    );

    state = editorSessionReducer(state, {
      type: 'save-checkpoint',
      previousReport: editedReport,
      savedReport
    });
    expect(state.report).toMatchObject({
      fileName: 'checkpoint.html',
      sourcePath: 'D:\\exports\\checkpoint.html',
      dirty: false
    });

    state = editorSessionReducer(state, { type: 'undo' });
    expect(state.report).toMatchObject({
      fileName: 'checkpoint.html',
      sourcePath: 'D:\\exports\\checkpoint.html',
      dirty: true
    });

    state = editorSessionReducer(state, { type: 'redo' });
    expect(state.report).toMatchObject({
      fileName: 'checkpoint.html',
      sourcePath: 'D:\\exports\\checkpoint.html',
      dirty: false
    });
  });

  it('keeps edits made during Save As dirty while retaining the saved snapshot as a clean checkpoint', () => {
    const report = parseReportHtml(html, {
      fileName: 'original.html',
      sourcePath: 'C:\\reports\\original.html'
    });
    let state = editorSessionReducer(emptyEditorSession(), { type: 'load', report });

    state = editorSessionReducer(state, {
      type: 'commit',
      updateReport: (current) => ({ ...current, title: 'Snapshot being saved', dirty: true })
    });
    const checkpointReport = state.report!;
    state = editorSessionReducer(state, {
      type: 'commit',
      updateReport: (current) => ({ ...current, title: 'Newer unsaved edit', dirty: true })
    });

    state = editorSessionReducer(state, {
      type: 'save-checkpoint',
      previousReport: checkpointReport,
      savedReport: nextReportAfterSave(checkpointReport, 'D:\\exports\\checkpoint.html')
    });
    expect(state.report).toMatchObject({
      title: 'Newer unsaved edit',
      sourcePath: 'D:\\exports\\checkpoint.html',
      dirty: true
    });

    state = editorSessionReducer(state, { type: 'undo' });
    expect(state.report).toMatchObject({
      title: 'Snapshot being saved',
      sourcePath: 'D:\\exports\\checkpoint.html',
      dirty: false
    });

    state = editorSessionReducer(state, { type: 'redo' });
    expect(state.report).toMatchObject({
      title: 'Newer unsaved edit',
      sourcePath: 'D:\\exports\\checkpoint.html',
      dirty: true
    });
  });
});
