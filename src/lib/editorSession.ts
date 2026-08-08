import type { EditResult, ReportDocument, ReportSection } from '../types/htmlpoint';

export interface EditorSelection {
  sectionId?: string;
  nodeId?: string;
  nodeIds: string[];
  cell: { row: number; cell: number };
}

export interface EditorHistoryEntry {
  report: ReportDocument;
  selection: EditorSelection;
}

export interface EditorSessionState {
  report: ReportDocument | null;
  selection: EditorSelection;
  past: EditorHistoryEntry[];
  future: EditorHistoryEntry[];
  lastInsertionResult?: EditorInsertionResult;
}

export interface EditorInsertionResult {
  requestId: string;
  didChange: boolean;
  insertedNodeId?: string;
}

export interface EditorInsertionTransition {
  report: ReportDocument;
  selection: EditorSelection;
  didChange: boolean;
  insertedNodeId?: string;
}

export interface EditorSelectionTransitionContext {
  current: EditorSelection;
  previousReport: ReportDocument;
  nextReport: ReportDocument;
}

export type EditorSelectionUpdater =
  | EditorSelection
  | ((current: EditorSelection) => EditorSelection);

export type EditorSessionAction =
  | { type: 'load'; report: ReportDocument }
  | {
      type: 'replace-report';
      updateReport: (current: ReportDocument | null) => ReportDocument | null;
    }
  | {
      type: 'save-checkpoint';
      previousReport: ReportDocument;
      savedReport: ReportDocument;
    }
  | { type: 'select'; updateSelection: EditorSelectionUpdater }
  | { type: 'normalize-selection' }
  | {
      type: 'commit';
      updateReport: (current: ReportDocument) => ReportDocument;
      updateSelection?: (context: EditorSelectionTransitionContext) => EditorSelection;
      historySelection?: (context: EditorSelectionTransitionContext) => EditorSelection;
    }
  | {
      type: 'insert-object';
      requestId: string;
      sectionId: string;
      insert: (current: ReportDocument) => EditResult;
    }
  | { type: 'undo' }
  | { type: 'redo' };

export function emptyEditorSession(): EditorSessionState {
  return {
    report: null,
    selection: emptySelection(),
    past: [],
    future: []
  };
}

export function editorSessionReducer(
  state: EditorSessionState,
  action: EditorSessionAction
): EditorSessionState {
  switch (action.type) {
    case 'load':
      return {
        report: action.report,
        selection: normalizeSelection(action.report, emptySelection()),
        past: [],
        future: []
      };
    case 'replace-report': {
      const report = action.updateReport(state.report);
      return report === state.report ? state : { ...state, report };
    }
    case 'save-checkpoint': {
      if (!state.report || state.report.id !== action.previousReport.id) {
        return state;
      }
      const applyCheckpoint = (report: ReportDocument) =>
        report === action.previousReport
          ? action.savedReport
          : {
              ...report,
              fileName: action.savedReport.fileName,
              sourcePath: action.savedReport.sourcePath,
              dirty: true
            };
      return {
        ...state,
        report: applyCheckpoint(state.report),
        past: state.past.map((entry) => ({
          ...entry,
          report: applyCheckpoint(entry.report)
        })),
        future: state.future.map((entry) => ({
          ...entry,
          report: applyCheckpoint(entry.report)
        }))
      };
    }
    case 'select': {
      const selection = resolveSelectionUpdate(action.updateSelection, state.selection);
      return selection === state.selection ? state : { ...state, selection };
    }
    case 'normalize-selection': {
      const selection = normalizeSelection(state.report, state.selection);
      return selection === state.selection ? state : { ...state, selection };
    }
    case 'commit': {
      if (!state.report) {
        return state;
      }
      const nextReport = action.updateReport(state.report);
      const nextSelection = action.updateSelection
        ? action.updateSelection({
            current: state.selection,
            previousReport: state.report,
            nextReport
          })
        : state.selection;
      const historySelection = action.historySelection
        ? action.historySelection({
            current: state.selection,
            previousReport: state.report,
            nextReport
          })
        : state.selection;
      if (nextReport === state.report) {
        return nextSelection === state.selection
          ? state
          : { ...state, selection: nextSelection };
      }
      return {
        report: nextReport,
        selection: nextSelection,
        past: [
          ...state.past.slice(-39),
          { report: state.report, selection: historySelection }
        ],
        future: []
      };
    }
    case 'insert-object': {
      if (!state.report) {
        return {
          ...state,
          lastInsertionResult: {
            requestId: action.requestId,
            didChange: false
          }
        };
      }
      const transition = applyObjectInsertion(
        state.report,
        state.selection,
        action.sectionId,
        action.insert
      );
      const lastInsertionResult: EditorInsertionResult = {
        requestId: action.requestId,
        didChange: transition.didChange,
        ...(transition.insertedNodeId
          ? { insertedNodeId: transition.insertedNodeId }
          : {})
      };
      if (!transition.didChange) {
        return { ...state, lastInsertionResult };
      }
      return {
        report: transition.report,
        selection: transition.selection,
        past: [
          ...state.past.slice(-39),
          { report: state.report, selection: state.selection }
        ],
        future: [],
        lastInsertionResult
      };
    }
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (!previous || !state.report) {
        return state;
      }
      return {
        report: previous.report,
        selection: normalizeSelection(previous.report, previous.selection),
        past: state.past.slice(0, -1),
        future: [
          { report: state.report, selection: state.selection },
          ...state.future
        ]
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next || !state.report) {
        return state;
      }
      return {
        report: next.report,
        selection: normalizeSelection(next.report, next.selection),
        past: [
          ...state.past.slice(-39),
          { report: state.report, selection: state.selection }
        ],
        future: state.future.slice(1)
      };
    }
  }
}

