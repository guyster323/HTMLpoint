import { EditableNode, ReportDocument } from '../types/htmlpoint';
import { getElementByPath, getElementPath } from './domPaths';
import { serializeFullDocument, stripEditorArtifacts } from './editorArtifacts';
import { parseHtml } from './htmlParser';
import { serializeReportHtml } from './htmlSerializer';
import { getVisibleSections } from './sectionNavigation';

export interface PreviewNodePayload {
  id: string;
  kind: EditableNode['kind'];
  label: string;
  path: number[];
  layoutPath: number[];
}
export interface PreviewSectionPayload {
  id: string;
  nodes: PreviewNodePayload[];
}
export function collectExternalReportUrls(html: string): Set<string> {
  return new Set(collectExternalReportLinks(html).map(([, url]) => url));
}

function collectExternalReportLinks(html: string): Array<[string, string]> {
  const document = parseHtml(html);
  const links = new Map<string, string>();
  const documentBaseUrl = normalizeExternalPreviewUrl(
    document.querySelector<HTMLBaseElement>('base[href]')?.getAttribute('href') ?? ''
  );
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const rawHref = (anchor.getAttribute('href') ?? '').trim();
    let normalized = normalizeExternalPreviewUrl(rawHref);
    if (!normalized && documentBaseUrl && rawHref && !rawHref.startsWith('#')) {
      try {
        normalized = normalizeExternalPreviewUrl(new URL(rawHref, documentBaseUrl).href);
      } catch {
        normalized = undefined;
      }
    }
    if (normalized) {
      links.set(rawHref, normalized);
    }
  });
  return Array.from(links);
}

