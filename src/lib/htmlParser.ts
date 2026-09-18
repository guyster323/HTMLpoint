import {
  AssetRef,
  ChartPresentationSettings,
  EditableNode,
  DiagramObjectSnapshot,
  ImportAdapterKind,
  ImportCandidate,
  ParseOptions,
  ReportDocument,
  ReportLanguage,
  ReportSection,
  ReportSectionKind,
  SourceRef,
  TableCellSnapshot,
  TextEffectSettings,
  TranslationEntry
} from '../types/htmlpoint';
import { snapshotChart } from './chartAdapters';
import { elementPathKey, getElementByPath, getElementPath, makeNodeId } from './domPaths';
import { serializeFullDocument, stripEditorArtifacts } from './editorArtifacts';
import { findImageFrame, TABLE_LAYOUT_TARGET_SELECTOR } from './layoutTargets';
export { snapshotChart } from './chartAdapters';

const SEMANTIC_SLIDE_SELECTOR = 'header, section';
const EXPLICIT_SLIDE_SELECTOR =
  '[data-htmlpoint-slide], [data-slide], .slide-portrait, .slide';
const FIG_CANVAS_SELECTOR = '.fig-canvas, [data-fig-canvas]';
const IMPORT_CANDIDATE_SELECTOR =
  '[data-htmlpoint-import-candidate], main > article, main > div, body > article, body > div';
const TEXT_SELECTOR = [
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
  'button',
  'a',
  'span',
  'strong',
  'em',
  'code'
].join(',');

const effectPresets: Record<TextEffectSettings['preset'], TextEffectSettings> = {
  none: {
    preset: 'none',
    fill: '#ffffff',
    textColor: '#1f2328',
    borderColor: '#d7dbe2',
    radius: 0,
    bold: false
  },
  neutral: {
    preset: 'neutral',
    fill: '#f3f4f6',
    textColor: '#303842',
    borderColor: '#cfd6df',
    radius: 6,
    bold: true
  },
  info: {
    preset: 'info',
    fill: '#e8f2ff',
    textColor: '#0f4f86',
    borderColor: '#86b7e8',
    radius: 999,
    bold: true
  },
  warning: {
    preset: 'warning',
    fill: '#fff3c4',
    textColor: '#805600',
    borderColor: '#f2c94c',
    radius: 999,
    bold: true
  },
  danger: {
    preset: 'danger',
    fill: '#ffe4e0',
    textColor: '#8f1d16',
    borderColor: '#f3a5aa',
    radius: 999,
    bold: true
  },
  success: {
    preset: 'success',
    fill: '#ddf6e8',
    textColor: '#17633f',
    borderColor: '#9fd37f',
    radius: 999,
    bold: true
  }
};

