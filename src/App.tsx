import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  addImageAnnotation,
  addTableColumn,
  addTableRow,
  applyTextEffect,
  applyTextStyleToNodes,
  applyImageFilter,
  cropImage,
  deleteSection,
  deleteTableColumn,
  deleteTableRow,
  duplicateSection,
  editTextNodeWithOutcome,
  filterTableRows,
  insertImageAfterNode,
  insertTableAfterNode,
  importTabDelimitedTable,
  mergeTableCellRight,
  moveSection,
  replaceImageSource,
  resizeImage,
  resizeImageFrame,
  setSectionHidden,
  setTableCellText,
  sortTableByColumn,
  styleTableCell,
  unmergeTableCell,
  updateChartData,
  updateChartPresentation,
  updateTranslationText,
  withActiveLanguage
} from './lib/editing';
import {
  createAutoBackup,
  openHtmlDialog,
  openImageAsDataUrl,
  saveAsHtml
} from './lib/fileServices';
import { acceptDroppedHtmlFile } from './lib/dropImport';
import {
  isCurrentBackupSnapshot,
  nextReportAfterSave,
  shouldCreateAutoBackup,
  validateOpenedReport
} from './lib/documentActions';
import type { PendingDocumentAction } from './lib/documentActions';
import { clampPropertiesWidth } from './lib/uiSizing';
import { formatChangeOperation } from './lib/changeSummary';
import {
  shouldApplyPreviewSelectionState,
  shouldStorePreviewSnapshot
} from './lib/selectionMessages';
import {
  editorSessionReducer,
  emptyEditorSession,
  selectionAfterSectionDelete,
  selectionAfterTableMutation
} from './lib/editorSession';
import type {
  EditorSelection,
  EditorSelectionTransitionContext,
  EditorSelectionUpdater
} from './lib/editorSession';
import { Canvas } from './components/Canvas';
import { ChangeSummaryTimeline } from './components/ChangeSummaryTimeline';
import { Modal } from './components/Modal';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Ribbon } from './components/Ribbon';
import { SectionRail } from './components/SectionRail';
import { StatusBar } from './components/StatusBar';
import {
  ChartPresentationSettings,
  ChartDataRow,
  EditResult,
  EditableNode,
  ImageFilterSettings,
  ImageResizeSettings,
  ReportDocument,
  SelectionVisualSnapshot,
  TextEffectSettings,
  TextStyleSettings
} from './types/htmlpoint';

type TransientOutput =
  | { kind: 'status'; text: string }
  | { kind: 'error'; text: string };

