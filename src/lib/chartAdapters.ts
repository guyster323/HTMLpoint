import { ChartDataRow, ChartSnapshot } from '../types/htmlpoint';

interface BarBinding {
  rect: SVGRectElement;
  label: string;
  value: number;
  valueText?: SVGTextElement;
  orientation: 'horizontal' | 'vertical';
}

interface PathPoint {
  x: number;
  y: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function snapshotChart(element: HTMLElement): ChartSnapshot {
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'canvas') {
    return {
      kind: 'canvas',
      editable: false,
      rows: [],
      reason: 'Canvas chart data is not safely recoverable from rendered pixels.'
    };
  }
  if (tagName !== 'svg') {
    return {
      kind: 'unknown',
      editable: false,
      rows: [],
      reason: 'Unsupported chart element.'
    };
  }

  const svg = element as unknown as SVGSVGElement;
  const titledBars = collectTitleBarBindings(svg);
  if (titledBars.length) {
    return {
      kind: 'svg-bar',
      editable: true,
      rows: titledBars.map((binding) => ({
        label: binding.label,
        value: binding.value
      })),
      reason: 'SVG bar values were detected from rect title labels.'
    };
  }

  const labeledBars = collectLabelBarBindings(svg);
  if (labeledBars.length) {
    return {
      kind: 'svg-bar-label',
      editable: true,
      rows: labeledBars.map((binding) => ({
        label: binding.label,
        value: binding.value
      })),
      reason: 'SVG bar values were detected from visible numeric labels.'
    };
  }

  const pointRows = collectCircleRows(svg);
  if (pointRows.length >= 2) {
    return {
      kind: 'svg-point',
      editable: true,
      rows: pointRows,
      reason: 'SVG point coordinates were detected from circle marks.'
    };
  }

  const pathRows = collectPathRows(svg);
  if (pathRows.length >= 2) {
    return {
      kind: 'svg-path',
      editable: true,
      rows: pathRows,
      reason: 'SVG line coordinates were detected from path commands.'
    };
  }

  return {
    kind: 'svg-generic',
    editable: false,
    rows: [],
    reason: 'SVG is preserved, but no supported chart data marks were detected.'
  };
}

export function applyChartData(element: SVGElement, rows: ChartDataRow[]): void {
  if (!rows.length) {
    return;
  }

  const svg = element as unknown as SVGSVGElement;
  const titleBindings = collectTitleBarBindings(svg);
  if (titleBindings.length) {
    updateBarBindings(svg, titleBindings, rows);
    return;
  }

  const labelBindings = collectLabelBarBindings(svg);
  if (labelBindings.length) {
    updateBarBindings(svg, labelBindings, rows);
    return;
  }

  const circles = Array.from(svg.querySelectorAll<SVGCircleElement>('circle')).filter(isDataCircle);
  if (circles.length) {
    updateCircleAndPathData(svg, circles, rows);
    return;
  }

  updatePathData(svg, rows);
}

function collectTitleBarBindings(svg: SVGSVGElement): BarBinding[] {
  const rects = dataRects(svg);
  const orientation = detectBarOrientation(rects);
  return rects
    .map((rect): BarBinding | null => {
      const parsed = parseChartTitle(rect.querySelector('title')?.textContent ?? '');
      if (!parsed) {
        return null;
      }
      return {
        rect,
        label: parsed.label,
        value: parsed.value,
        valueText: findValueText(svg, parsed.value, rect, orientation),
        orientation
      };
    })
    .filter((binding): binding is BarBinding => binding !== null);
}

function collectLabelBarBindings(svg: SVGSVGElement): BarBinding[] {
  const rects = dataRects(svg);
  const orientation = detectBarOrientation(rects);
  const usedText = new Set<SVGTextElement>();
  return rects
    .map((rect, index): BarBinding | null => {
      const valueText = findNearestNumericText(svg, rect, orientation, usedText);
      if (!valueText) {
        return null;
      }
      usedText.add(valueText);
      const value = parseNumber(valueText.textContent ?? '');
      if (value === undefined) {
        return null;
      }
      return {
        rect,
        label: findNearestLabelText(svg, rect, orientation) ?? `Bar ${index + 1}`,
        value,
        valueText,
        orientation
      };
    })
    .filter((binding): binding is BarBinding => binding !== null);
}