export function applyObjectInsertion(
  report: ReportDocument,
  currentSelection: EditorSelection,
  sectionId: string,
  insert: (current: ReportDocument) => EditResult
): EditorInsertionTransition {
  const result = insert(report);
  const insertedNode = result.insertedNodeId
    ? result.report.sections
        .find((section) => section.id === sectionId)
        ?.editableNodes.find((node) => node.id === result.insertedNodeId)
    : undefined;
  if (result.report === report || !insertedNode) {
    return {
      report,
      selection: currentSelection,
      didChange: false
    };
  }

  return {
    report: result.report,
    selection: {
      sectionId,
      nodeId: insertedNode.id,
      nodeIds: [insertedNode.id],
      cell: { row: 0, cell: 0 }
    },
    didChange: true,
    insertedNodeId: insertedNode.id
  };
}

export function emptySelection(): EditorSelection {
  return {
    sectionId: undefined,
    nodeId: undefined,
    nodeIds: [],
    cell: { row: 0, cell: 0 }
  };
}

export function normalizeSelection(
  report: ReportDocument | null,
  current: EditorSelection
): EditorSelection {
  if (!report) {
    return current;
  }

  const currentSection = report.sections.find((section) => section.id === current.sectionId);
  const section = currentSection ?? report.sections[0];
  if (!section) {
    return isEmptySelection(current) ? current : emptySelection();
  }

  const validNodeIds = currentSection
    ? current.nodeIds.filter((nodeId) => hasNode(section, nodeId))
    : [];
  const currentNodeIsValid = Boolean(
    currentSection && current.nodeId && hasNode(section, current.nodeId)
  );
  const nodeId = currentNodeIsValid
    ? current.nodeId
    : validNodeIds[0] ?? section.editableNodes[0]?.id;
  const nodeIds = currentNodeIsValid
    ? validNodeIds.includes(nodeId!)
      ? validNodeIds
      : [nodeId!]
    : validNodeIds.length
      ? validNodeIds
      : nodeId
        ? [nodeId]
        : [];
  const cell = currentSection ? current.cell : { row: 0, cell: 0 };

  if (
    current.sectionId === section.id &&
    current.nodeId === nodeId &&
    sameIds(current.nodeIds, nodeIds) &&
    current.cell.row === cell.row &&
    current.cell.cell === cell.cell
  ) {
    return current;
  }

  return {
    sectionId: section.id,
    nodeId,
    nodeIds,
    cell
  };
}

export function selectionAfterSectionDelete(
  reportAfterDelete: ReportDocument,
  deletedSectionIndex: number,
  current: EditorSelection
): EditorSelection {
  const nextSectionIndex = Math.min(
    Math.max(0, deletedSectionIndex),
    reportAfterDelete.sections.length - 1
  );
  const section = reportAfterDelete.sections[nextSectionIndex];
  if (!section) {
    return normalizeSelection(reportAfterDelete, {
      ...current,
      sectionId: undefined,
      nodeId: undefined,
      nodeIds: [],
      cell: { row: 0, cell: 0 }
    });
  }

  const nodeId = section.editableNodes[0]?.id;
  return {
    sectionId: section.id,
    nodeId,
    nodeIds: nodeId ? [nodeId] : [],
    cell: { row: 0, cell: 0 }
  };
}

export function selectionAfterTableMutation(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  current: EditorSelection
): EditorSelection {
  const node = report.sections
    .find((section) => section.id === sectionId)
    ?.editableNodes.find((candidate) => candidate.id === nodeId);
  const rows = node?.table?.rows;
  if (!rows?.length) {
    return current;
  }
  const row = Math.min(Math.max(0, current.cell.row), rows.length - 1);
  const cells = rows[row];
  if (!cells?.length) {
    return current;
  }
  return {
    ...current,
    cell: {
      row,
      cell: Math.min(Math.max(0, current.cell.cell), cells.length - 1)
    }
  };
}

function hasNode(section: ReportSection, nodeId: string): boolean {
  return section.editableNodes.some((node) => node.id === nodeId);
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((nodeId, index) => nodeId === right[index]);
}

function isEmptySelection(selection: EditorSelection): boolean {
  return (
    selection.sectionId === undefined &&
    selection.nodeId === undefined &&
    selection.nodeIds.length === 0 &&
    selection.cell.row === 0 &&
    selection.cell.cell === 0
  );
}

function resolveSelectionUpdate(
  update: EditorSelectionUpdater,
  current: EditorSelection
): EditorSelection {
  return typeof update === 'function' ? update(current) : update;
}