export function App(): JSX.Element {
  const [editorSession, dispatchEditorSession] = useReducer(
    editorSessionReducer,
    undefined,
    emptyEditorSession
  );
  const { report, selection, past, future, lastInsertionResult } = editorSession;
  const setSelection = useCallback((updateSelection: EditorSelectionUpdater) => {
    dispatchEditorSession({ type: 'select', updateSelection });
  }, []);
  const [activeTab, setActiveTab] = useState('Home');
  const [zoom, setZoom] = useState(100);
  const [fitMode, setFitMode] = useState(true);
  const [sectionsPanelExpanded, setSectionsPanelExpanded] = useState(true);
  const [propertiesPanelExpanded, setPropertiesPanelExpanded] = useState(true);
  const [backupPath, setBackupPath] = useState<string>();
  const [message, setMessage] = useState<TransientOutput>({ kind: 'status', text: 'Ready' });
  const [loadingAnnouncement, setLoadingAnnouncement] = useState<string>();
  const [dragActive, setDragActive] = useState(false);
  const [showChangeSummary, setShowChangeSummary] = useState(false);
  const [pendingDocumentAction, setPendingDocumentAction] = useState<PendingDocumentAction | null>(null);
  const [pendingSaveWarning, setPendingSaveWarning] = useState<PendingSaveWarning>();
  const [pendingSaveFeedback, setPendingSaveFeedback] = useState<TransientOutput>();
  const [documentActionBusy, setDocumentActionBusy] = useState(false);
  const [propertiesWidth, setPropertiesWidth] = useState(330);
  const [resizingProperties, setResizingProperties] = useState(false);
  const [selectionSnapshots, setSelectionSnapshots] = useState<Record<string, SelectionVisualSnapshot>>({});
  const [pendingInsertionFeedback, setPendingInsertionFeedback] = useState<{
    requestId: string;
    successMessage: string;
  }>();
  const reportRef = useRef(report);
  const insertionRequestCounterRef = useRef(0);
  const pendingDocumentActionRef = useRef<PendingDocumentAction | null>(null);
  const documentActionBusyRef = useRef(false);
  const pendingCancelButtonRef = useRef<HTMLButtonElement>(null);
  const changeSummaryCloseButtonRef = useRef<HTMLButtonElement>(null);
  reportRef.current = report;

  const selectedSectionId = selection.sectionId;
  const selectedNodeId = selection.nodeId;
  const selectedNodeIds = selection.nodeIds;
  const selectedCell = selection.cell;
  const changeSummaryEntries = report?.operations.map((operation) =>
    formatChangeOperation(operation, report.sections)
  ) ?? [];

  const commit = useCallback((
    updater: (current: ReportDocument) => ReportDocument,
    updateSelection?: (context: EditorSelectionTransitionContext) => EditorSelection
  ) => {
    dispatchEditorSession({ type: 'commit', updateReport: updater, updateSelection });
  }, []);

  const commitInsertion = useCallback((
    sectionId: string,
    insert: (current: ReportDocument) => EditResult,
    successMessage: string
  ) => {
    insertionRequestCounterRef.current += 1;
    const requestId = `insert-${insertionRequestCounterRef.current}`;
    setPendingInsertionFeedback({ requestId, successMessage });
    dispatchEditorSession({
      type: 'insert-object',
      requestId,
      sectionId,
      insert
    });
  }, []);

  const commitTextEdit = useCallback((
    sectionId: string,
    nodeId: string,
    text: string,
    language?: string,
    selectionUpdate?: {
      updateSelection?: (context: EditorSelectionTransitionContext) => EditorSelection;
      historySelection?: (context: EditorSelectionTransitionContext) => EditorSelection;
    }
  ) => {
    const currentReport = reportRef.current;
    if (!currentReport) {
      return;
    }

    const outcome = editTextNodeWithOutcome(
      currentReport,
      sectionId,
      nodeId,
      text,
      language
    );
    if (outcome.validation) {
      setMessage({ kind: 'error', text: outcome.validation.message });
      return;
    }

    dispatchEditorSession({
      type: 'commit',
      updateReport: (current) =>
        current === currentReport
          ? outcome.report
          : editTextNodeWithOutcome(current, sectionId, nodeId, text, language).report,
      updateSelection: selectionUpdate?.updateSelection,
      historySelection: selectionUpdate?.historySelection
    });
  }, []);

  const handleUndo = useCallback(() => {
    dispatchEditorSession({ type: 'undo' });
  }, []);

  const handleRedo = useCallback(() => {
    dispatchEditorSession({ type: 'redo' });
  }, []);

  useEffect(() => {
    if (!shouldCreateAutoBackup(report)) {
      return;
    }
    const backupReport = report;
    const timer = window.setTimeout(() => {
      createAutoBackup(backupReport)
        .then((backup) => {
          if (backup.backupPath && isCurrentBackupSnapshot(reportRef.current, backupReport)) {
            setBackupPath(backup.backupPath);
          }
          if (backup.warnings.length && isCurrentBackupSnapshot(reportRef.current, backupReport)) {
            setMessage({ kind: 'error', text: `자동 백업 경고: ${backup.warnings.join(' ')}` });
          }
        })
        .catch((error) => {
          if (isCurrentBackupSnapshot(reportRef.current, backupReport)) {
            setMessage({ kind: 'error', text: `자동 백업 경고: ${errorMessage(error)}` });
          }
        });
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [report]);

  const selectedSectionIndex = useMemo(
    () => report?.sections.findIndex((section) => section.id === selectedSectionId) ?? -1,
    [report?.sections, selectedSectionId]
  );

  const selectedSection = useMemo(
    () => report?.sections.find((section) => section.id === selectedSectionId),
    [report?.sections, selectedSectionId]
  );

  const selectedNode = useMemo(
    () => selectedSection?.editableNodes.find((node) => node.id === selectedNodeId),
    [selectedNodeId, selectedSection]
  );

  const selectedNodes = useMemo(
    () =>
      (selectedSection?.editableNodes ?? []).filter((node) =>
        selectedNodeIds.includes(node.id)
      ),
    [selectedNodeIds, selectedSection]
  );

  const sameKindSelection = useMemo(
    () =>
      selectedNodes.length <= 1 ||
      selectedNodes.every((node) => node.kind === selectedNodes[0]?.kind),
    [selectedNodes]
  );

  const effectiveSelectedNode = sameKindSelection
    ? mergeNodeSnapshot(selectedNode, selectedNodeId ? selectionSnapshots[selectedNodeId] : undefined)
    : undefined;

  useEffect(() => {
    setSelectionSnapshots({});
  }, [report?.id, report?.updatedAt]);

  useEffect(() => {
    if (
      !pendingInsertionFeedback ||
      lastInsertionResult?.requestId !== pendingInsertionFeedback.requestId
    ) {
      return;
    }
    if (lastInsertionResult.didChange) {
      setSelectionSnapshots({});
      setMessage({ kind: 'status', text: pendingInsertionFeedback.successMessage });
    }
    setPendingInsertionFeedback(undefined);
  }, [lastInsertionResult, pendingInsertionFeedback]);

  useEffect(() => {
    dispatchEditorSession({ type: 'normalize-selection' });
  }, [report]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.source !== 'htmlpoint-preview') {
        return;
      }

      if (
        event.data.type === 'htmlpoint-select-node' &&
        typeof event.data.nodeId === 'string' &&
        selectedSection?.editableNodes.some((node) => node.id === event.data.nodeId)
      ) {
        if (
          isSelectionSnapshot(event.data.snapshot) &&
          shouldStorePreviewSnapshot(event.data, selectedNodeId, selectedNodeIds)
        ) {
          setSelectionSnapshots((current) => ({
            ...current,
            [event.data.snapshot.nodeId]: event.data.snapshot
          }));
        }
        if (!shouldApplyPreviewSelectionState(event.data)) {
          return;
        }
        const nextSelectedIds = Array.isArray(event.data.selectedNodeIds)
          ? event.data.selectedNodeIds.filter((nodeId: unknown): nodeId is string =>
              typeof nodeId === 'string' &&
              Boolean(selectedSection?.editableNodes.some((node) => node.id === nodeId))
            )
          : [event.data.nodeId];
        setSelection((current) => ({
          ...current,
          nodeId: nextSelectedIds[0] ?? event.data.nodeId,
          nodeIds: nextSelectedIds.length ? nextSelectedIds : [event.data.nodeId]
        }));
        return;
      }

      if (event.data.type === 'htmlpoint-select-nodes' && Array.isArray(event.data.nodeIds)) {
        if (
          isSelectionSnapshot(event.data.snapshot) &&
          shouldStorePreviewSnapshot(event.data, selectedNodeId, selectedNodeIds)
        ) {
          setSelectionSnapshots((current) => ({
            ...current,
            [event.data.snapshot.nodeId]: event.data.snapshot
          }));
        }
        if (!shouldApplyPreviewSelectionState(event.data)) {
          return;
        }
        const nextSelectedIds = event.data.nodeIds.filter((nodeId: unknown): nodeId is string =>
          typeof nodeId === 'string' &&
          Boolean(selectedSection?.editableNodes.some((node) => node.id === nodeId))
        );
        if (nextSelectedIds.length) {
          setSelection((current) => ({
            ...current,
            nodeId: nextSelectedIds[0],
            nodeIds: nextSelectedIds
          }));
        }
        return;
      }

      if (
        event.data.type === 'htmlpoint-edit-text' &&
        typeof event.data.nodeId === 'string' &&
        typeof event.data.text === 'string' &&
        selectedSectionId &&
        selectedSection?.editableNodes.some((node) => node.id === event.data.nodeId)
      ) {
        const nodeId = event.data.nodeId;
        const text = event.data.text;
        const selectEditedNode = ({ current }: EditorSelectionTransitionContext) => ({
          ...current,
          nodeId,
          nodeIds: [nodeId]
        });
        commitTextEdit(selectedSectionId, nodeId, text, undefined, {
          updateSelection: selectEditedNode,
          historySelection: selectEditedNode
        });
        return;
      }

      if (
        event.data.type === 'htmlpoint-resize-image' &&
        typeof event.data.nodeId === 'string' &&
        selectedSectionId &&
        Number.isFinite(event.data.width) &&
        Number.isFinite(event.data.height)
      ) {
        commit((current) =>
          resizeImage(current, selectedSectionId, event.data.nodeId, {
            width: event.data.width,
            height: event.data.height,
            unit: 'px'
          })
        );
      }

      if (
        event.data.type === 'htmlpoint-resize-image-frame' &&
        typeof event.data.nodeId === 'string' &&
        selectedSectionId &&
        Number.isFinite(event.data.width) &&
        Number.isFinite(event.data.height)
      ) {
        commit((current) =>
          resizeImageFrame(current, selectedSectionId, event.data.nodeId, {
            width: event.data.width,
            height: event.data.height,
            unit: 'px'
          })
        );
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [commit, commitTextEdit, selectedNodeId, selectedNodeIds, selectedSection, selectedSectionId]);

  useEffect(() => {
    if (!resizingProperties) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      setPropertiesWidth(clampPropertiesWidth(window.innerWidth - event.clientX));
    };
    const handlePointerUp = () => setResizingProperties(false);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [resizingProperties]);

  const loadReport = useCallback(
    (
      nextReport: ReportDocument,
      backup?: string,
      successMessage?: string,
      warning?: string
    ) => {
      reportRef.current = nextReport;
      dispatchEditorSession({ type: 'load', report: nextReport });
      setFitMode(true);
      setBackupPath(backup);
      setSelectionSnapshots({});
      const loadedMessage = successMessage ?? `${nextReport.fileName ?? nextReport.title} loaded`;
      setLoadingAnnouncement(warning ? `${loadedMessage} — 경고: ${warning}` : loadedMessage);
      setMessage({ kind: warning ? 'error' : 'status', text: 'Rendering section 1…' });
    },
    []
  );

  const setPendingAction = useCallback((action: PendingDocumentAction | null) => {
    pendingDocumentActionRef.current = action;
    setPendingDocumentAction(action);
  }, []);

  const setActionBusy = useCallback((busy: boolean) => {
    documentActionBusyRef.current = busy;
    setDocumentActionBusy(busy);
  }, []);

  const saveReportSnapshot = useCallback(
    async (reportToSave: ReportDocument): Promise<SaveAttemptResult> => {
      let savedFile: Awaited<ReturnType<typeof saveAsHtml>>;
      try {
        savedFile = await saveAsHtml(reportToSave);
      } catch (error) {
        const failureMessage = `저장 실패: ${errorMessage(error)}`;
        setMessage({ kind: 'error', text: failureMessage });
        return { status: 'failed', message: failureMessage };
      }

      if (!savedFile) {
        const cancellationMessage = '저장이 취소되었습니다. 저장하지 않은 변경은 그대로 유지됩니다.';
        setMessage({ kind: 'status', text: cancellationMessage });
        return { status: 'cancelled', message: cancellationMessage };
      }

      const { filePath, warnings = [] } = savedFile;
      const warning = warnings.join(' ');
      const savedReport = nextReportAfterSave(reportToSave, filePath);
      const currentReport = reportRef.current;
      if (currentReport !== reportToSave) {
        if (currentReport) {
          const currentWithSavedPath = {
            ...nextReportAfterSave(currentReport, filePath),
            dirty: true
          };
          reportRef.current = currentWithSavedPath;
          dispatchEditorSession({
            type: 'save-checkpoint',
            previousReport: reportToSave,
            savedReport
          });
          setBackupPath(undefined);
        }
        const staleMessage =
          `Saved: ${filePath} — 저장 중 새 변경이 생겨 현재 문서는 아직 저장되지 않았습니다.${warning ? ` 경고: ${warning}` : ''}`;
        setMessage({ kind: 'error', text: staleMessage });
        return { status: 'stale', warning, message: staleMessage };
      }

      reportRef.current = savedReport;
      dispatchEditorSession({
        type: 'save-checkpoint',
        previousReport: reportToSave,
        savedReport
      });
      setBackupPath(undefined);
      setMessage({
        kind: warning ? 'error' : 'status',
        text: warning ? `Saved: ${filePath} — 경고: ${warning}` : `Saved: ${filePath}`
      });
      return { status: 'saved', report: savedReport, warning };
    },
    []
  );

  const loadOpenedFile = useCallback(
    (
      opened: Parameters<typeof validateOpenedReport>[0],
      allowedReport: ReportDocument | null,
      successMessage?: string
    ): PendingDocumentAction | null => {
      const currentReport = reportRef.current;
      if (currentReport?.dirty && currentReport !== allowedReport) {
        return { type: 'opened-file', opened };
      }

      performance.mark('htmlpoint:parse:start');
      const nextReport = validateOpenedReport(opened);
      performance.mark('htmlpoint:parse:end');
      loadReport(nextReport, opened.backupPath, successMessage, opened.warnings?.join(' '));
      return null;
    },
    [loadReport]
  );

  const executeDocumentAction = useCallback(
    async (
      action: PendingDocumentAction,
      allowedReport: ReportDocument | null
    ): Promise<PendingDocumentAction | null> => {
      try {
        if (action.type === 'opened-file') {
          return loadOpenedFile(action.opened, allowedReport);
        }
        if (action.type === 'dropped-file') {
          const opened = await acceptDroppedHtmlFile(action.file);
          return loadOpenedFile(
            opened,
            allowedReport,
            `${action.file.name} dropped and loaded`
          );
        }

        const currentReport = reportRef.current;
        if (currentReport?.dirty && currentReport !== allowedReport) {
          return action;
        }
        await window.htmlpoint?.confirmClose();
        return null;
      } catch (error) {
        setMessage({ kind: 'error', text: errorMessage(error) });
        return null;
      }
    },
    [loadOpenedFile]
  );

  const runDocumentAction = useCallback(
    async (action: PendingDocumentAction, allowedReport: ReportDocument | null) => {
      setActionBusy(true);
      let deferredAction: PendingDocumentAction | null = null;
      try {
        deferredAction = await executeDocumentAction(action, allowedReport);
      } finally {
        setActionBusy(false);
      }
      if (deferredAction) {
        setShowChangeSummary(false);
        setPendingSaveWarning(undefined);
        setPendingSaveFeedback(undefined);
        setPendingAction(deferredAction);
      }
    },
    [executeDocumentAction, setActionBusy, setPendingAction]
  );

  const requestDocumentAction = useCallback(
    (action: PendingDocumentAction) => {
      if (pendingDocumentActionRef.current || documentActionBusyRef.current) {
        return;
      }
      setShowChangeSummary(false);
      const currentReport = reportRef.current;
      if (currentReport?.dirty) {
        setPendingSaveWarning(undefined);
        setPendingSaveFeedback(undefined);
        setPendingAction(action);
        return;
      }
      void runDocumentAction(action, currentReport);
    },
    [runDocumentAction, setPendingAction]
  );

  const handleOpen = useCallback(async () => {
    if (pendingDocumentActionRef.current || documentActionBusyRef.current) {
      return;
    }
    setActionBusy(true);
    let opened: Awaited<ReturnType<typeof openHtmlDialog>> = null;
    try {
      opened = await openHtmlDialog();
    } catch (error) {
      setMessage({ kind: 'error', text: `열기 실패: ${errorMessage(error)}` });
    } finally {
      setActionBusy(false);
    }
    if (opened) {
      requestDocumentAction({ type: 'opened-file', opened });
    }
  }, [requestDocumentAction, setActionBusy]);

  const handleDroppedFiles = useCallback(
    (files: FileList | File[]) => {
      const file = Array.from(files)[0];
      if (file) {
        requestDocumentAction({ type: 'dropped-file', file });
      }
    },
    [requestDocumentAction]
  );

  const handleSaveAs = useCallback(async () => {
    if (pendingDocumentActionRef.current || documentActionBusyRef.current) {
      return;
    }
    const currentReport = reportRef.current;
    if (!currentReport) {
      return;
    }
    setActionBusy(true);
    try {
      await saveReportSnapshot(currentReport);
    } finally {
      setActionBusy(false);
    }
  }, [saveReportSnapshot, setActionBusy]);

  const handlePendingSave = useCallback(async () => {
    const action = pendingDocumentActionRef.current;
    const reportToSave = reportRef.current;
    if (!action || !reportToSave || documentActionBusyRef.current) {
      return;
    }

    setActionBusy(true);
    try {
      setPendingSaveFeedback(undefined);
      const result = await saveReportSnapshot(reportToSave);
      if (result.status !== 'saved') {
        setPendingSaveFeedback({
          kind: result.status === 'cancelled' ? 'status' : 'error',
          text: result.message
        });
      }
      const canContinue =
        result.status === 'saved' &&
        reportRef.current === result.report &&
        !result.report.dirty;
      if (result.warning) {
        setPendingSaveWarning({
          message: result.warning,
          continuationReport: canContinue ? result.report : undefined
        });
        return;
      }
      if (!canContinue) {
        return;
      }
      const deferredAction = await executeDocumentAction(action, result.report);
      setPendingSaveWarning(undefined);
      setPendingSaveFeedback(undefined);
      setPendingAction(deferredAction);
    } finally {
      setActionBusy(false);
    }
  }, [executeDocumentAction, saveReportSnapshot, setActionBusy, setPendingAction]);

  const handlePendingDiscard = useCallback(async () => {
    const action = pendingDocumentActionRef.current;
    if (!action || documentActionBusyRef.current) {
      return;
    }

    const discardedReport = reportRef.current;
    setActionBusy(true);
    try {
      const deferredAction = await executeDocumentAction(action, discardedReport);
      setPendingSaveWarning(undefined);
      setPendingSaveFeedback(undefined);
      setPendingAction(deferredAction);
    } finally {
      setActionBusy(false);
    }
  }, [executeDocumentAction, setActionBusy, setPendingAction]);

  const handlePendingCancel = useCallback(() => {
    if (!documentActionBusyRef.current) {
      setPendingSaveWarning(undefined);
      setPendingSaveFeedback(undefined);
      setPendingAction(null);
    }
  }, [setPendingAction]);

  const handlePendingWarning = useCallback(async () => {
    const action = pendingDocumentActionRef.current;
    const continuationReport = pendingSaveWarning?.continuationReport;
    if (!action || documentActionBusyRef.current) {
      return;
    }
    if (
      !continuationReport ||
      reportRef.current !== continuationReport ||
      continuationReport.dirty
    ) {
      setPendingSaveWarning(undefined);
      return;
    }

    setActionBusy(true);
    try {
      const deferredAction = await executeDocumentAction(action, continuationReport);
      setPendingSaveWarning(undefined);
      setPendingSaveFeedback(undefined);
      setPendingAction(deferredAction);
    } finally {
      setActionBusy(false);
    }
  }, [executeDocumentAction, pendingSaveWarning, setActionBusy, setPendingAction]);

  useEffect(() => {
    const offOpened = window.htmlpoint?.onOpenedFile((opened) => {
      requestDocumentAction({ type: 'opened-file', opened });
    });
    const offSaveAs = window.htmlpoint?.onMenuSaveAs(() => {
      void handleSaveAs();
    });
    const offUndo = window.htmlpoint?.onMenuUndo?.(() => handleUndo());
    const offRedo = window.htmlpoint?.onMenuRedo?.(() => handleRedo());
    const offCloseRequested = window.htmlpoint?.onCloseRequested(() => {
      requestDocumentAction({ type: 'close-window' });
    });
    const offOperationError = window.htmlpoint?.onOperationError((operationError) => {
      setMessage({ kind: 'error', text: operationError });
    });
    return () => {
      offOpened?.();
      offSaveAs?.();
      offUndo?.();
      offRedo?.();
      offCloseRequested?.();
      offOperationError?.();
    };
  }, [handleRedo, handleSaveAs, handleUndo, requestDocumentAction]);

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? handleRedo() : handleUndo();
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, [handleRedo, handleUndo]);

  const requireSection = useCallback(() => selectedSectionId, [selectedSectionId]);
  const requireNode = useCallback(() => selectedNodeId, [selectedNodeId]);

  const handleSelectNode = useCallback((nodeId: string, additive = false) => {
    setSelection((current) => {
      if (!additive) {
        return { ...current, nodeId, nodeIds: nodeId ? [nodeId] : [] };
      }
      const exists = current.nodeIds.includes(nodeId);
      const next = exists
        ? current.nodeIds.filter((id) => id !== nodeId)
        : [...current.nodeIds, nodeId];
      const nodeIds = next.length ? next : [nodeId];
      return {
        ...current,
        nodeId: exists ? nodeIds[0] : nodeId,
        nodeIds
      };
    });
  }, []);

  const selectedTextNodeIds = useMemo(
    () =>
      (selectedNodes.length ? selectedNodes : selectedNode ? [selectedNode] : [])
        .filter((node) => node.kind === 'text' || node.kind === 'list')
        .map((node) => node.id),
    [selectedNode, selectedNodes]
  );

  const handleTextStyle = useCallback(
    (settings: TextStyleSettings) => {
      const sectionId = requireSection();
      if (sectionId && selectedTextNodeIds.length) {
        commit((current) => applyTextStyleToNodes(current, sectionId, selectedTextNodeIds, settings));
      }
    },
    [commit, requireSection, selectedTextNodeIds]
  );

  const handleReplaceImage = useCallback(
    async (nodeId: string) => {
      const image = await openImageAsDataUrl();
      if (!image || !selectedSectionId) {
        return;
      }
      commit((current) => replaceImageSource(current, selectedSectionId, nodeId, image.dataUrl, image.fileName));
    },
    [commit, selectedSectionId]
  );

  const handleInsertImage = useCallback(async () => {
    const sectionId = requireSection();
    if (!sectionId) {
      return;
    }
    const image = await openImageAsDataUrl();
    if (!image) {
      return;
    }
    const anchorNodeId = requireNode();
    commitInsertion(
      sectionId,
      (current) =>
        insertImageAfterNode(current, sectionId, anchorNodeId, image.dataUrl, image.fileName),
      'Image inserted'
    );
  }, [commitInsertion, requireNode, requireSection]);

  const handleDeleteSection = useCallback(() => {
    if (!selectedSectionId) {
      return;
    }
    dispatchEditorSession({
      type: 'commit',
      updateReport: (current) => deleteSection(current, selectedSectionId),
      updateSelection: ({ current, previousReport, nextReport }) => {
        if (nextReport === previousReport) {
          return current;
        }
        const deletedSectionIndex = previousReport.sections.findIndex(
          (section) => section.id === selectedSectionId
        );
        return selectionAfterSectionDelete(nextReport, deletedSectionIndex, current);
      }
    });
  }, [selectedSectionId]);

  const sectionHidden = Boolean(selectedSection?.hidden);
  const handleManualZoomChange = useCallback((nextZoom: number) => {
    setFitMode(false);
    setZoom(nextZoom);
  }, []);
  const handlePreviewAssetError = useCallback((text: string) => {
    setMessage({ kind: 'error', text });
  }, []);
  const workspaceClassName = [
    'workspace',
    resizingProperties ? 'resizing-properties' : '',
    sectionsPanelExpanded ? '' : 'sections-collapsed',
    propertiesPanelExpanded ? '' : 'properties-collapsed'
  ].filter(Boolean).join(' ');

  return (
    <div
      className={dragActive ? 'app-shell drag-active' : 'app-shell'}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setDragActive(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        void handleDroppedFiles(event.dataTransfer.files);
      }}
    >
      {dragActive && (
        <div className="drop-overlay">
          <strong>Drop HTML Report</strong>
          <span>단일 HTML 파일을 열어 편집합니다.</span>
        </div>
      )}
      <Ribbon
        report={report}
        activeTab={activeTab}
        selectedSectionIndex={selectedSectionIndex}
        sectionCount={report?.sections.length ?? 0}
        sectionHidden={sectionHidden}
        selectedKind={effectiveSelectedNode?.kind}
        selectedTextStyle={effectiveSelectedNode?.textStyle}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onTabChange={setActiveTab}
        onOpen={handleOpen}
        onSaveAs={handleSaveAs}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onTextStyle={handleTextStyle}
        onInsertTable={() => {
          const sectionId = requireSection();
          if (sectionId) {
            const anchorNodeId = requireNode();
            commitInsertion(
              sectionId,
              (current) => insertTableAfterNode(current, sectionId, anchorNodeId, 3, 3),
              'Table inserted'
            );
          }
        }}
        onInsertImage={handleInsertImage}
        onDuplicate={() => selectedSectionId && commit((current) => duplicateSection(current, selectedSectionId))}
        onDelete={handleDeleteSection}
        onHideToggle={() =>
          selectedSectionId && commit((current) => setSectionHidden(current, selectedSectionId, !sectionHidden))
        }
        onMove={(delta) => selectedSectionId && commit((current) => moveSection(current, selectedSectionId, delta))}
        onTableAddRow={() => {
          const sectionId = requireSection();
          const nodeId = requireNode();
          if (sectionId && nodeId) {
            commit((current) => addTableRow(current, sectionId, nodeId, selectedCell.row));
          }
        }}
        onTableAddColumn={() => {
          const sectionId = requireSection();
          const nodeId = requireNode();
          if (sectionId && nodeId) {
            commit((current) => addTableColumn(current, sectionId, nodeId, selectedCell.cell + 1));
          }
        }}
        onTableDeleteRow={() => {
          const sectionId = requireSection();
          const nodeId = requireNode();
          if (sectionId && nodeId) {
            commit(
              (current) => deleteTableRow(current, sectionId, nodeId, selectedCell.row),
              ({ current, nextReport, previousReport }) =>
                nextReport === previousReport
                  ? current
                  : selectionAfterTableMutation(nextReport, sectionId, nodeId, current)
            );
          }
        }}
        onTableDeleteColumn={() => {
          const sectionId = requireSection();
          const nodeId = requireNode();
          if (sectionId && nodeId) {
            commit(
              (current) => deleteTableColumn(current, sectionId, nodeId, selectedCell.cell),
              ({ current, nextReport, previousReport }) =>
                nextReport === previousReport
                  ? current
                  : selectionAfterTableMutation(nextReport, sectionId, nodeId, current)
            );
          }
        }}
        onTableSort={(direction) => {
          const sectionId = requireSection();
          const nodeId = requireNode();
          if (sectionId && nodeId) {
            commit((current) => sortTableByColumn(current, sectionId, nodeId, selectedCell.cell, direction));
          }
        }}
        onImageReplace={() => {
          const nodeId = requireNode();
          if (nodeId) {
            void handleReplaceImage(nodeId);
          }
        }}
        onImageCrop={() => {
          const sectionId = requireSection();
          const nodeId = requireNode();
          if (sectionId && nodeId) {
            commit((current) => cropImage(current, sectionId, nodeId, 10));
          }
        }}
        onReviewSummary={() => {
          if (!pendingDocumentActionRef.current) {
            setShowChangeSummary(true);
          }
        }}
        onLanguageChange={(language) => commit((current) => withActiveLanguage(current, language))}
      />
      <div
        className={workspaceClassName}
        style={{ '--properties-width': `${propertiesWidth}px` } as CSSProperties}
      >
        <div className="narrow-panel-controls" aria-label="Side panels">
          <button
            type="button"
            aria-label={`${sectionsPanelExpanded ? 'Collapse' : 'Expand'} sections panel`}
            aria-expanded={sectionsPanelExpanded}
            onClick={() => setSectionsPanelExpanded((expanded) => !expanded)}
          >
            Sections
          </button>
          <button
            type="button"
            aria-label={`${propertiesPanelExpanded ? 'Collapse' : 'Expand'} properties panel`}
            aria-expanded={propertiesPanelExpanded}
            onClick={() => setPropertiesPanelExpanded((expanded) => !expanded)}
          >
            Properties
          </button>
        </div>
        <SectionRail
          report={report}
          selectedSectionId={selectedSectionId}
          onSelect={(sectionId) => {
            const nextSection = report?.sections.find((section) => section.id === sectionId);
            const firstNodeId = nextSection?.editableNodes[0]?.id;
            setSelection({
              sectionId,
              nodeId: firstNodeId,
              nodeIds: firstNodeId ? [firstNodeId] : [],
              cell: { row: 0, cell: 0 }
            });
          }}
          onDuplicate={() => selectedSectionId && commit((current) => duplicateSection(current, selectedSectionId))}
        />
        <Canvas
          report={report}
          selectedSectionId={selectedSectionId}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIds}
          zoom={zoom}
          fitMode={fitMode}
          onFitZoomChange={setZoom}
          onPreviewAssetError={handlePreviewAssetError}
          onPreviewReady={() => {
            if (loadingAnnouncement) {
              performance.mark('htmlpoint:active-preview:ready');
              setMessage({ kind: loadingAnnouncement.includes('경고:') ? 'error' : 'status', text: loadingAnnouncement });
              setLoadingAnnouncement(undefined);
            }
          }}
          onSelectNode={handleSelectNode}
        />
        <div
          className="properties-resizer"
          role="separator"
          aria-label="Resize properties panel"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setResizingProperties(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              setPropertiesWidth((width) => clampPropertiesWidth(width + 24));
            }
            if (event.key === 'ArrowRight') {
              setPropertiesWidth((width) => clampPropertiesWidth(width - 24));
            }
          }}
        />
        <PropertiesPanel
          report={report}
          selectedSectionId={selectedSectionId}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIds}
          selectedNodeOverride={effectiveSelectedNode}
          selectedCell={selectedCell}
          onNodeSelect={(nodeId) => handleSelectNode(nodeId, false)}
          onCellSelect={(row, cell) =>
            setSelection((current) => ({ ...current, cell: { row, cell } }))
          }
          onTextChange={(nodeId, text, language) => {
            const sectionId = requireSection();
            if (sectionId) {
              commitTextEdit(sectionId, nodeId, text, language);
            }
          }}
          onTextEffect={(nodeId, settings: TextEffectSettings) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => applyTextEffect(current, sectionId, nodeId, settings));
            }
          }}
          onTextStyle={(nodeIds, settings: TextStyleSettings) => {
            const sectionId = requireSection();
            if (sectionId && nodeIds.length) {
              commit((current) => applyTextStyleToNodes(current, sectionId, nodeIds, settings));
            }
          }}
          onTranslationChange={(selector, text) => commit((current) => updateTranslationText(current, selector, text))}
          onTableCellText={(nodeId, row, cell, text) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => setTableCellText(current, sectionId, nodeId, row, cell, text));
            }
          }}
          onAddTableRow={(nodeId, row) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => addTableRow(current, sectionId, nodeId, row));
            }
          }}
          onAddTableColumn={(nodeId, column) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => addTableColumn(current, sectionId, nodeId, column));
            }
          }}
          onDeleteTableRow={(nodeId, row) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit(
                (current) => deleteTableRow(current, sectionId, nodeId, row),
                ({ current, nextReport, previousReport }) =>
                  nextReport === previousReport
                    ? current
                    : selectionAfterTableMutation(nextReport, sectionId, nodeId, current)
              );
            }
          }}
          onDeleteTableColumn={(nodeId, column) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit(
                (current) => deleteTableColumn(current, sectionId, nodeId, column),
                ({ current, nextReport, previousReport }) =>
                  nextReport === previousReport
                    ? current
                    : selectionAfterTableMutation(nextReport, sectionId, nodeId, current)
              );
            }
          }}
          onSortTable={(nodeId, column, direction) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => sortTableByColumn(current, sectionId, nodeId, column, direction));
            }
          }}
          onFilterTable={(nodeId, query) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => filterTableRows(current, sectionId, nodeId, query));
            }
          }}
          onMergeRight={(nodeId, row, cell) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => mergeTableCellRight(current, sectionId, nodeId, row, cell));
            }
          }}
          onUnmerge={(nodeId, row, cell) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => unmergeTableCell(current, sectionId, nodeId, row, cell));
            }
          }}
          onCellStyle={(nodeId, row, cell, styles) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => styleTableCell(current, sectionId, nodeId, row, cell, styles));
            }
          }}
          onPasteTable={(nodeId, text) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => importTabDelimitedTable(current, sectionId, nodeId, text));
            }
          }}
          onReplaceImage={handleReplaceImage}
          onImageFilter={(nodeId, settings: ImageFilterSettings) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => applyImageFilter(current, sectionId, nodeId, settings));
            }
          }}
          onResizeImage={(nodeId, settings: ImageResizeSettings) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => resizeImage(current, sectionId, nodeId, settings));
            }
          }}
          onResizeImageFrame={(nodeId, settings: ImageResizeSettings) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => resizeImageFrame(current, sectionId, nodeId, settings));
            }
          }}
          onCropImage={(nodeId, inset) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => cropImage(current, sectionId, nodeId, inset));
            }
          }}
          onImageAnnotation={(nodeId, text, tone) => {
            const sectionId = requireSection();
            if (sectionId && text.trim()) {
              commit((current) => addImageAnnotation(current, sectionId, nodeId, text, tone));
            }
          }}
          onChartPresentation={(nodeId, settings: ChartPresentationSettings) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => updateChartPresentation(current, sectionId, nodeId, settings));
            }
          }}
          onChartData={(nodeId, rows: ChartDataRow[]) => {
            const sectionId = requireSection();
            if (sectionId) {
              commit((current) => updateChartData(current, sectionId, nodeId, rows));
            }
          }}
        />
      </div>
      <div
        className="message-line"
        role={message.kind === 'error' ? 'alert' : 'status'}
        aria-live={message.kind === 'status' ? 'polite' : undefined}
      >
        <span>{message.text}</span>
      </div>
      <Modal
        key={pendingSaveWarning ? 'backup-warning' : 'dirty-work'}
        open={Boolean(pendingDocumentAction)}
        title={pendingSaveWarning ? '백업 경고' : '저장하지 않은 변경'}
        description={
          pendingSaveWarning
            ? '문서는 저장되었지만 기존 파일 백업을 만들지 못했습니다.'
            : '현재 문서의 변경 사항을 저장한 뒤 계속할지 선택하세요.'
        }
        initialFocusRef={pendingCancelButtonRef}
        onEscape={handlePendingCancel}
      >
        {pendingSaveWarning ? (
          <>
            <div className="modal-warning" role="alert">
              {pendingSaveWarning.message}
            </div>
            <div className="modal-actions">
              <button
                ref={pendingSaveWarning.continuationReport ? undefined : pendingCancelButtonRef}
                type="button"
                className="blue-button"
                disabled={documentActionBusy}
                onClick={() => void handlePendingWarning()}
              >
                {pendingSaveWarning.continuationReport ? '계속' : '확인'}
              </button>
              {pendingSaveWarning.continuationReport ? (
                <button
                  ref={pendingCancelButtonRef}
                  type="button"
                  disabled={documentActionBusy}
                  onClick={handlePendingCancel}
                >
                  취소
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            {pendingSaveFeedback ? (
              <div
                className={
                  pendingSaveFeedback.kind === 'error'
                    ? 'modal-warning modal-error'
                    : 'modal-warning'
                }
                role={pendingSaveFeedback.kind === 'error' ? 'alert' : 'status'}
                aria-live={pendingSaveFeedback.kind === 'status' ? 'polite' : undefined}
              >
                {pendingSaveFeedback.text}
              </div>
            ) : null}
            <div className="modal-actions unsaved-actions">
              <button
                type="button"
                className="blue-button"
                disabled={documentActionBusy}
                onClick={() => void handlePendingSave()}
              >
                저장 후 계속
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={documentActionBusy}
                onClick={() => void handlePendingDiscard()}
              >
                변경 버리기
              </button>
              <button
                ref={pendingCancelButtonRef}
                type="button"
                disabled={documentActionBusy}
                onClick={handlePendingCancel}
              >
                취소
              </button>
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={showChangeSummary && !pendingDocumentAction}
        title="변경 요약"
        description={`${report?.operations.length ?? 0} operations in current document`}
        initialFocusRef={changeSummaryCloseButtonRef}
        onEscape={() => setShowChangeSummary(false)}
      >
        <ChangeSummaryTimeline entries={changeSummaryEntries} />
        <div className="modal-actions">
          <button
            ref={changeSummaryCloseButtonRef}
            type="button"
            onClick={() => setShowChangeSummary(false)}
          >
            Close
          </button>
        </div>
      </Modal>
      <StatusBar
        report={report}
        selectedIndex={Math.max(0, selectedSectionIndex)}
        zoom={zoom}
        fitMode={fitMode}
        backupPath={backupPath}
        onZoomChange={handleManualZoomChange}
        onFit={() => setFitMode(true)}
      />
    </div>
  );
}

type SaveAttemptResult =
  | { status: 'saved'; report: ReportDocument; warning?: string }
  | { status: 'stale'; warning?: string; message: string }
  | { status: 'cancelled' | 'failed'; warning?: undefined; message: string };

interface PendingSaveWarning {
  message: string;
  continuationReport?: ReportDocument;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSelectionSnapshot(value: unknown): value is SelectionVisualSnapshot {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as SelectionVisualSnapshot).nodeId === 'string'
  );
}

function mergeNodeSnapshot(
  node: EditableNode | undefined,
  snapshot: SelectionVisualSnapshot | undefined
): EditableNode | undefined {
  if (!node || !snapshot || snapshot.nodeId !== node.id) {
    return node;
  }

  return {
    ...node,
    textStyle: snapshot.textStyle ?? node.textStyle,
    textEffect: snapshot.textEffect ?? node.textEffect,
    image: node.image
      ? {
          ...node.image,
          ...snapshot.imageMetrics,
          frameWidth: snapshot.frameMetrics?.width ?? node.image.frameWidth,
          frameHeight: snapshot.frameMetrics?.height ?? node.image.frameHeight,
          frameStyle: snapshot.frameMetrics?.style ?? node.image.frameStyle
        }
      : node.image
  };
}