export function normalizeExternalPreviewUrl(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate || candidate.length > 2081 || /[\u0000-\u001f\u007f-\u009f]/.test(candidate)) {
    return undefined;
  }
  const parseable = candidate.startsWith('//') ? `https:${candidate}` : candidate;
  if (!/^https?:/i.test(parseable)) {
    return undefined;
  }
  try {
    const url = new URL(parseable);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

export function sourcePathToBaseUrl(sourcePath?: string): string | undefined {
  const source = sourcePath?.trim();
  if (!source) {
    return undefined;
  }

  if (/^file:/i.test(source)) {
    try {
      return new URL('.', source).href;
    } catch {
      return undefined;
    }
  }

  const normalized = source.replace(/\\/g, '/');
  const lastSeparator = normalized.lastIndexOf('/');
  if (lastSeparator < 0) {
    return undefined;
  }
  const directory = normalized.slice(0, lastSeparator + 1);
  const encodedDirectory = directory
    .split('/')
    .map((segment, index) =>
      index === 0 && /^[a-z]:$/i.test(segment) ? segment : encodeURIComponent(segment)
    )
    .join('/');
  if (/^[a-z]:\//i.test(directory)) {
    return `file:///${encodedDirectory}`;
  }
  if (directory.startsWith('//')) {
    return `file:${encodedDirectory}`;
  }
  if (directory.startsWith('/')) {
    return `file://${encodedDirectory}`;
  }
  return undefined;
}
const PREVIEW_SELECTION_CSS = `
  .htmlpoint-preview-node {
    cursor: pointer !important;
  }
  .htmlpoint-preview-node:hover {
    outline: 2px dashed rgba(15, 108, 189, .8) !important;
    outline-offset: 3px !important;
  }
  .htmlpoint-selected-node {
    outline: 3px solid #0f6cbd !important;
    outline-offset: 4px !important;
    box-shadow: 0 0 0 7px rgba(15, 108, 189, .16) !important;
  }
  .htmlpoint-selected-node-multi {
    outline: 2px solid #6b9fe5 !important;
    outline-offset: 3px !important;
    box-shadow: 0 0 0 5px rgba(15, 108, 189, .10) !important;
  }
  .htmlpoint-selected-node-child {
    outline: 1px dashed rgba(15, 108, 189, .45) !important;
    outline-offset: 1px !important;
  }
  .htmlpoint-selection-overlay {
    position: fixed !important;
    z-index: 2147483646 !important;
    pointer-events: none !important;
    box-sizing: border-box !important;
    border: 2px solid #0f6cbd !important;
    outline: 1px solid rgba(255,255,255,.85) !important;
  }
  .htmlpoint-selection-overlay-multi {
    border-style: dashed !important;
    border-color: #6b9fe5 !important;
  }
  .htmlpoint-selection-group-overlay {
    border: 2px dashed #0f6cbd !important;
    background: rgba(15, 108, 189, .035) !important;
  }
  .htmlpoint-select-handle {
    position: absolute !important;
    z-index: 2147483647 !important;
    width: 9px !important;
    height: 9px !important;
    border: 1px solid #ffffff !important;
    border-radius: 999px !important;
    background: #0f6cbd !important;
    box-shadow: 0 1px 2px rgba(0,0,0,.25) !important;
    pointer-events: auto !important;
    transform: scale(var(--htmlpoint-handle-scale, 1)) !important;
    transform-origin: center !important;
  }
  .htmlpoint-select-handle::after {
    content: '' !important;
    position: absolute !important;
    inset: -8px !important;
  }
  .htmlpoint-select-handle-nw,
  .htmlpoint-select-handle-se { cursor: nwse-resize !important; }
  .htmlpoint-select-handle-ne,
  .htmlpoint-select-handle-sw { cursor: nesw-resize !important; }
  .htmlpoint-select-handle-n,
  .htmlpoint-select-handle-s { cursor: ns-resize !important; }
  .htmlpoint-select-handle-e,
  .htmlpoint-select-handle-w { cursor: ew-resize !important; }
  .htmlpoint-select-handle-nw { left: -8px !important; top: -8px !important; }
  .htmlpoint-select-handle-ne { right: -8px !important; top: -8px !important; }
  .htmlpoint-select-handle-sw { left: -8px !important; bottom: -8px !important; }
  .htmlpoint-select-handle-se { right: -8px !important; bottom: -8px !important; }
  .htmlpoint-select-handle-n { left: calc(50% - 5px) !important; top: -8px !important; }
  .htmlpoint-select-handle-s { left: calc(50% - 5px) !important; bottom: -8px !important; }
  .htmlpoint-select-handle-e { right: -8px !important; top: calc(50% - 5px) !important; }
  .htmlpoint-select-handle-w { left: -8px !important; top: calc(50% - 5px) !important; }
  .htmlpoint-layout-guide {
    position: fixed !important;
    z-index: 2147483647 !important;
    pointer-events: none !important;
    background: #d83b01 !important;
    box-shadow: 0 0 0 1px rgba(255,255,255,.7) !important;
  }
  .htmlpoint-layout-guide-x { width: 1px !important; }
  .htmlpoint-layout-guide-y { height: 1px !important; }
  .htmlpoint-layout-badge {
    position: fixed !important;
    z-index: 2147483647 !important;
    pointer-events: none !important;
    padding: 3px 7px !important;
    border-radius: 4px !important;
    background: #242424 !important;
    color: #fff !important;
    font: 11px/1.25 Segoe UI, Arial, sans-serif !important;
    box-shadow: 0 2px 6px rgba(0,0,0,.25) !important;
  }
  .htmlpoint-layout-dragging,
  .htmlpoint-layout-dragging * {
    cursor: move !important;
    user-select: none !important;
  }
  .htmlpoint-layout-resizing,
  .htmlpoint-layout-resizing * {
    user-select: none !important;
  }
  .htmlpoint-select-handle-disabled {
    cursor: not-allowed !important;
    background: #7a7a7a !important;
  }
  .htmlpoint-marquee {
    position: fixed !important;
    z-index: 2147483645 !important;
    border: 1px solid #0f6cbd !important;
    background: rgba(15, 108, 189, .12) !important;
    pointer-events: none !important;
  }
  .htmlpoint-inline-editing {
    outline: 2px solid #107c10 !important;
    outline-offset: 3px !important;
    background: rgba(223, 246, 221, .72) !important;
    cursor: text !important;
  }
  .htmlpoint-image-arrow-ready {
    cursor: crosshair !important;
  }
  .htmlpoint-image-mosaic-ready { cursor: crosshair !important; }
  .htmlpoint-runtime-table {
    cursor: copy !important;
  }
  .htmlpoint-runtime-table:hover {
    outline: 3px dashed #7c3aed !important;
    outline-offset: 4px !important;
  }
`;
export function buildPreviewSelectionPayload(
  report: ReportDocument,
  selectedSectionId: string
): PreviewNodePayload[] {
  const section = report.sections.find((candidate) => candidate.id === selectedSectionId);
  return (section?.editableNodes ?? []).map((node) => ({
    id: node.id,
    kind: node.kind,
    label: node.label,
    path: node.path,
    layoutPath: node.layoutTargetPath ?? node.path
  }));
}
export function buildPreviewSectionPayloads(
  report: ReportDocument,
  language: string = report.activeLanguage
): PreviewSectionPayload[] {
  return getVisibleSections(report, language).map((section) => ({
    id: section.id,
    nodes: buildPreviewSelectionPayload(report, section.id)
  }));
}
export function buildPreviewHtml(
  report: ReportDocument,
  selectedSectionId: string,
  language: string,
  selectedNodeId?: string,
  selectedNodeIds: string[] = selectedNodeId ? [selectedNodeId] : [],
  sourceBaseUrl?: string,
  focusPath?: number[],
  previewRevision: string = `${report.id}:${report.updatedAt}:${selectedSectionId}:${language}`
): string {
  const nodes = buildPreviewSelectionPayload(report, selectedSectionId);
  const sectionPayloads = buildPreviewSectionPayloads(report, language);
  const externalReportLinks = collectExternalReportLinks(report.sourceHtml);
  const base = serializeReportHtml(report, { annotateSectionIds: true }).html;
  const initialSelectedNodeIds = Array.from(
    new Set([...(selectedNodeIds.length ? selectedNodeIds : []), selectedNodeId].filter(Boolean))
  );
  const script = `<script>
(() => {
  const previewRevision = ${jsonForInlineScript(previewRevision)};
  const selectedSectionId = ${jsonForInlineScript(selectedSectionId)};
  const language = ${jsonForInlineScript(language)};
  const focusPath = ${jsonForInlineScript(focusPath ?? [])};
  const htmlpointNodes = ${jsonForInlineScript(nodes)};
  const htmlpointSections = ${jsonForInlineScript(sectionPayloads)};
  const htmlpointExternalLinks = ${jsonForInlineScript(externalReportLinks)};
  let selectedNodeId = ${jsonForInlineScript(selectedNodeId ?? '')};
  let selectedNodeIds = new Set(${jsonForInlineScript(initialSelectedNodeIds)});
  let imageArrowModeNodeId = '';
  let imageMosaicModeNodeId = '';
  let marquee = null;
  let activeLayoutGesture = null;
  let keyboardLayoutGesture = null;
  let suppressClickUntil = 0;
  let lastLayoutCommandId = 0;
  const MAX_LAYOUT_OBJECTS = 256;
  const MAX_LAYOUT_OFFSET = 50000;
  const MIN_LAYOUT_SIZE = 16;
  const MAX_LAYOUT_SIZE = 20000;
  const htmlpointNodeById = new Map(htmlpointNodes.map((node) => [node.id, node]));
  const nodeElementCache = new Map();
  const layoutElementCache = new Map();
  const representativeNodeCache = new WeakMap();
  function postToEditor(payload) {
    window.parent.postMessage({
      source: 'htmlpoint-preview',
      previewRevision,
      ...payload
    }, '*');
  }
  function elementByPath(root, path) {
    return path.reduce((current, index) => current && current.children ? current.children[index] : null, root);
  }
  function getImageFrameElement(element) {
    const parent = element && element.parentElement;
    if (!parent || !parent.tagName || ['section', 'header'].includes(parent.tagName.toLowerCase())) return null;
    if (
      parent.dataset &&
      (parent.dataset.htmlpointImageAnnotationHost === 'true' || parent.dataset.htmlpointFrame === 'image')
    ) return parent;
    if (parent.matches('.action-photo-frame, .image-frame, .photo-frame, figure, picture')) return parent;
    if (parent.children && parent.children.length > 3) return null;
    const identity = (parent.id || '') + ' ' + (parent.className || '');
    return /(?:^|[-_\\s])(image|photo|frame|card)(?:$|[-_\\s])/i.test(identity) ? parent : null;
  }
  function shouldFillImageFrame(frame, image) {
    return String(frame.tagName || '').toLowerCase() === 'picture' ||
      (frame.dataset && frame.dataset.htmlpointImageAnnotationHost === 'true') ||
      (frame.classList && frame.classList.contains('action-photo-frame')) ||
      (frame.dataset && frame.dataset.htmlpointFrame === 'image') ||
      image.style.objectFit === 'cover' ||
      image.style.width === '100%' ||
      image.style.height === '100%';
  }
  function visualTargetFor(node, element, sectionId = selectedSectionId) {
    return (node && elementForLayoutNode(sectionId, node)) ||
      (node && node.kind === 'image' ? getImageFrameElement(element) : null) ||
      element;
  }
  function normalizeColor(value) {
    if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return undefined;
    const hex = String(value).trim().match(/^#[0-9a-f]{6}$/i);
    if (hex) return hex[0].toLowerCase();
    const shortHex = String(value).trim().match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
    if (shortHex) return ('#' + shortHex[1] + shortHex[1] + shortHex[2] + shortHex[2] + shortHex[3] + shortHex[3]).toLowerCase();
    const rgb = String(value).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/i);
    if (!rgb) return undefined;
    return '#' + [rgb[1], rgb[2], rgb[3]].map((channel) => Number(channel).toString(16).padStart(2, '0')).join('');
  }
  function inferEffectPreset(element, computed, fill, textColor) {
    const classes = Array.from(element.classList || []).map((className) => className.toLowerCase());
    const has = (className) => classes.includes(className);
    if ((has('pill') && has('warn')) || has('warning') || has('warn')) return 'warning';
    if ((has('pill') && has('bad')) || has('raw-bad') || has('bsc-bad') || has('danger') || has('risk')) return 'danger';
    if ((has('pill') && has('good')) || has('success') || has('good') || has('ok')) return 'success';
    const color = ((fill || '') + ' ' + (textColor || '')).toLowerCase();
    if (color.includes('fff3') || color.includes('fff4') || color.includes('805600') || color.includes('7a5200')) return 'warning';
    if (color.includes('ffe4') || color.includes('fde7') || color.includes('8f1d16') || color.includes('9f1b1f')) return 'danger';
    if (color.includes('ddf6') || color.includes('e7f6') || color.includes('17633f') || color.includes('276221')) return 'success';
    if (color.includes('e8f2') || color.includes('0f4f86')) return 'info';
    if (element.dataset && element.dataset.htmlpointEffect) return element.dataset.htmlpointEffect;
    return (computed.display.includes('inline') || has('pill') || has('badge')) ? 'neutral' : 'none';
  }
  function snapshotTextStyle(element) {
    const computed = window.getComputedStyle(element);
    return {
      fontFamily: computed.fontFamily || undefined,
      fontSize: computed.fontSize || undefined,
      bold: Number(computed.fontWeight) >= 600 || computed.fontWeight === 'bold',
      italic: computed.fontStyle === 'italic',
      underline: (computed.textDecorationLine || '').includes('underline') || (computed.textDecoration || '').includes('underline'),
      color: normalizeColor(computed.color)
    };
  }
  function snapshotTextEffect(element) {
    const computed = window.getComputedStyle(element);
    const fill = normalizeColor(computed.backgroundColor);
    const textColor = normalizeColor(computed.color) || '#1f2328';
    const borderColor = normalizeColor(computed.borderColor) || '#d7dbe2';
    const radiusMatch = computed.borderRadius.match(/\\d+(?:\\.\\d+)?/);
    const classes = Array.from(element.classList || []).map((className) => className.toLowerCase());
    const looksLikeBadge = Boolean(
      element.dataset.htmlpointEffect ||
      classes.some((className) => ['pill', 'badge', 'warn', 'warning', 'bad', 'good', 'raw-bad', 'bsc-bad', 'ok'].includes(className)) ||
      (fill && fill !== '#ffffff') ||
      Number.parseFloat(computed.borderRadius) > 0 ||
      Number.parseFloat(computed.paddingLeft) > 0
    );
    if (!looksLikeBadge) return undefined;
    const preset = inferEffectPreset(element, computed, fill, textColor);
    if (preset === 'none') return undefined;
    return {
      preset,
      fill: fill || '#f3f4f6',
      textColor,
      borderColor,
      radius: radiusMatch ? Number(radiusMatch[0]) : 0,
      bold: Number(computed.fontWeight) >= 600 || computed.fontWeight === 'bold'
    };
  }
  function snapshotImageMetrics(element) {
    const rect = element.getBoundingClientRect();
    return {
      width: String(Math.round(rect.width)),
      height: String(Math.round(rect.height)),
      style: element.getAttribute('style') || undefined
    };
  }
  function snapshotFrameMetrics(element) {
    if (!(element instanceof HTMLElement)) return undefined;
    const rect = element.getBoundingClientRect();
    return {
      width: String(Math.round(rect.width)),
      height: String(Math.round(rect.height)),
      style: element.getAttribute('style') || undefined
    };
  }
  function selectionSnapshot(node, target) {
    const visualTarget = visualTargetFor(node, target);
    const snapshot = { nodeId: node.id };
    if (node.kind === 'text' || node.kind === 'list') {
      snapshot.textStyle = snapshotTextStyle(target);
      snapshot.textEffect = snapshotTextEffect(target);
    }
    if (node.kind === 'image') {
      snapshot.imageMetrics = snapshotImageMetrics(target);
      if (visualTarget !== target) {
        snapshot.frameMetrics = snapshotFrameMetrics(visualTarget);
      }
    }
    if (visualTarget instanceof HTMLElement || visualTarget instanceof SVGElement) {
      snapshot.layoutMetrics = layoutMetrics({
        nodeId: node.id,
        node,
        element: target,
        target: visualTarget
      });
    }
    return snapshot;
  }
  function postSelectionMessage(type, nodeId, extra) {
    const { node, target } = nodeElement(nodeId);
    const snapshot = node && (target instanceof HTMLElement || target instanceof SVGElement)
      ? selectionSnapshot(node, target)
      : undefined;
    postToEditor({
      type,
      nodeId,
      selectedNodeIds: Array.from(selectedNodeIds),
      snapshot,
      ...extra
    });
  }
  function beginInlineTextEdit(element, node, event) {
    if (!(element instanceof HTMLElement)) return;
    if (!node || !['text', 'list'].includes(node.kind)) return;
    if (element.dataset.htmlpointInlineEditing === 'true') return;

    event.preventDefault();
    event.stopPropagation();
    selectNode(node.id, true, event.ctrlKey || event.metaKey || event.shiftKey);
    // Edit clones so Escape can restore both markup and the original child listeners.
    const originalChildren = Array.from(element.childNodes);
    element.replaceChildren(...originalChildren.map((child) => child.cloneNode(true)));
    element.dataset.htmlpointInlineEditing = 'true';
    element.classList.add('htmlpoint-inline-editing');
    element.contentEditable = 'plaintext-only';
    element.focus();

    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    let closed = false;
    const cleanup = () => {
      element.classList.remove('htmlpoint-inline-editing');
      element.removeAttribute('data-htmlpoint-inline-editing');
      element.removeAttribute('contenteditable');
      element.removeEventListener('blur', commit);
      element.removeEventListener('keydown', handleKeyDown);
    };
    const commit = () => {
      if (closed) return;
      closed = true;
      const text = element.textContent || '';
      cleanup();
      element.replaceChildren(...originalChildren);
      postToEditor({
        type: 'htmlpoint-edit-text',
        nodeId: node.id,
        text
      });
    };
    const cancel = () => {
      if (closed) return;
      closed = true;
      element.replaceChildren(...originalChildren);
      cleanup();
      paintSelections();
    };
    const handleKeyDown = (keyEvent) => {
      if (keyEvent.isComposing) return;
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        cancel();
        return;
      }
      if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
        keyEvent.preventDefault();
        commit();
      }
    };
    element.addEventListener('blur', commit);
    element.addEventListener('keydown', handleKeyDown);
  }
  function clearSelection() {
    document.querySelectorAll('.htmlpoint-selected-node, .htmlpoint-selected-node-multi, .htmlpoint-selected-node-child').forEach((element) => {
      element.classList.remove('htmlpoint-selected-node');
      element.classList.remove('htmlpoint-selected-node-multi');
      element.classList.remove('htmlpoint-selected-node-child');
    });
    document.querySelectorAll('.htmlpoint-selection-overlay').forEach((overlay) => overlay.remove());
  }
  function setOverlayRect(overlay, rect) {
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  }
  function createSelectionOverlay(rect, className) {
    const overlay = document.createElement('div');
    overlay.className = 'htmlpoint-selection-overlay ' + (className || '');
    setOverlayRect(overlay, rect);
    overlay.setAttribute('aria-hidden', 'true');
    document.documentElement.appendChild(overlay);
    return overlay;
  }
  function addHandles(entry) {
    const state = layoutState(entry);
    const overlay = createSelectionOverlay(state.rect, '');
    overlay.dataset.htmlpointLayoutNodeId = entry.nodeId;
    const candidateHandles = state.lockHeight
      ? ['e', 'w']
      : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const handles = state.lockPosition
      ? candidateHandles.filter((direction) => !direction.includes('n') && !direction.includes('w'))
      : candidateHandles;
    handles.forEach((direction) => {
      const handle = document.createElement('span');
      handle.className = 'htmlpoint-select-handle htmlpoint-select-handle-' + direction;
      if (state.lockSize) handle.classList.add('htmlpoint-select-handle-disabled');
      handle.setAttribute('aria-hidden', 'true');
      handle.dataset.htmlpointResizeHandle = direction;
      handle.addEventListener('pointerdown', (event) => beginResizeGesture(event, entry, direction));
      overlay.appendChild(handle);
    });
  }
  function sectionElement(sectionId) {
    return Array.from(document.querySelectorAll('[data-htmlpoint-preview-section]'))
      .find((element) => element.getAttribute('data-htmlpoint-preview-section') === sectionId);
  }
  function selectedSlideElement() {
    return sectionElement(selectedSectionId);
  }

  function representativePriority(node, target, sectionId) {
    if (node.kind === 'table') return 0;
    if (node.kind === 'image') return 1;
    if (node.kind === 'chart') return 2;
    if (elementForNode(sectionId, node) === target) return 3;
    if (node.kind === 'list') return 4;
    return 5;
  }

  function primePreviewObjectCaches() {
    document.querySelectorAll('[data-htmlpoint-node-id][data-htmlpoint-section-id]')
      .forEach((element) => {
        const sectionId = element.getAttribute('data-htmlpoint-section-id') || '';
        const nodeId = element.getAttribute('data-htmlpoint-node-id') || '';
        if (sectionId && nodeId) nodeElementCache.set(sectionId + ':' + nodeId, element);
      });
    document.querySelectorAll('[data-htmlpoint-preview-layout-key]')
      .forEach((element) => {
        const slide = element.closest('[data-htmlpoint-preview-section]');
        const sectionId = slide?.getAttribute('data-htmlpoint-preview-section') || '';
        const layoutKey = element.getAttribute('data-htmlpoint-preview-layout-key') || '';
        if (sectionId) layoutElementCache.set(sectionId + ':' + layoutKey, element);
      });
    htmlpointSections.forEach((section) => {
      section.nodes.forEach((node) => {
        const target = elementForLayoutNode(section.id, node);
        if (!(target instanceof Element)) return;
        const current = representativeNodeCache.get(target);
        if (
          !current ||
          representativePriority(node, target, section.id) <
            representativePriority(current, target, section.id)
        ) {
          representativeNodeCache.set(target, node);
        }
      });
    });
  }

  function elementForNode(sectionId, node) {
    const slide = sectionElement(sectionId);
    if (!(slide instanceof HTMLElement)) return null;
    const cacheKey = sectionId + ':' + node.id;
    const cached = nodeElementCache.get(cacheKey);
    if (cached instanceof Element && cached.isConnected) return cached;
    const marked = Array.from(
      slide.querySelectorAll('[data-htmlpoint-node-id][data-htmlpoint-section-id]')
    ).find((element) =>
      element.getAttribute('data-htmlpoint-node-id') === node.id &&
      element.getAttribute('data-htmlpoint-section-id') === sectionId
    );
    const resolved = marked || elementByPath(slide, node.path);
    if (resolved instanceof Element) nodeElementCache.set(cacheKey, resolved);
    return resolved;
  }

  function elementForLayoutNode(sectionId, node) {
    const slide = sectionElement(sectionId);
    if (!(slide instanceof HTMLElement) || !node) return null;
    const path = Array.isArray(node.layoutPath) ? node.layoutPath : node.path;
    const layoutKey = path.join('.');
    const cacheKey = sectionId + ':' + layoutKey;
    const cached = layoutElementCache.get(cacheKey);
    if (cached instanceof Element && cached.isConnected) return cached;
    const marked = Array.from(slide.querySelectorAll('[data-htmlpoint-preview-layout-key]'))
      .find((element) => element.getAttribute('data-htmlpoint-preview-layout-key') === layoutKey);
    const resolved = marked || elementByPath(slide, path);
    if (resolved instanceof Element) layoutElementCache.set(cacheKey, resolved);
    return resolved;
  }

  function layoutEntries(nodeIds, suppressDescendants = true) {
    const requested = Array.from(new Set(nodeIds)).filter(Boolean);
    const ordered = selectedNodeId && requested.includes(selectedNodeId)
      ? [selectedNodeId].concat(requested.filter((id) => id !== selectedNodeId))
      : requested;
    const byTarget = new Map();
    ordered.forEach((nodeId) => {
      const node = htmlpointNodeById.get(nodeId);
      const element = node ? elementForNode(selectedSectionId, node) : null;
      const target = node ? visualTargetFor(node, element) : null;
      if (!node || !(target instanceof HTMLElement || target instanceof SVGElement)) return;
      if (!byTarget.has(target)) {
        byTarget.set(target, { nodeId, node, element, target });
      }
    });
    const unique = Array.from(byTarget.values());
    return suppressDescendants ? unique.filter((entry) =>
      !unique.some((other) =>
        other !== entry && other.target !== entry.target && other.target.contains(entry.target)
      )
    ) : unique;
  }

  function representativeNodeIdForTarget(target, sectionId = selectedSectionId) {
    const cached = representativeNodeCache.get(target);
    if (cached) return cached.id;
    const sectionNodes = sectionId === selectedSectionId
      ? htmlpointNodes
      : htmlpointSections.find((section) => section.id === sectionId)?.nodes || [];
    const mapped = sectionNodes.filter(
      (node) => elementForLayoutNode(sectionId, node) === target
    );
    const representative =
      mapped.find((node) => node.kind === 'table') ||
      mapped.find((node) => node.kind === 'image') ||
      mapped.find((node) => node.kind === 'chart') ||
      mapped.find((node) => elementForNode(sectionId, node) === target) ||
      mapped[0];
    if (representative) representativeNodeCache.set(target, representative);
    return representative ? representative.id : '';
  }

  function layoutSelectionNodeId(node, sectionId = selectedSectionId) {
    const element = elementForNode(sectionId, node);
    const target = visualTargetFor(node, element, sectionId);
    return target instanceof Element
      ? representativeNodeIdForTarget(target, sectionId) || node.id
      : node.id;
  }

  function readDataNumber(target, name) {
    if (!target.hasAttribute(name)) return undefined;
    const value = Number(target.getAttribute(name));
    return Number.isFinite(value) ? value : undefined;
  }

  function parseTranslate(value) {
    if (!value || value === 'none') return { x: 0, y: 0, supported: true };
    const parts = String(value).trim().split(/\\s+/);
    if (parts.length > 2 || parts.some((part) => !/^-?(?:\\d+|\\d*\\.\\d+)px$/.test(part) && part !== '0')) {
      return { x: 0, y: 0, supported: false };
    }
    const x = Number.parseFloat(parts[0]);
    const y = Number.parseFloat(parts[1] || '0');
    return {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      supported: Number.isFinite(x) && Number.isFinite(y)
    };
  }

  function isContentHeightTarget(target) {
    return target instanceof HTMLTableElement || Boolean(
      target instanceof HTMLElement &&
      target.matches('[data-htmlpoint-runtime-table-snapshot], [data-htmlpoint-table-frame], .table-scroll, .table-wrap, .table-wrapper, .table-responsive') &&
      target.querySelector(':scope > table')
    );
  }

  function isRenderedLayoutTarget(target) {
    if (!(target instanceof Element) || !target.isConnected || !target.getClientRects().length) {
      return false;
    }
    const rect = target.getBoundingClientRect();
    return rect.width > 0.5 && rect.height > 0.5;
  }

  function cssPixelSize(target, computed, dimension, fallback) {
    const computedValue = Number.parseFloat(computed[dimension]);
    if (Number.isFinite(computedValue) && computedValue > 0) return computedValue;
    const borderBoxSize = target instanceof HTMLElement
      ? (dimension === 'width' ? target.offsetWidth : target.offsetHeight)
      : fallback;
    if (!Number.isFinite(borderBoxSize) || borderBoxSize <= 0 || computed.boxSizing === 'border-box') {
      return fallback;
    }
    const sides = dimension === 'width'
      ? ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
      : ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'];
    const extras = sides.reduce((sum, property) => {
      const value = Number.parseFloat(computed[property]);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    return Math.max(1, borderBoxSize - extras);
  }

  function hasUnsupportedSizeTransform(target) {
    let current = target;
    while (current instanceof Element) {
      const computed = window.getComputedStyle(current);
      const transform = computed.transform;
      const rotate = computed.rotate;
      const scale = computed.scale;
      if (transform && transform !== 'none') return true;
      if (rotate && !['none', '0', '0deg'].includes(rotate)) return true;
      if (scale && !['none', '1', '1 1'].includes(scale)) return true;
      current = current.parentElement;
    }
    return false;
  }

  function openAncestorDetails(target) {
    let details = target instanceof Element ? target.closest('details') : null;
    while (details instanceof HTMLDetailsElement) {
      details.open = true;
      details = details.parentElement?.closest('details') || null;
    }
  }

  function layoutState(entry) {
    const target = entry.target;
    const computed = window.getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    const offsetX = readDataNumber(target, 'data-htmlpoint-layout-x') || 0;
    const offsetY = readDataNumber(target, 'data-htmlpoint-layout-y') || 0;
    const computedTranslate = parseTranslate(computed.translate);
    const baseTranslateX = readDataNumber(target, 'data-htmlpoint-layout-base-x');
    const baseTranslateY = readDataNumber(target, 'data-htmlpoint-layout-base-y');
    const position = computed.position;
    const cssWidth = cssPixelSize(target, computed, 'width', rect.width);
    const cssHeight = cssPixelSize(target, computed, 'height', rect.height);
    const lockHeight = isContentHeightTarget(target);
    return {
      ...entry,
      rect,
      originalStyle: target.getAttribute('style'),
      offsetX,
      offsetY,
      baseTranslateX: baseTranslateX === undefined ? computedTranslate.x - offsetX : baseTranslateX,
      baseTranslateY: baseTranslateY === undefined ? computedTranslate.y - offsetY : baseTranslateY,
      cssWidth,
      cssHeight,
      lockHeight,
      lockSize:
        hasUnsupportedSizeTransform(target) ||
        !computedTranslate.supported ||
        cssWidth < MIN_LAYOUT_SIZE ||
        cssWidth > MAX_LAYOUT_SIZE ||
        (!lockHeight && cssHeight > MAX_LAYOUT_SIZE),
      lockPosition:
        position === 'fixed' ||
        position === 'sticky' ||
        !computedTranslate.supported
    };
  }

  function layoutMetrics(entry) {
    const state = layoutState(entry);
    const slide = selectedSlideElement();
    const slideRect = slide instanceof HTMLElement ? slide.getBoundingClientRect() : { left: 0, top: 0 };
    return {
      x: Math.round((state.rect.left - slideRect.left) * 1000) / 1000,
      y: Math.round((state.rect.top - slideRect.top) * 1000) / 1000,
      width: Math.round(state.cssWidth * 1000) / 1000,
      height: Math.round(state.cssHeight * 1000) / 1000,
      offsetX: state.offsetX,
      offsetY: state.offsetY,
      baseTranslateX: state.baseTranslateX,
      baseTranslateY: state.baseTranslateY,
      lockHeight: state.lockHeight,
      lockSize: state.lockSize,
      lockPosition: state.lockPosition
    };
  }

  function roundLayout(value) {
    return Math.round(value * 1000) / 1000;
  }

  function layoutPatchFor(state, offsetX, offsetY, width, height) {
    const patch = {
      nodeId: state.nodeId,
      offsetX: roundLayout(offsetX),
      offsetY: roundLayout(offsetY),
      baseTranslateX: roundLayout(state.baseTranslateX),
      baseTranslateY: roundLayout(state.baseTranslateY)
    };
    if (Number.isFinite(width)) patch.width = roundLayout(width);
    if (Number.isFinite(height) && !state.lockHeight) patch.height = roundLayout(height);
    return patch;
  }

  function resizePatchFor(state, latest, direction) {
    const patch = { nodeId: state.nodeId };
    if (direction.includes('e') || direction.includes('w')) {
      patch.width = roundLayout(latest.width);
    }
    if (!state.lockHeight && (direction.includes('n') || direction.includes('s'))) {
      patch.height = roundLayout(latest.height);
    }
    if (direction.includes('w')) {
      patch.offsetX = roundLayout(latest.offsetX);
    }
    if (!state.lockHeight && direction.includes('n')) {
      patch.offsetY = roundLayout(latest.offsetY);
    }
    if (direction.includes('w') || (!state.lockHeight && direction.includes('n'))) {
      patch.baseTranslateX = roundLayout(state.baseTranslateX);
      patch.baseTranslateY = roundLayout(state.baseTranslateY);
    }
    return patch;
  }

  function applyLivePosition(state, offsetX, offsetY) {
    if (['a', 'span', 'strong', 'em', 'code', 'picture'].includes(state.target.tagName.toLowerCase())) {
      state.target.style.setProperty('display', 'inline-block', 'important');
    }
    state.target.style.setProperty(
      'translate',
      roundLayout(state.baseTranslateX + offsetX) + 'px ' +
        roundLayout(state.baseTranslateY + offsetY) + 'px',
      'important'
    );
    refreshDiagramConnectors();
  }

  function applyLiveSize(state, width, height) {
    if (Number.isFinite(width)) {
      state.target.style.setProperty('width', roundLayout(width) + 'px', 'important');
      state.target.style.setProperty('max-width', 'none', 'important');
    }
    if (Number.isFinite(height) && !state.lockHeight) {
      state.target.style.setProperty('height', roundLayout(height) + 'px', 'important');
      state.target.style.setProperty('max-height', 'none', 'important');
    }
    if (['a', 'span', 'strong', 'em', 'code', 'picture'].includes(state.target.tagName.toLowerCase())) {
      state.target.style.setProperty('display', 'inline-block', 'important');
    }
    if (
      state.node.kind === 'image' &&
      state.element instanceof HTMLImageElement &&
      state.target !== state.element &&
      state.target instanceof HTMLElement &&
      shouldFillImageFrame(state.target, state.element)
    ) {
      state.element.style.setProperty('width', '100%', 'important');
      if (!state.lockHeight && Number.isFinite(height)) {
        state.element.style.setProperty('height', '100%', 'important');
      }
      state.element.style.setProperty('max-width', 'none', 'important');
      state.element.style.objectFit = state.element.style.objectFit || 'contain';
    }
    refreshDiagramConnectors();
  }

  function refreshDiagramConnectors() {
    const nodes = new Map();
    document.querySelectorAll('[data-htmlpoint-shape][data-htmlpoint-object-id], [data-fig-node][data-node-id]').forEach((node) => {
      const objectId = node.getAttribute('data-htmlpoint-object-id') || node.getAttribute('data-node-id');
      if (objectId) nodes.set(objectId, node);
    });
    document.querySelectorAll('[data-htmlpoint-connector], .htmlpoint-connector').forEach((connector) => {
      if (!(connector instanceof HTMLElement)) return;
      const fromId = connector.getAttribute('data-from') || connector.getAttribute('data-from-id') || connector.getAttribute('data-source');
      const toId = connector.getAttribute('data-to') || connector.getAttribute('data-to-id') || connector.getAttribute('data-target');
      const from = fromId ? nodes.get(fromId) : undefined;
      const to = toId ? nodes.get(toId) : undefined;
      const parent = connector.parentElement;
      if (!(from instanceof Element) || !(to instanceof Element) || !parent) return;
      const parentRect = parent.getBoundingClientRect();
      const fromRect = from.getBoundingClientRect();
      const toRect = to.getBoundingClientRect();
      const startX = fromRect.left + fromRect.width / 2 - parentRect.left;
      const startY = fromRect.top + fromRect.height / 2 - parentRect.top;
      const endX = toRect.left + toRect.width / 2 - parentRect.left;
      const endY = toRect.top + toRect.height / 2 - parentRect.top;
      const length = Math.max(1, Math.hypot(endX - startX, endY - startY));
      const angle = Math.atan2(endY - startY, endX - startX) * 180 / Math.PI;
      connector.style.setProperty('position', 'absolute', 'important');
      connector.style.setProperty('left', roundLayout(startX) + 'px', 'important');
      connector.style.setProperty('top', roundLayout(startY) + 'px', 'important');
      connector.style.setProperty('width', roundLayout(length) + 'px', 'important');
      connector.style.setProperty('height', '0px', 'important');
      connector.style.setProperty('transform', 'rotate(' + roundLayout(angle) + 'deg)', 'important');
      connector.style.setProperty('transform-origin', '0 0', 'important');
    });
  }

  function restoreTransientStates(states) {
    states.forEach((state) => {
      if (state.originalStyle === null) state.target.removeAttribute('style');
      else state.target.setAttribute('style', state.originalStyle);
      if (state.element !== state.target && state.originalElementStyle !== undefined) {
        if (state.originalElementStyle === null) state.element.removeAttribute('style');
        else state.element.setAttribute('style', state.originalElementStyle);
      }
    });
  }

  function clearLayoutFeedback() {
    document.documentElement.classList.remove('htmlpoint-layout-dragging');
    document.documentElement.classList.remove('htmlpoint-layout-resizing');
    document.querySelectorAll('.htmlpoint-layout-guide, .htmlpoint-layout-badge').forEach((element) => element.remove());
  }

  function showLayoutBadge(text, rect) {
    document.querySelectorAll('.htmlpoint-layout-badge').forEach((element) => element.remove());
    const badge = document.createElement('div');
    badge.className = 'htmlpoint-layout-badge';
    badge.textContent = text;
    badge.style.left = Math.max(4, rect.right - 90) + 'px';
    badge.style.top = Math.max(4, rect.top - 30) + 'px';
    document.documentElement.appendChild(badge);
  }

  function showSnapGuides(x, y) {
    document.querySelectorAll('.htmlpoint-layout-guide').forEach((element) => element.remove());
    const slide = selectedSlideElement();
    if (!(slide instanceof HTMLElement)) return;
    const rect = slide.getBoundingClientRect();
    if (Number.isFinite(x)) {
      const guide = document.createElement('div');
      guide.className = 'htmlpoint-layout-guide htmlpoint-layout-guide-x';
      guide.style.left = x + 'px';
      guide.style.top = rect.top + 'px';
      guide.style.height = rect.height + 'px';
      document.documentElement.appendChild(guide);
    }
    if (Number.isFinite(y)) {
      const guide = document.createElement('div');
      guide.className = 'htmlpoint-layout-guide htmlpoint-layout-guide-y';
      guide.style.left = rect.left + 'px';
      guide.style.top = y + 'px';
      guide.style.width = rect.width + 'px';
      document.documentElement.appendChild(guide);
    }
  }

  function startBoundsFor(states) {
    const left = Math.min(...states.map((state) => state.rect.left));
    const top = Math.min(...states.map((state) => state.rect.top));
    const right = Math.max(...states.map((state) => state.rect.right));
    const bottom = Math.max(...states.map((state) => state.rect.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function nearestSnap(anchors, candidates, threshold) {
    let best;
    anchors.forEach((anchor) => {
      candidates.forEach((candidate) => {
        const difference = candidate - anchor;
        if (Math.abs(difference) <= threshold && (!best || Math.abs(difference) < Math.abs(best.difference))) {
          best = { difference, line: candidate };
        }
      });
    });
    return best;
  }

  function collectSnapCandidateRects(states) {
    const selectedTargets = new Set(states.map((state) => state.target));
    const rects = layoutEntries(htmlpointNodes.map((node) => node.id), false)
      .filter((entry) =>
        isRenderedLayoutTarget(entry.target) &&
        !Array.from(selectedTargets).some(
          (target) => target === entry.target || target.contains(entry.target)
        )
      )
      .map((entry) => entry.target.getBoundingClientRect());
    const slide = selectedSlideElement();
    if (slide instanceof HTMLElement) rects.push(slide.getBoundingClientRect());
    return rects;
  }

  function snapMove(states, candidateRects, deltaX, deltaY, disabled) {
    if (disabled) return { deltaX, deltaY };
    const bounds = startBoundsFor(states);
    const xCandidates = candidateRects.flatMap((rect) => [rect.left, rect.left + rect.width / 2, rect.right]);
    const yCandidates = candidateRects.flatMap((rect) => [rect.top, rect.top + rect.height / 2, rect.bottom]);
    const xSnap = nearestSnap(
      [bounds.left + deltaX, bounds.left + bounds.width / 2 + deltaX, bounds.right + deltaX],
      xCandidates,
      5
    );
    const ySnap = nearestSnap(
      [bounds.top + deltaY, bounds.top + bounds.height / 2 + deltaY, bounds.bottom + deltaY],
      yCandidates,
      5
    );
    return {
      deltaX: deltaX + (xSnap ? xSnap.difference : 0),
      deltaY: deltaY + (ySnap ? ySnap.difference : 0),
      guideX: xSnap ? xSnap.line : undefined,
      guideY: ySnap ? ySnap.line : undefined
    };
  }

  function constrainMoveDelta(states, delta) {
    const minimumX = Math.max(...states.map((state) => -MAX_LAYOUT_OFFSET - state.offsetX));
    const maximumX = Math.min(...states.map((state) => MAX_LAYOUT_OFFSET - state.offsetX));
    const minimumY = Math.max(...states.map((state) => -MAX_LAYOUT_OFFSET - state.offsetY));
    const maximumY = Math.min(...states.map((state) => MAX_LAYOUT_OFFSET - state.offsetY));
    const deltaX = Math.max(minimumX, Math.min(maximumX, delta.deltaX));
    const deltaY = Math.max(minimumY, Math.min(maximumY, delta.deltaY));
    return {
      ...delta,
      deltaX,
      deltaY,
      guideX: deltaX === delta.deltaX ? delta.guideX : undefined,
      guideY: deltaY === delta.deltaY ? delta.guideY : undefined
    };
  }

  function refreshSelectionOverlayGeometry() {
    refreshDiagramConnectors();
    const entries = layoutEntries(Array.from(selectedNodeIds));
    const overlays = Array.from(document.querySelectorAll('.htmlpoint-selection-overlay'));
    if (!entries.length || !overlays.length) return;
    const bounds = entries.length === 1
      ? entries[0].target.getBoundingClientRect()
      : combinedRect(entries);
    if (bounds) setOverlayRect(overlays[0], bounds);
  }

  function postLayoutCommit(patches, label, commandId) {
    if (!patches.length) return;
    postToEditor({
      type: 'htmlpoint-commit-layout',
      sectionId: selectedSectionId,
      patches,
      label,
      commandId
    });
  }

  function finishGestureListeners(move, finish, cancel, keydown, blur) {
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', finish, true);
    document.removeEventListener('pointercancel', cancel, true);
    document.removeEventListener('keydown', keydown, true);
    window.removeEventListener('blur', blur);
  }

  function beginMoveGesture(event, node) {
    const gestureTarget = event.target instanceof Element ? event.target : null;
    if (
      !event.isTrusted ||
      event.button !== 0 ||
      activeLayoutGesture ||
      marquee ||
      imageArrowModeNodeId === node.id ||
      imageMosaicModeNodeId === node.id ||
      gestureTarget?.closest(
        '[data-htmlpoint-resize-handle], [contenteditable]:not([contenteditable="false"])'
      )
    ) return;
    if (keyboardLayoutGesture) cancelKeyboardNudge();
    event.stopPropagation();
    const clickedElement = elementForNode(selectedSectionId, node);
    const clickedTarget = visualTargetFor(node, clickedElement);
    const clickedNodeId = layoutSelectionNodeId(node);
    if (!(clickedTarget instanceof HTMLElement || clickedTarget instanceof SVGElement)) return;
    let entries = layoutEntries(Array.from(selectedNodeIds));
    if (!selectedNodeIds.has(clickedNodeId)) {
      entries = layoutEntries([clickedNodeId]);
    }
    const states = entries
      .map(layoutState)
      .map((state) => ({
        ...state,
        originalElementStyle: state.element instanceof Element ? state.element.getAttribute('style') : undefined
      }));
    if (!states.length) return;
    if (states.some((state) => state.lockPosition)) {
      postToEditor({
        type: 'htmlpoint-layout-command-unavailable',
        reason: '고정 또는 sticky 위치 개체는 이동할 수 없습니다.'
      });
      return;
    }
    if (states.length > MAX_LAYOUT_OBJECTS) {
      postToEditor({
        type: 'htmlpoint-layout-command-unavailable',
        reason: '한 번에 이동할 수 있는 개체는 256개까지입니다.'
      });
      return;
    }
    let snapCandidateRects;
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerHost = clickedElement;
    try {
      if (pointerHost instanceof Element) pointerHost.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Document listeners remain as a fallback in restricted preview contexts.
    }
    let started = false;
    let lastDelta = { deltaX: 0, deltaY: 0 };
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      let rawX = moveEvent.clientX - startX;
      let rawY = moveEvent.clientY - startY;
      if (!started && Math.hypot(rawX, rawY) < 4) return;
      if (moveEvent.shiftKey) {
        if (Math.abs(rawX) >= Math.abs(rawY)) rawY = 0;
        else rawX = 0;
      }
      if (!started) {
        started = true;
        snapCandidateRects = collectSnapCandidateRects(states);
        document.documentElement.classList.add('htmlpoint-layout-dragging');
        if (!selectedNodeIds.has(clickedNodeId)) {
          selectedNodeIds = new Set([clickedNodeId]);
          selectedNodeId = clickedNodeId;
          postSelectionMessage('htmlpoint-select-node', clickedNodeId, { ctrlKey: false });
        }
      }
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      lastDelta = constrainMoveDelta(
        states,
        snapMove(states, snapCandidateRects || [], rawX, rawY, moveEvent.altKey)
      );
      states.forEach((state) =>
        applyLivePosition(
          state,
          state.offsetX + lastDelta.deltaX,
          state.offsetY + lastDelta.deltaY
        )
      );
      refreshSelectionOverlayGeometry();
      showSnapGuides(lastDelta.guideX, lastDelta.guideY);
      const rect = startBoundsFor(states);
      showLayoutBadge(
        'X ' + Math.round(lastDelta.deltaX) + '  Y ' + Math.round(lastDelta.deltaY),
        {
          ...rect,
          left: rect.left + lastDelta.deltaX,
          right: rect.right + lastDelta.deltaX,
          top: rect.top + lastDelta.deltaY,
          bottom: rect.bottom + lastDelta.deltaY
        }
      );
    };
    const cleanup = () => {
      finishGestureListeners(move, finish, cancel, keydown, blur);
      if (pointerHost instanceof Element) {
        pointerHost.removeEventListener('lostpointercapture', cancel);
      }
      try {
        if (pointerHost instanceof Element && pointerHost.hasPointerCapture(event.pointerId)) {
          pointerHost.releasePointerCapture(event.pointerId);
        }
      } catch (_error) {
        // Pointer capture may already be released by the browser.
      }
      clearLayoutFeedback();
      activeLayoutGesture = null;
    };
    const finish = (finishEvent) => {
      if (finishEvent instanceof PointerEvent && finishEvent.pointerId !== event.pointerId) return;
      if (started) {
        suppressClickUntil = Date.now() + 500;
        postLayoutCommit(
          states.map((state) =>
            layoutPatchFor(
              state,
              state.offsetX + lastDelta.deltaX,
              state.offsetY + lastDelta.deltaY
            )
          ),
          states.length > 1 ? '개체 그룹 이동' : '개체 이동'
        );
      }
      cleanup();
    };
    const cancel = (cancelEvent) => {
      if (cancelEvent instanceof PointerEvent && cancelEvent.pointerId !== event.pointerId) return;
      restoreTransientStates(states);
      refreshSelectionOverlayGeometry();
      cleanup();
    };
    const keydown = (keyEvent) => {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        cancel();
      }
    };
    const blur = () => cancel();
    activeLayoutGesture = { cancel };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', finish, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('blur', blur, { once: true });
    if (pointerHost instanceof Element) {
      pointerHost.addEventListener('lostpointercapture', cancel, { once: true });
    }
  }

  function beginResizeGesture(event, entry, direction) {
    if (!event.isTrusted || event.button !== 0 || activeLayoutGesture || marquee) return;
    if (keyboardLayoutGesture) cancelKeyboardNudge();
    event.preventDefault();
    event.stopPropagation();
    const state = {
      ...layoutState(entry),
      originalElementStyle: entry.element instanceof Element ? entry.element.getAttribute('style') : undefined
    };
    if (state.lockSize) {
      postToEditor({
        type: 'htmlpoint-layout-command-unavailable',
        reason: '회전 또는 배율 변형이 적용된 개체는 크기 조절할 수 없습니다.'
      });
      return;
    }
    if (state.lockPosition && (direction.includes('n') || direction.includes('w'))) {
      postToEditor({
        type: 'htmlpoint-layout-command-unavailable',
        reason: '고정 위치 개체는 오른쪽 또는 아래쪽에서만 크기 조절할 수 있습니다.'
      });
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerHost = event.currentTarget;
    try {
      if (pointerHost instanceof Element) pointerHost.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Document listeners remain as a fallback in restricted preview contexts.
    }
    const ratio = state.cssWidth / Math.max(1, state.cssHeight);
    let latest = {
      width: state.cssWidth,
      height: state.cssHeight,
      offsetX: state.offsetX,
      offsetY: state.offsetY
    };
    let changed = false;
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      let width = state.cssWidth;
      let height = state.cssHeight;
      if (direction.includes('e')) width = Math.max(MIN_LAYOUT_SIZE, Math.min(MAX_LAYOUT_SIZE, state.cssWidth + deltaX));
      if (direction.includes('w')) width = Math.max(MIN_LAYOUT_SIZE, Math.min(MAX_LAYOUT_SIZE, state.cssWidth - deltaX));
      if (!state.lockHeight && direction.includes('s')) height = Math.max(MIN_LAYOUT_SIZE, Math.min(MAX_LAYOUT_SIZE, state.cssHeight + deltaY));
      if (!state.lockHeight && direction.includes('n')) height = Math.max(MIN_LAYOUT_SIZE, Math.min(MAX_LAYOUT_SIZE, state.cssHeight - deltaY));
      const corner = direction.length === 2;
      const preserveRatio = corner && !state.lockHeight && ((state.node.kind === 'image') !== moveEvent.shiftKey);
      if (preserveRatio) {
        if (Math.abs(deltaX / Math.max(1, state.cssWidth)) >= Math.abs(deltaY / Math.max(1, state.cssHeight))) {
          height = Math.max(MIN_LAYOUT_SIZE, Math.min(MAX_LAYOUT_SIZE, width / ratio));
        } else {
          width = Math.max(MIN_LAYOUT_SIZE, Math.min(MAX_LAYOUT_SIZE, height * ratio));
        }
      }
      let offsetX = state.offsetX + (direction.includes('w') ? state.cssWidth - width : 0);
      let offsetY = state.offsetY + (!state.lockHeight && direction.includes('n') ? state.cssHeight - height : 0);
      offsetX = Math.max(-MAX_LAYOUT_OFFSET, Math.min(MAX_LAYOUT_OFFSET, offsetX));
      offsetY = Math.max(-MAX_LAYOUT_OFFSET, Math.min(MAX_LAYOUT_OFFSET, offsetY));
      latest = { width, height, offsetX, offsetY };
      changed = Math.abs(width - state.cssWidth) >= 0.5 || Math.abs(height - state.cssHeight) >= 0.5;
      if (direction.includes('w') || direction.includes('n')) {
        applyLivePosition(state, offsetX, offsetY);
      }
      applyLiveSize(
        state,
        direction.includes('e') || direction.includes('w') ? width : undefined,
        !state.lockHeight && (direction.includes('n') || direction.includes('s'))
          ? height
          : undefined
      );
      refreshSelectionOverlayGeometry();
      const rect = state.target.getBoundingClientRect();
      showLayoutBadge(Math.round(rect.width) + ' × ' + Math.round(rect.height), rect);
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
    };
    const cleanup = () => {
      finishGestureListeners(move, finish, cancel, keydown, blur);
      if (pointerHost instanceof Element) {
        pointerHost.removeEventListener('lostpointercapture', cancel);
      }
      try {
        if (pointerHost instanceof Element && pointerHost.hasPointerCapture(event.pointerId)) {
          pointerHost.releasePointerCapture(event.pointerId);
        }
      } catch (_error) {
        // Pointer capture may already be released by the browser.
      }
      clearLayoutFeedback();
      activeLayoutGesture = null;
    };
    const finish = (finishEvent) => {
      if (finishEvent instanceof PointerEvent && finishEvent.pointerId !== event.pointerId) return;
      if (changed) {
        suppressClickUntil = Date.now() + 500;
        postLayoutCommit(
          [resizePatchFor(state, latest, direction)],
          '개체 크기 조절'
        );
      } else {
        restoreTransientStates([state]);
      }
      cleanup();
    };
    const cancel = (cancelEvent) => {
      if (cancelEvent instanceof PointerEvent && cancelEvent.pointerId !== event.pointerId) return;
      restoreTransientStates([state]);
      refreshSelectionOverlayGeometry();
      cleanup();
    };
    const keydown = (keyEvent) => {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        cancel();
      }
    };
    const blur = () => cancel();
    activeLayoutGesture = { cancel };
    document.documentElement.classList.add('htmlpoint-layout-resizing');
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', finish, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('blur', blur, { once: true });
    if (pointerHost instanceof Element) {
      pointerHost.addEventListener('lostpointercapture', cancel, { once: true });
    }
  }

  function applyLayoutDeltas(states, deltas, label, commandId) {
    if (states.length > MAX_LAYOUT_OBJECTS || states.some((state, index) => {
      const delta = deltas[index] || { x: 0, y: 0 };
      return Math.abs(state.offsetX + delta.x) > MAX_LAYOUT_OFFSET ||
        Math.abs(state.offsetY + delta.y) > MAX_LAYOUT_OFFSET;
    })) {
      postToEditor({
        type: 'htmlpoint-layout-command-unavailable',
        commandId,
        reason: '배치 결과가 지원 범위를 벗어납니다.'
      });
      return;
    }
    const patches = states.map((state, index) => {
      const delta = deltas[index] || { x: 0, y: 0 };
      const offsetX = state.offsetX + delta.x;
      const offsetY = state.offsetY + delta.y;
      return layoutPatchFor(state, offsetX, offsetY);
    });
    postLayoutCommit(patches, label, commandId);
  }

  function runLayoutCommand(command, commandId) {
    if (!Number.isInteger(commandId) || commandId <= lastLayoutCommandId) return;
    lastLayoutCommandId = commandId;
    if (keyboardLayoutGesture) cancelKeyboardNudge();
    const entries = layoutEntries(Array.from(selectedNodeIds));
    if (!entries.length) {
      postToEditor({ type: 'htmlpoint-layout-command-unavailable', commandId, reason: '개체를 먼저 선택하세요.' });
      return;
    }
    if (entries.length > MAX_LAYOUT_OBJECTS) {
      postToEditor({ type: 'htmlpoint-layout-command-unavailable', commandId, reason: '한 번에 배치할 수 있는 개체는 256개까지입니다.' });
      return;
    }
    if (entries.some((entry) => !isRenderedLayoutTarget(entry.target))) {
      postToEditor({ type: 'htmlpoint-layout-command-unavailable', commandId, reason: '화면에 표시되지 않은 개체는 먼저 펼쳐서 선택하세요.' });
      return;
    }
    const states = entries.map(layoutState);
    if (command === 'reset-position') {
      const hasMovedObject = states.some((state) =>
        state.target.hasAttribute('data-htmlpoint-layout-x') ||
        state.target.hasAttribute('data-htmlpoint-layout-y')
      );
      if (!hasMovedObject) {
        postToEditor({ type: 'htmlpoint-layout-command-unavailable', commandId, reason: '초기화할 이동 값이 없습니다.' });
        return;
      }
      postLayoutCommit(
        states.map((state) => ({ nodeId: state.nodeId, resetPosition: true })),
        states.length > 1 ? '개체 그룹 위치 초기화' : '개체 위치 초기화',
        commandId
      );
      return;
    }
    if (states.some((state) => state.lockPosition)) {
      postToEditor({ type: 'htmlpoint-layout-command-unavailable', commandId, reason: '고정 또는 sticky 위치 개체는 정렬할 수 없습니다.' });
      return;
    }
    if ((command === 'distribute-horizontal' || command === 'distribute-vertical') && states.length < 3) {
      postToEditor({ type: 'htmlpoint-layout-command-unavailable', commandId, reason: '균등 배분은 개체를 3개 이상 선택해야 합니다.' });
      return;
    }
    const slide = selectedSlideElement();
    if (!(slide instanceof HTMLElement)) {
      postToEditor({ type: 'htmlpoint-layout-command-unavailable', commandId, reason: 'Section 배치 영역을 찾을 수 없습니다.' });
      return;
    }
    const group = startBoundsFor(states);
    const reference = states.length === 1 ? slide.getBoundingClientRect() : group;
    const deltas = states.map(() => ({ x: 0, y: 0 }));
    if (command === 'align-left') {
      states.forEach((state, index) => { deltas[index].x = reference.left - state.rect.left; });
    } else if (command === 'align-center') {
      const center = reference.left + reference.width / 2;
      states.forEach((state, index) => { deltas[index].x = center - (state.rect.left + state.rect.width / 2); });
    } else if (command === 'align-right') {
      states.forEach((state, index) => { deltas[index].x = reference.right - state.rect.right; });
    } else if (command === 'align-top') {
      states.forEach((state, index) => { deltas[index].y = reference.top - state.rect.top; });
    } else if (command === 'align-middle') {
      const middle = reference.top + reference.height / 2;
      states.forEach((state, index) => { deltas[index].y = middle - (state.rect.top + state.rect.height / 2); });
    } else if (command === 'align-bottom') {
      states.forEach((state, index) => { deltas[index].y = reference.bottom - state.rect.bottom; });
    } else if (command === 'distribute-horizontal') {
      const ordered = states.map((state, index) => ({ state, index })).sort((left, right) => left.state.rect.left - right.state.rect.left);
      const totalWidth = ordered.reduce((sum, entry) => sum + entry.state.rect.width, 0);
      const gap = (group.width - totalWidth) / (ordered.length - 1);
      let cursor = group.left;
      ordered.forEach((entry) => {
        deltas[entry.index].x = cursor - entry.state.rect.left;
        cursor += entry.state.rect.width + gap;
      });
    } else if (command === 'distribute-vertical') {
      const ordered = states.map((state, index) => ({ state, index })).sort((left, right) => left.state.rect.top - right.state.rect.top);
      const totalHeight = ordered.reduce((sum, entry) => sum + entry.state.rect.height, 0);
      const gap = (group.height - totalHeight) / (ordered.length - 1);
      let cursor = group.top;
      ordered.forEach((entry) => {
        deltas[entry.index].y = cursor - entry.state.rect.top;
        cursor += entry.state.rect.height + gap;
      });
    } else {
      return;
    }
    if (deltas.every((delta) => Math.abs(delta.x) < 0.01 && Math.abs(delta.y) < 0.01)) {
      postToEditor({ type: 'htmlpoint-layout-command-unavailable', commandId, reason: '이미 해당 위치로 정렬되어 있습니다.' });
      return;
    }
    applyLayoutDeltas(states, deltas, '개체 정렬', commandId);
  }

  function semanticLayoutNodeIds() {
    return layoutEntries(htmlpointNodes.map((node) => node.id), false)
      .filter((entry) => isRenderedLayoutTarget(entry.target))
      .map((entry) => representativeNodeIdForTarget(entry.target) || entry.nodeId)
      .filter(Boolean);
  }

  function isGeometryShortcutTarget(target) {
    return target instanceof Element && Boolean(
      target.isContentEditable ||
      target.closest(
        'input, textarea, select, button, a, summary, [role="button"], [contenteditable]:not([contenteditable="false"])'
      )
    );
  }

  function cancelKeyboardNudge() {
    if (!keyboardLayoutGesture) return;
    window.clearTimeout(keyboardLayoutGesture.timer);
    restoreTransientStates(keyboardLayoutGesture.states);
    keyboardLayoutGesture = null;
    clearLayoutFeedback();
    refreshSelectionOverlayGeometry();
  }

  function flushKeyboardNudge() {
    const gesture = keyboardLayoutGesture;
    if (!gesture) return;
    keyboardLayoutGesture = null;
    window.clearTimeout(gesture.timer);
    clearLayoutFeedback();
    if (Math.abs(gesture.deltaX) < 0.001 && Math.abs(gesture.deltaY) < 0.001) {
      restoreTransientStates(gesture.states);
      return;
    }
    postLayoutCommit(
      gesture.states.map((state) =>
        layoutPatchFor(
          state,
          state.offsetX + gesture.deltaX,
          state.offsetY + gesture.deltaY
        )
      ),
      gesture.states.length > 1 ? '개체 그룹 미세 이동' : '개체 미세 이동'
    );
  }

  function nudgeSelection(entries, delta) {
    if (!keyboardLayoutGesture) {
      const states = entries.map(layoutState).map((state) => ({
        ...state,
        originalElementStyle: state.element instanceof Element
          ? state.element.getAttribute('style')
          : undefined
      }));
      if (states.some((state) => state.lockPosition)) {
        postToEditor({
          type: 'htmlpoint-layout-command-unavailable',
          reason: '고정 또는 sticky 위치 개체는 이동할 수 없습니다.'
        });
        return;
      }
      if (states.length > MAX_LAYOUT_OBJECTS) {
        postToEditor({
          type: 'htmlpoint-layout-command-unavailable',
          reason: '한 번에 이동할 수 있는 개체는 256개까지입니다.'
        });
        return;
      }
      keyboardLayoutGesture = {
        states,
        deltaX: 0,
        deltaY: 0,
        timer: 0
      };
    }
    const gesture = keyboardLayoutGesture;
    const constrained = constrainMoveDelta(gesture.states, {
      deltaX: gesture.deltaX + delta.x,
      deltaY: gesture.deltaY + delta.y
    });
    gesture.deltaX = constrained.deltaX;
    gesture.deltaY = constrained.deltaY;
    gesture.states.forEach((state) =>
      applyLivePosition(
        state,
        state.offsetX + gesture.deltaX,
        state.offsetY + gesture.deltaY
      )
    );
    document.documentElement.classList.add('htmlpoint-layout-dragging');
    refreshSelectionOverlayGeometry();
    window.clearTimeout(gesture.timer);
    gesture.timer = window.setTimeout(flushKeyboardNudge, 1500);
  }

  function handleLayoutKeyboard(event) {
    if (!event.isTrusted || event.isComposing || isGeometryShortcutTarget(event.target)) return;
    if (marquee) return;
    if (activeLayoutGesture) return;
    const key = event.key;
    const isArrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key);
    if (keyboardLayoutGesture && !isArrow && key !== 'Escape') flushKeyboardNudge();
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'a') {
      const ids = semanticLayoutNodeIds();
      if (ids.length) {
        event.preventDefault();
        selectNodes(ids, true);
      }
      return;
    }
    if (key === 'Escape') {
      if (keyboardLayoutGesture) {
        event.preventDefault();
        cancelKeyboardNudge();
        return;
      }
      if (selectedNodeIds.size) {
        event.preventDefault();
        selectedNodeIds = new Set();
        selectedNodeId = '';
        clearSelection();
        postToEditor({ type: 'htmlpoint-clear-selection', sectionId: selectedSectionId });
      }
      return;
    }
    if (key === 'Tab') {
      const ids = semanticLayoutNodeIds();
      if (!ids.length) return;
      event.preventDefault();
      const currentIndex = ids.indexOf(selectedNodeId);
      const direction = event.shiftKey ? -1 : 1;
      const nextIndex = currentIndex < 0
        ? (direction > 0 ? 0 : ids.length - 1)
        : (currentIndex + direction + ids.length) % ids.length;
      selectNode(ids[nextIndex], true, false);
      return;
    }
    if (key === 'F2' || key === 'Enter') {
      const { node, target } = nodeElement(selectedNodeId);
      if (node && target instanceof HTMLElement && ['text', 'list'].includes(node.kind)) {
        event.preventDefault();
        beginInlineTextEdit(target, node, event);
      }
      return;
    }
    if (!isArrow) return;
    const entries = layoutEntries(Array.from(selectedNodeIds));
    if (!entries.length) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const delta = {
      x: key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0,
      y: key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
    };
    nudgeSelection(entries, delta);
  }

  function finishKeyboardNudge(event) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      flushKeyboardNudge();
    }
  }

  function revealTarget(element) {
    openAncestorDetails(element);
    element.scrollIntoView({ block: 'center', inline: 'center' });
    requestAnimationFrame(refreshSelectionOverlayGeometry);
  }

  function setPreviewPan(x, y) {
    document.body.style.transformOrigin = 'top left';
    document.body.style.transform = '';
  }
  function nodeElement(nodeId) {
    const node = htmlpointNodeById.get(nodeId);
    const target = node ? elementForNode(selectedSectionId, node) : null;
    return { node, target };
  }
  function combinedRect(entries) {
    if (!entries.length) return null;
    const rects = entries.map((entry) => entry.target.getBoundingClientRect());
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }
  function paintSelections(revealPrimary) {
    clearSelection();
    const ids = Array.from(selectedNodeIds).filter(Boolean);
    const entries = layoutEntries(ids);
    if (revealPrimary) entries.forEach((entry) => openAncestorDetails(entry.target));
    entries.forEach((entry) => {
      entry.target.classList.add(
        entry.nodeId === selectedNodeId && entries.length === 1
          ? 'htmlpoint-selected-node'
          : 'htmlpoint-selected-node-multi'
      );
      if (entry.target !== entry.element && entry.element instanceof Element) {
        entry.element.classList.add('htmlpoint-selected-node-child');
      }
    });
    if (entries.length === 1) {
      if (revealPrimary) revealTarget(entries[0].target);
      addHandles(entries[0]);
    } else if (entries.length > 1) {
      const bounds = combinedRect(entries);
      if (bounds) createSelectionOverlay(bounds, 'htmlpoint-selection-group-overlay');
      if (revealPrimary) {
        const primary = entries.find((entry) => entry.nodeId === selectedNodeId) || entries[0];
        revealTarget(primary.target);
      }
    }
  }
  function selectNode(nodeId, announce, additive) {
    const nextIds = new Set(additive ? selectedNodeIds : []);
    if (additive && nextIds.has(nodeId)) {
      nextIds.delete(nodeId);
    } else {
      nextIds.add(nodeId);
    }
    if (!nextIds.size) {
      nextIds.add(nodeId);
    }
    selectedNodeIds = nextIds;
    selectedNodeId = nextIds.has(nodeId) ? nodeId : Array.from(nextIds)[0] || nodeId;
    paintSelections(false);
    if (announce) {
      postSelectionMessage('htmlpoint-select-node', selectedNodeId, { ctrlKey: Boolean(additive) });
    }
  }
  function selectNodes(nodeIds, announce) {
    let validIds = nodeIds.filter((nodeId) => htmlpointNodeById.has(nodeId));
    if (!validIds.length) return;
    if (validIds.length > MAX_LAYOUT_OBJECTS) {
      validIds = validIds.slice(0, MAX_LAYOUT_OBJECTS);
      postToEditor({
        type: 'htmlpoint-layout-command-unavailable',
        reason: '한 번에 선택할 수 있는 개체는 256개까지입니다.'
      });
    }
    selectedNodeIds = new Set(validIds);
    selectedNodeId = validIds[0];
    paintSelections(false);
    if (announce) {
      postSelectionMessage('htmlpoint-select-nodes', selectedNodeId, { nodeIds: validIds, ctrlKey: true });
    }
  }
  function applyEditorSelection(nodeId, nodeIds) {
    if (keyboardLayoutGesture) cancelKeyboardNudge();
    const requestedIds = Array.isArray(nodeIds)
      ? nodeIds.filter((id) => typeof id === 'string')
      : [];
    const primary = typeof nodeId === 'string' ? nodeId : requestedIds[0];
    const validIds = (requestedIds.length ? requestedIds : primary ? [primary] : [])
      .filter((id) => htmlpointNodeById.has(id));
    if (!validIds.length) {
      selectedNodeId = undefined;
      selectedNodeIds = new Set();
      clearSelection();
      return;
    }

    const limitedIds = validIds.slice(0, MAX_LAYOUT_OBJECTS);
    selectedNodeId = limitedIds.includes(primary) ? primary : limitedIds[0];
    selectedNodeIds = new Set(limitedIds);
    paintSelections(!activeLayoutGesture);
    postSelectionMessage('htmlpoint-select-node', selectedNodeId, { previewSync: true });
  }
  function isImageArrowEligible(element) {
    if (!(element instanceof HTMLImageElement)) return false;
    const parent = element.parentElement;
    const bare = parent && ['section', 'header'].includes(parent.tagName.toLowerCase());
    const generatedHost = parent && parent.dataset && parent.dataset.htmlpointImageAnnotationHost === 'true';
    return Boolean((bare || generatedHost) && !element.style.transform && !element.style.clipPath && !element.style.getPropertyValue('--htmlpoint-crop-scale').trim());
  }
  function updateImageArrowMode() {
    htmlpointNodes.forEach((node) => {
      const { target } = nodeElement(node.id);
      if (target instanceof HTMLImageElement) {
        target.classList.toggle('htmlpoint-image-arrow-ready', node.id === imageArrowModeNodeId);
      }
    });
  }
  function createTransientArrow(rect, startX, startY) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + rect.width + ' ' + rect.height);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('style', 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;overflow:visible;pointer-events:none;z-index:2147483647;');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(startX));
    line.setAttribute('y1', String(startY));
    line.setAttribute('x2', String(startX));
    line.setAttribute('y2', String(startY));
    line.setAttribute('stroke', '#e53935');
    line.setAttribute('stroke-width', '3');
    svg.appendChild(line);
    document.documentElement.appendChild(svg);
    return { svg, line };
  }
  function normalizedArrowPosition(event, rect) {
    return {
      x: Math.max(0, Math.min(100, Number((((event.clientX - rect.left) / rect.width) * 100).toFixed(3)))),
      y: Math.max(0, Math.min(100, Number((((event.clientY - rect.top) / rect.height) * 100).toFixed(3))))
    };
  }
  function addImageArrowDrawing(element, node) {
    if (!(element instanceof HTMLImageElement)) return;
    element.addEventListener('pointerdown', (event) => {
      if (!event.isTrusted || imageArrowModeNodeId !== node.id || activeLayoutGesture) return;
      if (keyboardLayoutGesture) cancelKeyboardNudge();
      event.preventDefault();
      event.stopPropagation();
      if (!isImageArrowEligible(element)) {
        imageArrowModeNodeId = '';
        updateImageArrowMode();
        postToEditor({
          type: 'htmlpoint-image-arrow-rejected',
          nodeId: node.id
        });
        return;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const start = normalizedArrowPosition(event, rect);
      const transient = createTransientArrow(rect, event.clientX - rect.left, event.clientY - rect.top);
      const pointerId = event.pointerId;
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        transient.svg.remove();
        document.removeEventListener('pointermove', update, true);
        document.removeEventListener('pointerup', finish, true);
        document.removeEventListener('pointercancel', cancel, true);
        document.removeEventListener('keydown', cancelOnEscape, true);
        window.removeEventListener('blur', cancel);
        element.removeEventListener('lostpointercapture', cancel);
        try {
          if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
        } catch (_error) {
          // Capture can already be gone after cancellation.
        }
        imageArrowModeNodeId = '';
        activeLayoutGesture = null;
        updateImageArrowMode();
      };
      const update = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        transient.line.setAttribute('x2', String(moveEvent.clientX - rect.left));
        transient.line.setAttribute('y2', String(moveEvent.clientY - rect.top));
      };
      const finish = (finishEvent) => {
        if (finishEvent.pointerId !== pointerId) return;
        const end = normalizedArrowPosition(finishEvent, rect);
        cleanup();
        postToEditor({
          type: 'htmlpoint-add-image-arrow',
          nodeId: node.id,
          startX: start.x,
          startY: start.y,
          endX: end.x,
          endY: end.y
        });
      };
      const cancel = (cancelEvent) => {
        if (cancelEvent instanceof PointerEvent && cancelEvent.pointerId !== pointerId) return;
        cleanup();
      };
      const cancelOnEscape = (keyEvent) => {
        if (keyEvent.key !== 'Escape') return;
        keyEvent.preventDefault();
        cleanup();
      };
      try {
        element.setPointerCapture(pointerId);
      } catch (_error) {
        // Fall back to iframe window listeners when pointer capture is unavailable.
      }
      activeLayoutGesture = { cancel };
      document.addEventListener('pointermove', update, true);
      document.addEventListener('pointerup', finish, true);
      document.addEventListener('pointercancel', cancel, true);
      document.addEventListener('keydown', cancelOnEscape, true);
      window.addEventListener('blur', cancel, { once: true });
      element.addEventListener('lostpointercapture', cancel, { once: true });
    });
  }
  function updateImageMosaicMode() {
    htmlpointNodes.forEach((node) => {
      const { target } = nodeElement(node.id);
      if (target instanceof HTMLImageElement) target.classList.toggle('htmlpoint-image-mosaic-ready', node.id === imageMosaicModeNodeId);
    });
  }
  function addImageMosaicDrawing(element, node) {
    if (!(element instanceof HTMLImageElement)) return;
    element.addEventListener('pointerdown', (event) => {
      if (!event.isTrusted || imageMosaicModeNodeId !== node.id || activeLayoutGesture) return;
      if (keyboardLayoutGesture) cancelKeyboardNudge();
      event.preventDefault(); event.stopPropagation();
      if (!isImageArrowEligible(element)) {
        imageMosaicModeNodeId = ''; updateImageMosaicMode();
        postToEditor({ type: 'htmlpoint-image-arrow-rejected', nodeId: node.id });
        return;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const start = normalizedArrowPosition(event, rect);
      const box = document.createElement('div');
      box.setAttribute('style', 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #6d28d9;background:rgba(109,40,217,.16);');
      document.documentElement.appendChild(box);
      const pointerId = event.pointerId;
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        box.remove();
        document.removeEventListener('pointermove', update, true);
        document.removeEventListener('pointerup', finish, true);
        document.removeEventListener('pointercancel', cancel, true);
        document.removeEventListener('keydown', cancelOnEscape, true);
        window.removeEventListener('blur', cancel);
        element.removeEventListener('lostpointercapture', cancel);
        try {
          if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
        } catch (_error) {
          // Capture can already be gone after cancellation.
        }
        imageMosaicModeNodeId = '';
        activeLayoutGesture = null;
        updateImageMosaicMode();
      };
      const update = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const end = normalizedArrowPosition(moveEvent, rect);
        const left = Math.min(start.x, end.x), top = Math.min(start.y, end.y);
        box.style.left = (rect.left + rect.width * left / 100) + 'px'; box.style.top = (rect.top + rect.height * top / 100) + 'px';
        box.style.width = (rect.width * Math.abs(end.x - start.x) / 100) + 'px'; box.style.height = (rect.height * Math.abs(end.y - start.y) / 100) + 'px';
      };
      const finish = (finishEvent) => {
        if (finishEvent.pointerId !== pointerId) return;
        const end = normalizedArrowPosition(finishEvent, rect);
        cleanup();
        postToEditor({ type: 'htmlpoint-add-image-mosaic', nodeId: node.id,
          left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) });
      };
      const cancel = (cancelEvent) => {
        if (cancelEvent instanceof PointerEvent && cancelEvent.pointerId !== pointerId) return;
        cleanup();
      };
      const cancelOnEscape = (keyEvent) => {
        if (keyEvent.key !== 'Escape') return;
        keyEvent.preventDefault();
        cleanup();
      };
      try {
        element.setPointerCapture(pointerId);
      } catch (_error) {
        // Fall back to document listeners when capture is unavailable.
      }
      activeLayoutGesture = { cancel };
      document.addEventListener('pointermove', update, true);
      document.addEventListener('pointerup', finish, true);
      document.addEventListener('pointercancel', cancel, true);
      document.addEventListener('keydown', cancelOnEscape, true);
      window.addEventListener('blur', cancel, { once: true });
      element.addEventListener('lostpointercapture', cancel, { once: true });
      update(event);
    });
  }
  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (event.source !== window.parent || data.source !== 'htmlpoint-editor') return;
    if (data.type === 'htmlpoint-set-selection') {
      applyEditorSelection(data.selectedNodeId, data.selectedNodeIds);
      return;
    }
    if (data.type === 'htmlpoint-set-editor-zoom') {
      const zoom = Number(data.zoom);
      if (Number.isFinite(zoom) && zoom >= 25 && zoom <= 400) {
        document.documentElement.style.setProperty(
          '--htmlpoint-handle-scale',
          String(100 / zoom)
        );
      }
      return;
    }
    if (
      data.type === 'htmlpoint-run-layout-command' &&
      data.previewRevision === previewRevision &&
      [
        'align-left',
        'align-center',
        'align-right',
        'align-top',
        'align-middle',
        'align-bottom',
        'distribute-horizontal',
        'distribute-vertical',
        'reset-position'
      ].includes(data.command)
    ) {
      runLayoutCommand(data.command, data.commandId);
      return;
    }
    if (data.type === 'htmlpoint-set-image-arrow-mode') {
      imageArrowModeNodeId = typeof data.nodeId === 'string' ? data.nodeId : '';
      updateImageArrowMode();
      return;
    }
    if (data.type === 'htmlpoint-set-image-mosaic-mode') {
      imageMosaicModeNodeId = typeof data.nodeId === 'string' ? data.nodeId : '';
      updateImageMosaicMode();
    }
  });
  function rectsIntersect(left, right) {
    return left.left <= right.right &&
      left.right >= right.left &&
      left.top <= right.bottom &&
      left.bottom >= right.top;
  }
  function beginMarquee(event) {
    if (
      !event.isTrusted ||
      event.button !== 0 ||
      activeLayoutGesture ||
      marquee ||
      !(event.currentTarget instanceof HTMLElement)
    ) return;
    if (keyboardLayoutGesture) cancelKeyboardNudge();
    const pointerTarget = event.target instanceof Element ? event.target : null;
    if (
      pointerTarget?.closest(
        '[data-htmlpoint-node-id], [data-htmlpoint-runtime-wired="true"], a, button, input, textarea, select, summary, [contenteditable]:not([contenteditable="false"])'
      )
    ) return;
    event.preventDefault();
    const pointerHost = event.currentTarget;
    const pointerId = event.pointerId;
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const startX = event.clientX;
    const startY = event.clientY;
    marquee = document.createElement('div');
    marquee.className = 'htmlpoint-marquee';
    document.documentElement.appendChild(marquee);
    const updateMarquee = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId || !marquee) return;
      const left = Math.min(startX, moveEvent.clientX);
      const top = Math.min(startY, moveEvent.clientY);
      const width = Math.abs(moveEvent.clientX - startX);
      const height = Math.abs(moveEvent.clientY - startY);
      marquee.style.left = left + 'px';
      marquee.style.top = top + 'px';
      marquee.style.width = width + 'px';
      marquee.style.height = height + 'px';
    };
    const candidates = layoutEntries(htmlpointNodes.map((node) => node.id), false)
      .filter((entry) => isRenderedLayoutTarget(entry.target));
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      marquee?.remove();
      marquee = null;
      document.removeEventListener('pointermove', updateMarquee, true);
      document.removeEventListener('pointerup', finishMarquee, true);
      document.removeEventListener('pointercancel', cancelMarquee, true);
      document.removeEventListener('keydown', cancelMarqueeOnEscape, true);
      window.removeEventListener('blur', cancelMarquee);
      pointerHost.removeEventListener('lostpointercapture', cancelMarquee);
      try {
        if (pointerHost.hasPointerCapture(pointerId)) pointerHost.releasePointerCapture(pointerId);
      } catch (_error) {
        // Pointer capture may already be gone after an OS-level cancellation.
      }
    };
    const finishMarquee = (finishEvent) => {
      if (finishEvent.pointerId !== pointerId || !marquee) return;
      const selectionRect = marquee.getBoundingClientRect();
      let selectedIds = candidates
        .filter((entry) => rectsIntersect(selectionRect, entry.target.getBoundingClientRect()))
        .map((entry) => representativeNodeIdForTarget(entry.target) || entry.nodeId);
      const isClick = selectionRect.width < 4 && selectionRect.height < 4;
      cleanup();
      if (isClick && !additive) {
        selectedNodeIds = new Set();
        selectedNodeId = '';
        clearSelection();
        postToEditor({ type: 'htmlpoint-clear-selection', sectionId: selectedSectionId });
        return;
      }
      if (selectedIds.length > MAX_LAYOUT_OBJECTS) {
        selectedIds = selectedIds.slice(0, MAX_LAYOUT_OBJECTS);
        postToEditor({
          type: 'htmlpoint-layout-command-unavailable',
          reason: '한 번에 선택할 수 있는 개체는 256개까지입니다.'
        });
      }
      const nextIds = additive
        ? Array.from(new Set(Array.from(selectedNodeIds).concat(selectedIds)))
        : selectedIds;
      if (nextIds.length) {
        selectNodes(nextIds, true);
      } else if (!additive) {
        selectedNodeIds = new Set();
        selectedNodeId = '';
        clearSelection();
        postToEditor({ type: 'htmlpoint-clear-selection', sectionId: selectedSectionId });
      }
    };
    const cancelMarquee = (cancelEvent) => {
      if (cancelEvent instanceof PointerEvent && cancelEvent.pointerId !== pointerId) return;
      cleanup();
    };
    const cancelMarqueeOnEscape = (keyEvent) => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      cleanup();
    };
    try {
      pointerHost.setPointerCapture(pointerId);
    } catch (_error) {
      // Capture can be unavailable in restricted iframe contexts; blur/Escape still clean up.
    }
    updateMarquee(event);
    document.addEventListener('pointermove', updateMarquee, true);
    document.addEventListener('pointerup', finishMarquee, true);
    document.addEventListener('pointercancel', cancelMarquee, true);
    document.addEventListener('keydown', cancelMarqueeOnEscape, true);
    window.addEventListener('blur', cancelMarquee, { once: true });
    pointerHost.addEventListener('lostpointercapture', cancelMarquee, { once: true });
  }

  document.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClickUntil = 0;
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target && target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rawHref = (anchor.getAttribute('href') || '').trim();
    if (rawHref.startsWith('#')) {
      postToEditor({
        type: 'htmlpoint-navigate-fragment',
        fragment: rawHref
      });
      return;
    }
    const configuredUrl = htmlpointExternalLinks.find((entry) => entry[0] === rawHref)?.[1];
    if (configuredUrl) {
      postToEditor({
        type: 'htmlpoint-open-external-link',
        url: configuredUrl
      });
      return;
    }
    try {
      const parseableHref = rawHref.startsWith('//') ? 'https:' + rawHref : rawHref;
      const url = new URL(parseableHref);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        postToEditor({
          type: 'htmlpoint-open-external-link',
          url: url.href
        });
        return;
      }
    } catch (_error) {
      // Invalid and relative-to-opaque links stay inside the editor.
    }
    postToEditor({
      type: 'htmlpoint-link-blocked',
      href: rawHref
    });
  }, true);

  function wireSectionObjects() {
    htmlpointSections.forEach((section) => {
      const slide = sectionElement(section.id);
      if (!(slide instanceof HTMLElement)) return;
      section.nodes.forEach((node) => {
        const element = elementForNode(section.id, node);
        if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return;
        element.classList.add('htmlpoint-preview-node');
        element.setAttribute('data-htmlpoint-node-id', node.id);
        element.setAttribute('data-htmlpoint-section-id', section.id);
        element.setAttribute(
          'title',
          (section.id === selectedSectionId ? '' : 'Section 이동 · ') +
            node.kind.toUpperCase() + ' · ' + node.label
        );
      });
    });
  }

  document.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClickUntil = 0;
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-htmlpoint-runtime-wired="true"]')) return;
    const object = target && target.closest('[data-htmlpoint-node-id][data-htmlpoint-section-id]');
    if (!(object instanceof Element)) return;
    const sectionId = object.getAttribute('data-htmlpoint-section-id') || '';
    const nodeId = object.getAttribute('data-htmlpoint-node-id') || '';
    if (!sectionId || sectionId === selectedSectionId || !nodeId) return;
    const section = htmlpointSections.find((entry) => entry.id === sectionId);
    const node = section?.nodes.find((candidate) => candidate.id === nodeId);
    if (!section || !node) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    postToEditor({
      type: 'htmlpoint-select-section-node',
      sectionId,
      nodeId: layoutSelectionNodeId(node, sectionId)
    });
  }, true);

  function wireRuntimeTables(sectionId, slide) {
    slide.querySelectorAll('table').forEach((table) => {
      if (table.hasAttribute('data-htmlpoint-node-id') || table.dataset.htmlpointRuntimeWired === 'true') return;
      const sourceHost = table.parentElement && table.parentElement.closest('[data-htmlpoint-source-path]');
      const encodedPath = sourceHost && sourceHost.getAttribute('data-htmlpoint-source-path');
      if (!encodedPath) return;
      const hostPath = encodedPath.split('.').filter(Boolean).map(Number);
      if (!hostPath.every((part) => Number.isInteger(part) && part >= 0)) return;
      table.dataset.htmlpointRuntimeWired = 'true';
      table.classList.add('htmlpoint-runtime-table');
      table.setAttribute(
        'title',
        sectionId === selectedSectionId
          ? '동적 표 · 클릭하여 정적 편집본으로 변환'
          : '동적 표 · 클릭하여 해당 Section으로 이동'
      );
      table.addEventListener('click', (event) => {
        if (!event.isTrusted) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (sectionId !== selectedSectionId) {
          postToEditor({
            type: 'htmlpoint-select-section-runtime',
            sectionId,
            hostPath
          });
          return;
        }
        postToEditor({
          type: 'htmlpoint-capture-runtime-table',
          sectionId,
          hostPath,
          tableHtml: table.outerHTML
        });
      }, true);
    });
  }

  function initializePreview() {
    document.documentElement.style.overflow = 'auto';
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.overflow = 'auto';
    document.body.style.scrollBehavior = 'auto';
    primePreviewObjectCaches();
    const langButton = document.querySelector('[data-lang="' + language + '"]');
    if (langButton instanceof HTMLElement) {
      langButton.click();
      window.scrollTo({ left: window.scrollX, top: window.scrollY, behavior: 'auto' });
    }
    wireSectionObjects();
    const wireAllRuntimeTables = () => {
      htmlpointSections.forEach((section) => {
        const slide = sectionElement(section.id);
        if (slide instanceof HTMLElement) wireRuntimeTables(section.id, slide);
      });
    };
    wireAllRuntimeTables();
    const runtimeObserver = new MutationObserver(wireAllRuntimeTables);
    runtimeObserver.observe(document.body, { childList: true, subtree: true });
    const selected = selectedSlideElement();
    if (selected instanceof HTMLElement) {
      selected.style.outline = '3px solid #0f6cbd';
      selected.style.outlineOffset = '4px';
      selected.addEventListener('pointerdown', beginMarquee);
      document.addEventListener('keydown', handleLayoutKeyboard, true);
      document.addEventListener('keyup', finishKeyboardNudge, true);
      window.addEventListener('blur', cancelKeyboardNudge);
      window.addEventListener('scroll', refreshSelectionOverlayGeometry, true);
      window.addEventListener('resize', refreshSelectionOverlayGeometry);
      htmlpointNodes.forEach((node) => {
        const element = elementForNode(selectedSectionId, node);
        if (element instanceof HTMLElement || element instanceof SVGElement) {
          element.classList.add('htmlpoint-preview-node');
          element.setAttribute('data-htmlpoint-node-id', node.id);
          element.setAttribute('draggable', 'false');
          element.setAttribute('title', node.kind.toUpperCase() + ' · 드래그하여 이동 · 더블클릭하여 편집');
          element.addEventListener('pointerdown', (event) => beginMoveGesture(event, node));
          element.addEventListener('click', (event) => {
            if (!event.isTrusted) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.detail >= 2) {
              beginInlineTextEdit(element, node, event);
              return;
            }
            selectNode(
              layoutSelectionNodeId(node),
              true,
              event.ctrlKey || event.metaKey || event.shiftKey
            );
          });
          element.addEventListener('dblclick', (event) => {
            if (event.isTrusted) beginInlineTextEdit(element, node, event);
          });
          if (node.kind === 'image') {
            addImageArrowDrawing(element, node);
            addImageMosaicDrawing(element, node);
          }
        }
      });
      updateImageArrowMode();
      updateImageMosaicMode();
      const markedFocusTarget = selected.querySelector('[data-htmlpoint-focus-target="true"]');
      const focusTarget = markedFocusTarget || (focusPath.length ? elementByPath(selected, focusPath) : selected);
      let focusDetails = focusTarget instanceof Element ? focusTarget.closest('details') : null;
      while (focusDetails instanceof HTMLDetailsElement) {
        focusDetails.open = true;
        focusDetails = focusDetails.parentElement?.closest('details') ?? null;
      }
      if (focusTarget instanceof HTMLElement || focusTarget instanceof SVGElement) {
        focusTarget.scrollIntoView({ block: 'center', inline: 'nearest' });
      } else {
        selected.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      if (selectedNodeId || selectedNodeIds.size) {
        paintSelections(true);
        if (selectedNodeId) {
          postSelectionMessage('htmlpoint-select-node', selectedNodeId, { previewSync: true });
        }
      }
    }
    document.documentElement.dataset.htmlpointPreviewReady = 'true';
  }
  requestAnimationFrame(() => requestAnimationFrame(initializePreview));
})();
</script>`;
  const document = parseHtml(base);
  const serializedSections = Array.from(
    document.querySelectorAll<HTMLElement>('[data-htmlpoint-serialized-section]')
  ).map((element) => ({
    element,
    sectionId: element.dataset.htmlpointSerializedSection ?? ''
  }));
  stripEditorArtifacts(document);
  const visibleSectionIds = new Set(sectionPayloads.map((section) => section.id));
  const payloadBySectionId = new Map(
    sectionPayloads.map((section) => [section.id, section] as const)
  );
  serializedSections.forEach(({ element: slide, sectionId }) => {
    if (!sectionId || !visibleSectionIds.has(sectionId)) {
      return;
    }
    slide.dataset.htmlpointPreviewSection = sectionId;
    slide.querySelectorAll<HTMLElement>('*').forEach((element) => {
      element.dataset.htmlpointSourcePath = getElementPath(slide, element).join('.');
    });
    payloadBySectionId.get(sectionId)?.nodes.forEach((node) => {
      const element = getElementByPath(slide, node.path);
      if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
        return;
      }
      element.dataset.htmlpointNodeId = node.id;
      element.dataset.htmlpointSectionId = sectionId;
      const layoutTarget = getElementByPath(slide, node.layoutPath);
      if (layoutTarget instanceof HTMLElement || layoutTarget instanceof SVGElement) {
        layoutTarget.dataset.htmlpointPreviewLayoutKey = node.layoutPath.join('.');
      }
    });
    if (sectionId === selectedSectionId && focusPath?.length) {
      const focusTarget = getElementByPath(slide, focusPath);
      if (focusTarget instanceof HTMLElement || focusTarget instanceof SVGElement) {
        focusTarget.dataset.htmlpointFocusTarget = 'true';
      }
    }
  });
  if (sourceBaseUrl) {
    const baseElement = document.createElement('base');
    baseElement.dataset.htmlpointPreviewBase = 'true';
    baseElement.setAttribute('href', sourceBaseUrl);
    document.head.insertBefore(baseElement, document.head.firstChild);
  }

  const styleElement = document.createElement('style');
  styleElement.dataset.htmlpointPreviewStyle = 'true';
  styleElement.textContent = PREVIEW_SELECTION_CSS;
  document.head.appendChild(styleElement);
  const scriptDocument = parseHtml(script);
  const scriptElement = scriptDocument.querySelector('script');
  if (scriptElement) {
    const runtimeElement = document.createElement('script');
    runtimeElement.dataset.htmlpointPreviewRuntime = 'true';
    runtimeElement.textContent = scriptElement.textContent;
    document.body.appendChild(runtimeElement);
  }

  return serializeFullDocument(document);
}

