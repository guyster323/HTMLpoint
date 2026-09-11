import {
  ChartDataRow,
  ChartPresentationSettings,
  EditResult,
  EditOperation,
  ImageFilterSettings,
  ImageResizeSettings,
  ObjectLayoutPatch,
  ReportDocument,
  ReportSection,
  TableSortDirection,
  TextEditOutcome,
  TextEffectSettings,
  TextReplacementOutcome,
  TextStyleSettings,
  TranslationEntry
} from '../types/htmlpoint';
import { applyChartData } from './chartAdapters';
import { getElementByPath, getElementPath, makeNodeId } from './domPaths';
import { parseHtml, parseSectionHtml } from './htmlParser';
import {
  findImageFrame,
  shouldFillImageFrame,
  TABLE_LAYOUT_TARGET_SELECTOR
} from './layoutTargets';
import {
  RUNTIME_TABLE_HOST_ATTRIBUTE,
  RUNTIME_TABLE_SNAPSHOT_ATTRIBUTE,
  sanitizeRuntimeTableHtml,
  setSerializableImportantStyles
} from './runtimeTableSnapshot';
type SectionMutator = (sectionRoot: HTMLElement, node: Element) => boolean | void;

export interface ImageArrowCoordinates {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface ImageMosaicRegion { left: number; top: number; width: number; height: number; }

const EFFECT_ORIGINAL_STYLE_ATTRIBUTE = 'data-htmlpoint-effect-original-style';
const EFFECT_ORIGINAL_STYLE_PRESENT_ATTRIBUTE =
  'data-htmlpoint-effect-original-style-present';
const EFFECT_OWNED_STYLE_PROPERTIES = [
  'display',
  'align-items',
  'width',
  'padding',
  'border',
  'border-radius',
  'background',
  'background-color',
  'color',
  'font-weight',
  'line-height'
] as const;
const LAYOUT_X_ATTRIBUTE = 'data-htmlpoint-layout-x';
const LAYOUT_Y_ATTRIBUTE = 'data-htmlpoint-layout-y';
const LAYOUT_BASE_X_ATTRIBUTE = 'data-htmlpoint-layout-base-x';
const LAYOUT_BASE_Y_ATTRIBUTE = 'data-htmlpoint-layout-base-y';
const LAYOUT_WIDTH_ATTRIBUTE = 'data-htmlpoint-layout-width';
const LAYOUT_HEIGHT_ATTRIBUTE = 'data-htmlpoint-layout-height';
const LAYOUT_ORIGINAL_TRANSLATE_ATTRIBUTE = 'data-htmlpoint-layout-original-translate';
const LAYOUT_ORIGINAL_TRANSLATE_PRESENT_ATTRIBUTE =
  'data-htmlpoint-layout-original-translate-present';
const LAYOUT_ORIGINAL_TRANSLATE_PRIORITY_ATTRIBUTE =
  'data-htmlpoint-layout-original-translate-priority';
const MAX_LAYOUT_OFFSET = 50_000;
const MIN_LAYOUT_SIZE = 16;
const MAX_LAYOUT_SIZE = 20_000;

export function editTextNode(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  text: string,
  language: string = report.activeLanguage
): ReportDocument {
  return editTextNodeWithOutcome(report, sectionId, nodeId, text, language).report;
}

export function editTextNodeWithOutcome(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  text: string,
  language: string = report.activeLanguage
): TextEditOutcome {
  const section = findSection(report, sectionId);
  const node = section?.editableNodes.find((candidate) => candidate.id === nodeId);
  if (!section || !node) {
    return { report };
  }

  if (language === 'en' && node.translationSelector) {
    return { report: updateTranslationText(report, node.translationSelector, text) };
  }

  let replacement: TextReplacementOutcome | undefined;
  const nextReport = mutateNode(report, sectionId, nodeId, (root, element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    replacement = replaceTextPreservingChildren(element, text);
    if (!replacement.ok) {
      return false;
    }
    root.setAttribute('data-htmlpoint-edited', 'true');
  }, `텍스트 수정: ${section.title}`);

  return replacement && !replacement.ok
    ? { report, validation: replacement }
    : { report: nextReport };
}

export function replaceTextPreservingChildren(
  element: HTMLElement,
  text: string
): TextReplacementOutcome {
  const childElements = Array.from(element.children);
  if (!childElements.length) {
    element.textContent = text;
    return { ok: true };
  }

  if ((element.textContent ?? '').trim() === text) {
    return { ok: true };
  }

  const tokenEntries = childElements
    .map((child, childIndex) => ({
      childIndex,
      token: (child.textContent ?? '').trim()
    }))
    .filter((entry) => entry.token.length > 0);
  const matches = findUniqueOrderedTokenMatches(text, tokenEntries.map((entry) => entry.token));
  if (matches.status === 'missing') {
    return {
      ok: false,
      code: 'rich-text-child-token-mismatch',
      message: 'This rich-text edit would change protected child markup. Edit the child object separately.'
    };
  }
  if (matches.status === 'ambiguous') {
    return {
      ok: false,
      code: 'rich-text-child-token-ambiguous',
      message: 'This rich-text edit has an ambiguous child object match. Edit the child object separately.'
    };
  }

  const directTextBySlot = childElements.map(() => '');
  directTextBySlot.push('');
  if (!tokenEntries.length) {
    const existingSlot = findFirstDirectTextSlot(element);
    directTextBySlot[existingSlot] = text;
  } else {
    let cursor = 0;
    tokenEntries.forEach((entry, index) => {
      const match = matches.positions[index];
      directTextBySlot[entry.childIndex] = text.slice(cursor, match);
      cursor = match + entry.token.length;
    });
    directTextBySlot[childElements.length] = text.slice(cursor);
  }

  replaceDirectTextSlots(element, childElements, directTextBySlot);
  return { ok: true };
}

type OrderedTokenMatchResult =
  | { status: 'unique'; positions: number[] }
  | { status: 'missing' }
  | { status: 'ambiguous' };

function findUniqueOrderedTokenMatches(
  text: string,
  tokens: string[]
): OrderedTokenMatchResult {
  const solutions: number[][] = [];
  const search = (tokenIndex: number, minimumIndex: number, positions: number[]): void => {
    if (solutions.length > 1) {
      return;
    }
    if (tokenIndex === tokens.length) {
      solutions.push(positions);
      return;
    }

    const token = tokens[tokenIndex];
    let match = text.indexOf(token, minimumIndex);
    while (match !== -1 && solutions.length <= 1) {
      search(tokenIndex + 1, match + token.length, [...positions, match]);
      match = text.indexOf(token, match + 1);
    }
  };

  search(0, 0, []);
  if (!solutions.length) {
    return { status: 'missing' };
  }
  if (solutions.length > 1) {
    return { status: 'ambiguous' };
  }
  return { status: 'unique', positions: solutions[0] };
}

function findFirstDirectTextSlot(element: HTMLElement): number {
  let slot = 0;
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      slot += 1;
    } else if (node.nodeType === Node.TEXT_NODE) {
      return slot;
    }
  }
  return slot;
}

function replaceDirectTextSlots(
  element: HTMLElement,
  childElements: Element[],
  directTextBySlot: string[]
): void {
  const textNodesBySlot = directTextBySlot.map(() => [] as Text[]);
  let slot = 0;
  Array.from(element.childNodes).forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      slot += 1;
    } else if (node.nodeType === Node.TEXT_NODE) {
      textNodesBySlot[slot].push(node as Text);
    }
  });

  directTextBySlot.forEach((directText, index) => {
    const existing = textNodesBySlot[index];
    if (existing.length) {
      existing[0].data = directText;
      existing.slice(1).forEach((node) => {
        node.data = '';
      });
      return;
    }
    if (!directText) {
      return;
    }

    const textNode = element.ownerDocument.createTextNode(directText);
    const nextChild = childElements[index];
    if (nextChild) {
      element.insertBefore(textNode, nextChild);
    } else {
      element.appendChild(textNode);
    }
  });
}

export function updateTranslationText(
  report: ReportDocument,
  selector: string,
  enHtml: string
): ReportDocument {
  const translations = report.translations.some((entry) => entry.selector === selector)
    ? report.translations.map((entry) =>
        entry.selector === selector ? { ...entry, enHtml } : entry
      )
    : [...report.translations, { selector, koHtml: '', enHtml }];

  return markReportChanged(
    {
      ...report,
      translations
    },
    {
      type: 'translation',
      label: `ENG 텍스트 수정: ${selector}`,
      after: enHtml
    }
  );
}

export function setTableCellText(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  rowIndex: number,
  cellIndex: number,
  text: string
): ReportDocument {
  return mutateTable(report, sectionId, nodeId, (table) => {
    const cell = table.rows.item(rowIndex)?.cells.item(cellIndex);
    if (cell) {
      cell.textContent = text;
    }
  }, '표 셀 수정');
}