function updateBarBindings(svg: SVGSVGElement, bindings: BarBinding[], rows: ChartDataRow[]): void {
  const maxValue = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  const maxWidth = Math.max(...bindings.map((binding) => numberAttribute(binding.rect, 'width')), 1);
  const maxHeight = Math.max(...bindings.map((binding) => numberAttribute(binding.rect, 'height')), 1);
  const textElements = Array.from(svg.querySelectorAll<SVGTextElement>('text'));
  const usedText = new Set<SVGTextElement>();

  bindings.forEach((binding, index) => {
    const row = rows[index] ?? binding;
    const value = Number.isFinite(row.value) ? row.value : binding.value;
    const label = row.label || binding.label;
    const rect = binding.rect;

    if (binding.orientation === 'vertical') {
      const originalY = numberAttribute(rect, 'y');
      const originalHeight = numberAttribute(rect, 'height');
      const baseline = originalY + originalHeight;
      const nextHeight = Math.max(0, (Math.abs(value) / maxValue) * maxHeight);
      rect.setAttribute('height', formatNumber(nextHeight));
      rect.setAttribute('y', formatNumber(baseline - nextHeight));
    } else {
      const nextWidth = Math.max(0, (Math.abs(value) / maxValue) * maxWidth);
      rect.setAttribute('width', formatNumber(nextWidth));
    }

    rect.dataset.htmlpointChartLabel = label;
    rect.dataset.htmlpointChartValue = String(value);

    const title = rect.querySelector('title') ?? document.createElementNS(SVG_NS, 'title');
    title.textContent = `${label}: ${formatNumber(value)}`;
    if (!title.parentElement) {
      rect.appendChild(title);
    }

    const valueText =
      binding.valueText && !usedText.has(binding.valueText)
        ? binding.valueText
        : findValueText(svg, binding.value, rect, binding.orientation, textElements, usedText);
    if (valueText) {
      valueText.textContent = formatNumberWithSuffix(value, valueText.textContent ?? '');
      usedText.add(valueText);
    }
  });

  svg.setAttribute('data-htmlpoint-chart-data', JSON.stringify(rows));
}

function updateCircleAndPathData(svg: SVGSVGElement, circles: SVGCircleElement[], rows: ChartDataRow[]): void {
  circles.forEach((circle, index) => {
    const row = rows[index];
    if (!row) {
      return;
    }
    const x = Number.isFinite(row.x) ? Number(row.x) : numberAttribute(circle, 'cx');
    const y = Number.isFinite(row.y) ? Number(row.y) : Number.isFinite(row.value) ? row.value : numberAttribute(circle, 'cy');
    circle.setAttribute('cx', formatNumber(x));
    circle.setAttribute('cy', formatNumber(y));
    circle.dataset.htmlpointChartLabel = row.label || `Point ${index + 1}`;
    circle.dataset.htmlpointChartValue = String(row.value);
  });
  updatePathData(svg, rows);
  svg.setAttribute('data-htmlpoint-chart-data', JSON.stringify(rows));
}