function jsonForInlineScript(value: unknown): string {
  return (JSON.stringify(value) ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
export function buildThumbnailHtml(sectionHtml: string): string {
  const document = parseHtml(`<!doctype html><html><head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">
  <style>
    body { margin: 0; background: #fff; color: #222; font-family: Arial, sans-serif; overflow: hidden; }
    header, section { box-sizing: border-box; width: 100%; min-height: 100%; margin: 0 !important; padding: 12px !important; box-shadow: none !important; border-radius: 0 !important; }
    h1 { font-size: 16px !important; line-height: 1.15 !important; margin: 0 0 8px !important; }
    h2 { font-size: 14px !important; line-height: 1.2 !important; margin: 0 0 6px !important; }
    h3, p, li, td, th { font-size: 8px !important; line-height: 1.25 !important; }
    table { width: 100% !important; border-collapse: collapse !important; }
    th, td { padding: 2px !important; border: 1px solid #d6dbe2 !important; }
    svg, img, canvas { max-width: 100% !important; height: auto !important; }
    .htmlpoint-thumbnail-image-placeholder { display: flex !important; align-items: center; justify-content: center; box-sizing: border-box; min-height: 44px; width: 100%; margin: 6px 0; padding: 8px; border: 1px dashed #97afc4; border-radius: 4px; background: #edf4fa; color: #48657c; font-size: 10px; overflow-wrap: anywhere; }
  </style></head><body>${sectionHtml}</body></html>`);
  stripEditorArtifacts(document);
  neutralizeThumbnailAssetRequests(document);
  document.querySelectorAll<HTMLImageElement>('img:not([src]):not([srcset])').forEach((image) => {
    const placeholder = document.createElement('span');
    if (image.id) placeholder.id = image.id;
    placeholder.className = 'htmlpoint-thumbnail-image-placeholder';
    placeholder.setAttribute('role', 'img');
    const label = image.alt.trim() || '이미지';
    placeholder.setAttribute('aria-label', `${label} · 본문에서 확인`);
    placeholder.textContent = `▧ ${label}`;
    image.replaceWith(placeholder);
  });
  return serializeFullDocument(document);
}
function neutralizeThumbnailAssetRequests(document: Document): void {
  document.querySelectorAll<HTMLElement>('[src]').forEach((element) => {
    const source = element.getAttribute('src');
    if (!source || !isMemoryAssetUrl(source)) {
      element.removeAttribute('src');
    }
  });
  document.querySelectorAll<HTMLElement>('[srcset]').forEach((element) => {
    const sourceSet = element.getAttribute('srcset');
    if (!sourceSet || !isMemoryOnlySourceSet(sourceSet)) {
      element.removeAttribute('srcset');
    }
  });
}
function isMemoryAssetUrl(source: string): boolean {
  const urlParserInput = source.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
  return /^(?:data|blob):/i.test(urlParserInput);
}

function isMemoryOnlySourceSet(sourceSet: string): boolean {
  const candidates = parseSourceSetUrls(sourceSet);
  return candidates.length > 0 && candidates.every(isMemoryAssetUrl);
}

function parseSourceSetUrls(sourceSet: string): string[] {
  const urls: string[] = [];
  let index = 0;
  while (index < sourceSet.length) {
    while (
      index < sourceSet.length &&
      (isSourceSetWhitespace(sourceSet[index]) || sourceSet[index] === ',')
    ) {
      index += 1;
    }
    if (index >= sourceSet.length) {
      break;
    }
    const start = index;
    const dataUrl = sourceSet.slice(index, index + 5).toLowerCase() === 'data:';
    while (
      index < sourceSet.length &&
      !isSourceSetWhitespace(sourceSet[index]) &&
      (dataUrl || sourceSet[index] !== ',')
    ) {
      index += 1;
    }
    const collectedUrl = sourceSet.slice(start, index);
    const trailingCommas = dataUrl ? collectedUrl.match(/,+$/)?.[0].length ?? 0 : 0;
    urls.push(trailingCommas ? collectedUrl.slice(0, -trailingCommas) : collectedUrl);
    if (trailingCommas) {
      continue;
    }
    let parentheses = 0;
    while (index < sourceSet.length) {
      const character = sourceSet[index];
      if (character === '(') {
        parentheses += 1;
      } else if (character === ')') {
        parentheses = Math.max(0, parentheses - 1);
      } else if (character === ',' && parentheses === 0) {
        index += 1;
        break;
      }
      index += 1;
    }
  }

  return urls;
}
function isSourceSetWhitespace(character: string): boolean {
  return /[\u0009\u000a\u000c\u000d\u0020]/.test(character);
}