function makeDocumentId(): string {
  return `report-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

export function getSlideElements(document: Document): HTMLElement[] {
  return getSlideDescriptors(document).map((descriptor) => descriptor.element);
}

export interface SlideDescriptor {
  element: HTMLElement;
  adapter: Exclude<ImportAdapterKind, 'candidate'>;
}

/**
 * Selects one page root per visual container. Explicit slide and fig-canvas
 * markers win over semantic descendants, so a slide containing a section or
 * a canvas is never imported twice.
 */
export function getSlideDescriptors(document: Document): SlideDescriptor[] {
  const candidates: Array<SlideDescriptor & { priority: number; order: number }> = [];
  const add = (
    selector: string,
    adapter: Exclude<ImportAdapterKind, 'candidate'>,
    priority: number
  ) => {
    document.body.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      candidates.push({ element, adapter, priority, order: elementOrder(document.body, element) });
    });
  };

  add(SEMANTIC_SLIDE_SELECTOR, 'semantic', 10);
  add(FIG_CANVAS_SELECTOR, 'fig-canvas', 20);
  add(EXPLICIT_SLIDE_SELECTOR, 'slide', 30);

  const selected: Array<SlideDescriptor & { priority: number; order: number }> = [];
  for (const candidate of candidates.sort((left, right) => right.priority - left.priority || left.order - right.order)) {
    const higherPriorityAncestor = candidates.some(
      (other) =>
        other !== candidate &&
        other.priority > candidate.priority &&
        other.element.contains(candidate.element)
    );
    if (higherPriorityAncestor) {
      continue;
    }
    const containing = selected.find((parent) => parent.element.contains(candidate.element));
    if (containing && containing.priority >= candidate.priority) {
      continue;
    }
    const higherPrioritySelectedDescendant = selected.some(
      (child) =>
        child.priority > candidate.priority && candidate.element.contains(child.element)
    );
    if (higherPrioritySelectedDescendant) {
      continue;
    }
    const descendants = selected.filter(
      (child) => candidate.element.contains(child.element) && candidate.priority >= child.priority
    );
    descendants.forEach((child) => selected.splice(selected.indexOf(child), 1));
    selected.push(candidate);
  }

  return selected
    .sort((left, right) => left.order - right.order)
    .map(({ element, adapter }) => ({ element, adapter }));
}

export function findImportCandidates(document: Document): ImportCandidate[] {
  const descriptors = new Set<HTMLElement>();
  return Array.from(document.body.querySelectorAll<HTMLElement>(IMPORT_CANDIDATE_SELECTOR))
    .filter((element) => {
      if (descriptors.has(element) || element.closest(SEMANTIC_SLIDE_SELECTOR) || element.closest(FIG_CANVAS_SELECTOR)) {
        return false;
      }
      descriptors.add(element);
      return hasCandidateContent(element);
    })
    .slice(0, 20)
    .map((element, index) => ({
      id: `candidate-${index + 1}`,
      adapter: 'candidate' as const,
      selector: element.hasAttribute('data-htmlpoint-import-candidate')
        ? '[data-htmlpoint-import-candidate]'
        : element.tagName.toLowerCase(),
      label: getCandidateLabel(element, `Candidate ${index + 1}`),
      domPath: getElementPath(document.body, element),
      reason: '명시적 slide·section 표식이 없어 편집 범위를 선택해야 합니다.'
    }));
}

export function getParentKey(document: Document, parent: Element): string {
  return elementPathKey(document.body, parent);
}

export function parseReportHtml(html: string, options: ParseOptions = {}): ReportDocument {
  const document = parseHtml(html);
  const strippedEditorArtifacts = stripEditorArtifacts(document);
  const translations = extractTranslations(document);
  const languages = detectLanguages(document);
  const activePaneLanguage = document
    .querySelector<HTMLElement>('[data-report-lang].active')
    ?.dataset.reportLang?.trim();
  const slideDescriptors = getSlideDescriptors(document);
  const selectedCandidate = !slideDescriptors.length && options.selectedCandidatePath
    ? getElementByPath(document.body, options.selectedCandidatePath)
    : null;
  const sections = selectedCandidate instanceof HTMLElement
    ? [parseSectionElement(document, selectedCandidate, 0, translations, 'candidate')]
    : slideDescriptors.map((descriptor, index) =>
        parseSectionElement(document, descriptor.element, index, translations, descriptor.adapter)
      );
  const importCandidates = sections.length ? undefined : findImportCandidates(document);

  return {
    id: makeDocumentId(),
    title: document.title?.trim() || options.fileName || 'Untitled HTML Report',
    fileName: options.fileName,
    sourcePath: options.sourcePath,
    sourceHtml: strippedEditorArtifacts ? serializeFullDocument(document) : html,
    sections,
    assets: collectAssets(sections),
    languages,
    activeLanguage:
      activePaneLanguage ?? languages[0] ?? document.documentElement.lang ?? 'ko',
    translations,
    operations: [],
    dirty: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...(importCandidates?.length ? { importCandidates } : {})
  };
}

export function parseSectionHtml(
  section: ReportSection,
  translations: TranslationEntry[]
): ReportSection {
  const document = parseHtml(section.html);
  stripEditorArtifacts(document);
  const element = document.body.firstElementChild as HTMLElement | null;
  if (!element) {
    return section;
  }

  return {
    ...section,
    kind: getSectionKind(element),
    title: getSectionTitle(element, section.originalIndex ?? 0),
    html: element.outerHTML,
    textPreview: getTextPreview(element),
    hidden:
      element.hasAttribute('hidden') ||
      element.dataset.htmlpointHidden === 'true' ||
      element.style.display === 'none',
    outlineItems: collectSectionOutlineItems(element),
    editableNodes: collectEditableNodes(element, section.id, translations)
  };
}

export function parseSectionElement(
  document: Document,
  element: HTMLElement,
  index: number,
  translations: TranslationEntry[],
  adapter: ImportAdapterKind = inferAdapter(element)
): ReportSection {
  const id = readStableSectionId(element) ?? `section-${index + 1}`;
  const domPath = getElementPath(document.body, element);
  const section: ReportSection = {
    id,
    kind: getSectionKind(element, adapter),
    title: getSectionTitle(element, index),
    sourceId: element.id || undefined,
    languageScope: getSectionLanguageScope(element),
    parentKey: element.parentElement ? getParentKey(document, element.parentElement) : 'body',
    originalIndex: index,
    html: element.outerHTML,
    textPreview: getTextPreview(element),
    hidden:
      element.hasAttribute('hidden') ||
      element.dataset.htmlpointHidden === 'true' ||
      element.style.display === 'none',
    editableNodes: [],
    changed: false,
    sourceRef: {
      adapter,
      domPath,
      htmlId: element.id || undefined,
      objectId: id
    }
  };

  return parseSectionHtml(section, translations);
}

export function extractTranslations(document: Document): TranslationEntry[] {
  const entries: TranslationEntry[] = [];

  Array.from(document.scripts).forEach((script) => {
    const source = script.textContent ?? '';
    if (!source.includes('translations')) {
      return;
    }

    const entryPattern = /\[\s*(['"])(.*?)\1\s*,\s*(['"])([\s\S]*?)\3\s*\]/g;
    let match: RegExpExecArray | null;
    while ((match = entryPattern.exec(source))) {
      const selector = unescapeScriptString(match[2]);
      const enHtml = unescapeScriptString(match[4]);
      const koElement = safeQuerySelector(document, selector);
      entries.push({
        selector,
        koHtml: koElement?.innerHTML ?? '',
        enHtml
      });
    }
  });

  return dedupeTranslations(entries);
}

export function detectLanguages(document: Document): ReportLanguage[] {
  const found = new Set<ReportLanguage>();
  const htmlLang = document.documentElement.lang?.trim();
  if (htmlLang) {
    found.add(htmlLang);
  }

  document
    .querySelectorAll<HTMLElement>('[data-lang], [data-report-lang]')
    .forEach((element) => {
    const lang = (element.dataset.reportLang || element.dataset.lang)?.trim();
    if (lang) {
      found.add(lang);
    }
  });

  return Array.from(found.size ? found : new Set(['ko']));
}

function getSectionLanguageScope(element: HTMLElement): ReportLanguage | undefined {
  const languageContainer = element.closest<HTMLElement>('[data-report-lang]');
  return languageContainer?.dataset.reportLang?.trim() || undefined;
}

function collectSectionOutlineItems(sectionElement: HTMLElement): ReportSection['outlineItems'] {
  return Array.from(sectionElement.querySelectorAll<HTMLDetailsElement>('details'))
    .map((details, index) => {
      const summary = details.querySelector<HTMLElement>(':scope > summary');
      const visualHost =
        details.querySelector<HTMLElement>('table, svg, canvas, img') ??
        Array.from(details.querySelectorAll<HTMLElement>('[class], [id]')).find(
          (element) => /(?:heatmap|chart|graph)/i.test(`${element.id} ${element.className}`)
        );
      if (!summary || !visualHost) {
        return undefined;
      }
      const label = summary.textContent?.replace(/\s+/g, ' ').trim();
      if (!label) {
        return undefined;
      }
      return {
        id: `outline-${index + 1}`,
        label,
        path: getElementPath(sectionElement, details),
        dynamic: !details.querySelector('table, svg, canvas, img')
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}
export function collectEditableNodes(
  sectionElement: HTMLElement,
  sectionId: string,
  translations: TranslationEntry[]
): EditableNode[] {
  const nodes: EditableNode[] = [];
  const seen = new Set<Element>();
  const diagramElements = Array.from(
    sectionElement.querySelectorAll<Element>(
      '.fig-node, [data-fig-node], .htmlpoint-shape, [data-htmlpoint-shape], .fig-edge, [data-fig-edge], .htmlpoint-connector, [data-htmlpoint-connector]'
    )
  );

  sectionElement.querySelectorAll<HTMLElement>(TEXT_SELECTOR).forEach((element) => {
    if (
      isInsideSvg(element) ||
      isInsideDiagramObject(element) ||
      !isMeaningfulTextElement(element)
    ) {
      return;
    }
    seen.add(element);
    nodes.push(createTextNode(sectionElement, sectionId, element, translations));
  });

  sectionElement.querySelectorAll<HTMLElement>('table').forEach((element) => {
    if (seen.has(element)) {
      return;
    }
    const path = getElementPath(sectionElement, element);
    nodes.push({
      id: nodeIdForElement(sectionId, path, 'table', element),
      sectionId,
      kind: 'table',
      tagName: element.tagName.toLowerCase(),
      label: getNodeLabel(element, 'Table'),
      path,
      text: element.textContent?.trim() ?? '',
      html: element.innerHTML,
      table: snapshotTable(element as HTMLTableElement),
      sourceRef: makeNodeSourceRef(sectionElement, element, 'semantic')
    });
  });

  sectionElement.querySelectorAll<HTMLImageElement>('img').forEach((element) => {
    if (element.dataset.htmlpointImageMosaicSource === 'true') {
      return;
    }
    const path = getElementPath(sectionElement, element);
    const frame = findImageFrame(element, sectionElement);
    nodes.push({
      id: nodeIdForElement(sectionId, path, 'image', element),
      sectionId,
      kind: 'image',
      tagName: 'img',
      label: element.alt || getNodeLabel(element, 'Image'),
      path,
      text: element.alt ?? '',
      html: element.outerHTML,
      image: {
        src: element.currentSrc || element.src || element.getAttribute('src') || '',
        alt: element.alt || '',
        width: element.getAttribute('width') ?? parseStyleSize(element.getAttribute('style'), 'width'),
        height: element.getAttribute('height') ?? parseStyleSize(element.getAttribute('style'), 'height'),
        style: element.getAttribute('style') ?? undefined,
        frameWidth: frame?.getAttribute('width') ?? parseStyleSize(frame?.getAttribute('style') ?? null, 'width'),
        frameHeight: frame?.getAttribute('height') ?? parseStyleSize(frame?.getAttribute('style') ?? null, 'height'),
        frameStyle: frame?.getAttribute('style') ?? undefined,
        hasFrame: Boolean(frame)
      },
      sourceRef: makeNodeSourceRef(sectionElement, element, 'semantic')
    });
  });

  sectionElement.querySelectorAll<HTMLElement>('svg, canvas').forEach((element) => {
    if (
      element.dataset.htmlpointImageArrow === 'true' ||
      isStaticDiagramArtwork(element, sectionElement)
    ) {
      return;
    }
    const path = getElementPath(sectionElement, element);
    const id = nodeIdForElement(sectionId, path, 'chart', element);
    nodes.push({
      id,
      sectionId,
      kind: 'chart',
      tagName: element.tagName.toLowerCase(),
      label: element.getAttribute('aria-label') || getNodeLabel(element, 'Chart'),
      path,
      text: element.textContent?.trim() ?? '',
      html: element.outerHTML,
      chart: snapshotChart(element),
      chartPresentation: snapshotChartPresentation(element, id),
      sourceRef: makeNodeSourceRef(sectionElement, element, 'semantic')
    });
  });

  diagramElements.forEach((element) => {
    if (seen.has(element)) {
      return;
    }
    seen.add(element);
    const path = getElementPath(sectionElement, element);
    const role = element.matches(
      '.fig-edge, [data-fig-edge], .htmlpoint-connector, [data-htmlpoint-connector]'
    ) ? 'edge' : 'node';
    const objectId = readDiagramObjectId(element, `${sectionId}:${role}:${pathKey(path)}`);
    const diagram = snapshotDiagramObject(element, role, objectId);
    nodes.push({
      id: makeDiagramNodeId(sectionId, role, objectId),
      sectionId,
      kind: role === 'edge' ? 'connector' : 'shape',
      tagName: element.tagName.toLowerCase(),
      label: getElementLabel(element, role === 'edge' ? 'Connector' : 'Shape'),
      path,
      text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      html: element instanceof HTMLElement ? element.outerHTML : element.outerHTML,
      sourceRef: makeNodeSourceRef(sectionElement, element, 'fig-canvas', objectId),
      diagram
    });
  });
  return assignLayoutTargetPaths(sectionElement, nodes);
}

const BLOCK_LAYOUT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'figcaption',
  'caption',
  'summary',
  'blockquote'
]);

function elementOrder(root: Element, target: Element): number {
  return Array.from(root.querySelectorAll('*')).indexOf(target);
}

function hasCandidateContent(element: HTMLElement): boolean {
  return Boolean(
    element.hasAttribute('data-htmlpoint-import-candidate') ||
      element.querySelector('h1,h2,h3,h4,h5,h6,p,table,img,svg,canvas,.fig-node')
  );
}

function inferAdapter(element: HTMLElement): Exclude<ImportAdapterKind, 'candidate'> {
  if (element.matches(FIG_CANVAS_SELECTOR)) {
    return 'fig-canvas';
  }
  if (element.matches(EXPLICIT_SLIDE_SELECTOR)) {
    return 'slide';
  }
  return 'semantic';
}

function readStableSectionId(element: HTMLElement): string | undefined {
  const value = element.dataset.htmlpointSourceSectionId?.trim();
  return value || undefined;
}

function nodeIdForElement(
  sectionId: string,
  path: number[],
  kind: string,
  element: Element
): string {
  const stableId = element.getAttribute('data-htmlpoint-object-id')?.trim();
  return stableId || makeNodeId(sectionId, path, kind);
}

function makeNodeSourceRef(
  sectionElement: HTMLElement,
  element: Element,
  adapter: ImportAdapterKind,
  objectId?: string
): SourceRef {
  return {
    adapter,
    domPath: getElementPath(sectionElement, element),
    htmlId: element.id || undefined,
    objectId:
      objectId ?? element.getAttribute('data-htmlpoint-object-id')?.trim() ?? undefined
  };
}

function pathKey(path: number[]): string {
  return path.length ? path.join('.') : 'root';
}

function isInsideDiagramObject(element: Element): boolean {
  return Boolean(
    element.closest(
      '.fig-node, [data-fig-node], .htmlpoint-shape, [data-htmlpoint-shape], .fig-edge, [data-fig-edge], .htmlpoint-connector, [data-htmlpoint-connector]'
    )
  );
}

function isStaticDiagramArtwork(element: Element, sectionElement: HTMLElement): boolean {
  if (!element.closest(FIG_CANVAS_SELECTOR)) {
    return false;
  }
  const hasDeclaredObjects = Boolean(
    sectionElement.querySelector(
      '.fig-node, [data-fig-node], .htmlpoint-shape, [data-htmlpoint-shape], .fig-edge, [data-fig-edge], .htmlpoint-connector, [data-htmlpoint-connector]'
    )
  );
  if (!hasDeclaredObjects) {
    return false;
  }
  return !element.matches('[data-htmlpoint-chart], .chart, .graph, [role="img"][aria-label]');
}

function readDiagramObjectId(element: Element, fallback: string): string {
  return (
    element.getAttribute('data-htmlpoint-object-id')?.trim() ||
    element.getAttribute('data-object-id')?.trim() ||
    element.getAttribute('data-node-id')?.trim() ||
    element.getAttribute('data-edge-id')?.trim() ||
    element.getAttribute('data-id')?.trim() ||
    element.id?.trim() ||
    fallback
  );
}

function makeDiagramNodeId(
  sectionId: string,
  role: DiagramObjectSnapshot['role'],
  objectId: string
): string {
  return `${sectionId}:${role === 'edge' ? 'connector' : 'shape'}:${objectId}`;
}

function readDiagramAttribute(element: Element, names: string[]): string | undefined {
  for (const name of names) {
    const value = element.getAttribute(name)?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function readNumericAttribute(element: Element, names: string[]): number | undefined {
  const value = readDiagramAttribute(element, names);
  if (value === undefined) {
    return undefined;
  }
  const number = Number(value.replace(/px$/i, ''));
  return Number.isFinite(number) ? number : undefined;
}

function snapshotDiagramObject(
  element: Element,
  role: DiagramObjectSnapshot['role'],
  objectId: string
): DiagramObjectSnapshot {
  if (role === 'edge') {
    return {
      role,
      objectId,
      fromObjectId: readDiagramAttribute(element, [
        'data-from',
        'data-from-id',
        'data-source',
        'data-start'
      ]),
      toObjectId: readDiagramAttribute(element, [
        'data-to',
        'data-to-id',
        'data-target',
        'data-end'
      ]),
      startAnchor: readDiagramAttribute(element, ['data-start-anchor', 'data-from-anchor']),
      endAnchor: readDiagramAttribute(element, ['data-end-anchor', 'data-to-anchor'])
    };
  }
  return {
    role,
    objectId,
    x: readNumericAttribute(element, ['data-x', 'x']),
    y: readNumericAttribute(element, ['data-y', 'y']),
    width: readNumericAttribute(element, ['data-width', 'width']),
    height: readNumericAttribute(element, ['data-height', 'height'])
  };
}

function getElementLabel(element: Element, fallback: string): string {
  const label =
    element.getAttribute('aria-label') ||
    element.getAttribute('data-label') ||
    element.textContent?.replace(/\s+/g, ' ').trim();
  return label ? label.slice(0, 80) : fallback;
}

function getCandidateLabel(element: HTMLElement, fallback: string): string {
  const heading = element.querySelector('h1,h2,h3,h4,h5,h6');
  const label = heading?.textContent?.replace(/\s+/g, ' ').trim();
  return label ? label.slice(0, 80) : getNodeLabel(element, fallback);
}

function assignLayoutTargetPaths(
  sectionElement: HTMLElement,
  nodes: EditableNode[]
): EditableNode[] {
  return nodes.map((node) => ({
    ...node,
    layoutTargetPath: resolveLayoutTargetPath(sectionElement, nodes, node)
  }));
}

function resolveLayoutTargetPath(
  sectionElement: HTMLElement,
  nodes: EditableNode[],
  node: EditableNode
): number[] {
  const element = getElementByPath(sectionElement, node.path);
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
    return node.path;
  }

  if (node.kind === 'table' && element instanceof HTMLTableElement) {
    const wrapper = element.parentElement;
    if (
      wrapper &&
      wrapper !== sectionElement &&
      wrapper.matches(
        TABLE_LAYOUT_TARGET_SELECTOR
      )
    ) {
      return getElementPath(sectionElement, wrapper);
    }
    return node.path;
  }

  const containingTable = nodes
    .filter(
      (candidate) =>
        candidate.kind === 'table' &&
        isStrictPathPrefix(candidate.path, node.path)
    )
    .sort((left, right) => right.path.length - left.path.length)[0];
  if (containingTable) {
    return resolveLayoutTargetPath(sectionElement, nodes, containingTable);
  }

  if (node.kind === 'image' && element instanceof HTMLImageElement) {
    const frame = findImageFrame(element, sectionElement);
    return frame ? getElementPath(sectionElement, frame) : node.path;
  }

  if (node.kind === 'text' || node.kind === 'list') {
    if (BLOCK_LAYOUT_TAGS.has(node.tagName)) {
      return node.path;
    }
    const blockAncestor = nodes
      .filter(
        (candidate) =>
          (candidate.kind === 'text' || candidate.kind === 'list') &&
          BLOCK_LAYOUT_TAGS.has(candidate.tagName) &&
          isStrictPathPrefix(candidate.path, node.path)
      )
      .sort((left, right) => right.path.length - left.path.length)[0];
    if (blockAncestor) {
      return blockAncestor.path;
    }
  }

  return node.path;
}

function isStrictPathPrefix(parent: number[], child: number[]): boolean {
  return (
    parent.length < child.length &&
    parent.every((part, index) => child[index] === part)
  );
}

export function readChartPresentation(
  nodeHtml: string,
  sectionHtml: string,
  nodeId: string
): ChartPresentationSettings {
  const nodeDocument = parseHtml(nodeHtml);
  const fallbackChart = nodeDocument.body.firstElementChild;
  const sectionDocument = parseHtml(sectionHtml);
  const sectionRoot = sectionDocument.body.firstElementChild;
  const path = readChartNodePath(nodeId);
  const sectionChart = sectionRoot && path ? getElementByPath(sectionRoot, path) : null;
  const chart =
    sectionChart?.matches('svg,canvas') ? sectionChart : fallbackChart?.matches('svg,canvas') ? fallbackChart : null;

  return chart
    ? snapshotChartPresentation(chart, nodeId, sectionRoot ?? undefined)
    : { caption: undefined, width: undefined, height: undefined, frame: false, align: 'left' };
}

function snapshotChartPresentation(
  chart: Element,
  nodeId: string,
  sectionRoot: Element = chart.parentElement ?? chart
): ChartPresentationSettings {
  const style = (chart as HTMLElement | SVGElement).style;
  const caption = findGeneratedChartCaption(chart, nodeId, sectionRoot);
  return {
    caption: caption?.textContent ?? undefined,
    width: readChartDimension(chart, style, 'width'),
    height: readChartDimension(chart, style, 'height'),
    frame: Boolean(style.border && style.border !== 'none'),
    align: readChartAlignment(style)
  };
}

function readChartDimension(
  chart: Element,
  style: CSSStyleDeclaration,
  dimension: 'width' | 'height'
): number | undefined {
  const styleValue = style.getPropertyValue(dimension).trim();
  const pixelMatch = styleValue.match(/^(\d+(?:\.\d+)?)px$/i);
  if (pixelMatch) {
    const pixelNumber = Number(pixelMatch[1]);
    if (Number.isFinite(pixelNumber) && pixelNumber > 0) {
      return pixelNumber;
    }
  }

  const attributeValue = chart.getAttribute(dimension)?.trim() ?? '';
  const attributeMatch = attributeValue.match(/^(\d+(?:\.\d+)?)(?:px)?$/i);
  if (!attributeMatch) {
    return undefined;
  }
  const attributeNumber = Number(attributeMatch[1]);
  return Number.isFinite(attributeNumber) && attributeNumber > 0
    ? attributeNumber
    : undefined;
}

function readChartAlignment(style: CSSStyleDeclaration): ChartPresentationSettings['align'] {
  const marginLeft = style.marginLeft.trim().toLowerCase();
  const marginRight = style.marginRight.trim().toLowerCase();
  if (marginLeft === 'auto' && marginRight === 'auto') {
    return 'center';
  }
  if (marginLeft === 'auto') {
    return 'right';
  }
  return 'left';
}

function findGeneratedChartCaption(
  chart: Element,
  nodeId: string,
  sectionRoot: Element
): HTMLElement | undefined {
  const adjacent = chart.nextElementSibling;
  if (adjacent instanceof HTMLElement && adjacent.matches('figcaption[data-htmlpoint-chart-caption]')) {
    return adjacent;
  }
  return Array.from(
    sectionRoot.querySelectorAll<HTMLElement>('figcaption[data-htmlpoint-chart-caption]')
  ).find((caption) => caption.dataset.htmlpointChartCaption === nodeId);
}

function readChartNodePath(nodeId: string): number[] | undefined {
  const marker = ':chart:';
  const markerIndex = nodeId.lastIndexOf(marker);
  if (markerIndex === -1) {
    return undefined;
  }
  const suffix = nodeId.slice(markerIndex + marker.length);
  if (suffix === 'root') {
    return [];
  }
  const path = suffix.split('.').map(Number);
  return path.every((part) => Number.isInteger(part) && part >= 0) ? path : undefined;
}

export function snapshotTable(table: HTMLTableElement): { rows: TableCellSnapshot[][] } {
  const rows = Array.from(table.rows).map((row) =>
    Array.from(row.cells).map((cell) => ({
      text: cell.textContent?.trim() ?? '',
      html: cell.innerHTML,
      rowSpan: cell.rowSpan,
      colSpan: cell.colSpan,
      tagName: cell.tagName.toLowerCase() as 'td' | 'th'
    }))
  );

  return { rows };
}

function collectAssets(sections: ReportSection[]): AssetRef[] {
  const assets: AssetRef[] = [];

  sections.forEach((section) => {
    section.editableNodes.forEach((node) => {
      if (node.kind === 'image' && node.image) {
        assets.push({
          id: node.id,
          kind: 'image',
          sectionId: section.id,
          src: node.image.src,
          alt: node.image.alt,
          embedded: node.image.src.startsWith('data:')
        });
      }
      if (node.kind === 'chart') {
        assets.push({
          id: node.id,
          kind: node.tagName === 'canvas' ? 'canvas' : 'svg',
          sectionId: section.id,
          embedded: true
        });
      }
    });
  });

  return assets;
}

function createTextNode(
  sectionElement: HTMLElement,
  sectionId: string,
  element: HTMLElement,
  translations: TranslationEntry[]
): EditableNode {
  const path = getElementPath(sectionElement, element);
  const translation = translations.find((entry) => safeMatches(element, entry.selector));
  const text = element.textContent?.trim() ?? '';

  return {
    id: nodeIdForElement(sectionId, path, 'text', element),
    sectionId,
    kind: element.matches('ul,ol,li') ? 'list' : 'text',
    tagName: element.tagName.toLowerCase(),
    label: getNodeLabel(element, element.tagName.toLowerCase()),
    path,
    text,
    html: element.outerHTML,
    translationSelector: translation?.selector,
    textStyle: snapshotTextStyle(element),
    textEffect: snapshotTextEffect(element),
    sourceRef: makeNodeSourceRef(sectionElement, element, 'semantic'),
    languageTexts: translation
      ? {
          ko: translation.koHtml,
          en: translation.enHtml
        }
      : undefined
  };
}

function snapshotTextEffect(element: HTMLElement): TextEffectSettings | undefined {
  const explicitPreset = element.dataset.htmlpointEffect as TextEffectSettings['preset'] | undefined;
  if (explicitPreset && explicitPreset !== 'none') {
    return mergeInlineEffect(element, explicitPreset);
  }

  const classPreset = getClassBasedTextEffect(element);
  if (classPreset) {
    return classPreset;
  }

  const style = element.style;
  const hasBadgeStyle = Boolean(
    style.backgroundColor ||
      style.background ||
      style.borderRadius ||
      style.border ||
      style.padding ||
      style.display.includes('inline')
  );
  if (!hasBadgeStyle) {
    return undefined;
  }

  const fill = normalizeCssColor(style.backgroundColor || style.background) || undefined;
  const inferredPreset = inferEffectPreset(fill, normalizeCssColor(style.color));
  return mergeInlineEffect(element, inferredPreset);
}

function getClassBasedTextEffect(element: HTMLElement): TextEffectSettings | undefined {
  const classes = Array.from(element.classList).map((className) => className.toLowerCase());
  const has = (className: string) => classes.includes(className);

  if (has('pill') && has('warn')) {
    return effectPresets.warning;
  }
  if (has('pill') && has('bad')) {
    return effectPresets.danger;
  }
  if (has('pill') && has('good')) {
    return effectPresets.success;
  }
  if (has('raw-bad') || has('bsc-bad') || has('danger') || has('risk')) {
    return effectPresets.danger;
  }
  if (has('ok') || has('good') || has('success')) {
    return effectPresets.success;
  }
  if (has('warn') || has('warning')) {
    return effectPresets.warning;
  }
  if (has('badge') || has('pill')) {
    return effectPresets.neutral;
  }

  return undefined;
}

function mergeInlineEffect(
  element: HTMLElement,
  preset: TextEffectSettings['preset']
): TextEffectSettings {
  const defaults = effectPresets[preset] ?? effectPresets.neutral;
  const style = element.style;
  return {
    preset,
    fill: normalizeCssColor(style.backgroundColor || style.background) || defaults.fill,
    textColor: normalizeCssColor(style.color) || defaults.textColor,
    borderColor: normalizeCssColor(style.borderColor) || readBorderColor(style.border) || defaults.borderColor,
    radius: readRadius(style.borderRadius) ?? defaults.radius,
    bold:
      element.tagName.toLowerCase() === 'strong' ||
      style.fontWeight === 'bold' ||
      Number(style.fontWeight) >= 600 ||
      defaults.bold
  };
}

function snapshotTextStyle(element: HTMLElement): {
  fontFamily?: string;
  fontSize?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
} {
  const style = element.style;
  const tagName = element.tagName.toLowerCase();
  return {
    fontFamily: style.fontFamily || undefined,
    fontSize: style.fontSize || undefined,
    bold:
      tagName === 'strong' ||
      tagName === 'b' ||
      style.fontWeight === 'bold' ||
      Number(style.fontWeight) >= 600 ||
      undefined,
    italic: tagName === 'em' || tagName === 'i' || style.fontStyle === 'italic' || undefined,
    underline: style.textDecoration.includes('underline') || undefined,
    color: style.color || undefined
  };
}
function getSectionKind(
  element: HTMLElement,
  adapter: ImportAdapterKind = inferAdapter(element)
): ReportSectionKind {
  if (adapter === 'fig-canvas') {
    return 'canvas';
  }
  if (adapter === 'slide' && !element.matches('header, section')) {
    return 'slide';
  }
  if (adapter === 'candidate') {
    return 'generic';
  }
  if (element.tagName.toLowerCase() === 'header') {
    return 'header';
  }
  if (element.tagName.toLowerCase() === 'section') {
    return 'section';
  }
  return 'generic';
}

function getSectionTitle(element: HTMLElement, index: number): string {
  const heading = element.querySelector('h1,h2,h3');
  const text = heading?.textContent?.replace(/\s+/g, ' ').trim();
  if (text) {
    return text.slice(0, 90);
  }
  const fallback = element.textContent?.replace(/\s+/g, ' ').trim();
  return fallback ? fallback.slice(0, 90) : `Section ${index + 1}`;
}

function getTextPreview(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 260);
}

function getNodeLabel(element: HTMLElement, fallback: string): string {
  const label =
    element.getAttribute('aria-label') ||
    element.getAttribute('alt') ||
    element.textContent?.replace(/\s+/g, ' ').trim();
  return label ? label.slice(0, 80) : fallback;
}

function isMeaningfulTextElement(element: HTMLElement): boolean {
  const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (!text) {
    return false;
  }
  if (element.closest('script,style,svg')) {
    return false;
  }
  if (element.matches('span,strong,em,code') && element.children.length > 0) {
    return false;
  }
  return true;
}

function isInsideSvg(element: HTMLElement): boolean {
  return Boolean(element.closest('svg'));
}

function safeQuerySelector(root: ParentNode, selector: string): Element | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

function safeMatches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function dedupeTranslations(entries: TranslationEntry[]): TranslationEntry[] {
  const bySelector = new Map<string, TranslationEntry>();
  entries.forEach((entry) => bySelector.set(entry.selector, entry));
  return Array.from(bySelector.values());
}

function unescapeScriptString(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function parseStyleSize(style: string | null, property: 'width' | 'height'): string | undefined {
  const match = style?.match(new RegExp(`${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, 'i'));
  return match ? match[1] : undefined;
}

