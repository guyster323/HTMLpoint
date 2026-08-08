import { EditableNode, ReportDocument } from '../types/htmlpoint';
import { serializeFullDocument, stripEditorArtifacts } from './editorArtifacts';
import { parseHtml } from './htmlParser';
import { serializeReportHtml } from './htmlSerializer';

export interface PreviewNodePayload {
  id: string;
  kind: EditableNode['kind'];
  label: string;
  path: number[];
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
  }
  .htmlpoint-select-handle-se[data-htmlpoint-resize-handle="true"] { cursor: nwse-resize !important; }
  .htmlpoint-select-handle-nw { left: -8px !important; top: -8px !important; }
  .htmlpoint-select-handle-ne { right: -8px !important; top: -8px !important; }
  .htmlpoint-select-handle-sw { left: -8px !important; bottom: -8px !important; }
  .htmlpoint-select-handle-se { right: -8px !important; bottom: -8px !important; }
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
    path: node.path
  }));
}

export function buildPreviewHtml(
  report: ReportDocument,
  selectedSectionId: string,
  language: string,
  selectedNodeId?: string,
  selectedNodeIds: string[] = selectedNodeId ? [selectedNodeId] : [],
  sourceBaseUrl?: string
): string {
  const selectedIndex = Math.max(
    0,
    report.sections.findIndex((section) => section.id === selectedSectionId)
  );
  const nodes = buildPreviewSelectionPayload(report, selectedSectionId);
  const base = serializeReportHtml(report).html;
  const initialSelectedNodeIds = Array.from(
    new Set([...(selectedNodeIds.length ? selectedNodeIds : []), selectedNodeId].filter(Boolean))
  );
  const script = `<script>
(() => {
  const selectedIndex = ${JSON.stringify(selectedIndex)};
  const language = ${JSON.stringify(language)};
  const htmlpointNodes = ${JSON.stringify(nodes)};
  let selectedNodeId = ${JSON.stringify(selectedNodeId ?? '')};
  let selectedNodeIds = new Set(${JSON.stringify(initialSelectedNodeIds)});
  let imageArrowModeNodeId = '';
  let imageMosaicModeNodeId = '';
  let marquee = null;

  function elementByPath(root, path) {
    return path.reduce((current, index) => current && current.children ? current.children[index] : null, root);
  }

  function getImageFrameElement(element) {
    const parent = element && element.parentElement;
    if (!parent || !parent.tagName || ['section', 'header'].includes(parent.tagName.toLowerCase())) return null;
    if (parent.dataset && parent.dataset.htmlpointImageAnnotationHost === 'true') return null;
    if (parent.children && parent.children.length > 3) return null;
    return parent;
  }

  function visualTargetFor(node, element) {
    if (node && node.kind === 'image') {
      return getImageFrameElement(element) || element;
    }
    return element;
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
    return snapshot;
  }

  function postSelectionMessage(type, nodeId, extra) {
    const { node, target } = nodeElement(nodeId);
    const snapshot = node && (target instanceof HTMLElement || target instanceof SVGElement)
      ? selectionSnapshot(node, target)
      : undefined;
    window.parent.postMessage({
      source: 'htmlpoint-preview',
      type,
      nodeId,
      selectedNodeIds: Array.from(selectedNodeIds),
      snapshot,
      ...extra
    }, '*');
  }

  function beginInlineTextEdit(element, node, event) {
    if (!(element instanceof HTMLElement)) return;
    if (!node || !['text', 'list'].includes(node.kind)) return;
    if (element.dataset.htmlpointInlineEditing === 'true') return;

    event.preventDefault();
    event.stopPropagation();
    selectNode(node.id, true, event.ctrlKey || event.metaKey);

    const originalText = element.textContent || '';
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
      window.parent.postMessage({
        source: 'htmlpoint-preview',
        type: 'htmlpoint-edit-text',
        nodeId: node.id,
        text
      }, '*');
    };
    const cancel = () => {
      if (closed) return;
      closed = true;
      element.textContent = originalText;
      cleanup();
      paintSelections();
    };
    const handleKeyDown = (keyEvent) => {
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
      element.querySelectorAll(':scope > .htmlpoint-select-handle').forEach((handle) => handle.remove());
    });
    document.querySelectorAll('.htmlpoint-selection-overlay').forEach((overlay) => overlay.remove());
  }

  function addHandles(element, node) {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return;
    const resizeTarget = visualTargetFor(node, element);
    const overlay = document.createElement('div');
    overlay.className = 'htmlpoint-selection-overlay';
    const rect = resizeTarget.getBoundingClientRect();
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.setAttribute('aria-hidden', 'true');
    document.documentElement.appendChild(overlay);
    ['nw','ne','sw','se'].forEach((corner) => {
      const handle = document.createElement('span');
      handle.className = 'htmlpoint-select-handle htmlpoint-select-handle-' + corner;
      handle.setAttribute('aria-hidden', 'true');
      if (node.kind === 'image' && corner === 'se') {
        let resizing = false;
        const beginResize = (event) => {
          if (resizing) return;
          resizing = true;
          event.preventDefault();
          event.stopPropagation();
          const startX = event.clientX;
          const startY = event.clientY;
          const resizeTarget = visualTargetFor(node, element);
          const start = resizeTarget.getBoundingClientRect();
          const hasFrame = resizeTarget !== element;
          const pointerId = event.pointerId;
          try {
            if (pointerId !== undefined) handle.setPointerCapture(pointerId);
          } catch (_error) {
            // Some sandboxed preview contexts do not allow pointer capture.
          }
          const finish = (finishEvent) => {
            if (!resizing) return;
            resizing = false;
            const width = Math.max(24, Math.round(start.width + finishEvent.clientX - startX));
            const height = Math.max(24, Math.round(start.height + finishEvent.clientY - startY));
            window.parent.postMessage({
              source: 'htmlpoint-preview',
              type: hasFrame ? 'htmlpoint-resize-image-frame' : 'htmlpoint-resize-image',
              nodeId: node.id,
              width,
              height
            }, '*');
            try {
              if (pointerId !== undefined) handle.releasePointerCapture(pointerId);
            } catch (_error) {
              // Ignore release failures after pointer capture fallback.
            }
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('mouseup', finish);
            handle.removeEventListener('pointerup', finish);
            handle.removeEventListener('mouseup', finish);
          };
          window.addEventListener('pointerup', finish, { once: true });
          window.addEventListener('mouseup', finish, { once: true });
          handle.addEventListener('pointerup', finish, { once: true });
          handle.addEventListener('mouseup', finish, { once: true });
        };
        handle.dataset.htmlpointResizeHandle = 'true';
        handle.addEventListener('pointerdown', beginResize);
        handle.addEventListener('mousedown', beginResize);
      }
      overlay.appendChild(handle);
    });
  }

  function selectedSlideElement() {
    return document.querySelectorAll('header, section')[selectedIndex];
  }

  function revealTarget(element) {
    element.scrollIntoView({ block: 'center', inline: 'center' });
  }

  function setPreviewPan(x, y) {
    document.body.style.transformOrigin = 'top left';
    document.body.style.transform = '';
  }

  function nodeElement(nodeId) {
    const node = htmlpointNodes.find((entry) => entry.id === nodeId);
    const selectedSlide = selectedSlideElement();
    const target = node && selectedSlide ? elementByPath(selectedSlide, node.path) : null;
    return { node, target };
  }

  function paintSelections() {
    clearSelection();
    const ids = Array.from(selectedNodeIds).filter(Boolean);
    ids.forEach((id) => {
      const { node, target } = nodeElement(id);
      if (node && (target instanceof HTMLElement || target instanceof SVGElement)) {
        const visualTarget = visualTargetFor(node, target);
        visualTarget.classList.add(id === selectedNodeId ? 'htmlpoint-selected-node' : 'htmlpoint-selected-node-multi');
        if (ids.length > 1) {
          visualTarget.classList.add('htmlpoint-selected-node-multi');
        }
        if (visualTarget !== target) {
          target.classList.add('htmlpoint-selected-node-child');
        }
        if (id === selectedNodeId) {
          revealTarget(visualTarget);
          addHandles(target, node);
        }
      }
    });
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
    selectedNodeId = Array.from(selectedNodeIds)[0] || nodeId;
    paintSelections();
    if (announce) {
      postSelectionMessage('htmlpoint-select-node', nodeId, { ctrlKey: Boolean(additive) });
    }
  }

  function selectNodes(nodeIds, announce) {
    const validIds = nodeIds.filter((nodeId) => htmlpointNodes.some((node) => node.id === nodeId));
    if (!validIds.length) return;
    selectedNodeIds = new Set(validIds);
    selectedNodeId = validIds[0];
    paintSelections();
    if (announce) {
      postSelectionMessage('htmlpoint-select-nodes', selectedNodeId, { nodeIds: validIds, ctrlKey: true });
    }
  }

  function applyEditorSelection(nodeId, nodeIds) {
    const requestedIds = Array.isArray(nodeIds)
      ? nodeIds.filter((id) => typeof id === 'string')
      : [];
    const primary = typeof nodeId === 'string' ? nodeId : requestedIds[0];
    const validIds = (requestedIds.length ? requestedIds : primary ? [primary] : [])
      .filter((id) => htmlpointNodes.some((node) => node.id === id));

    if (!validIds.length) {
      selectedNodeId = undefined;
      selectedNodeIds = new Set();
      clearSelection();
      return;
    }

    selectedNodeId = validIds.includes(primary) ? primary : validIds[0];
    selectedNodeIds = new Set(validIds);
    paintSelections();
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
      if (imageArrowModeNodeId !== node.id) return;
      event.preventDefault();
      event.stopPropagation();
      if (!isImageArrowEligible(element)) {
        imageArrowModeNodeId = '';
        updateImageArrowMode();
        window.parent.postMessage({
          source: 'htmlpoint-preview',
          type: 'htmlpoint-image-arrow-rejected',
          nodeId: node.id
        }, '*');
        return;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const start = normalizedArrowPosition(event, rect);
      const transient = createTransientArrow(rect, event.clientX - rect.left, event.clientY - rect.top);
      const pointerId = event.pointerId;
      try {
        element.setPointerCapture(pointerId);
      } catch (_error) {
        // Fall back to iframe window listeners when pointer capture is unavailable.
      }
      const update = (moveEvent) => {
        transient.line.setAttribute('x2', String(moveEvent.clientX - rect.left));
        transient.line.setAttribute('y2', String(moveEvent.clientY - rect.top));
      };
      const finish = (finishEvent) => {
        const end = normalizedArrowPosition(finishEvent, rect);
        transient.svg.remove();
        window.removeEventListener('pointermove', update);
        window.removeEventListener('pointerup', finish);
        try {
          element.releasePointerCapture(pointerId);
        } catch (_error) {
          // Ignore release failures after the iframe fallback path.
        }
        imageArrowModeNodeId = '';
        updateImageArrowMode();
        window.parent.postMessage({
          source: 'htmlpoint-preview',
          type: 'htmlpoint-add-image-arrow',
          nodeId: node.id,
          startX: start.x,
          startY: start.y,
          endX: end.x,
          endY: end.y
        }, '*');
      };
      window.addEventListener('pointermove', update);
      window.addEventListener('pointerup', finish, { once: true });
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
      if (imageMosaicModeNodeId !== node.id) return;
      event.preventDefault(); event.stopPropagation();
      if (!isImageArrowEligible(element)) {
        imageMosaicModeNodeId = ''; updateImageMosaicMode();
        window.parent.postMessage({ source: 'htmlpoint-preview', type: 'htmlpoint-image-arrow-rejected', nodeId: node.id }, '*');
        return;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const start = normalizedArrowPosition(event, rect);
      const box = document.createElement('div');
      box.setAttribute('style', 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #6d28d9;background:rgba(109,40,217,.16);');
      document.documentElement.appendChild(box);
      const update = (moveEvent) => {
        const end = normalizedArrowPosition(moveEvent, rect);
        const left = Math.min(start.x, end.x), top = Math.min(start.y, end.y);
        box.style.left = (rect.left + rect.width * left / 100) + 'px'; box.style.top = (rect.top + rect.height * top / 100) + 'px';
        box.style.width = (rect.width * Math.abs(end.x - start.x) / 100) + 'px'; box.style.height = (rect.height * Math.abs(end.y - start.y) / 100) + 'px';
      };
      const finish = (finishEvent) => {
        const end = normalizedArrowPosition(finishEvent, rect); box.remove(); window.removeEventListener('pointermove', update);
        imageMosaicModeNodeId = ''; updateImageMosaicMode();
        window.parent.postMessage({ source: 'htmlpoint-preview', type: 'htmlpoint-add-image-mosaic', nodeId: node.id,
          left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }, '*');
      };
      window.addEventListener('pointermove', update); window.addEventListener('pointerup', finish, { once: true }); update(event);
    });
  }

  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.source !== 'htmlpoint-editor') return;
    if (data.type === 'htmlpoint-set-selection') {
      applyEditorSelection(data.selectedNodeId, data.selectedNodeIds);
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
    if (!event.ctrlKey && !event.metaKey) return;
    if (!(event.currentTarget instanceof HTMLElement)) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    marquee = document.createElement('div');
    marquee.className = 'htmlpoint-marquee';
    document.documentElement.appendChild(marquee);
    const updateMarquee = (moveEvent) => {
      const left = Math.min(startX, moveEvent.clientX);
      const top = Math.min(startY, moveEvent.clientY);
      const width = Math.abs(moveEvent.clientX - startX);
      const height = Math.abs(moveEvent.clientY - startY);
      marquee.style.left = left + 'px';
      marquee.style.top = top + 'px';
      marquee.style.width = width + 'px';
      marquee.style.height = height + 'px';
    };
    const finishMarquee = () => {
      const selectionRect = marquee.getBoundingClientRect();
      const selectedIds = htmlpointNodes
        .filter((node) => {
          const { target } = nodeElement(node.id);
          return (target instanceof HTMLElement || target instanceof SVGElement) &&
            rectsIntersect(selectionRect, target.getBoundingClientRect());
        })
        .map((node) => node.id);
      marquee.remove();
      marquee = null;
      document.removeEventListener('pointermove', updateMarquee);
      document.removeEventListener('pointerup', finishMarquee);
      if (selectedIds.length) {
        selectNodes(selectedIds, true);
      }
    };
    updateMarquee(event);
    document.addEventListener('pointermove', updateMarquee);
    document.addEventListener('pointerup', finishMarquee, { once: true });
  }

  requestAnimationFrame(() => {
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    const langButton = document.querySelector('[data-lang="' + language + '"]');
    if (langButton instanceof HTMLElement) langButton.click();
    const slides = Array.from(document.querySelectorAll('header, section'));
    const selected = slides[selectedIndex];
    if (selected instanceof HTMLElement) {
      selected.style.outline = '3px solid #0f6cbd';
      selected.style.outlineOffset = '4px';
      selected.scrollIntoView({ block: 'center', inline: 'nearest' });
      selected.addEventListener('pointerdown', beginMarquee);
      htmlpointNodes.forEach((node) => {
        const element = elementByPath(selected, node.path);
        if (element instanceof HTMLElement || element instanceof SVGElement) {
          element.classList.add('htmlpoint-preview-node');
          element.setAttribute('data-htmlpoint-node-id', node.id);
          element.setAttribute('title', node.kind.toUpperCase() + ' · ' + node.label);
          element.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.detail >= 2) {
              beginInlineTextEdit(element, node, event);
              return;
            }
            selectNode(node.id, true, event.ctrlKey || event.metaKey);
          });
          element.addEventListener('dblclick', (event) => beginInlineTextEdit(element, node, event));
          if (node.kind === 'image') {
            addImageArrowDrawing(element, node);
            addImageMosaicDrawing(element, node);
          }
        }
      });
      updateImageArrowMode();
      updateImageMosaicMode();
      if (selectedNodeId || selectedNodeIds.size) {
        paintSelections();
        if (selectedNodeId) {
          postSelectionMessage('htmlpoint-select-node', selectedNodeId, { previewSync: true });
        }
      }
    }
  });
})();
</script>`;
  const document = parseHtml(base);
  stripEditorArtifacts(document);

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

export function buildThumbnailHtml(sectionHtml: string): string {
  const document = parseHtml(`<!doctype html><html><head><style>
    body { margin: 0; background: #fff; color: #222; font-family: Arial, sans-serif; overflow: hidden; }
    header, section { box-sizing: border-box; width: 100%; min-height: 100%; margin: 0 !important; padding: 12px !important; box-shadow: none !important; border-radius: 0 !important; }
    h1 { font-size: 16px !important; line-height: 1.15 !important; margin: 0 0 8px !important; }
    h2 { font-size: 14px !important; line-height: 1.2 !important; margin: 0 0 6px !important; }
    h3, p, li, td, th { font-size: 8px !important; line-height: 1.25 !important; }
    table { width: 100% !important; border-collapse: collapse !important; }
    th, td { padding: 2px !important; border: 1px solid #d6dbe2 !important; }
    svg, img, canvas { max-width: 100% !important; height: auto !important; }
  </style></head><body>${sectionHtml}</body></html>`);
  stripEditorArtifacts(document);
  neutralizeThumbnailAssetRequests(document);
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
