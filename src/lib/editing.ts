import {
  ChartDataRow,
  ChartPresentationSettings,
  EditResult,
  EditOperation,
  ImageFilterSettings,
  ImageResizeSettings,
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
import { getElementByPath, getElementPath } from './domPaths';
import { parseHtml, parseSectionHtml } from './htmlParser';

type SectionMutator = (sectionRoot: HTMLElement, node: Element) => boolean | void;

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
    if (
      !rows.length ||
      rows.some(
        (row) =>
          row.cells.length <= 1 ||
          Array.from(row.cells).some((cell) => cell.colSpan > 1 || cell.rowSpan > 1)
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
    }
    if (settings.height && settings.height > 0) {
      element.setAttribute('height', String(Math.round(settings.height)));
      element.style.height = `${Math.round(settings.height)}${settings.unit}`;
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
    if (!(element instanceof HTMLElement)) {
      return;
    }
    const frame = getImageFrameElement(element);
    if (!frame) {
      return;
    }
    if (settings.width && settings.width > 0) {
      frame.style.width = `${Math.round(settings.width)}${settings.unit}`;
    }
    if (settings.height && settings.height > 0) {
      frame.style.height = `${Math.round(settings.height)}${settings.unit}`;
    }
    const image = element instanceof HTMLImageElement ? element : frame.querySelector('img');
    const fillFrame = image instanceof HTMLImageElement && shouldFillImageFrame(frame, image);

    frame.style.boxSizing = 'border-box';
    frame.style.overflow = frame.style.overflow || 'hidden';
    frame.style.maxWidth = settings.unit === '%' ? '100%' : frame.style.maxWidth;
    frame.dataset.htmlpointFrame = 'image';

    if (image instanceof HTMLImageElement && fillFrame) {
      image.style.width = '100%';
      image.style.height = '100%';
      image.style.objectFit = image.style.objectFit || 'cover';
      image.style.display = image.style.display || 'block';
    }
  }, '이미지 프레임 크기 수정');
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
    }
    if (settings.height && settings.height > 0) {
      chartElement.setAttribute('height', String(Math.round(settings.height)));
      (chartElement as HTMLElement).style.height = `${Math.round(settings.height)}px`;
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
  const nextIndex = index + delta;
  if (index === -1 || nextIndex < 0 || nextIndex >= report.sections.length) {
    return report;
  }

  const sections = [...report.sections];
  const [moved] = sections.splice(index, 1);
  sections.splice(nextIndex, 0, { ...moved, changed: true });

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

function getImageFrameElement(element: HTMLElement): HTMLElement | null {
  const parent = element.parentElement;
  if (!parent || parent.tagName.toLowerCase() === 'section' || parent.tagName.toLowerCase() === 'header') {
    return null;
  }
  if (parent.children.length > 3) {
    return null;
  }
  return parent;
}

function shouldFillImageFrame(frame: HTMLElement, image: HTMLImageElement): boolean {
  return (
    frame.classList.contains('action-photo-frame') ||
    frame.dataset.htmlpointFrame === 'image' ||
    image.style.objectFit === 'cover' ||
    image.style.width === '100%' ||
    image.style.height === '100%'
  );
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