function updatePathData(svg: SVGSVGElement, rows: ChartDataRow[]): void {
  const path = Array.from(svg.querySelectorAll<SVGPathElement>('path')).find((candidate) => {
    const points = parsePathPoints(candidate.getAttribute('d') ?? '');
    return points.length >= 2 && points.length <= rows.length;
  });
  if (!path) {
    return;
  }
  const points = parsePathPoints(path.getAttribute('d') ?? '');
  if (!points.length) {
    return;
  }
  const nextPoints = points.map((point, index) => {
    const row = rows[index];
    return {
      x: Number.isFinite(row?.x) ? Number(row.x) : point.x,
      y: Number.isFinite(row?.y) ? Number(row.y) : Number.isFinite(row?.value) ? row!.value : point.y
    };
  });
  path.setAttribute(
    'd',
    nextPoints
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${formatNumber(point.x)} ${formatNumber(point.y)}`)
      .join(' ')
  );
  svg.setAttribute('data-htmlpoint-chart-data', JSON.stringify(rows));
}

function collectCircleRows(svg: SVGSVGElement): ChartDataRow[] {
  return Array.from(svg.querySelectorAll<SVGCircleElement>('circle'))
    .filter(isDataCircle)
    .map((circle, index) => {
      const x = numberAttribute(circle, 'cx');
      const y = numberAttribute(circle, 'cy');
      return {
        label: circle.querySelector('title')?.textContent?.trim() || `Point ${index + 1}`,
        value: y,
        x,
        y
      };
    });
}

function collectPathRows(svg: SVGSVGElement): ChartDataRow[] {
  const path = Array.from(svg.querySelectorAll<SVGPathElement>('path')).find((candidate) => {
    const points = parsePathPoints(candidate.getAttribute('d') ?? '');
    return points.length >= 2;
  });
  return path
    ? parsePathPoints(path.getAttribute('d') ?? '').map((point, index) => ({
        label: `Point ${index + 1}`,
        value: point.y,
        x: point.x,
        y: point.y
      }))
    : [];
}

function dataRects(svg: SVGSVGElement): SVGRectElement[] {
  const viewBox = parseViewBox(svg.getAttribute('viewBox'));
  return Array.from(svg.querySelectorAll<SVGRectElement>('rect')).filter((rect) => {
    const width = numberAttribute(rect, 'width');
    const height = numberAttribute(rect, 'height');
    if (width <= 0 || height <= 0) {
      return false;
    }
    if (viewBox && width >= viewBox.width * 0.85 && height >= viewBox.height * 0.85) {
      return false;
    }
    if (width <= 16 && height <= 16) {
      return false;
    }
    return true;
  });
}

function isDataCircle(circle: SVGCircleElement): boolean {
  return numberAttribute(circle, 'r') > 0 && numberAttribute(circle, 'cx') !== 0;
}

function detectBarOrientation(rects: SVGRectElement[]): 'horizontal' | 'vertical' {
  if (!rects.length) {
    return 'vertical';
  }
  const widths = rects.map((rect) => numberAttribute(rect, 'width'));
  const heights = rects.map((rect) => numberAttribute(rect, 'height'));
  const widthSpread = spreadRatio(widths);
  const heightSpread = spreadRatio(heights);
  if (widthSpread < 0.25 && heightSpread >= 0.25) {
    return 'vertical';
  }
  if (heightSpread < 0.25 && widthSpread >= 0.25) {
    return 'horizontal';
  }
  const averageWidth = average(widths);
  const averageHeight = average(heights);
  return averageHeight >= averageWidth ? 'vertical' : 'horizontal';
}

function findNearestNumericText(
  svg: SVGSVGElement,
  rect: SVGRectElement,
  orientation: 'horizontal' | 'vertical',
  usedText: Set<SVGTextElement>
): SVGTextElement | undefined {
  const candidates = Array.from(svg.querySelectorAll<SVGTextElement>('text')).filter((text) => {
    if (usedText.has(text) || parseNumber(text.textContent ?? '') === undefined) {
      return false;
    }
    const x = numberAttribute(text, 'x');
    const y = numberAttribute(text, 'y');
    const rectX = numberAttribute(rect, 'x');
    const rectY = numberAttribute(rect, 'y');
    const width = numberAttribute(rect, 'width');
    const height = numberAttribute(rect, 'height');
    const centerX = rectX + width / 2;
    const centerY = rectY + height / 2;
    if (orientation === 'vertical') {
      return Math.abs(x - centerX) <= Math.max(24, width) && y <= rectY + height * 0.35 && y >= rectY - 48;
    }
    return Math.abs(y - centerY) <= Math.max(18, height) && x >= rectX + width - 4;
  });

  return candidates
    .map((text) => ({ text, distance: distanceToRect(text, rect) }))
    .sort((left, right) => left.distance - right.distance)[0]?.text;
}

function findNearestLabelText(
  svg: SVGSVGElement,
  rect: SVGRectElement,
  orientation: 'horizontal' | 'vertical'
): string | undefined {
  const rectX = numberAttribute(rect, 'x');
  const rectY = numberAttribute(rect, 'y');
  const width = numberAttribute(rect, 'width');
  const height = numberAttribute(rect, 'height');
  const centerX = rectX + width / 2;
  const centerY = rectY + height / 2;
  const labels = Array.from(svg.querySelectorAll<SVGTextElement>('text'))
    .filter((text) => parseNumber(text.textContent ?? '') === undefined)
    .map((text) => ({
      text,
      value: text.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      x: numberAttribute(text, 'x'),
      y: numberAttribute(text, 'y')
    }))
    .filter((entry) => entry.value);

  const candidate =
    orientation === 'vertical'
      ? labels
          .filter((entry) => Math.abs(entry.x - centerX) <= Math.max(36, width) && entry.y >= rectY + height)
          .sort((left, right) => Math.abs(left.y - (rectY + height)) - Math.abs(right.y - (rectY + height)))[0]
      : labels
          .filter((entry) => entry.x <= rectX && Math.abs(entry.y - centerY) <= Math.max(20, height))
          .sort((left, right) => Math.abs(left.x - rectX) - Math.abs(right.x - rectX))[0];
  return candidate?.value;
}

function findValueText(
  svg: SVGSVGElement,
  value: number,
  rect: SVGRectElement,
  orientation: 'horizontal' | 'vertical',
  textElements = Array.from(svg.querySelectorAll<SVGTextElement>('text')),
  usedText = new Set<SVGTextElement>()
): SVGTextElement | undefined {
  const formatted = formatNumber(value);
  const exact = textElements.find((textElement) => {
    if (usedText.has(textElement)) {
      return false;
    }
    return new RegExp(`^${escapeRegExp(formatted)}(\\D*)$`).test(textElement.textContent?.trim() ?? '');
  });
  return exact ?? findNearestNumericText(svg, rect, orientation, usedText);
}

function distanceToRect(text: SVGTextElement, rect: SVGRectElement): number {
  const x = numberAttribute(text, 'x');
  const y = numberAttribute(text, 'y');
  const centerX = numberAttribute(rect, 'x') + numberAttribute(rect, 'width') / 2;
  const centerY = numberAttribute(rect, 'y') + numberAttribute(rect, 'height') / 2;
  return Math.hypot(x - centerX, y - centerY);
}

function parseChartTitle(title: string): ChartDataRow | null {
  const normalized = title.replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^(.*):\s*[^-\d]*(-?\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const value = Number(match[2]);
  return Number.isFinite(value) ? { label: match[1].trim(), value } : null;
}

function parsePathPoints(d: string): PathPoint[] {
  const points: PathPoint[] = [];
  const pointPattern = /[ML]\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = pointPattern.exec(d))) {
    points.push({ x: Number(match[1]), y: Number(match[2]) });
  }
  return points;
}

function parseViewBox(viewBox: string | null): { width: number; height: number } | null {
  const parts = viewBox?.trim().split(/\s+/).map(Number);
  if (!parts || parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return { width: parts[2], height: parts[3] };
}

function parseNumber(value: string): number | undefined {
  const normalized = value.replace(/,/g, '').trim();
  if (!/^-?\d+(?:\.\d+)?\s*[\w%()./-]*$/i.test(normalized)) {
    return undefined;
  }
  const match = normalized.match(/^-?\d+(?:\.\d+)?/);
  const number = match ? Number(match[0]) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function numberAttribute(element: Element, attribute: string): number {
  const value = Number(element.getAttribute(attribute));
  return Number.isFinite(value) ? value : 0;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function formatNumberWithSuffix(value: number, previousText: string): string {
  const suffix = previousText.trim().match(/^-?\d+(?:\.\d+)?(\D*)$/)?.[1] ?? '';
  return `${formatNumber(value)}${suffix}`;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function spreadRatio(values: number[]): number {
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  return (max - min) / max;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