export function addTableRow(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  afterRowIndex: number
): ReportDocument {
  return mutateTable(report, sectionId, nodeId, (table) => {
    const sourceRow = table.rows.item(afterRowIndex);
    if (!sourceRow) {
      return false;
    }
    const targetSection =
      sourceRow?.parentElement instanceof HTMLTableSectionElement
        ? sourceRow.parentElement
        : table.tBodies.item(0) || table.createTBody();
    const newRow = sourceRow
      ? (sourceRow.cloneNode(true) as HTMLTableRowElement)
      : table.ownerDocument.createElement('tr');

    Array.from(newRow.cells).forEach((cell) => {
      cell.textContent = '';
      cell.removeAttribute('rowspan');
      cell.removeAttribute('colspan');
    });

    if (!newRow.cells.length) {
      const width = table.rows.item(0)?.cells.length || 1;
      for (let index = 0; index < width; index += 1) {
        newRow.insertCell();
      }
    }

    const localRowIndex = sourceRow
      ? Array.from(targetSection.rows).indexOf(sourceRow)
      : -1;
    const nextRow = targetSection.rows.item(localRowIndex + 1);
    if (nextRow) {
      targetSection.insertBefore(newRow, nextRow);
    } else {
      targetSection.appendChild(newRow);
    }
  }, '표 행 추가');
}

export function deleteTableRow(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  rowIndex: number
): ReportDocument {
  return mutateTable(report, sectionId, nodeId, (table) => {
    const row = table.rows.item(rowIndex);
    const group = row?.parentElement;
    if (
      !(row instanceof HTMLTableRowElement) ||
      !(group instanceof HTMLTableSectionElement) ||
      table.rows.length <= 1
    ) {
      return false;
    }
    const localRowIndex = Array.from(group.rows).indexOf(row);
    const crossesBoundary = Array.from(mapTableSectionCellPositions(group).values()).some(
      ({ rowIndex: start, rowSpan }) =>
        rowSpan > 1 && start <= localRowIndex && localRowIndex < start + rowSpan
    );
    if (localRowIndex < 0 || crossesBoundary) {
      return false;
    }
    row.remove();
  }, '표 행 삭제');
}

export function deleteTableColumn(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  columnIndex: number
): ReportDocument {
  return mutateTable(report, sectionId, nodeId, (table) => {
    const rows = Array.from(table.rows);
    const cellCount = rows[0]?.cells.length;
    if (
      !cellCount ||
      rows.some(
        (row) =>
          row.cells.length !== cellCount ||
          Array.from(row.cells).some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1)
      )
    ) {
      return false;
    }
    const cells = rows.map((row) => row.cells.item(columnIndex));
    if (
      cells.some(
        (cell) =>
          !(cell instanceof HTMLTableCellElement) || cell.colSpan > 1 || cell.rowSpan > 1
      )
    ) {
      return false;
    }
    cells.forEach((cell) => cell!.remove());
  }, '표 열 삭제');
}

export function addTableColumn(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  columnIndex: number
): ReportDocument {
  return mutateTable(report, sectionId, nodeId, (table) => {
    Array.from(table.rows).forEach((row) => {
      const isHeaderRow = row.parentElement?.tagName.toLowerCase() === 'thead';
      const cell = document.createElement(isHeaderRow ? 'th' : 'td');
      const anchor = row.cells.item(columnIndex);
      if (anchor) {
        row.insertBefore(cell, anchor);
      } else {
        row.appendChild(cell);
      }
    });
  }, '표 열 추가');
}

export function sortTableByColumn(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  columnIndex: number,
  direction: TableSortDirection
): ReportDocument {
  return mutateTable(report, sectionId, nodeId, (table) => {
    const body = table.tBodies.item(0);
    if (!body) {
      return;
    }
    const multiplier = direction === 'asc' ? 1 : -1;
    const rows = Array.from(body.rows);
    rows
      .sort((left, right) => {
        const leftText = left.cells.item(columnIndex)?.textContent?.trim() ?? '';
        const rightText = right.cells.item(columnIndex)?.textContent?.trim() ?? '';
        return leftText.localeCompare(rightText, 'ko', { numeric: true }) * multiplier;
      })
      .forEach((row) => body.appendChild(row));
  }, '표 정렬');
}

export function filterTableRows(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  query: string
): ReportDocument {
  const needle = query.trim().toLowerCase();
  return mutateTable(report, sectionId, nodeId, (table) => {
    Array.from(table.tBodies).forEach((body) => {
      Array.from(body.rows).forEach((row) => {
        const matches = !needle || (row.textContent ?? '').toLowerCase().includes(needle);
        row.style.display = matches ? '' : 'none';
        row.toggleAttribute('data-htmlpoint-filtered', !matches);
      });
    });
  }, '표 필터');
}

export function mergeTableCellRight(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  rowIndex: number,
  cellIndex: number
): ReportDocument {
  return mutateTable(report, sectionId, nodeId, (table) => {
    const cell = table.rows.item(rowIndex)?.cells.item(cellIndex);
    const next = cell?.nextElementSibling;
    if (cell instanceof HTMLTableCellElement && next instanceof HTMLTableCellElement) {
      cell.colSpan += next.colSpan || 1;
      next.remove();
    }
  }, '표 셀 병합');
}

export function unmergeTableCell(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  rowIndex: number,
  cellIndex: number
): ReportDocument {
  return mutateTable(report, sectionId, nodeId, (table) => {
    const row = table.rows.item(rowIndex);
    const cell = row?.cells.item(cellIndex);
    const rowGroup = row?.parentElement;
    if (
      !(row instanceof HTMLTableRowElement) ||
      !(cell instanceof HTMLTableCellElement) ||
      !(rowGroup instanceof HTMLTableSectionElement)
    ) {
      return false;
    }

    const rows = Array.from(rowGroup.rows);
    const localRowIndex = rows.indexOf(row);
    const positions = mapTableSectionCellPositions(rowGroup);
    const position = positions.get(cell);
    if (localRowIndex < 0 || !position) {
      return false;
    }

    const rowSpan = getEffectiveRowSpan(cell, localRowIndex, rows.length);
    const colSpan = Math.max(1, cell.colSpan);
    if (rowSpan === 1 && colSpan === 1) {
      return false;
    }

    cell.removeAttribute('rowspan');
    cell.removeAttribute('colspan');

    for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
      const targetRow = rows[localRowIndex + rowOffset];
      if (!targetRow) {
        break;
      }
      const originalCells = Array.from(targetRow.cells).map((candidate) => ({
        cell: candidate,
        columnIndex: positions.get(candidate)?.columnIndex ?? Number.POSITIVE_INFINITY
      }));
      const firstColumnOffset = rowOffset === 0 ? 1 : 0;
      for (let columnOffset = firstColumnOffset; columnOffset < colSpan; columnOffset += 1) {
        const logicalColumn = position.columnIndex + columnOffset;
        const anchor = originalCells.find(
          (candidate) => candidate.columnIndex >= logicalColumn
        )?.cell;
        const newCell = table.ownerDocument.createElement(
          cell.tagName.toLowerCase()
        ) as HTMLTableCellElement;
        targetRow.insertBefore(newCell, anchor ?? null);
      }
    }
  }, '표 셀 병합 해제');
}

interface TableCellPosition {
  rowIndex: number;
  columnIndex: number;
  rowSpan: number;
  colSpan: number;
}

function mapTableSectionCellPositions(
  rowGroup: HTMLTableSectionElement
): Map<HTMLTableCellElement, TableCellPosition> {
  const rows = Array.from(rowGroup.rows);
  const grid = rows.map(() => [] as Array<HTMLTableCellElement | undefined>);
  const positions = new Map<HTMLTableCellElement, TableCellPosition>();

  rows.forEach((row, rowIndex) => {
    let nextColumn = 0;
    Array.from(row.cells).forEach((cell) => {
      const colSpan = Math.max(1, cell.colSpan);
      const columnIndex = findAvailableColumn(grid[rowIndex], nextColumn, colSpan);
      const rowSpan = getEffectiveRowSpan(cell, rowIndex, rows.length);
      positions.set(cell, { rowIndex, columnIndex, rowSpan, colSpan });

      for (let coveredRow = rowIndex; coveredRow < rowIndex + rowSpan; coveredRow += 1) {
        for (
          let coveredColumn = columnIndex;
          coveredColumn < columnIndex + colSpan;
          coveredColumn += 1
        ) {
          grid[coveredRow][coveredColumn] = cell;
        }
      }
      nextColumn = columnIndex + colSpan;
    });
  });

  return positions;
}