function readRadius(value: string): number | undefined {
  const match = value.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function readBorderColor(value: string): string | undefined {
  const hex = value.match(/#[0-9a-f]{3,8}/i)?.[0];
  if (hex) {
    return normalizeCssColor(hex);
  }
  const rgb = value.match(/rgba?\([^)]+\)/i)?.[0];
  return rgb ? normalizeCssColor(rgb) : undefined;
}

function normalizeCssColor(value: string | undefined): string | undefined {
  const color = value?.trim();
  if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') {
    return undefined;
  }
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return color.toLowerCase();
  }
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const [, r, g, b] = color.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i) ?? [];
    return r && g && b ? `#${r}${r}${g}${g}${b}${b}`.toLowerCase() : undefined;
  }
  const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map((channel) => Number(channel).toString(16).padStart(2, '0'))
      .join('')}`;
  }
  return undefined;
}

function inferEffectPreset(
  fill: string | undefined,
  textColor: string | undefined
): TextEffectSettings['preset'] {
  const color = `${fill ?? ''} ${textColor ?? ''}`.toLowerCase();
  if (color.includes('fff3') || color.includes('fff4') || color.includes('805600') || color.includes('7a5200')) {
    return 'warning';
  }
  if (color.includes('ffe4') || color.includes('fde7') || color.includes('8f1d16') || color.includes('9f1b1f')) {
    return 'danger';
  }
  if (color.includes('ddf6') || color.includes('e7f6') || color.includes('17633f') || color.includes('276221')) {
    return 'success';
  }
  if (color.includes('e8f2') || color.includes('0f4f86')) {
    return 'info';
  }
  return 'neutral';
}
