import type PptxGenJS from 'pptxgenjs';
import type {
  RenderSnapshotObject,
  RenderSnapshotPage,
  RenderSnapshotWarning,
  RenderTextRun,
  RenderedDocumentSnapshot,
  TableCellSnapshot
} from '../../types/htmlpoint';

export type PptxExportMode = 'editable' | 'appearance';
export type PptxPageSize = '16:9' | '4:3' | 'A4' | 'source';

export interface PptxExportOptions {
  mode?: PptxExportMode;
  pageSize?: PptxPageSize;
  allowErrors?: boolean;
  assetResolver?: (source: string) => string | undefined | Promise<string | undefined>;
  signal?: AbortSignal;
  onProgress?: (progress: { page: number; total: number; title: string }) => void;
}

export interface PptxExportReport {
  mode: PptxExportMode;
  pageSize: PptxPageSize;
  pageCount: number;
  nativeObjectCount: number;
  pictureFallbackCount: number;
  warnings: RenderSnapshotWarning[];
  errors: RenderSnapshotWarning[];
}

export interface PptxExportResult {
  data: Uint8Array;
  report: PptxExportReport;
}

export class PptxExportError extends Error {
  readonly report: PptxExportReport;

  constructor(report: PptxExportReport) {
    super('PPTX 변환을 완료하지 못했습니다. 변환 결과 보고서의 오류를 먼저 해결해 주세요.');
    this.name = 'PptxExportError';
    this.report = report;
  }
}

export async function exportRenderedDocumentToPptx(
  snapshot: RenderedDocumentSnapshot,
  options: PptxExportOptions = {}
): Promise<PptxExportResult> {
  const mode = options.mode ?? 'editable';
  const pageSize = options.pageSize ?? '16:9';
  const report = createExportReport(snapshot, mode, pageSize);
  if (report.errors.length && !options.allowErrors) {
    throw new PptxExportError(report);
  }

  const { default: PptxGenJSModule } = await import('pptxgenjs');
  const pptx = new PptxGenJSModule();
  configurePresentation(pptx, snapshot, pageSize);
  for (let index = 0; index < snapshot.pages.length; index += 1) {
    throwIfAborted(options.signal);
    const page = snapshot.pages[index];
    const slide = pptx.addSlide();
    await addPageToSlide(slide, page, snapshot.pages[0], mode, options);
    options.onProgress?.({ page: index + 1, total: snapshot.pages.length, title: page.title });
  }

  throwIfAborted(options.signal);
  const output = await pptx.write({ outputType: 'uint8array', compression: true });
  return { data: toUint8Array(output), report };
}

function createExportReport(
  snapshot: RenderedDocumentSnapshot,
  mode: PptxExportMode,
  pageSize: PptxPageSize
): PptxExportReport {
  const warnings = snapshot.warnings;
  return {
    mode,
    pageSize,
    pageCount: snapshot.pages.length,
    nativeObjectCount: snapshot.pages
      .flatMap((page) => page.objects)
      .filter((object) => !object.capabilities.includes('picture-fallback')).length,
    pictureFallbackCount: snapshot.pages
      .flatMap((page) => page.objects)
      .filter((object) => object.capabilities.includes('picture-fallback')).length,
    warnings,
    errors: warnings.filter((item) => item.severity === 'error')
  };
}

function configurePresentation(
  pptx: PptxGenJS,
  snapshot: RenderedDocumentSnapshot,
  pageSize: PptxPageSize
): void {
  const firstPage = snapshot.pages[0];
  const sourceWidth = firstPage?.width || 1280;
  const sourceHeight = firstPage?.height || 720;
  const size = getPageInches(pageSize, sourceWidth, sourceHeight);
  const layoutName = `HTMLPOINT_${pageSize.replace(':', '_').toUpperCase()}`;
  pptx.defineLayout({ name: layoutName, width: size.width, height: size.height });
  pptx.layout = layoutName;
  pptx.author = 'HTMLpoint';
  pptx.company = 'HTMLpoint';
  pptx.subject = 'HTMLpoint rendered document';
  pptx.title = 'HTMLpoint export';
}

async function addPageToSlide(
  slide: PptxGenJS.Slide,
  page: RenderSnapshotPage,
  firstPage: RenderSnapshotPage | undefined,
  mode: PptxExportMode,
  options: PptxExportOptions
): Promise<void> {
  const slideSize = getPageInches(options.pageSize ?? '16:9', firstPage?.width ?? page.width, firstPage?.height ?? page.height);
  const scale = Math.min(slideSize.width / page.width, slideSize.height / page.height);
  const offsetX = (slideSize.width - page.width * scale) / 2;
  const offsetY = (slideSize.height - page.height * scale) / 2;
  slide.background = { color: 'FFFFFF' };

  for (const object of [...page.objects].sort((left, right) => left.paintOrder - right.paintOrder)) {
    throwIfAborted(options.signal);
    const position = toPosition(object, scale, offsetX, offsetY);
    if (mode === 'appearance' && object.capabilities.includes('picture-fallback')) {
      // The snapshot does not contain a browser screenshot. Preserve the object
      // as a picture and retain the fallback warning instead of pretending it is editable.
      await addPictureOrPlaceholder(slide, object, position, options);
      continue;
    }
    await addObject(slide, object, position, scale, options);
  }
}