function findAvailableColumn(
  occupied: Array<HTMLTableCellElement | undefined>,
  start: number,
  width: number
): number {
  let column = start;
  while (occupied.slice(column, column + width).some(Boolean)) {
    column += 1;
  }
  return column;
}

function getEffectiveRowSpan(
  cell: HTMLTableCellElement,
  rowIndex: number,
  rowCount: number
): number {
  const remainingRows = Math.max(1, rowCount - rowIndex);
  return cell.rowSpan === 0
    ? remainingRows
    : Math.min(Math.max(1, cell.rowSpan), remainingRows);
}

export function styleTableCell(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  rowIndex: number,
  cellIndex: number,
  styles: Partial<CSSStyleDeclaration>
): ReportDocument {
  return mutateTable(report, sectionId, nodeId, (table) => {
    const cell = table.rows.item(rowIndex)?.cells.item(cellIndex);
    if (cell instanceof HTMLElement) {
      Object.entries(styles).forEach(([key, value]) => {
        if (typeof value === 'string') {
          cell.style.setProperty(toKebabCase(key), value);
        }
      });
    }
  }, '표 셀 스타일');
}

export function replaceImageSource(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  src: string,
  alt?: string
): ReportDocument {
  return mutateNode(report, sectionId, nodeId, (_root, element) => {
    if (element instanceof HTMLImageElement) {
      element.src = src;
      element.setAttribute('src', src);
      if (alt !== undefined) {
        element.alt = alt;
      }
    }
  }, '이미지 교체');
}

export function applyImageFilter(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  settings: ImageFilterSettings
): ReportDocument {
  return mutateNode(report, sectionId, nodeId, (_root, element) => {
    if (element instanceof HTMLElement) {
      if (
        element instanceof HTMLImageElement &&
        imageAnnotationHostFor(element) &&
        settings.rotation !== undefined &&
        settings.rotation !== 0
      ) {
        return false;
      }
      const filters = [
        settings.brightness !== undefined ? `brightness(${settings.brightness}%)` : '',
        settings.contrast !== undefined ? `contrast(${settings.contrast}%)` : '',
        settings.blur !== undefined ? `blur(${settings.blur}px)` : ''
      ].filter(Boolean);
      if (settings.rotation !== undefined) {
        element.style.setProperty('--htmlpoint-rotate', `${settings.rotation}deg`);
        setImageTransform(element, settings.rotation);
        element.style.transformOrigin = 'center center';
      }
      if (filters.length) {
        element.style.filter = filters.join(' ');
      }
    }
  }, '이미지 보정');
}

export function cropImage(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  insetPercent: number
): ReportDocument {
  return mutateNode(report, sectionId, nodeId, (_root, element) => {
    if (element instanceof HTMLElement) {
      if (element instanceof HTMLImageElement && imageAnnotationHostFor(element)) {
        return false;
      }
      const inset = Math.max(0, Math.min(45, insetPercent));
      const scale = inset >= 45 ? 10 : 1 / Math.max(0.1, 1 - (inset * 2) / 100);
      element.style.clipPath = `inset(${inset}% ${inset}% ${inset}% ${inset}%)`;
      element.style.objectFit = 'cover';
      element.style.overflow = 'hidden';
      element.style.setProperty('--htmlpoint-crop-scale', scale.toFixed(2));
      setImageTransform(element, readImageRotation(element));
      element.style.transformOrigin = 'center center';
    }
  }, '이미지 크롭');
}

export function resizeImage(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  settings: ImageResizeSettings
): ReportDocument {
  return mutateNode(report, sectionId, nodeId, (_root, element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    if (settings.width && settings.width > 0) {
      element.setAttribute('width', String(Math.round(settings.width)));
      element.style.width = `${Math.round(settings.width)}${settings.unit}`;
      syncPersistedLayoutDimension(element, LAYOUT_WIDTH_ATTRIBUTE, settings.width, settings.unit);
    }
    if (settings.height && settings.height > 0) {
      element.setAttribute('height', String(Math.round(settings.height)));
      element.style.height = `${Math.round(settings.height)}${settings.unit}`;
      syncPersistedLayoutDimension(element, LAYOUT_HEIGHT_ATTRIBUTE, settings.height, settings.unit);
    }
    element.style.maxWidth = settings.unit === '%' ? '100%' : element.style.maxWidth;
    element.style.objectFit = element.style.objectFit || 'contain';
  }, '이미지 크기 수정');
}

export function resizeImageFrame(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  settings: ImageResizeSettings
): ReportDocument {
  return mutateNode(report, sectionId, nodeId, (_root, element) => {
    if (!(element instanceof HTMLImageElement)) {
      return false;
    }
    const frame = findImageFrame(element, _root);
    if (!frame) {
      return false;
    }
    if (settings.width && settings.width > 0) {
      frame.style.width = `${Math.round(settings.width)}${settings.unit}`;
      syncPersistedLayoutDimension(frame, LAYOUT_WIDTH_ATTRIBUTE, settings.width, settings.unit);
    }
    if (settings.height && settings.height > 0) {
      frame.style.height = `${Math.round(settings.height)}${settings.unit}`;
      syncPersistedLayoutDimension(frame, LAYOUT_HEIGHT_ATTRIBUTE, settings.height, settings.unit);
    }
    const image = element;
    const fillFrame = shouldFillImageFrame(frame, image);
    frame.style.boxSizing = 'border-box';
    frame.style.overflow = frame.style.overflow || 'hidden';
    frame.style.maxWidth = settings.unit === '%' ? '100%' : frame.style.maxWidth;
    if (image instanceof HTMLImageElement && fillFrame) {
      image.style.width = '100%';
      image.style.height = '100%';
      image.style.objectFit = image.style.objectFit || 'cover';
      image.style.display = image.style.display || 'block';
    }
  }, '이미지 프레임 크기 수정');
}

/**
 * Applies one completed pointer/keyboard layout gesture as a single report edit.
 * The source DOM structure is deliberately left untouched so path-based node IDs,
 * authored grid/flex layout and report scripts keep working.
 */
export function applyObjectLayouts(
  report: ReportDocument,
  sectionId: string,
  patches: ObjectLayoutPatch[],
  label = '개체 배치 변경'
): ReportDocument {
  const section = findSection(report, sectionId);
  if (!section || !patches.length || patches.length > 256) {
    return report;
  }
  const document = parseHtml(section.html);
  const sectionRoot = document.body.firstElementChild as HTMLElement | null;
  if (!sectionRoot) {
    return report;
  }

  const nodeById = new Map(section.editableNodes.map((node) => [node.id, node] as const));
  const patchByTarget = new Map<
    Element,
    { patch: ObjectLayoutPatch; node: (typeof section.editableNodes)[number]; source: Element }
  >();
  for (const patch of patches) {
    const node = nodeById.get(patch.nodeId);
    if (!node || !isSafeLayoutPatch(patch)) {
      return report;
    }
    const source = getElementByPath(sectionRoot, node.path);
    const target = getElementByPath(
      sectionRoot,
      node.layoutTargetPath?.length ? node.layoutTargetPath : node.path
    );
    if (
      !source ||
      (!(target instanceof HTMLElement) && !(target instanceof SVGElement))
    ) {
      return report;
    }
    const existing = patchByTarget.get(target);
    patchByTarget.set(target, existing
      ? {
          ...existing,
          patch: { ...existing.patch, ...patch, nodeId: existing.patch.nodeId }
        }
      : { patch, node, source });
  }
  if (!patchByTarget.size) {
    return report;
  }

  const before = section.html;
  patchByTarget.forEach(({ patch, node, source }, target) => {
    applyObjectLayoutPatch(
      target as HTMLElement | SVGElement,
      patch,
      node.kind === 'image' && source instanceof HTMLImageElement ? source : undefined
    );
  });
  if (sectionRoot.outerHTML === before) {
    return report;
  }

  const nextSection = parseSectionHtml(
    {
      ...section,
      html: sectionRoot.outerHTML,
      changed: true
    },
    report.translations
  );
  return markReportChanged(
    {
      ...report,
      sections: report.sections.map((candidate) =>
        candidate.id === sectionId ? nextSection : candidate
      )
    },
    {
      type: 'layout',
      label,
      sectionId,
      nodeId: patches[0]?.nodeId,
      before,
      after: nextSection.html
    }
  );
}

function isSafeLayoutPatch(patch: ObjectLayoutPatch): boolean {
  if (!patch || typeof patch.nodeId !== 'string' || patch.nodeId.length > 512) {
    return false;
  }
  const boundedOffset = (value: number | undefined) =>
    value === undefined || (Number.isFinite(value) && Math.abs(value) <= MAX_LAYOUT_OFFSET);
  const boundedSize = (value: number | undefined) =>
    value === undefined ||
    (Number.isFinite(value) && value >= MIN_LAYOUT_SIZE && value <= MAX_LAYOUT_SIZE);
  return (
    boundedOffset(patch.offsetX) &&
    boundedOffset(patch.offsetY) &&
    boundedOffset(patch.baseTranslateX) &&
    boundedOffset(patch.baseTranslateY) &&
    boundedSize(patch.width) &&
    boundedSize(patch.height)
  );
}

