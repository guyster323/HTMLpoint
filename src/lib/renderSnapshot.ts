import type {
  EditableNode,
  RenderBounds,
  RenderSnapshotObject,
  RenderSnapshotPage,
  RenderSnapshotWarning,
  RenderTextRun,
  ReportDocument,
  ReportSection,
  RenderedDocumentSnapshot
} from '../types/htmlpoint';
import { getElementByPath } from './domPaths';
import { parseHtml } from './htmlParser';

const DEFAULT_PAGE_WIDTH = 1280;
const DEFAULT_PAGE_HEIGHT = 720;
const TEXT_BLOCK_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'td',
  'th',
  'figcaption',
  'caption',
  'summary',
  'blockquote',
  'button'
]);

export interface RenderSnapshotOptions {
  sectionIds?: string[];
  pageWidth?: number;
  pageHeight?: number;
  now?: number;
}

export interface SnapshotValidation {
  ok: boolean;
  reason?: string;
}

export function getReportRevision(report: ReportDocument): string {
  const input = [
    report.id,
    String(report.updatedAt),
    ...report.sections.map((section) => `${section.id}:${section.html}`)
  ].join('|');
  return `${report.id}:${hashString(input)}`;
}

export function createRenderedDocumentSnapshot(
  report: ReportDocument,
  options: RenderSnapshotOptions = {}
): RenderedDocumentSnapshot {
  const allowedSections = options.sectionIds ? new Set(options.sectionIds) : undefined;
  const pages = report.sections
    .filter((section) => !allowedSections || allowedSections.has(section.id))
    .map((section) => createPageSnapshot(section, options));
  const warnings = pages.flatMap((page) => page.warnings);
  return {
    schemaVersion: 1,
    reportId: report.id,
    reportRevision: getReportRevision(report),
    createdAt: options.now ?? Date.now(),
    pages,
    warnings
  };
}

export function validateRenderedDocumentSnapshot(
  report: ReportDocument,
  snapshot: RenderedDocumentSnapshot
): SnapshotValidation {
  if (snapshot.schemaVersion !== 1) {
    return { ok: false, reason: '지원하지 않는 렌더링 스냅샷 버전입니다.' };
  }
  if (snapshot.reportId !== report.id) {
    return { ok: false, reason: '다른 문서의 렌더링 스냅샷입니다.' };
  }
  if (snapshot.reportRevision !== getReportRevision(report)) {
    return { ok: false, reason: '문서가 변경되어 렌더링 스냅샷을 다시 만들어야 합니다.' };
  }
  return { ok: true };
}

function createPageSnapshot(
  section: ReportSection,
  options: RenderSnapshotOptions
): RenderSnapshotPage {
  const document = parseHtml(section.html);
  const root = document.body.firstElementChild as HTMLElement | null;
  const pageSize = readPageSize(root, options);
  if (!root) {
    const emptyPageWarning = warning(
      'unsupported-css',
      '섹션 루트를 읽을 수 없어 빈 페이지로 처리했습니다.',
      'error'
    );
    return {
      sectionId: section.id,
      title: section.title,
      width: pageSize.width,
      height: pageSize.height,
      language: section.languageScope,
      objects: [],
      warnings: [emptyPageWarning]
    };
  }

  const nodes = section.editableNodes.filter((node) => shouldSnapshotNode(node, section.editableNodes));
  const diagramObjectIds = new Set(
    section.editableNodes
      .filter((node) => node.diagram?.role === 'node')
      .map((node) => node.diagram?.objectId)
      .filter((id): id is string => Boolean(id))
  );
  const objects = nodes.map((node, index) =>
    createObjectSnapshot(root, node, index, pageSize.width, pageSize.height, diagramObjectIds)
  );
  resolveConnectorBounds(objects);
  const warnings = objects.flatMap((object) => object.warnings);
  return {
    sectionId: section.id,
    title: section.title,
    width: pageSize.width,
    height: pageSize.height,
    language: section.languageScope,
    objects,
    warnings
  };
}

function shouldSnapshotNode(node: EditableNode, nodes: EditableNode[]): boolean {
  if (node.kind !== 'text' && node.kind !== 'list') {
    return true;
  }
  return !nodes.some(
    (ancestor) =>
      ancestor !== node &&
      (ancestor.kind === 'text' || ancestor.kind === 'list') &&
      TEXT_BLOCK_TAGS.has(ancestor.tagName) &&
      isStrictPathPrefix(ancestor.path, node.path)
  );
}

