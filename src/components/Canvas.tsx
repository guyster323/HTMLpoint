import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Layers, MousePointer2 } from 'lucide-react';
import { buildPreviewHtml, sourcePathToBaseUrl } from '../lib/preview';
import { EditableNode, ReportDocument } from '../types/htmlpoint';

const PAGE_WIDTH = 1120;
const STAGE_PADDING = 28;
const MIN_ZOOM = 50;
const MAX_FIT_ZOOM = 100;
const UNAVAILABLE_PREVIEW_BASE = 'htmlpoint-asset://unavailable/';

export function calculateFitZoom(canvasWidth: number, pageWidth: number, padding: number): number {
  if (!Number.isFinite(canvasWidth) || !Number.isFinite(pageWidth) || pageWidth <= 0) {
    return MIN_ZOOM;
  }
  const availableWidth = Math.max(0, canvasWidth - Math.max(0, padding) * 2);
  const calculatedZoom = Math.floor((availableWidth / pageWidth) * 100);
  return Math.min(MAX_FIT_ZOOM, Math.max(MIN_ZOOM, calculatedZoom));
}

interface CanvasProps {
  report: ReportDocument | null;
  selectedSectionId?: string;
  selectedNodeId?: string;
  selectedNodeIds?: string[];
  imageArrowModeNodeId?: string;
  zoom: number;
  fitMode?: boolean;
  onFitZoomChange?: (zoom: number) => void;
  onPreviewAssetError?: (message: string) => void;
  onPreviewReady?: () => void;
  onSelectNode: (nodeId: string, additive?: boolean) => void;
}

interface PreviewBaseState {
  sourcePath?: string;
  baseUrl?: string;
  pending: boolean;
}