function applyObjectLayoutPatch(
  target: HTMLElement | SVGElement,
  patch: ObjectLayoutPatch,
  sourceImage?: HTMLImageElement
): void {
  if (patch.resetPosition) {
    restoreOriginalTranslate(target);
  } else if (patch.offsetX !== undefined || patch.offsetY !== undefined) {
    initializeLayoutTranslation(target, patch);
    if (patch.offsetX !== undefined) {
      target.setAttribute(LAYOUT_X_ATTRIBUTE, formatLayoutNumber(patch.offsetX));
    }
    if (patch.offsetY !== undefined) {
      target.setAttribute(LAYOUT_Y_ATTRIBUTE, formatLayoutNumber(patch.offsetY));
    }
    reapplyPersistedLayoutStyle(target);
  }

  const appliesWidth = patch.width !== undefined;
  const appliesHeight = patch.height !== undefined && !isContentHeightLayoutTarget(target);
  if (patch.width !== undefined) {
    target.setAttribute(LAYOUT_WIDTH_ATTRIBUTE, formatLayoutNumber(patch.width));
  }
  if (patch.height !== undefined && appliesHeight) {
    target.setAttribute(LAYOUT_HEIGHT_ATTRIBUTE, formatLayoutNumber(patch.height));
  }
  if (appliesWidth || appliesHeight) {
    if (isInlineLayoutTarget(target)) {
      target.style.setProperty('display', 'inline-block', 'important');
    }
    target.style.setProperty('max-width', 'none', 'important');
    target.style.setProperty('max-height', 'none', 'important');
    reapplyPersistedLayoutStyle(target);
    synchronizeIntrinsicSize(target, {
      ...patch,
      ...(appliesHeight ? {} : { height: undefined })
    });
    if (
      sourceImage &&
      sourceImage !== target &&
      target instanceof HTMLElement &&
      shouldFillImageFrame(target, sourceImage)
    ) {
      sourceImage.style.setProperty('width', '100%', 'important');
      if (appliesHeight) {
        sourceImage.style.setProperty('height', '100%', 'important');
      }
      sourceImage.style.setProperty('max-width', 'none', 'important');
      sourceImage.style.objectFit = sourceImage.style.objectFit || 'contain';
    }
  }
}

function initializeLayoutTranslation(
  target: HTMLElement | SVGElement,
  patch: ObjectLayoutPatch
): void {
  if (!target.hasAttribute(LAYOUT_ORIGINAL_TRANSLATE_PRESENT_ATTRIBUTE)) {
    const originalTranslate = target.style.getPropertyValue('translate');
    target.setAttribute(
      LAYOUT_ORIGINAL_TRANSLATE_PRESENT_ATTRIBUTE,
      originalTranslate ? 'true' : 'false'
    );
    if (originalTranslate) {
      target.setAttribute(LAYOUT_ORIGINAL_TRANSLATE_ATTRIBUTE, originalTranslate);
      const priority = target.style.getPropertyPriority('translate');
      if (priority) {
        target.setAttribute(LAYOUT_ORIGINAL_TRANSLATE_PRIORITY_ATTRIBUTE, priority);
      }
    }
  }
  if (!target.hasAttribute(LAYOUT_BASE_X_ATTRIBUTE)) {
    target.setAttribute(
      LAYOUT_BASE_X_ATTRIBUTE,
      formatLayoutNumber(patch.baseTranslateX ?? 0)
    );
  }
  if (!target.hasAttribute(LAYOUT_BASE_Y_ATTRIBUTE)) {
    target.setAttribute(
      LAYOUT_BASE_Y_ATTRIBUTE,
      formatLayoutNumber(patch.baseTranslateY ?? 0)
    );
  }
}

function restoreOriginalTranslate(target: HTMLElement | SVGElement): void {
  const hadOriginal = target.getAttribute(LAYOUT_ORIGINAL_TRANSLATE_PRESENT_ATTRIBUTE);
  if (hadOriginal === 'true') {
    target.style.setProperty(
      'translate',
      target.getAttribute(LAYOUT_ORIGINAL_TRANSLATE_ATTRIBUTE) ?? '',
      target.getAttribute(LAYOUT_ORIGINAL_TRANSLATE_PRIORITY_ATTRIBUTE) ?? ''
    );
  } else if (hadOriginal === 'false') {
    target.style.removeProperty('translate');
  }
  [
    LAYOUT_X_ATTRIBUTE,
    LAYOUT_Y_ATTRIBUTE,
    LAYOUT_BASE_X_ATTRIBUTE,
    LAYOUT_BASE_Y_ATTRIBUTE,
    LAYOUT_ORIGINAL_TRANSLATE_ATTRIBUTE,
    LAYOUT_ORIGINAL_TRANSLATE_PRESENT_ATTRIBUTE,
    LAYOUT_ORIGINAL_TRANSLATE_PRIORITY_ATTRIBUTE
  ].forEach((attribute) => target.removeAttribute(attribute));
}

function reapplyPersistedLayoutStyle(target: HTMLElement | SVGElement): void {
  const offsetX = readLayoutNumber(target, LAYOUT_X_ATTRIBUTE);
  const offsetY = readLayoutNumber(target, LAYOUT_Y_ATTRIBUTE);
  if (offsetX !== undefined || offsetY !== undefined) {
    if (isInlineLayoutTarget(target)) {
      target.style.setProperty('display', 'inline-block', 'important');
    }
    const baseX = readLayoutNumber(target, LAYOUT_BASE_X_ATTRIBUTE) ?? 0;
    const baseY = readLayoutNumber(target, LAYOUT_BASE_Y_ATTRIBUTE) ?? 0;
    target.style.setProperty(
      'translate',
      `${formatLayoutNumber(baseX + (offsetX ?? 0))}px ${formatLayoutNumber(baseY + (offsetY ?? 0))}px`,
      'important'
    );
  }
  const width = readLayoutNumber(target, LAYOUT_WIDTH_ATTRIBUTE);
  const height = readLayoutNumber(target, LAYOUT_HEIGHT_ATTRIBUTE);
  if ((width !== undefined || height !== undefined) && isInlineLayoutTarget(target)) {
    target.style.setProperty('display', 'inline-block', 'important');
  }
  if (width !== undefined || height !== undefined) {
    target.style.setProperty('max-width', 'none', 'important');
    target.style.setProperty('max-height', 'none', 'important');
  }
  if (width !== undefined) {
    target.style.setProperty('width', `${formatLayoutNumber(width)}px`, 'important');
  }
  if (height !== undefined && !isContentHeightLayoutTarget(target)) {
    target.style.setProperty('height', `${formatLayoutNumber(height)}px`, 'important');
  }
}

function synchronizeIntrinsicSize(
  target: HTMLElement | SVGElement,
  patch: ObjectLayoutPatch
): void {
  if (target instanceof HTMLCanvasElement) {
    return;
  }
  if (target instanceof HTMLImageElement || target instanceof SVGElement) {
    if (patch.width !== undefined) {
      target.setAttribute('width', String(Math.round(patch.width)));
    }
    if (patch.height !== undefined) {
      target.setAttribute('height', String(Math.round(patch.height)));
    }
  }
}

function readLayoutNumber(
  target: HTMLElement | SVGElement,
  attribute: string
): number | undefined {
  if (!target.hasAttribute(attribute)) {
    return undefined;
  }
  const value = Number(target.getAttribute(attribute));
  return Number.isFinite(value) ? value : undefined;
}

function formatLayoutNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function syncPersistedLayoutDimension(
  target: HTMLElement | SVGElement,
  attribute: string,
  value: number,
  unit: ImageResizeSettings['unit']
): void {
  if (unit === 'px') {
    target.setAttribute(attribute, formatLayoutNumber(value));
  } else {
    target.removeAttribute(attribute);
  }
}

function isInlineLayoutTarget(target: HTMLElement | SVGElement): boolean {
  return ['a', 'span', 'strong', 'em', 'code', 'picture'].includes(target.tagName.toLowerCase());
}