function createObjectSnapshot(
  root: HTMLElement,
  node: EditableNode,
  index: number,
  pageWidth: number,
  pageHeight: number,
  diagramObjectIds: Set<string>
): RenderSnapshotObject {
  const element = getElementByPath(root, node.path);
  const bounds = readBounds(element, node, index);
  const warnings = collectObjectWarnings(element, node, bounds, pageWidth, pageHeight, diagramObjectIds);
  const object: RenderSnapshotObject = {
    id: node.id,
    sourceNodeId: node.id,
    kind: node.kind,
    bounds,
    paintOrder: index,
    capabilities: capabilitiesFor(node),
    warnings
  };

  if (node.kind === 'text' || node.kind === 'list') {
    object.textRuns = extractTextRuns(element, node.id, node.text);
  } else if (node.kind === 'table') {
    object.textRuns = [{ text: node.text, sourceNodeId: node.id }];
    object.table = node.table;
  }
  if (node.kind === 'image') {
    object.assetSrc = node.image?.src || element?.getAttribute('src') || undefined;
  }
  if (node.kind === 'chart') {
    object.assetSrc = element?.outerHTML;
  }
  if (node.diagram) {
    object.diagram = node.diagram;
  }
  if (node.kind === 'shape') {
    object.shapeType = element && /(?:ellipse|oval|circle)/i.test(element.className)
      ? 'ellipse'
      : 'rect';
  }
  return object;
}

function resolveConnectorBounds(objects: RenderSnapshotObject[]): void {
  const nodes = new Map(
    objects
      .filter((object) => object.diagram?.role === 'node')
      .map((object) => [object.diagram?.objectId, object.bounds] as const)
  );
  objects
    .filter((object) => object.kind === 'connector' && object.diagram?.role === 'edge')
    .forEach((object) => {
      const from = object.diagram?.fromObjectId ? nodes.get(object.diagram.fromObjectId) : undefined;
      const to = object.diagram?.toObjectId ? nodes.get(object.diagram.toObjectId) : undefined;
      if (!from || !to) {
        return;
      }
      const startX = from.x + from.width / 2;
      const startY = from.y + from.height / 2;
      const endX = to.x + to.width / 2;
      const endY = to.y + to.height / 2;
      object.bounds = {
        x: Math.min(startX, endX),
        y: Math.min(startY, endY),
        width: Math.max(1, Math.abs(endX - startX)),
        height: Math.max(1, Math.abs(endY - startY))
      };
    });
}

function capabilitiesFor(node: EditableNode): string[] {
  switch (node.kind) {
    case 'text':
    case 'list':
      return ['editable-text'];
    case 'table':
      return ['editable-table'];
    case 'shape':
      return ['editable-shape'];
    case 'connector':
      return ['editable-connector'];
    case 'image':
      return ['picture'];
    case 'chart':
      return ['picture-fallback'];
    default:
      return [];
  }
}

function readPageSize(
  root: HTMLElement | null,
  options: RenderSnapshotOptions
): { width: number; height: number } {
  const width = readDimension(root, 'width') ?? options.pageWidth ?? DEFAULT_PAGE_WIDTH;
  const height = readDimension(root, 'height') ?? options.pageHeight ?? DEFAULT_PAGE_HEIGHT;
  return {
    width: Math.max(1, width),
    height: Math.max(1, height)
  };
}

function readBounds(element: Element | null, node: EditableNode, index: number): RenderBounds {
  const width =
    readDimension(element, 'width') ??
    readDimension(element?.parentElement ?? null, 'width') ??
    fallbackTextWidth(node.text);
  const height =
    readDimension(element, 'height') ??
    (node.kind === 'table' ? Math.max(28, (node.table?.rows.length ?? 1) * 28) : 24);
  const rect = readClientRect(element);
  return {
    x: readPosition(element, 'x') ?? rect?.x ?? index * 8,
    y: readPosition(element, 'y') ?? rect?.y ?? index * 8,
    width: Math.max(1, rect?.width || width),
    height: Math.max(1, rect?.height || height)
  };
}

function readClientRect(element: Element | null): RenderBounds | undefined {
  if (!element || typeof element.getBoundingClientRect !== 'function') {
    return undefined;
  }
  const rect = element.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    return undefined;
  }
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

function readPosition(element: Element | null, axis: 'x' | 'y'): number | undefined {
  if (!element) {
    return undefined;
  }
  const names = axis === 'x' ? ['data-x', 'data-left', 'left'] : ['data-y', 'data-top', 'top'];
  let basePosition: number | undefined;
  for (const name of names) {
    const attribute = element.getAttribute(name);
    const inline = name === 'left' || name === 'top'
      ? (element as HTMLElement).style.getPropertyValue(name)
      : attribute;
    const value = inline || attribute;
    const parsed = parseLength(value);
    if (parsed !== undefined && basePosition === undefined) {
      basePosition = parsed;
    }
  }
  const layoutOffset = parseLength(
    element.getAttribute(axis === 'x' ? 'data-htmlpoint-layout-x' : 'data-htmlpoint-layout-y')
  );
  if (basePosition !== undefined) {
    return basePosition + (layoutOffset ?? 0);
  }
  return layoutOffset;
}