export function Canvas({
  report,
  selectedSectionId,
  selectedNodeId,
  selectedNodeIds = selectedNodeId ? [selectedNodeId] : [],
  imageArrowModeNodeId,
  zoom,
  fitMode = false,
  onFitZoomChange,
  onPreviewAssetError,
  onPreviewReady,
  onSelectNode
}: CanvasProps): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const section = report?.sections.find((candidate) => candidate.id === selectedSectionId);
  const hasPreview = Boolean(report && section);
  const zoomScale = zoom / 100;
  const sourcePath = report?.sourcePath;
  const electronPreviewResolver =
    typeof window !== 'undefined' ? window.htmlpoint?.registerPreviewSource : undefined;
  const [previewBase, setPreviewBase] = useState<PreviewBaseState>(() => ({
    sourcePath,
    baseUrl: sourcePath && !electronPreviewResolver ? sourcePathToBaseUrl(sourcePath) : undefined,
    pending: Boolean(sourcePath && electronPreviewResolver)
  }));
  const previewBaseMatchesSource = previewBase.sourcePath === sourcePath;
  const previewBasePending = Boolean(
    sourcePath && electronPreviewResolver && (!previewBaseMatchesSource || previewBase.pending)
  );
  const effectivePreviewBaseUrl = previewBaseMatchesSource
    ? previewBase.baseUrl
    : electronPreviewResolver
      ? undefined
      : sourcePathToBaseUrl(sourcePath);

  useEffect(() => {
    if (!sourcePath) {
      setPreviewBase({ sourcePath, baseUrl: undefined, pending: false });
      return;
    }
    if (!electronPreviewResolver) {
      setPreviewBase({
        sourcePath,
        baseUrl: sourcePathToBaseUrl(sourcePath),
        pending: false
      });
      return;
    }

    let active = true;
    setPreviewBase({ sourcePath, baseUrl: undefined, pending: true });
    electronPreviewResolver(sourcePath)
      .then((baseUrl) => {
        if (active) {
          setPreviewBase({ sourcePath, baseUrl, pending: false });
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setPreviewBase({
          sourcePath,
          baseUrl: UNAVAILABLE_PREVIEW_BASE,
          pending: false
        });
        onPreviewAssetError?.(`상대경로 자산 미리보기 준비 실패: ${message}`);
      });
    return () => {
      active = false;
    };
  }, [electronPreviewResolver, onPreviewAssetError, sourcePath]);

  const previewHtml = useMemo(() => {
    if (!report || !selectedSectionId || previewBasePending) {
      return '';
    }
    return buildPreviewHtml(
      report,
      selectedSectionId,
      report.activeLanguage,
      selectedNodeId,
      selectedNodeIds,
      effectivePreviewBaseUrl
    );
  }, [effectivePreviewBaseUrl, previewBasePending, report, selectedSectionId]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!fitMode || !hasPreview || !stage || !onFitZoomChange) {
      return;
    }

    let lastReportedZoom: number | undefined;
    const updateFitZoom = () => {
      const width = stage.clientWidth;
      if (width <= 0) {
        return;
      }
      const nextZoom = calculateFitZoom(width, PAGE_WIDTH, STAGE_PADDING);
      if (nextZoom === lastReportedZoom) {
        return;
      }
      lastReportedZoom = nextZoom;
      onFitZoomChange(nextZoom);
    };

    updateFitZoom();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(updateFitZoom);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [fitMode, hasPreview, onFitZoomChange]);

  const postSelectionToPreview = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: 'htmlpoint-editor',
        type: 'htmlpoint-set-selection',
        selectedNodeId,
        selectedNodeIds
      },
      '*'
    );
  }, [selectedNodeId, selectedNodeIds]);

  const postImageArrowModeToPreview = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: 'htmlpoint-editor',
        type: 'htmlpoint-set-image-arrow-mode',
        nodeId: imageArrowModeNodeId
      },
      '*'
    );
  }, [imageArrowModeNodeId]);

  useEffect(() => {
    postSelectionToPreview();
  }, [postSelectionToPreview]);

  useEffect(() => {
    postImageArrowModeToPreview();
  }, [postImageArrowModeToPreview]);

  return (
    <main className="canvas-region">
      <div className="canvas-toolbar">
        <div>
          <span className="section-kicker">{section?.kind === 'header' ? 'Header' : 'Section'}</span>
          <strong>{section?.title || 'No document loaded'}</strong>
        </div>
        <div className="canvas-mode">
          <MousePointer2 size={15} />
          Layout-safe edit
        </div>
      </div>
      <div ref={stageRef} className="canvas-stage">
        {report && section ? (
          <div
            className="document-frame-scale"
            style={
              {
                '--zoom-scale': zoomScale,
                '--frame-width': `${PAGE_WIDTH * zoomScale}px`,
                '--frame-height': `${720 * zoomScale}px`,
                '--frame-min-height': `${600 * zoomScale}px`
              } as CSSProperties
            }
          >
            <div className="document-frame">
              <iframe
                ref={iframeRef}
                title="Report preview"
                sandbox="allow-scripts"
                srcDoc={previewHtml}
                onLoad={() => {
                  postSelectionToPreview();
                  postImageArrowModeToPreview();
                  if (previewHtml) onPreviewReady?.();
                }}
              />
            </div>
          </div>
        ) : (
          <div className="empty-canvas">
            <Layers size={38} />
            <span>Open HTML 파일을 선택하세요.</span>
          </div>
        )}
      </div>
      <ElementStrip
        nodes={section?.editableNodes ?? []}
        selectedNodeId={selectedNodeId}
        selectedNodeIds={selectedNodeIds}
        onSelectNode={onSelectNode}
      />
    </main>
  );
}

function ElementStrip({
  nodes,
  selectedNodeId,
  selectedNodeIds,
  onSelectNode
}: {
  nodes: EditableNode[];
  selectedNodeId?: string;
  selectedNodeIds: string[];
  onSelectNode: (nodeId: string, additive?: boolean) => void;
}): JSX.Element {
  const selectedSet = new Set(selectedNodeIds.length ? selectedNodeIds : selectedNodeId ? [selectedNodeId] : []);
  const activeChipRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const activeChip = activeChipRef.current;
    if (typeof activeChip?.scrollIntoView === 'function') {
      activeChip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [selectedNodeId]);

  return (
    <div className="element-strip">
      <div className="element-strip-title">Objects</div>
      <div className="element-list">
        {nodes.map((node) => (
          <button
            type="button"
            key={node.id}
            ref={node.id === selectedNodeId ? activeChipRef : undefined}
            className={selectedSet.has(node.id) ? 'object-chip active' : 'object-chip'}
            onClick={(event) => onSelectNode(node.id, event.ctrlKey || event.metaKey)}
          >
            <span>{node.kind}</span>
            {node.label}
          </button>
        ))}
      </div>
    </div>
  );
}