function isContentHeightLayoutTarget(target: HTMLElement | SVGElement): boolean {
  if (target instanceof HTMLTableElement) {
    return true;
  }
  return Boolean(
    target instanceof HTMLElement &&
      target.matches(
        TABLE_LAYOUT_TARGET_SELECTOR
      ) &&
      target.querySelector(':scope > table')
  );
}
export function addImageAnnotation(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  text: string,
  tone: 'note' | 'warning' | 'box' = 'note'
): ReportDocument {
  return mutateNode(report, sectionId, nodeId, (_root, element) => {
    const annotation = document.createElement('div');
    annotation.className = `htmlpoint-annotation htmlpoint-annotation-${tone}`;
    annotation.textContent = text;
    annotation.setAttribute(
      'style',
      'margin:8px 0 0;padding:8px 10px;border:2px solid #1565c0;background:#eef6ff;color:#0f315f;font:13px/1.4 Arial,sans-serif;'
    );
    element.after(annotation);
  }, '이미지 주석 추가');
}

export function addImageArrowAnnotation(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  coordinates: ImageArrowCoordinates
): ReportDocument {
  if (!areValidImageArrowCoordinates(coordinates)) {
    return report;
  }

  return mutateNode(report, sectionId, nodeId, (_root, element) => {
    if (!(element instanceof HTMLImageElement) || !isImageArrowAnnotationSupported(element)) {
      return false;
    }

    const host = imageAnnotationHostFor(element) ?? wrapImageForAnnotations(element);
    host.appendChild(createImageArrowOverlay(element.ownerDocument, coordinates));
  }, '이미지 화살표 주석 추가');
}

export function addImageMosaic(report: ReportDocument, sectionId: string, nodeId: string, region: ImageMosaicRegion): ReportDocument {
  if (!isValidMosaicRegion(region)) return report;
  return mutateNode(report, sectionId, nodeId, (_root, element) => {
    if (!(element instanceof HTMLImageElement) || !isImageArrowAnnotationSupported(element)) return false;
    const host = imageAnnotationHostFor(element) ?? wrapImageForAnnotations(element);
    const mosaic = element.ownerDocument.createElement('span');
    mosaic.dataset.htmlpointImageMosaic = 'true';
    mosaic.setAttribute('style', `position:absolute;left:${region.left}%;top:${region.top}%;width:${region.width}%;height:${region.height}%;overflow:hidden;pointer-events:none;`);
    const copy = element.ownerDocument.createElement('img');
    copy.dataset.htmlpointImageMosaicSource = 'true';
    copy.setAttribute('src', element.getAttribute('src') ?? element.src);
    copy.setAttribute('alt', '');
    copy.setAttribute('aria-hidden', 'true');
    const blockScale = 8;
    copy.setAttribute('style', `position:absolute;max-width:none;width:${100 / region.width / blockScale * 100}%;height:${100 / region.height / blockScale * 100}%;left:-${region.left / region.width * 100}%;top:-${region.top / region.height * 100}%;transform:scale(${blockScale});transform-origin:0 0;image-rendering:pixelated;`);
    mosaic.appendChild(copy);
    const arrow = host.querySelector('[data-htmlpoint-image-arrow="true"]');
    host.insertBefore(mosaic, arrow);
  }, '이미지 모자이크 추가');
}

function isValidMosaicRegion(region: ImageMosaicRegion): boolean {
  const values = [region.left, region.top, region.width, region.height];
  return values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100) &&
    region.width >= 2 && region.height >= 2 && region.left + region.width <= 100 && region.top + region.height <= 100;
}

function areValidImageArrowCoordinates(coordinates: ImageArrowCoordinates): boolean {
  const values = [coordinates.startX, coordinates.startY, coordinates.endX, coordinates.endY];
  if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) {
    return false;
  }
  return Math.hypot(coordinates.endX - coordinates.startX, coordinates.endY - coordinates.startY) >= 1;
}

function isImageArrowAnnotationSupported(image: HTMLImageElement): boolean {
  const host = imageAnnotationHostFor(image);
  const parent = image.parentElement;
  const isBareImage = parent?.tagName.toLowerCase() === 'section' || parent?.tagName.toLowerCase() === 'header';
  const cropped = image.style.clipPath || image.style.getPropertyValue('--htmlpoint-crop-scale').trim();
  return Boolean((isBareImage || host) && !image.style.transform && !cropped);
}

function imageAnnotationHostFor(image: HTMLImageElement): HTMLSpanElement | undefined {
  const parent = image.parentElement;
  return parent instanceof HTMLSpanElement && parent.dataset.htmlpointImageAnnotationHost === 'true'
    ? parent
    : undefined;
}

function wrapImageForAnnotations(image: HTMLImageElement): HTMLSpanElement {
  const host = image.ownerDocument.createElement('span');
  host.className = 'htmlpoint-image-annotation-host';
  host.dataset.htmlpointImageAnnotationHost = 'true';
  host.setAttribute('style', 'position:relative;display:inline-block;vertical-align:top;line-height:0;');
  image.replaceWith(host);
  host.appendChild(image);
  migrateImageLayoutToAnnotationHost(image, host);
  return host;
}

function migrateImageLayoutToAnnotationHost(
  image: HTMLImageElement,
  host: HTMLSpanElement
): void {
  const hasLayoutTranslation = [
    LAYOUT_X_ATTRIBUTE,
    LAYOUT_Y_ATTRIBUTE,
    LAYOUT_BASE_X_ATTRIBUTE,
    LAYOUT_BASE_Y_ATTRIBUTE,
    LAYOUT_ORIGINAL_TRANSLATE_PRESENT_ATTRIBUTE
  ].some((attribute) => image.hasAttribute(attribute));
  const hasLayoutWidth = image.hasAttribute(LAYOUT_WIDTH_ATTRIBUTE);
  const hasLayoutHeight = image.hasAttribute(LAYOUT_HEIGHT_ATTRIBUTE);

  [LAYOUT_WIDTH_ATTRIBUTE, LAYOUT_HEIGHT_ATTRIBUTE].forEach((attribute) => {
    if (image.hasAttribute(attribute)) {
      host.setAttribute(attribute, image.getAttribute(attribute) ?? '');
      image.removeAttribute(attribute);
    }
  });
  if (hasLayoutTranslation) {
    const offsetX = readLayoutNumber(image, LAYOUT_X_ATTRIBUTE) ?? 0;
    const offsetY = readLayoutNumber(image, LAYOUT_Y_ATTRIBUTE) ?? 0;
    restoreOriginalTranslate(image);
    host.setAttribute(LAYOUT_X_ATTRIBUTE, formatLayoutNumber(offsetX));
    host.setAttribute(LAYOUT_Y_ATTRIBUTE, formatLayoutNumber(offsetY));
    host.setAttribute(LAYOUT_BASE_X_ATTRIBUTE, '0');
    host.setAttribute(LAYOUT_BASE_Y_ATTRIBUTE, '0');
    host.setAttribute(LAYOUT_ORIGINAL_TRANSLATE_PRESENT_ATTRIBUTE, 'false');
    host.style.setProperty(
      'translate',
      `${formatLayoutNumber(offsetX)}px ${formatLayoutNumber(offsetY)}px`,
      'important'
    );
  }
  if (hasLayoutWidth || hasLayoutHeight) {
    host.style.boxSizing = 'border-box';
    host.style.maxWidth = 'none';
    host.style.maxHeight = 'none';
    if (hasLayoutWidth) {
      host.style.width = `${host.getAttribute(LAYOUT_WIDTH_ATTRIBUTE)}px`;
      image.style.width = '100%';
      image.style.maxWidth = 'none';
    }
    if (hasLayoutHeight) {
      host.style.height = `${host.getAttribute(LAYOUT_HEIGHT_ATTRIBUTE)}px`;
      image.style.height = '100%';
      image.style.maxHeight = 'none';
    }
    image.style.objectFit = image.style.objectFit || 'contain';
  }
}
function createImageArrowOverlay(document: Document, coordinates: ImageArrowCoordinates): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.dataset.htmlpointImageArrow = 'true';
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Arrow annotation');
  svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;');
  svg.dataset.htmlpointArrowStartX = String(coordinates.startX);
  svg.dataset.htmlpointArrowStartY = String(coordinates.startY);
  svg.dataset.htmlpointArrowEndX = String(coordinates.endX);
  svg.dataset.htmlpointArrowEndY = String(coordinates.endY);

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', String(coordinates.startX));
  line.setAttribute('y1', String(coordinates.startY));
  line.setAttribute('x2', String(coordinates.endX));
  line.setAttribute('y2', String(coordinates.endY));
  line.setAttribute('stroke', '#e53935');
  line.setAttribute('stroke-width', '1.2');
  line.setAttribute('vector-effect', 'non-scaling-stroke');

  const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  head.setAttribute('points', imageArrowHeadPoints(coordinates));
  head.setAttribute('fill', '#e53935');
  head.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(line, head);
  return svg;
}