function readDimension(element: Element | null, dimension: 'width' | 'height'): number | undefined {
  if (!element) {
    return undefined;
  }
  const attribute = element.getAttribute(`data-${dimension}`) || element.getAttribute(dimension);
  const inline = (element as HTMLElement).style?.getPropertyValue(dimension);
  return parseLength(inline || attribute);
}

function parseLength(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(?:px)?$/i);
  if (!match) {
    return undefined;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fallbackTextWidth(text: string): number {
  return Math.max(120, Math.min(960, text.replace(/\s+/g, ' ').trim().length * 7 + 24));
}

function extractTextRuns(
  element: Element | null,
  sourceNodeId: string,
  fallbackText: string
): RenderTextRun[] {
  if (!element) {
    return fallbackText ? [{ text: fallbackText, sourceNodeId }] : [];
  }
  const runs: RenderTextRun[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    const text = textNode.nodeValue?.replace(/\s+/g, ' ').trim();
    if (!text) {
      continue;
    }
    const parent = textNode.parentElement ?? element;
    runs.push({ text, sourceNodeId, ...readInlineTextStyle(parent) });
  }
  return runs.length ? runs : fallbackText ? [{ text: fallbackText, sourceNodeId }] : [];
}

function readInlineTextStyle(element: Element): Omit<RenderTextRun, 'text' | 'sourceNodeId'> {
  const style = (element as HTMLElement).style;
  const tag = element.tagName.toLowerCase();
  const fontWeight = style?.fontWeight?.trim();
  const fontSizePx = parseLength(style?.fontSize);
  return {
    bold: tag === 'strong' || tag === 'b' || fontWeight === 'bold' || Number(fontWeight) >= 600 || undefined,
    italic: tag === 'em' || tag === 'i' || style?.fontStyle === 'italic' || undefined,
    underline: style?.textDecoration?.includes('underline') || tag === 'u' || undefined,
    color: style?.color || undefined,
    fontFamily: style?.fontFamily || undefined,
    fontSizePx
  };
}

function collectObjectWarnings(
  element: Element | null,
  node: EditableNode,
  bounds: RenderBounds,
  pageWidth: number,
  pageHeight: number,
  diagramObjectIds: Set<string>
): RenderSnapshotWarning[] {
  const warnings: RenderSnapshotWarning[] = [];
  if (
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.x + bounds.width > pageWidth ||
    bounds.y + bounds.height > pageHeight
  ) {
    warnings.push(warning('outside-page', `${node.label} 개체가 페이지 경계를 벗어났습니다.`, 'warning', node.id));
  }
  if ((node.kind === 'text' || node.kind === 'list') && node.text.length > 0) {
    const estimatedLines = Math.ceil((node.text.length * 7) / Math.max(1, bounds.width));
    if (estimatedLines * 18 > bounds.height * 1.5) {
      warnings.push(warning('text-overflow', `${node.label} 텍스트가 상자 높이를 초과할 수 있습니다.`, 'warning', node.id));
    }
  }
  const style = element instanceof HTMLElement ? element.getAttribute('style') ?? '' : '';
  if (/(?:filter|clip-path|mask|transform\s*:\s*rotate)/i.test(style)) {
    warnings.push(warning('unsupported-css', `${node.label}에 PPTX 네이티브 변환이 어려운 CSS가 있습니다.`, 'warning', node.id));
  }
  if (node.kind === 'image' && !(node.image?.src || element?.getAttribute('src'))) {
    warnings.push(warning('missing-asset', `${node.label} 이미지 자산이 없습니다.`, 'error', node.id));
  }
  if (node.kind === 'chart') {
    warnings.push(warning('picture-fallback', `${node.label} 차트는 그림으로 출력됩니다.`, 'warning', node.id));
  }
  if (node.diagram?.role === 'edge') {
    if (!node.diagram.fromObjectId || !node.diagram.toObjectId) {
      warnings.push(warning('broken-connector', `${node.label} 연결선의 양 끝 개체 참조가 없습니다.`, 'error', node.id));
    } else if (
      !diagramObjectIds.has(node.diagram.fromObjectId) ||
      !diagramObjectIds.has(node.diagram.toObjectId)
    ) {
      warnings.push(warning('broken-connector', `${node.label} 연결선이 존재하지 않는 개체를 가리킵니다.`, 'error', node.id));
    }
  }
  return warnings;
}

function warning(
  code: RenderSnapshotWarning['code'],
  message: string,
  severity: RenderSnapshotWarning['severity'],
  sourceNodeId?: string
): RenderSnapshotWarning {
  return { code, message, severity, ...(sourceNodeId ? { sourceNodeId } : {}) };
}

function isStrictPathPrefix(parent: number[], child: number[]): boolean {
  return parent.length < child.length && parent.every((part, index) => child[index] === part);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
