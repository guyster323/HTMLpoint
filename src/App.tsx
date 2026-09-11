import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react';
import type { CSSProperties } from 'react';
import {
  addImageAnnotation,
  addImageArrowAnnotation,
  addImageMosaic,
  addTableColumn,
  addTableRow,
  applyObjectLayouts,
  applyTextEffect,
  applyTextStyleToNodes,
  applyImageFilter,
  captureRuntimeTable,
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
  updateTranslationText
} from './lib/editing';
import {
  normalizeSemanticLayoutSelection,
  semanticLayoutNodes,
  semanticLayoutSelectionCount,
  semanticRepresentativeId
} from './lib/objectLayout';
import {
  createAutoBackup,
  openHtmlDialog,
  openImageAsDataUrl,
  saveHtml,
  saveAsHtml
} from './lib/fileServices';
import { acceptDroppedHtmlFile, isFileDrag } from './lib/dropImport';
import {
  isCurrentBackupSnapshot,
  nextReportAfterSave,
  shouldCreateAutoBackup,
  validateOpenedReport
} from './lib/documentActions';
import type { PendingDocumentAction } from './lib/documentActions';
import { clampPropertiesWidth } from './lib/uiSizing';
import { collectExternalReportUrls, normalizeExternalPreviewUrl } from './lib/preview';
import {
  findFragmentPath,
  findSectionForFragment,
  getVisibleSections
} from './lib/sectionNavigation';
import { buildChangeSummaryEntries } from './lib/changeSummary';
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
  ObjectLayoutCommand,
  ObjectLayoutMetrics,
  ObjectLayoutPatch,
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
  const [imageArrowModeNodeId, setImageArrowModeNodeId] = useState<string>();
  const [imageMosaicModeNodeId, setImageMosaicModeNodeId] = useState<string>();
  const [previewNavigationNonce, setPreviewNavigationNonce] = useState(0);
  const [layoutCommand, setLayoutCommand] = useState<{
    id: number;
    command: ObjectLayoutCommand;
  }>();
  const [focusedOutline, setFocusedOutline] = useState<{
    sectionId: string;
    path: number[];
  }>();
  const [pendingInsertionFeedback, setPendingInsertionFeedback] = useState<{
    requestId: string;
    successMessage: string;
  }>();
  const reportRef = useRef(report);
  const insertionRequestCounterRef = useRef(0);
  const layoutCommandCounterRef = useRef(0);
  const dragDepthRef = useRef(0);
  const pendingDocumentActionRef = useRef<PendingDocumentAction | null>(null);
  const documentActionBusyRef = useRef(false);
  const pendingCancelButtonRef = useRef<HTMLButtonElement>(null);
  const changeSummaryCloseButtonRef = useRef<HTMLButtonElement>(null);
  const clearDropOverlay = useCallback(() => {
    dragDepthRef.current = 0;
    setDragActive(false);
  }, []);
  reportRef.current = report;
  const selectedSectionId = selection.sectionId;
  const selectedNodeId = selection.nodeId;
  const selectedNodeIds = selection.nodeIds;
  const selectedCell = selection.cell;
  const focusedOutlineKey = focusedOutline
    ? `${focusedOutline.sectionId}:${focusedOutline.path.join('.')}`
    : undefined;
  const previewRevision = useMemo(
    () =>
      report && selectedSectionId
        ? `${report.id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`
        : undefined,
    [focusedOutlineKey, previewNavigationNonce, report, selectedSectionId]
  );
  const previewRevisionRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    previewRevisionRef.current = previewRevision;
  }, [previewRevision]);
  const changeSummaryOpen = showChangeSummary && !pendingDocumentAction;
  const changeSummaryEntries = useMemo(
    () => buildChangeSummaryEntries(changeSummaryOpen, report),
    [changeSummaryOpen, report]
  );
  const commit = useCallback((
    updater: (current: ReportDocument) => ReportDocument,
    updateSelection?: (context: EditorSelectionTransitionContext) => EditorSelection
  ) => {
    dispatchEditorSession({ type: 'commit', updateReport: updater, updateSelection });
  }, []);
  useEffect(() => {
    const handleWindowDragFinished = () => clearDropOverlay();
    window.addEventListener('drop', handleWindowDragFinished, true);
    window.addEventListener('dragend', handleWindowDragFinished, true);
    window.addEventListener('blur', handleWindowDragFinished, true);
    return () => {
      window.removeEventListener('drop', handleWindowDragFinished, true);
      window.removeEventListener('dragend', handleWindowDragFinished, true);
      window.removeEventListener('blur', handleWindowDragFinished, true);
    };
  }, [clearDropOverlay]);
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
  const visibleSections = useMemo(() => getVisibleSections(report), [report]);
  const selectedSectionIndex = useMemo(
    () => visibleSections.findIndex((section) => section.id === selectedSectionId),
    [selectedSectionId, visibleSections]
  );
  const allowedExternalUrls = useMemo(
    () => collectExternalReportUrls(report?.sourceHtml ?? ''),
    [report?.sourceHtml]
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
  const effectiveSelectedLayoutMetrics = normalizeObjectLayoutMetrics(
    selectedNodeId ? selectionSnapshots[selectedNodeId]?.layoutMetrics : undefined
  );
  const selectedObjectCount = selectedSection
    ? semanticLayoutSelectionCount(selectedSection.editableNodes, selectedNodeIds)
    : 0;
  const layoutSelectionKey = `${selectedSectionId ?? ''}|${selectedNodeId ?? ''}|${selectedNodeIds.join('|')}`;

  useEffect(() => {
    setSelectionSnapshots({});
    setLayoutCommand(undefined);
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
    setImageArrowModeNodeId(undefined);
    setImageMosaicModeNodeId(undefined);
    setLayoutCommand(undefined);
  }, [selectedSectionId]);
  useEffect(() => {
    setLayoutCommand(undefined);
  }, [layoutSelectionKey]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const previewWindow = document.querySelector<HTMLIFrameElement>(
        'iframe[title="Report preview"]'
      )?.contentWindow;
      if (event.source !== previewWindow || event.data?.source !== 'htmlpoint-preview') {
        return;
      }
      if (
        !previewRevisionRef.current ||
        event.data.previewRevision !== previewRevisionRef.current
      ) {
        return;
      }
      if (
        event.data.type === 'htmlpoint-select-section-node' &&
        typeof event.data.sectionId === 'string' &&
        typeof event.data.nodeId === 'string'
      ) {
        const currentReport = reportRef.current;
        const section = getVisibleSections(currentReport).find(
          (candidate) => candidate.id === event.data.sectionId
        );
        const clickedNode = section?.editableNodes.find(
          (candidate) => candidate.id === event.data.nodeId
        );
        if (!section || !clickedNode) {
          return;
        }
        const nodeId = semanticRepresentativeId(section.editableNodes, clickedNode.id) ?? clickedNode.id;
        const node = section.editableNodes.find((candidate) => candidate.id === nodeId) ?? clickedNode;
        setFocusedOutline({ sectionId: section.id, path: node.path });
        setSelection({
          sectionId: section.id,
          nodeId: node.id,
          nodeIds: [node.id],
          cell: { row: 0, cell: 0 }
        });
        setMessage({
          kind: 'status',
          text: `‘${section.title}’(으)로 이동해 개체를 선택했습니다.`
        });
        return;
      }
      if (
        event.data.type === 'htmlpoint-select-section-runtime' &&
        typeof event.data.sectionId === 'string' &&
        Array.isArray(event.data.hostPath) &&
        event.data.hostPath.length > 0 &&
        event.data.hostPath.length <= 128 &&
        event.data.hostPath.every(
          (part: unknown) => Number.isInteger(part) && Number(part) >= 0
        )
      ) {
        const section = getVisibleSections(reportRef.current).find(
          (candidate) => candidate.id === event.data.sectionId
        );
        if (!section) {
          return;
        }
        setFocusedOutline({
          sectionId: section.id,
          path: event.data.hostPath as number[]
        });
        setSelection({
          sectionId: section.id,
          nodeId: undefined,
          nodeIds: [],
          cell: { row: 0, cell: 0 }
        });
        setMessage({
          kind: 'status',
          text: `‘${section.title}’의 동적 표로 이동했습니다. 다시 클릭하면 편집본으로 변환됩니다.`
        });
        return;
      }
      if (
        event.data.type === 'htmlpoint-navigate-fragment' &&
        typeof event.data.fragment === 'string' &&
        event.data.fragment.length <= 2048
      ) {
        const currentReport = reportRef.current;
        const section = currentReport && findSectionForFragment(
          currentReport,
          event.data.fragment,
          currentReport.activeLanguage
        );
        if (!section) {
          setMessage({ kind: 'error', text: '링크 대상 Section을 찾을 수 없습니다.' });
          return;
        }
        const path = findFragmentPath(section, event.data.fragment);
        setPreviewNavigationNonce((current) => current + 1);
        setFocusedOutline({ sectionId: section.id, path: path ?? [] });
        setSelection({
          sectionId: section.id,
          nodeId: undefined,
          nodeIds: [],
          cell: { row: 0, cell: 0 }
        });
        return;
      }
      if (
        event.data.type === 'htmlpoint-open-external-link' &&
        typeof event.data.url === 'string'
      ) {
        const normalizedUrl = normalizeExternalPreviewUrl(event.data.url);
        if (!normalizedUrl || !allowedExternalUrls.has(normalizedUrl)) {
          setMessage({ kind: 'error', text: '원본 HTML에 없는 외부 링크 요청을 차단했습니다.' });
          return;
        }
        const opener = window.htmlpoint?.openExternalLink;
        if (!opener) {
          setMessage({ kind: 'error', text: '외부 브라우저 열기는 데스크톱 배포판에서 사용할 수 있습니다.' });
          return;
        }
        void opener(normalizedUrl).catch((error: unknown) => {
          setMessage({ kind: 'error', text: `외부 링크 열기 실패: ${errorMessage(error)}` });
        });
        return;
      }
      if (event.data.type === 'htmlpoint-link-blocked') {
        setMessage({ kind: 'error', text: '안전하지 않거나 지원하지 않는 링크 이동을 차단했습니다.' });
        return;
      }
      if (
        event.data.type === 'htmlpoint-capture-runtime-table' &&
        selectedSectionId &&
        event.data.sectionId === selectedSectionId &&
        Array.isArray(event.data.hostPath) &&
        event.data.hostPath.length > 0 &&
        event.data.hostPath.length <= 128 &&
        event.data.hostPath.every(
          (part: unknown) => Number.isInteger(part) && Number(part) >= 0
        ) &&
        typeof event.data.tableHtml === 'string' &&
        event.data.tableHtml.length <= 2 * 1024 * 1024
      ) {
        const hostPath = event.data.hostPath as number[];
        const tableHtml = event.data.tableHtml;
        commitInsertion(
          selectedSectionId,
          (current) => captureRuntimeTable(
            current,
            selectedSectionId,
            hostPath,
            tableHtml
          ),
          '동적 Heatmap을 현재 화면의 정적 편집본으로 변환했습니다. 이제 Objects에서 표를 수정할 수 있습니다.'
        );
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
        const requestedNodeIds = Array.isArray(event.data.selectedNodeIds)
          ? event.data.selectedNodeIds.filter((nodeId: unknown): nodeId is string =>
              typeof nodeId === 'string' &&
              Boolean(selectedSection?.editableNodes.some((node) => node.id === nodeId))
            )
          : [event.data.nodeId];
        const normalizedSelection = normalizeSemanticLayoutSelection(
          selectedSection.editableNodes,
          requestedNodeIds,
          event.data.nodeId
        );
        const nextSelectedIds = normalizedSelection.nodeIds;
        const nextPrimaryNodeId = normalizedSelection.primaryNodeId ?? event.data.nodeId;
        setSelection((current) => ({
          ...current,
          nodeId: nextPrimaryNodeId,
          nodeIds: nextSelectedIds.length ? nextSelectedIds : [nextPrimaryNodeId]
        }));
        const selectedLabel = selectedSection.editableNodes.find(
          (node) => node.id === nextPrimaryNodeId
        )?.label;
        setMessage({
          kind: 'status',
          text: nextSelectedIds.length > 1
            ? `개체 ${nextSelectedIds.length}개를 선택했습니다.`
            : `‘${selectedLabel ?? '개체'}’을(를) 선택했습니다.`
        });
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
        const requestedNodeIds = event.data.nodeIds.filter((nodeId: unknown): nodeId is string =>
          typeof nodeId === 'string' &&
          Boolean(selectedSection?.editableNodes.some((node) => node.id === nodeId))
        );
        const normalizedSelection = selectedSection
          ? normalizeSemanticLayoutSelection(
              selectedSection.editableNodes,
              requestedNodeIds,
              requestedNodeIds[0]
            )
          : { nodeIds: [], primaryNodeId: undefined };
        const nextSelectedIds = normalizedSelection.nodeIds;
        if (nextSelectedIds.length) {
          setSelection((current) => ({
            ...current,
            nodeId: normalizedSelection.primaryNodeId ?? nextSelectedIds[0],
            nodeIds: nextSelectedIds
          }));
          setMessage({
            kind: 'status',
            text: nextSelectedIds.length > 1
              ? `개체 ${nextSelectedIds.length}개를 선택했습니다.`
              : '개체 1개를 선택했습니다.'
          });
        }
        return;
      }
      if (
        event.data.type === 'htmlpoint-clear-selection' &&
        event.data.sectionId === selectedSectionId
      ) {
        setSelection((current) => ({
          ...current,
          nodeId: undefined,
          nodeIds: []
        }));
        return;
      }
      if (event.data.type === 'htmlpoint-layout-command-unavailable') {
        setLayoutCommand((current) =>
          current?.id === event.data.commandId ? undefined : current
        );
        setMessage({
          kind: 'status',
          text:
            typeof event.data.reason === 'string' && event.data.reason.length <= 160
              ? event.data.reason
              : '이 배치 명령을 현재 선택에 적용할 수 없습니다.'
        });
        return;
      }
      if (
        event.data.type === 'htmlpoint-commit-layout' &&
        event.data.sectionId === selectedSectionId &&
        selectedSectionId &&
        selectedSection
      ) {
        const sectionId = selectedSectionId;
        const patches = normalizePreviewLayoutPatches(
          event.data.patches,
          selectedSection
        );
        if (!patches) {
          setPreviewNavigationNonce((current) => current + 1);
          setMessage({ kind: 'error', text: '유효하지 않은 개체 배치 요청을 차단했습니다.' });
          return;
        }
        const label = normalizeLayoutLabel(event.data.label);
        setLayoutCommand((current) =>
          current?.id === event.data.commandId ? undefined : current
        );
        const currentReport = reportRef.current;
        if (!currentReport) {
          return;
        }
        const appliedReport = applyObjectLayouts(
          currentReport,
          sectionId,
          patches,
          label
        );
        if (appliedReport === currentReport) {
          setPreviewNavigationNonce((current) => current + 1);
          setMessage({ kind: 'status', text: '변경할 개체 배치 값이 없습니다.' });
          return;
        }
        commit((current) =>
          current === currentReport
            ? appliedReport
            : applyObjectLayouts(current, sectionId, patches, label)
        );
        setMessage({
          kind: 'status',
          text: `${label} · Ctrl+Z로 되돌릴 수 있습니다.`
        });
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
        event.data.type === 'htmlpoint-add-image-mosaic' && typeof event.data.nodeId === 'string' &&
        event.data.nodeId === imageMosaicModeNodeId && selectedSectionId &&
        selectedSection?.editableNodes.some((node) => node.id === event.data.nodeId) &&
        Number.isFinite(event.data.left) && Number.isFinite(event.data.top) &&
        Number.isFinite(event.data.width) && Number.isFinite(event.data.height)
      ) {
        const nodeId = event.data.nodeId;
        commit((current) => addImageMosaic(current, selectedSectionId, nodeId, { left: event.data.left, top: event.data.top, width: event.data.width, height: event.data.height }));
        setImageMosaicModeNodeId(undefined);
        setMessage({ kind: 'status', text: '이미지 모자이크를 추가했습니다.' });
        return;
      }
      if (
        event.data.type === 'htmlpoint-add-image-arrow' &&
        typeof event.data.nodeId === 'string' &&
        event.data.nodeId === imageArrowModeNodeId &&
        selectedSectionId &&
        selectedSection?.editableNodes.some((node) => node.id === event.data.nodeId) &&
        Number.isFinite(event.data.startX) &&
        Number.isFinite(event.data.startY) &&
        Number.isFinite(event.data.endX) &&
        Number.isFinite(event.data.endY)
      ) {
        const nodeId = event.data.nodeId;
        commit((current) =>
          addImageArrowAnnotation(current, selectedSectionId, nodeId, {
            startX: event.data.startX,
            startY: event.data.startY,
            endX: event.data.endX,
            endY: event.data.endY
          })
        );
        setImageArrowModeNodeId(undefined);
        setMessage({ kind: 'status', text: '이미지 화살표 주석을 추가했습니다.' });
        return;
      }
      if (
        event.data.type === 'htmlpoint-image-arrow-rejected' &&
        typeof event.data.nodeId === 'string' &&
        (event.data.nodeId === imageArrowModeNodeId || event.data.nodeId === imageMosaicModeNodeId)
      ) {
        setImageArrowModeNodeId(undefined);
        setImageMosaicModeNodeId(undefined);
        setMessage({ kind: 'error', text: '화살표는 프레임, 크롭, 회전이 없는 이미지에서만 그릴 수 있습니다.' });
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
  }, [allowedExternalUrls, commit, commitInsertion, commitTextEdit, imageArrowModeNodeId, imageMosaicModeNodeId, selectedNodeId, selectedNodeIds, selectedSection, selectedSectionId]);

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
      clearDropOverlay();
      reportRef.current = nextReport;
      dispatchEditorSession({ type: 'load', report: nextReport });
      setFitMode(true);
      setFocusedOutline(undefined);
      setImageArrowModeNodeId(undefined);
      setImageMosaicModeNodeId(undefined);
      setLayoutCommand(undefined);
      setBackupPath(backup);
      setSelectionSnapshots({});
      const loadedMessage = successMessage ?? `${nextReport.fileName ?? nextReport.title} loaded`;
      setLoadingAnnouncement(warning ? `${loadedMessage} — 경고: ${warning}` : loadedMessage);
      setMessage({ kind: warning ? 'error' : 'status', text: 'Rendering section 1…' });
    },
    [clearDropOverlay]
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
    async (reportToSave: ReportDocument, forceSaveAs = false): Promise<SaveAttemptResult> => {
      let savedFile: Awaited<ReturnType<typeof saveAsHtml>>;
      try {
        savedFile = forceSaveAs ? await saveAsHtml(reportToSave) : await saveHtml(reportToSave);
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
      if (action.type !== 'close-window') {
        clearDropOverlay();
      }
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
    [clearDropOverlay, runDocumentAction, setPendingAction]
  );
  const handleOpen = useCallback(async () => {
    clearDropOverlay();
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
  }, [clearDropOverlay, requestDocumentAction, setActionBusy]);
  const handleDroppedFiles = useCallback(
    (files: FileList | File[]) => {
      const file = Array.from(files)[0];
      if (file) {
        requestDocumentAction({ type: 'dropped-file', file });
      }
    },
    [requestDocumentAction]
  );
  const saveCurrentReport = useCallback(async (forceSaveAs: boolean) => {
    if (pendingDocumentActionRef.current || documentActionBusyRef.current) {
      return;
    }
    const currentReport = reportRef.current;
    if (!currentReport) {
      return;
    }
    setActionBusy(true);
    try {
      await saveReportSnapshot(currentReport, forceSaveAs);
    } finally {
      setActionBusy(false);
    }
  }, [saveReportSnapshot, setActionBusy]);
  const handleSave = useCallback(() => saveCurrentReport(false), [saveCurrentReport]);
  const handleSaveAs = useCallback(() => saveCurrentReport(true), [saveCurrentReport]);
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
      if (discardedReport?.sourcePath) {
        try {
          await window.htmlpoint?.discardAutoBackups?.(discardedReport.sourcePath);
        } catch (error) {
          setMessage({ kind: 'error', text: `자동 복구본 정리 경고: ${errorMessage(error)}` });
        }
      }
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
    const offSave = window.htmlpoint?.onMenuSave?.(() => {
      void handleSave();
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
      offSave?.();
      offUndo?.();
      offRedo?.();
      offCloseRequested?.();
      offOperationError?.();
    };
  }, [handleRedo, handleSave, handleSaveAs, handleUndo, requestDocumentAction]);
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
    setFocusedOutline(undefined);
    setSelection((current) => {
      if (!additive) {
        return { ...current, nodeId, nodeIds: nodeId ? [nodeId] : [] };
      }
      const exists = current.nodeIds.includes(nodeId);
      const next = exists
        ? current.nodeIds.filter((id) => id !== nodeId)
        : [...current.nodeIds, nodeId];
      const requestedNodeIds = next.length ? next : [nodeId];
      const normalized = selectedSection
        ? normalizeSemanticLayoutSelection(
            selectedSection.editableNodes,
            requestedNodeIds,
            exists ? requestedNodeIds[0] : nodeId
          )
        : { nodeIds: requestedNodeIds, primaryNodeId: nodeId };
      const nodeIds = normalized.nodeIds.length ? normalized.nodeIds : [nodeId];
      return {
        ...current,
        nodeId: normalized.primaryNodeId ?? nodeIds[0],
        nodeIds
      };
    });
  }, [selectedSection]);
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
  const handleArrange = useCallback((command: ObjectLayoutCommand) => {
    if (!selectedSectionId || !selectedNodeIds.length) {
      setMessage({ kind: 'status', text: '배치할 개체를 먼저 선택하세요.' });
      return;
    }
    layoutCommandCounterRef.current += 1;
    setLayoutCommand({ id: layoutCommandCounterRef.current, command });
  }, [selectedNodeIds.length, selectedSectionId]);
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
        if (!isFileDrag(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        dragDepthRef.current += 1;
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (dragDepthRef.current === 0) {
          return;
        }
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
          setDragActive(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        const shouldOpenFile = isFileDrag(event.dataTransfer);
        clearDropOverlay();
        if (shouldOpenFile) {
          void handleDroppedFiles(event.dataTransfer.files);
        }
      }}
    >
      {dragActive && (
        <div className="drop-overlay" style={{ pointerEvents: 'auto' }}>
          <strong>Drop HTML Report</strong>
          <span>단일 HTML 파일을 열어 편집합니다.</span>
        </div>
      )}
      <Ribbon
        report={report}
        activeTab={activeTab}
        selectedSectionIndex={selectedSectionIndex}
        sectionCount={visibleSections.length}
        sectionHidden={sectionHidden}
        selectedKind={effectiveSelectedNode?.kind}
        selectedTextStyle={effectiveSelectedNode?.textStyle}
        selectedObjectCount={selectedObjectCount}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onTabChange={setActiveTab}
        onOpen={handleOpen}
        onSave={handleSave}
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
        onLanguageChange={(language) => {
          setFocusedOutline(undefined);
          setLayoutCommand(undefined);
          dispatchEditorSession({ type: 'set-language', language });
        }}
        onArrange={handleArrange}
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
          focusedOutlineKey={
            focusedOutlineKey
          }
          onSelect={(sectionId, outlinePath) => {
            setPreviewNavigationNonce((current) => current + 1);
            const nextSection = report?.sections.find((section) => section.id === sectionId);
            const firstNodeId = outlinePath
              ? undefined
              : nextSection
                ? semanticLayoutNodes(nextSection.editableNodes)[0]?.id
                : undefined;
            const outlineItem = outlinePath
              ? nextSection?.outlineItems?.find(
                  (item) => item.path.join('.') === outlinePath.join('.')
                )
              : undefined;
            setFocusedOutline(
              outlinePath ? { sectionId, path: outlinePath } : undefined
            );
            if (outlineItem?.dynamic) {
              setMessage({
                kind: 'status',
                text: '동적 Heatmap으로 이동했습니다. 표를 클릭하면 저장 가능한 편집본으로 변환됩니다.'
              });
            }
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
          focusPath={
            focusedOutline && focusedOutline.sectionId === selectedSectionId
              ? focusedOutline.path
              : undefined
          }
          previewRevision={previewRevision}
          imageArrowModeNodeId={imageArrowModeNodeId}
          imageMosaicModeNodeId={imageMosaicModeNodeId}
          layoutCommand={layoutCommand}
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
          selectedLayoutMetrics={effectiveSelectedLayoutMetrics}
          selectedObjectCount={selectedObjectCount}
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
          onDrawImageArrow={(nodeId) => {
            setImageArrowModeNodeId((current) => current === nodeId ? undefined : nodeId);
            setImageMosaicModeNodeId(undefined);
            setMessage({ kind: 'status', text: '이미지 위에서 드래그하여 화살표를 그리세요.' });
          }}
          imageArrowArmed={imageArrowModeNodeId === effectiveSelectedNode?.id}
          onDrawImageMosaic={(nodeId) => {
            setImageMosaicModeNodeId((current) => current === nodeId ? undefined : nodeId);
            setImageArrowModeNodeId(undefined);
            setMessage({ kind: 'status', text: '이미지 위에서 드래그하여 모자이크 영역을 지정하세요.' });
          }}
          imageMosaicArmed={imageMosaicModeNodeId === effectiveSelectedNode?.id}
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
          onObjectLayout={(patch) => {
            const sectionId = requireSection();
            if (sectionId) {
              const currentReport = reportRef.current;
              if (!currentReport) {
                return;
              }
              const appliedReport = applyObjectLayouts(
                currentReport,
                sectionId,
                [patch],
                '개체 크기 및 위치 입력'
              );
              if (appliedReport === currentReport) {
                setMessage({ kind: 'status', text: '변경할 크기 또는 위치 값이 없습니다.' });
              } else {
                commit((current) =>
                  current === currentReport
                    ? appliedReport
                    : applyObjectLayouts(
                        current,
                        sectionId,
                        [patch],
                        '개체 크기 및 위치 입력'
                      )
                );
                setMessage({ kind: 'status', text: '개체 크기와 위치를 적용했습니다.' });
              }
            }
          }}
        />
      </div>
      <div
        className="message-line"
        role={message.kind === 'error' ? 'alert' : 'status'}
        aria-atomic="true"
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
        open={changeSummaryOpen}
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

function normalizePreviewLayoutPatches(
  value: unknown,
  section: { editableNodes: EditableNode[] }
): ObjectLayoutPatch[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
    return undefined;
  }
  const validNodeIds = new Set(section.editableNodes.map((node) => node.id));
  const normalized: ObjectLayoutPatch[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      return undefined;
    }
    const patch = candidate as Record<string, unknown>;
    if (typeof patch.nodeId !== 'string' || !validNodeIds.has(patch.nodeId)) {
      return undefined;
    }
    const readNumber = (
      key: 'offsetX' | 'offsetY' | 'baseTranslateX' | 'baseTranslateY' | 'width' | 'height',
      minimum: number,
      maximum: number
    ): number | undefined | null => {
      const raw = patch[key];
      if (raw === undefined) {
        return undefined;
      }
      return typeof raw === 'number' && Number.isFinite(raw) && raw >= minimum && raw <= maximum
        ? raw
        : null;
    };
    const offsetX = readNumber('offsetX', -50_000, 50_000);
    const offsetY = readNumber('offsetY', -50_000, 50_000);
    const baseTranslateX = readNumber('baseTranslateX', -50_000, 50_000);
    const baseTranslateY = readNumber('baseTranslateY', -50_000, 50_000);
    const width = readNumber('width', 16, 20_000);
    const height = readNumber('height', 16, 20_000);
    if (
      offsetX === null ||
      offsetY === null ||
      baseTranslateX === null ||
      baseTranslateY === null ||
      width === null ||
      height === null
    ) {
      return undefined;
    }
    const resetPosition = patch.resetPosition === true;
    if (
      !resetPosition &&
      offsetX === undefined &&
      offsetY === undefined &&
      width === undefined &&
      height === undefined
    ) {
      return undefined;
    }
    normalized.push({
      nodeId: patch.nodeId,
      ...(offsetX !== undefined ? { offsetX } : {}),
      ...(offsetY !== undefined ? { offsetY } : {}),
      ...(baseTranslateX !== undefined ? { baseTranslateX } : {}),
      ...(baseTranslateY !== undefined ? { baseTranslateY } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(resetPosition ? { resetPosition: true } : {})
    });
  }
  return normalized;
}

function normalizeLayoutLabel(value: unknown): string {
  const allowed = new Set([
    '개체 이동',
    '개체 그룹 이동',
    '개체 미세 이동',
    '개체 그룹 미세 이동',
    '개체 크기 조절',
    '개체 정렬',
    '개체 위치 초기화',
    '개체 그룹 위치 초기화'
  ]);
  return typeof value === 'string' && allowed.has(value) ? value : '개체 배치 변경';
}

function normalizeObjectLayoutMetrics(value: unknown): ObjectLayoutMetrics | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const readFinite = (key: keyof ObjectLayoutMetrics, minimum: number, maximum: number) => {
    const raw = candidate[key];
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= minimum && raw <= maximum
      ? raw
      : undefined;
  };
  const x = readFinite('x', -100_000, 100_000);
  const y = readFinite('y', -100_000, 100_000);
  const width = readFinite('width', 0, 20_000);
  const height = readFinite('height', 0, 20_000);
  const offsetX = readFinite('offsetX', -50_000, 50_000);
  const offsetY = readFinite('offsetY', -50_000, 50_000);
  const baseTranslateX = readFinite('baseTranslateX', -50_000, 50_000);
  const baseTranslateY = readFinite('baseTranslateY', -50_000, 50_000);
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    offsetX === undefined ||
    offsetY === undefined ||
    baseTranslateX === undefined ||
    baseTranslateY === undefined
  ) {
    return undefined;
  }
  return {
    x,
    y,
    width,
    height,
    offsetX,
    offsetY,
    baseTranslateX,
    baseTranslateY,
    lockHeight: candidate.lockHeight === true,
    lockSize: candidate.lockSize === true,
    lockPosition: candidate.lockPosition === true
  };
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