function imageArrowHeadPoints(coordinates: ImageArrowCoordinates): string {
  const deltaX = coordinates.endX - coordinates.startX;
  const deltaY = coordinates.endY - coordinates.startY;
  const length = Math.hypot(deltaX, deltaY);
  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const baseX = coordinates.endX - unitX * 5;
  const baseY = coordinates.endY - unitY * 5;
  const perpendicularX = -unitY * 2.7;
  const perpendicularY = unitX * 2.7;
  return [
    `${coordinates.endX},${coordinates.endY}`,
    `${baseX + perpendicularX},${baseY + perpendicularY}`,
    `${baseX - perpendicularX},${baseY - perpendicularY}`
  ].join(' ');
}

export function insertTableAfterNode(
  report: ReportDocument,
  sectionId: string,
  nodeId: string | undefined,
  rowCount = 3,
  columnCount = 3
): EditResult {
  return insertSectionObject(
    report,
    sectionId,
    nodeId,
    'table',
    '표 삽입',
    (document) => {
      const table = document.createElement('table');
      table.dataset.htmlpointInserted = 'table';
      table.setAttribute('style', 'width:100%;border-collapse:collapse;margin:12px 0;');
      const tbody = table.createTBody();
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const row = tbody.insertRow();
        for (let cellIndex = 0; cellIndex < columnCount; cellIndex += 1) {
          const cell = row.insertCell();
          cell.textContent = rowIndex === 0 ? `Header ${cellIndex + 1}` : '';
          cell.setAttribute('style', 'border:1px solid #cfd6df;padding:6px 8px;');
        }
      }
      return table;
    }
  );
}

export function insertImageAfterNode(
  report: ReportDocument,
  sectionId: string,
  nodeId: string | undefined,
  src: string,
  alt = 'Inserted image'
): EditResult {
  return insertSectionObject(
    report,
    sectionId,
    nodeId,
    'image',
    '이미지 삽입',
    (document) => {
      const image = document.createElement('img');
      image.dataset.htmlpointInserted = 'image';
      image.src = src;
      image.setAttribute('src', src);
      image.alt = alt;
      image.setAttribute('width', '480');
      image.setAttribute(
        'style',
        'width:480px;height:auto;max-width:100%;object-fit:contain;margin:12px 0;'
      );
      return image;
    }
  );
}

export function applyTextEffect(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  settings: TextEffectSettings
): ReportDocument {
  return mutateNode(report, sectionId, nodeId, (_root, element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }
    if (settings.preset === 'none') {
      removeReportEffectClasses(element);
      element.removeAttribute('data-htmlpoint-effect');
      if (element.hasAttribute(EFFECT_ORIGINAL_STYLE_ATTRIBUTE)) {
        restoreOriginalEffectStyle(element);
      }
      element.removeAttribute(EFFECT_ORIGINAL_STYLE_ATTRIBUTE);
      element.removeAttribute(EFFECT_ORIGINAL_STYLE_PRESENT_ATTRIBUTE);
      reapplyPersistedLayoutStyle(element);
      return;
    }

    if (!element.hasAttribute(EFFECT_ORIGINAL_STYLE_ATTRIBUTE)) {
      const originalStyle = element.getAttribute('style');
      element.setAttribute(EFFECT_ORIGINAL_STYLE_ATTRIBUTE, originalStyle ?? '');
      element.setAttribute(
        EFFECT_ORIGINAL_STYLE_PRESENT_ATTRIBUTE,
        originalStyle === null ? 'false' : 'true'
      );
    }

    removeReportEffectClasses(element);
    restoreOriginalEffectStyle(element);
    element.dataset.htmlpointEffect = settings.preset;
    EFFECT_OWNED_STYLE_PROPERTIES.forEach((property) => element.style.removeProperty(property));
    const baselineStyle = element.getAttribute('style')?.trim().replace(/;?\s*$/, '') ?? '';
    const display = element.tagName.toLowerCase() === 'li' ? '' : 'display: inline-flex; ';
    const effectStyle =
      `${display}align-items: center; width: fit-content; padding: 2px 9px; ` +
      `border: 1px solid ${settings.borderColor}; border-radius: ${settings.radius}px; ` +
      `background-color: ${settings.fill}; color: ${settings.textColor}; ` +
      `font-weight: ${settings.bold ? '700' : '500'}; line-height: 1.35;`;
    element.setAttribute('style', baselineStyle ? `${baselineStyle}; ${effectStyle}` : effectStyle);
    reapplyPersistedLayoutStyle(element);
  }, '텍스트 효과 수정');
}

export function applyTextStyle(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  settings: TextStyleSettings
): ReportDocument {
  return mutateNode(report, sectionId, nodeId, (_root, element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }
    applyTextStyleToElement(element, settings);
  }, '텍스트 스타일 수정');
}

export function applyTextStyleToNodes(
  report: ReportDocument,
  sectionId: string,
  nodeIds: string[],
  settings: TextStyleSettings
): ReportDocument {
  return nodeIds.reduce(
    (current, nodeId) => applyTextStyle(current, sectionId, nodeId, settings),
    report
  );
}

export function updateChartData(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  rows: ChartDataRow[]
): ReportDocument {
  return mutateNode(report, sectionId, nodeId, (_root, element) => {
    if (!(element instanceof SVGElement)) {
      return;
    }
    applyChartData(element, rows);
  }, '차트 데이터 수정');
}

export function updateChartPresentation(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  settings: ChartPresentationSettings
): ReportDocument {
  return mutateNode(report, sectionId, nodeId, (_root, element) => {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
      return;
    }

    const chartElement = element as HTMLElement | SVGElement;
    if (settings.width && settings.width > 0) {
      chartElement.setAttribute('width', String(Math.round(settings.width)));
      (chartElement as HTMLElement).style.width = `${Math.round(settings.width)}px`;
      chartElement.setAttribute(LAYOUT_WIDTH_ATTRIBUTE, formatLayoutNumber(settings.width));
    }
    if (settings.height && settings.height > 0) {
      chartElement.setAttribute('height', String(Math.round(settings.height)));
      (chartElement as HTMLElement).style.height = `${Math.round(settings.height)}px`;
      chartElement.setAttribute(LAYOUT_HEIGHT_ATTRIBUTE, formatLayoutNumber(settings.height));
    }

    const htmlElement = chartElement as HTMLElement;
    htmlElement.style.maxWidth = '100%';
    htmlElement.style.display = 'block';
    htmlElement.style.marginLeft = settings.align === 'center' || settings.align === 'right' ? 'auto' : '0';
    htmlElement.style.marginRight = settings.align === 'center' || settings.align === 'left' ? 'auto' : '0';
    if (settings.frame) {
      htmlElement.style.border = '1px solid #cdd6e3';
      htmlElement.style.borderRadius = '6px';
      htmlElement.style.padding = '8px';
      htmlElement.style.background = '#ffffff';
    } else {
      htmlElement.style.removeProperty('border');
      htmlElement.style.removeProperty('border-radius');
      htmlElement.style.removeProperty('padding');
      htmlElement.style.removeProperty('background');
    }

    const existingCaption = findGeneratedChartCaption(chartElement, nodeId);
    if (existingCaption) {
      existingCaption.dataset.htmlpointChartCaption = nodeId;
    }
    if (settings.caption === undefined) {
      return;
    }

    const nextCaption = settings.caption.trim();
    if (!nextCaption) {
      existingCaption?.remove();
      return;
    }

    const caption = existingCaption ?? document.createElement('figcaption');
    caption.dataset.htmlpointChartCaption = nodeId;
    caption.textContent = nextCaption;
    caption.setAttribute(
      'style',
      'margin:6px 0 0;color:#4f5865;font:12px/1.4 Arial,sans-serif;text-align:center;'
    );
    if (!existingCaption) {
      chartElement.after(caption);
    }
  }, '차트 표시 속성 수정');
}

export function duplicateSection(report: ReportDocument, sectionId: string): ReportDocument {
  const index = report.sections.findIndex((section) => section.id === sectionId);
  if (index === -1) {
    return report;
  }
  const source = report.sections[index];
  const clone: ReportSection = parseSectionHtml(
    {
      ...source,
      id: makeSectionId(report),
      title: `${source.title} Copy`,
      originalIndex: undefined,
      changed: true
    },
    report.translations
  );

  const sections = [...report.sections];
  sections.splice(index + 1, 0, clone);
  return markReportChanged({ ...report, sections }, {
    type: 'section',
    label: `섹션 복제: ${source.title}`,
    sectionId
  });
}

export function deleteSection(report: ReportDocument, sectionId: string): ReportDocument {
  const section = findSection(report, sectionId);
  if (!section || report.sections.length <= 1) {
    return report;
  }
  return markReportChanged(
    {
      ...report,
      sections: report.sections.filter((candidate) => candidate.id !== sectionId)
    },
    {
      type: 'section',
      label: `섹션 삭제: ${section.title}`,
      sectionId
    }
  );
}