async function addObject(
  slide: PptxGenJS.Slide,
  object: RenderSnapshotObject,
  position: Position,
  scale: number,
  options: PptxExportOptions
): Promise<void> {
  switch (object.kind) {
    case 'text':
    case 'list':
      slide.addText(toTextRuns(object.textRuns ?? []), {
        ...position,
        margin: 0,
        breakLine: false,
        fit: 'shrink',
        valign: 'middle'
      });
      return;
    case 'table':
      if (object.table?.rows.length) {
        slide.addTable(toTableRows(object.table.rows), {
          ...position,
          border: { type: 'solid', color: 'CBD5E1', pt: 0.5 },
          margin: 0.04,
          fontSize: 9,
          color: '1F2937',
          fill: { color: 'FFFFFF' }
        });
      }
      return;
    case 'shape':
      slide.addShape(
        object.shapeType === 'ellipse' ? slideShape(slide, 'ellipse') : slideShape(slide, 'rect'),
        {
          ...position,
          fill: { color: 'E8F2FF', transparency: 8 },
          line: { color: '0F4F86', pt: 1 }
        }
      );
      if (object.textRuns?.length) {
        slide.addText(toTextRuns(object.textRuns), { ...position, margin: 0.06, fit: 'shrink', valign: 'middle' });
      }
      return;
    case 'connector':
      slide.addShape(slideShape(slide, 'line'), {
        ...position,
        line: { color: '64748B', pt: Math.max(0.5, scale * 1.2), endArrowType: 'triangle' }
      });
      return;
    case 'image':
    case 'chart':
      await addPictureOrPlaceholder(slide, object, position, options);
      return;
    default:
      return;
  }
}

async function addPictureOrPlaceholder(
  slide: PptxGenJS.Slide,
  object: RenderSnapshotObject,
  position: Position,
  options: PptxExportOptions
): Promise<void> {
  const source = object.assetSrc;
  const resolved = source && options.assetResolver ? await options.assetResolver(source) : source;
  const data = resolved && (isDataUrl(resolved) || isSvgMarkup(resolved))
    ? isSvgMarkup(resolved)
      ? svgDataUrl(resolved)
      : resolved
    : undefined;
  if (data) {
    slide.addImage({ data, ...position });
    return;
  }
  slide.addShape(slideShape(slide, 'rect'), {
    ...position,
    fill: { color: 'FEE2E2' },
    line: { color: 'DC2626', pt: 1, dashType: 'dash' }
  });
  slide.addText('이미지 대체\n자산을 찾을 수 없음', {
    ...position,
    margin: 0.05,
    color: '991B1B',
    fontSize: 9,
    align: 'center',
    valign: 'middle',
    fit: 'shrink'
  });
}

function toTextRuns(runs: RenderTextRun[]): PptxGenJS.TextProps[] {
  if (!runs.length) {
    return [{ text: '' }];
  }
  return runs.map((run) => ({
    text: run.text,
    options: {
      bold: run.bold,
      italic: run.italic,
      underline: run.underline ? { color: run.color } : undefined,
      color: normalizeHex(run.color) ?? '1F2937',
      fontFace: run.fontFamily,
      fontSize: run.fontSizePx ? (run.fontSizePx * 72) / 96 : undefined
    }
  }));
}

function toTableRows(rows: TableCellSnapshot[][]): PptxGenJS.TableRow[] {
  return rows.map((row) =>
    row.map((cell) => ({
      text: stripMarkup(cell.text),
      options: {
        colspan: cell.colSpan > 1 ? cell.colSpan : undefined,
        rowspan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
        bold: cell.tagName === 'th',
        fill: { color: cell.tagName === 'th' ? 'E8F2FF' : 'FFFFFF' }
      }
    }))
  );
}

interface Position {
  x: number;
  y: number;
  w: number;
  h: number;
}

function toPosition(
  object: RenderSnapshotObject,
  scale: number,
  offsetX: number,
  offsetY: number
): Position {
  return {
    x: offsetX + object.bounds.x * scale,
    y: offsetY + object.bounds.y * scale,
    w: Math.max(0.01, object.bounds.width * scale),
    h: Math.max(0.01, object.bounds.height * scale)
  };
}

function getPageInches(
  pageSize: PptxPageSize,
  sourceWidth: number,
  sourceHeight: number
): { width: number; height: number } {
  switch (pageSize) {
    case '4:3':
      return { width: 10, height: 7.5 };
    case 'A4':
      return { width: 8.27, height: 11.69 };
    case 'source':
      return { width: sourceWidth / 96, height: sourceHeight / 96 };
    case '16:9':
    default:
      return { width: 13.333, height: 7.5 };
  }
}

function slideShape(slide: PptxGenJS.Slide, shape: 'rect' | 'ellipse' | 'line') {
  if (shape === 'ellipse') {
    return slideShapeType(slide, 'ellipse');
  }
  if (shape === 'line') {
    return slideShapeType(slide, 'line');
  }
  return slideShapeType(slide, 'rect');
}

function slideShapeType(slide: PptxGenJS.Slide, shape: 'rect' | 'ellipse' | 'line') {
  // PptxGenJS exposes ShapeType on the presentation instance in v4.
  const presentation = (slide as unknown as { _pptx?: PptxGenJS })._pptx;
  const shapeType = presentation?.ShapeType;
  return shape === 'ellipse' ? shapeType?.ellipse ?? 'ellipse' : shape === 'line' ? shapeType?.line ?? 'line' : shapeType?.rect ?? 'rect';
}

function isDataUrl(value: string): boolean {
  return /^data:[^,]+,/i.test(value);
}

function isSvgMarkup(value: string): boolean {
  return /^\s*<svg[\s>]/i.test(value);
}

function svgDataUrl(value: string): string {
  const encoded = typeof btoa === 'function'
    ? btoa(unescape(encodeURIComponent(value)))
    : Buffer.from(value, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${encoded}`;
}

function normalizeHex(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  return match?.[1].toUpperCase();
}

function stripMarkup(value: string): string {
  return value.replace(/<[^>]+>/g, '');
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new Error('PPTX 라이브러리가 예상하지 않은 출력 형식을 반환했습니다.');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('PPTX export canceled', 'AbortError');
  }
}