export function setSectionHidden(
  report: ReportDocument,
  sectionId: string,
  hidden: boolean
): ReportDocument {
  const section = findSection(report, sectionId);
  if (!section) {
    return report;
  }
  return markReportChanged(
    {
      ...report,
      sections: report.sections.map((candidate) =>
        candidate.id === sectionId ? { ...candidate, hidden, changed: true } : candidate
      )
    },
    {
      type: 'section',
      label: `${hidden ? '섹션 숨김' : '섹션 표시'}: ${section.title}`,
      sectionId
    }
  );
}

export function moveSection(
  report: ReportDocument,
  sectionId: string,
  delta: -1 | 1
): ReportDocument {
  const index = report.sections.findIndex((section) => section.id === sectionId);
  if (index === -1) {
    return report;
  }

  const source = report.sections[index];
  const siblingIndexes = report.sections
    .map((section, candidateIndex) => ({ section, candidateIndex }))
    .filter(
      ({ section }) =>
        section.parentKey === source.parentKey &&
        section.languageScope === source.languageScope
    )
    .map(({ candidateIndex }) => candidateIndex);
  const siblingIndex = siblingIndexes.indexOf(index);
  const nextIndex = siblingIndexes[siblingIndex + delta];
  if (siblingIndex === -1 || nextIndex === undefined) {
    return report;
  }

  const sections = [...report.sections];
  const moved = { ...sections[index], changed: true };
  sections[index] = sections[nextIndex];
  sections[nextIndex] = moved;
  return markReportChanged({ ...report, sections }, {
    type: 'section',
    label: `섹션 순서 변경: ${moved.title}`,
    sectionId
  });
}

export function withActiveLanguage(report: ReportDocument, language: string): ReportDocument {
  return {
    ...report,
    activeLanguage: language,
    updatedAt: Date.now()
  };
}

export function importTabDelimitedTable(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  text: string
): ReportDocument {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((row) => row.split('\t'));

  if (!rows.length) {
    return report;
  }

  return mutateTable(report, sectionId, nodeId, (table) => {
    table.innerHTML = '';
    const tbody = table.createTBody();
    rows.forEach((sourceRow) => {
      const row = tbody.insertRow();
      sourceRow.forEach((value) => {
        const cell = row.insertCell();
        cell.textContent = value;
      });
    });
  }, 'Excel 붙여넣기');
}

function mutateTable(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  mutator: (table: HTMLTableElement) => boolean | void,
  label: string
): ReportDocument {
  return mutateNode(report, sectionId, nodeId, (_root, element) => {
    if (element instanceof HTMLTableElement) {
      return mutator(element);
    }
  }, label);
}

function mutateNode(
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  mutator: SectionMutator,
  label: string
): ReportDocument {
  const section = findSection(report, sectionId);
  const node = section?.editableNodes.find((candidate) => candidate.id === nodeId);
  if (!section || !node) {
    return report;
  }

  const document = parseHtml(section.html);
  const sectionRoot = document.body.firstElementChild as HTMLElement | null;
  if (!sectionRoot) {
    return report;
  }

  const target = getElementByPath(sectionRoot, node.path);
  if (!target) {
    return report;
  }

  const before = section.html;
  if (mutator(sectionRoot, target) === false) {
    return report;
  }

  const nextSection = parseSectionHtml(
    {
      ...section,
      html: sectionRoot.outerHTML,
      changed: true
    },
    report.translations
  );

  return markReportChanged(
    {
      ...report,
      sections: report.sections.map((candidate) =>
        candidate.id === sectionId ? nextSection : candidate
      )
    },
    {
      type: node.kind === 'table' ? 'table' : node.kind === 'image' ? 'image' : node.kind === 'chart' ? 'chart' : 'text',
      label,
      sectionId,
      nodeId,
      before,
      after: nextSection.html
    }
  );
}

function mutateSection(
  report: ReportDocument,
  sectionId: string,
  mutator: (sectionRoot: HTMLElement) => void,
  label: string,
  type: EditOperation['type'] = 'section'
): ReportDocument {
  const section = findSection(report, sectionId);
  if (!section) {
    return report;
  }

  const document = parseHtml(section.html);
  const sectionRoot = document.body.firstElementChild as HTMLElement | null;
  if (!sectionRoot) {
    return report;
  }

  const before = section.html;
  mutator(sectionRoot);

  const nextSection = parseSectionHtml(
    {
      ...section,
      html: sectionRoot.outerHTML,
      changed: true
    },
    report.translations
  );

  return markReportChanged(
    {
      ...report,
      sections: report.sections.map((candidate) =>
        candidate.id === sectionId ? nextSection : candidate
      )
    },
    {
      type,
      label,
      sectionId,
      before,
      after: nextSection.html
    }
  );
}

const INSERTION_TOKEN_ATTRIBUTE = 'data-htmlpoint-insertion-token';
let insertionTokenSequence = 0;

/**
 * Freezes a table created by report runtime JavaScript into an inert, editable
 * snapshot. The original host remains in the document (so its script does not
 * fail) but is hidden; the snapshot is stored as its immediately following
 * sibling.
 */
export function captureRuntimeTable(
  report: ReportDocument,
  sectionId: string,
  hostPath: number[],
  tableHtml: string
): EditResult {
  const section = findSection(report, sectionId);
  if (
    !section ||
    !hostPath.length ||
    hostPath.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    return makeEditResult(report);
  }

  const sectionDocument = parseHtml(section.html);
  const sectionRoot = sectionDocument.body.firstElementChild as HTMLElement | null;
  const host = sectionRoot ? getElementByPath(sectionRoot, hostPath) : null;
  if (
    !sectionRoot ||
    !(host instanceof HTMLElement) ||
    host === sectionRoot ||
    !host.parentElement ||
    !canContainRuntimeTableSnapshot(host.parentElement)
  ) {
    return makeEditResult(report);
  }

  const existingTable = findCapturedRuntimeTable(host);
  if (existingTable) {
    const existingPath = getElementPath(sectionRoot, existingTable);
    const existingNodeId =
      section.editableNodes.find(
        (node) => node.kind === 'table' && pathsEqual(node.path, existingPath)
      )?.id ?? makeNodeId(sectionId, existingPath, 'table');
    return makeEditResult(report, existingNodeId);
  }

  const belongsToDynamicOutline = section.outlineItems?.some(
    (item) =>
      item.dynamic &&
      hostPath.length > item.path.length &&
      item.path.every((part, index) => hostPath[index] === part)
  );
  if (!belongsToDynamicOutline) {
    return makeEditResult(report);
  }

  const sanitizedTable = sanitizeRuntimeTableHtml(tableHtml);
  if (!sanitizedTable) {
    return makeEditResult(report);
  }

  const before = section.html;
  const insertionToken = `htmlpoint-${Date.now()}-${insertionTokenSequence += 1}`;
  const table = sectionDocument.importNode(sanitizedTable, true) as HTMLTableElement;
  table.setAttribute(INSERTION_TOKEN_ATTRIBUTE, insertionToken);

  host.setAttribute(RUNTIME_TABLE_HOST_ATTRIBUTE, 'true');
  host.hidden = true;
  host.setAttribute('aria-hidden', 'true');
  setSerializableImportantStyles(host, [['display', 'none']]);

  const wrapper = sectionDocument.createElement('div');
  wrapper.setAttribute(RUNTIME_TABLE_SNAPSHOT_ATTRIBUTE, 'true');
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', 'Static table snapshot');
  wrapper.style.maxWidth = '100%';
  wrapper.style.overflowX = 'auto';
  setSerializableImportantStyles(wrapper, [
    ['display', 'block'],
    ['visibility', 'visible'],
    ['opacity', '1']
  ]);
  wrapper.appendChild(table);
  host.after(wrapper);

  const details = host.closest('details');
  if (details instanceof HTMLDetailsElement) {
    details.open = true;
  }

  // Normalize once before resolving the table. Browsers can repair malformed
  // table markup and therefore change element paths during serialization.
  const normalizedDocument = parseHtml(sectionRoot.outerHTML);
  const normalizedRoot = normalizedDocument.body.firstElementChild as HTMLElement | null;
  const normalizedTable = normalizedRoot
    ? Array.from(
        normalizedRoot.querySelectorAll<HTMLTableElement>(
          `table[${INSERTION_TOKEN_ATTRIBUTE}]`
        )
      ).find(
        (candidate) => candidate.getAttribute(INSERTION_TOKEN_ATTRIBUTE) === insertionToken
      )
    : undefined;
  if (!normalizedRoot || !normalizedTable) {
    return makeEditResult(report);
  }

  normalizedTable.removeAttribute(INSERTION_TOKEN_ATTRIBUTE);
  const insertedPath = getElementPath(normalizedRoot, normalizedTable);
  const nextSection = parseSectionHtml(
    {
      ...section,
      html: normalizedRoot.outerHTML,
      changed: true
    },
    report.translations
  );
  const insertedNodeId = nextSection.editableNodes.find(
    (node) => node.kind === 'table' && pathsEqual(node.path, insertedPath)
  )?.id;
  if (!insertedNodeId) {
    return makeEditResult(report);
  }

  const updatedReport = markReportChanged(
    {
      ...report,
      sections: report.sections.map((candidate) =>
        candidate.id === sectionId ? nextSection : candidate
      )
    },
    {
      type: 'table',
      label: `동적 표 정적 편집본 생성: ${section.title}`,
      sectionId,
      nodeId: insertedNodeId,
      before,
      after: nextSection.html
    }
  );
  return makeEditResult(updatedReport, insertedNodeId);
}

function findCapturedRuntimeTable(host: HTMLElement): HTMLTableElement | undefined {
  const wrapper = host.nextElementSibling;
  if (
    !(wrapper instanceof HTMLElement) ||
    wrapper.getAttribute(RUNTIME_TABLE_SNAPSHOT_ATTRIBUTE) !== 'true'
  ) {
    return undefined;
  }
  return Array.from(wrapper.children).find(
    (child): child is HTMLTableElement => child instanceof HTMLTableElement
  );
}

function canContainRuntimeTableSnapshot(parent: HTMLElement): boolean {
  return !['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup'].includes(
    parent.tagName.toLowerCase()
  );
}

function pathsEqual(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function insertSectionObject(
  report: ReportDocument,
  sectionId: string,
  nodeId: string | undefined,
  kind: 'table' | 'image',
  label: string,
  createElement: (document: Document) => HTMLElement
): EditResult {
  const section = findSection(report, sectionId);
  if (!section) {
    return makeEditResult(report);
  }

  const document = parseHtml(section.html);
  const sectionRoot = document.body.firstElementChild as HTMLElement | null;
  if (!sectionRoot) {
    return makeEditResult(report);
  }

  const insertionToken = `htmlpoint-${Date.now()}-${insertionTokenSequence += 1}`;
  const element = createElement(document);
  element.setAttribute(INSERTION_TOKEN_ATTRIBUTE, insertionToken);
  insertAfterSelectedNode(sectionRoot, report, sectionId, nodeId, element);

  // Reparse once before resolving the node so browser HTML normalization (for
  // example table foster-parenting) cannot invalidate the insertion identity.
  const normalizedDocument = parseHtml(sectionRoot.outerHTML);
  const normalizedRoot = normalizedDocument.body.firstElementChild as HTMLElement | null;
  const normalizedElement = normalizedRoot
    ? Array.from(normalizedRoot.querySelectorAll<HTMLElement>(`[${INSERTION_TOKEN_ATTRIBUTE}]`)).find(
        (candidate) => candidate.getAttribute(INSERTION_TOKEN_ATTRIBUTE) === insertionToken
      )
    : undefined;
  if (!normalizedRoot || !normalizedElement) {
    return makeEditResult(report);
  }

  normalizedElement.removeAttribute(INSERTION_TOKEN_ATTRIBUTE);
  const insertedPath = getElementPath(normalizedRoot, normalizedElement);
  const nextSection = parseSectionHtml(
    {
      ...section,
      html: normalizedRoot.outerHTML,
      changed: true
    },
    report.translations
  );
  const insertedNodeId = nextSection.editableNodes.find(
    (node) =>
      node.kind === kind &&
      node.path.length === insertedPath.length &&
      node.path.every((part, index) => part === insertedPath[index])
  )?.id;
  const updatedReport = markReportChanged(
    {
      ...report,
      sections: report.sections.map((candidate) =>
        candidate.id === sectionId ? nextSection : candidate
      )
    },
    {
      type: kind,
      label,
      sectionId,
      before: section.html,
      after: nextSection.html
    }
  );

  return makeEditResult(updatedReport, insertedNodeId);
}

function insertAfterSelectedNode(
  sectionRoot: HTMLElement,
  report: ReportDocument,
  sectionId: string,
  nodeId: string | undefined,
  element: HTMLElement
): void {
  const node = findSection(report, sectionId)?.editableNodes.find((candidate) => candidate.id === nodeId);
  const target = node ? getElementByPath(sectionRoot, node.path) : null;
  let structuralAnchor = target;
  while (structuralAnchor?.parentElement && structuralAnchor.parentElement !== sectionRoot) {
    structuralAnchor = structuralAnchor.parentElement;
  }
  if (structuralAnchor?.parentElement === sectionRoot) {
    structuralAnchor.after(element);
  } else {
    sectionRoot.appendChild(element);
  }
}

function makeEditResult(report: ReportDocument, insertedNodeId?: string): EditResult {
  return insertedNodeId ? { report, insertedNodeId } : { report };
}

function applyTextStyleToElement(element: HTMLElement, settings: TextStyleSettings): void {
  if (settings.fontFamily) {
    element.style.fontFamily = settings.fontFamily;
  }
  if (settings.fontSize && settings.fontSize > 0) {
    element.style.fontSize = `${settings.fontSize}px`;
  }
  if (settings.bold !== undefined) {
    element.style.fontWeight = settings.bold ? '700' : '400';
  }
  if (settings.italic !== undefined) {
    element.style.fontStyle = settings.italic ? 'italic' : 'normal';
  }
  if (settings.underline !== undefined) {
    element.style.textDecoration = settings.underline ? 'underline' : 'none';
  }
  if (settings.color) {
    element.style.color = settings.color;
    const style = element.getAttribute('style');
    if (style) {
      element.setAttribute('style', style.replace(/color:\s*[^;]+;?/i, `color: ${settings.color};`));
    }
  }
}
function restoreOriginalEffectStyle(element: HTMLElement): void {
  if (!element.hasAttribute(EFFECT_ORIGINAL_STYLE_ATTRIBUTE)) {
    return;
  }
  if (element.getAttribute(EFFECT_ORIGINAL_STYLE_PRESENT_ATTRIBUTE) === 'false') {
    element.removeAttribute('style');
    return;
  }
  element.setAttribute('style', element.getAttribute(EFFECT_ORIGINAL_STYLE_ATTRIBUTE) ?? '');
}

function removeReportEffectClasses(element: HTMLElement): void {
  const badgeContainer =
    element.classList.contains('pill') || element.classList.contains('badge');
  const effectClasses = badgeContainer
    ? [
        'pill',
        'badge',
        'warn',
        'warning',
        'bad',
        'good',
        'ok',
        'danger',
        'risk',
        'success'
      ]
    : [
        'raw-bad',
        'bsc-bad',
        'warn',
        'warning',
        'good',
        'ok',
        'danger',
        'risk',
        'success'
      ];
  effectClasses.forEach((className) => element.classList.remove(className));
  if (!element.getAttribute('class')?.trim()) {
    element.removeAttribute('class');
  }
}

function markReportChanged(
  report: ReportDocument,
  operation: Omit<EditOperation, 'id' | 'timestamp'>
): ReportDocument {
  return {
    ...report,
    dirty: true,
    updatedAt: Date.now(),
    operations: [
      ...report.operations,
      {
        ...operation,
        id: `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now()
      }
    ]
  };
}

function findSection(report: ReportDocument, sectionId: string): ReportSection | undefined {
  return report.sections.find((section) => section.id === sectionId);
}

function makeSectionId(report: ReportDocument): string {
  let index = report.sections.length + 1;
  let id = `section-${index}`;
  const used = new Set(report.sections.map((section) => section.id));
  while (used.has(id)) {
    index += 1;
    id = `section-${index}`;
  }
  return id;
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function readImageRotation(element: HTMLElement): number {
  const custom = element.style.getPropertyValue('--htmlpoint-rotate').trim();
  const customMatch = custom.match(/(-?\d+(?:\.\d+)?)deg/);
  if (customMatch) {
    return Number(customMatch[1]);
  }
  const transformMatch = element.style.transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
  return transformMatch ? Number(transformMatch[1]) : 0;
}

function setImageTransform(element: HTMLElement, rotation: number): void {
  element.style.transform = `rotate(${rotation}deg) scale(var(--htmlpoint-crop-scale, 1))`;
}

function findGeneratedChartCaption(
  chartElement: HTMLElement | SVGElement,
  nodeId: string
): HTMLElement | undefined {
  const adjacent = chartElement.nextElementSibling;
  if (adjacent instanceof HTMLElement && adjacent.matches('figcaption[data-htmlpoint-chart-caption]')) {
    return adjacent;
  }
  return Array.from(
    chartElement.parentElement?.querySelectorAll<HTMLElement>(
      'figcaption[data-htmlpoint-chart-caption]'
    ) ?? []
  ).find((caption) => caption.dataset.htmlpointChartCaption === nodeId);
}
