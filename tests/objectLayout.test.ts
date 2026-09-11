import { describe, expect, it } from 'vitest';
import {
  addImageArrowAnnotation,
  applyObjectLayouts,
  applyTextEffect,
  resizeImageFrame
} from '../src/lib/editing';
import { parseHtml, parseReportHtml } from '../src/lib/htmlParser';
import {
  normalizeSemanticLayoutSelection,
  semanticLayoutNodes,
  semanticLayoutSelectionCount
} from '../src/lib/objectLayout';
import type { TextEffectSettings } from '../src/types/htmlpoint';

const warningEffect: TextEffectSettings = {
  preset: 'warning',
  fill: '#fff3c4',
  textColor: '#805600',
  borderColor: '#f2c94c',
  radius: 10,
  bold: true
};

const noEffect: TextEffectSettings = {
  preset: 'none',
  fill: '',
  textColor: '',
  borderColor: '',
  radius: 0,
  bold: false
};

describe('PowerPoint-style object layout edits', () => {
  it('moves and resizes a text object without replacing its authored transform', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><p style="transform:rotate(2deg)">Move me</p></section></main></body></html>'
    );
    const section = report.sections[0];
    const node = section.editableNodes.find((candidate) => candidate.tagName === 'p')!;

    const next = applyObjectLayouts(report, section.id, [{
      nodeId: node.id,
      offsetX: 24,
      offsetY: -5,
      baseTranslateX: 0,
      baseTranslateY: 0,
      width: 300,
      height: 80
    }]);
    const paragraph = parseHtml(next.sections[0].html).querySelector('p')!;

    expect(paragraph.style.transform).toBe('rotate(2deg)');
    expect(paragraph.style.getPropertyValue('translate')).toBe('24px -5px');
    expect(paragraph.style.width).toBe('300px');
    expect(paragraph.style.height).toBe('80px');
    expect(paragraph.dataset.htmlpointLayoutX).toBe('24');
    expect(next.sections[0].editableNodes.find((candidate) => candidate.tagName === 'p')?.id).toBe(node.id);
    expect(next.operations.at(-1)?.type).toBe('layout');
  });

  it('keeps a move-only standalone inline object transformable after persistence', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><span>Move badge</span></section></main></body></html>'
    );
    const section = report.sections[0];
    const node = section.editableNodes.find((candidate) => candidate.tagName === 'span')!;
    const next = applyObjectLayouts(report, section.id, [{
      nodeId: node.id,
      offsetX: 14,
      offsetY: 9,
      baseTranslateX: 0,
      baseTranslateY: 0
    }]);
    const span = parseHtml(next.sections[0].html).querySelector<HTMLElement>('span')!;

    expect(span.style.display).toBe('inline-block');
    expect(span.style.getPropertyValue('translate')).toBe('14px 9px');
  });

  it('restores an authored translate when Reset Position is used', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><p style="translate:12px 4px">Reset me</p></section></main></body></html>'
    );
    const section = report.sections[0];
    const node = section.editableNodes.find((candidate) => candidate.tagName === 'p')!;
    const moved = applyObjectLayouts(report, section.id, [{
      nodeId: node.id,
      offsetX: 20,
      offsetY: 8,
      baseTranslateX: 12,
      baseTranslateY: 4
    }]);
    const resetNode = moved.sections[0].editableNodes.find((candidate) => candidate.tagName === 'p')!;
    const reset = applyObjectLayouts(moved, section.id, [{
      nodeId: resetNode.id,
      resetPosition: true
    }]);
    const paragraph = parseHtml(reset.sections[0].html).querySelector('p')!;

    expect(paragraph.style.getPropertyValue('translate')).toBe('12px 4px');
    expect(paragraph.hasAttribute('data-htmlpoint-layout-x')).toBe(false);
    expect(paragraph.hasAttribute('data-htmlpoint-layout-original-translate')).toBe(false);
  });

  it('maps nested text and table cells to one semantic layout target', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <p>Outer <span>Inner</span></p>
      <table><tbody><tr><td>Cell</td></tr></tbody></table>
    </section></main></body></html>`);
    const section = report.sections[0];
    const span = section.editableNodes.find((candidate) => candidate.tagName === 'span')!;
    const cell = section.editableNodes.find((candidate) => candidate.tagName === 'td')!;
    const next = applyObjectLayouts(report, section.id, [
      { nodeId: span.id, offsetX: 10, offsetY: 11, baseTranslateX: 0, baseTranslateY: 0 },
      { nodeId: cell.id, offsetX: 30, offsetY: 31, baseTranslateX: 0, baseTranslateY: 0, width: 500, height: 900 }
    ]);
    const document = parseHtml(next.sections[0].html);

    expect(document.querySelector('p')?.style.getPropertyValue('translate')).toBe('10px 11px');
    expect(document.querySelector('span')?.style.getPropertyValue('translate')).toBe('');
    expect(document.querySelector('table')?.style.getPropertyValue('translate')).toBe('30px 31px');
    expect(document.querySelector('table')?.style.width).toBe('500px');
    expect(document.querySelector('table')?.style.height).toBe('');
    expect(document.querySelector('td')?.style.getPropertyValue('translate')).toBe('');
    expect(next.operations).toHaveLength(1);
  });

  it('keeps nested block objects independent and maps inline text to the nearest block', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <blockquote><p>Paragraph <strong>Inline</strong></p></blockquote>
    </section></main></body></html>`);
    const nodes = report.sections[0].editableNodes;
    const quote = nodes.find((candidate) => candidate.tagName === 'blockquote')!;
    const paragraph = nodes.find((candidate) => candidate.tagName === 'p')!;
    const strong = nodes.find((candidate) => candidate.tagName === 'strong')!;

    expect(quote.layoutTargetPath).toEqual(quote.path);
    expect(paragraph.layoutTargetPath).toEqual(paragraph.path);
    expect(strong.layoutTargetPath).toEqual(paragraph.path);
  });

  it('canonicalizes an ancestor and descendant selection to the visible owner', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <blockquote><p>Paragraph <strong>Inline</strong></p></blockquote>
    </section></main></body></html>`);
    const nodes = report.sections[0].editableNodes;
    const quote = nodes.find((candidate) => candidate.tagName === 'blockquote')!;
    const paragraph = nodes.find((candidate) => candidate.tagName === 'p')!;
    const strong = nodes.find((candidate) => candidate.tagName === 'strong')!;
    const selection = normalizeSemanticLayoutSelection(
      nodes,
      [paragraph.id, strong.id, quote.id],
      strong.id
    );

    expect(selection).toEqual({ nodeIds: [quote.id], primaryNodeId: quote.id });
  });

  it('maps nested table cells to their nearest table without collapsing the inner table', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <table><tbody><tr><td>Outer <table><tbody><tr><td>Inner</td></tr></tbody></table></td></tr></tbody></table>
    </section></main></body></html>`);
    const nodes = report.sections[0].editableNodes;
    const tables = nodes.filter((candidate) => candidate.kind === 'table');
    const innerTable = tables.find((candidate) => candidate.path.length > tables[0].path.length)!;
    const innerCell = nodes
      .filter((candidate) => candidate.tagName === 'td')
      .find((candidate) => candidate.path.length > innerTable.path.length)!;

    expect(innerTable.layoutTargetPath).toEqual(innerTable.path);
    expect(innerCell.layoutTargetPath).toEqual(innerTable.path);
  });

  it('presents a wrapped table as one semantic Table object instead of cell objects', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <div class="table-wrap"><table><tbody><tr><td>A</td><td>B</td></tr></tbody></table></div>
    </section></main></body></html>`);
    const nodes = report.sections[0].editableNodes;
    const table = nodes.find((candidate) => candidate.kind === 'table')!;
    const cells = nodes.filter((candidate) => candidate.tagName === 'td');
    const semantic = semanticLayoutNodes(nodes);

    expect(semantic.filter((candidate) => candidate.kind === 'table')).toHaveLength(1);
    expect(semantic.some((candidate) => candidate.tagName === 'td')).toBe(false);
    expect(semanticLayoutSelectionCount(nodes, [table.id, ...cells.map((cell) => cell.id)])).toBe(1);
  });

  it('resizes a captioned figure without stretching the image across its caption', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <figure><img src="data:image/png;base64,AA==" alt="Rack"><figcaption>Rack caption</figcaption></figure>
    </section></main></body></html>`);
    const section = report.sections[0];
    const image = section.editableNodes.find((candidate) => candidate.kind === 'image')!;
    const next = applyObjectLayouts(report, section.id, [{
      nodeId: image.id,
      width: 420,
      height: 260
    }]);
    const document = parseHtml(next.sections[0].html);
    const figure = document.querySelector<HTMLElement>('figure')!;
    const resizedImage = figure.querySelector<HTMLImageElement>('img')!;

    expect(figure.style.width).toBe('420px');
    expect(figure.style.height).toBe('260px');
    expect(resizedImage.style.width).toBe('');
    expect(resizedImage.style.height).toBe('');
  });

  it('keeps repeated Frame Size edits from turning a captioned figure into a fill frame', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <figure><img src="data:image/png;base64,AA==" alt="Rack"><figcaption>Rack caption</figcaption></figure>
    </section></main></body></html>`);
    const section = report.sections[0];
    const image = section.editableNodes.find((candidate) => candidate.kind === 'image')!;
    const once = resizeImageFrame(report, section.id, image.id, {
      width: 400,
      height: 240,
      unit: 'px'
    });
    const reparsedImage = once.sections[0].editableNodes.find(
      (candidate) => candidate.kind === 'image'
    )!;
    const twice = resizeImageFrame(once, section.id, reparsedImage.id, {
      width: 420,
      height: 260,
      unit: 'px'
    });
    const figure = parseHtml(twice.sections[0].html).querySelector<HTMLElement>('figure')!;
    const resizedImage = figure.querySelector<HTMLImageElement>('img')!;

    expect(figure.dataset.htmlpointFrame).toBeUndefined();
    expect(figure.style.width).toBe('420px');
    expect(resizedImage.style.width).toBe('');
    expect(resizedImage.style.height).toBe('');
  });

  it('treats a responsive picture with several sources as one resizable image frame', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <picture>
        <source media="(min-width:1200px)" srcset="rack-xl.png">
        <source media="(min-width:900px)" srcset="rack-lg.png">
        <source media="(min-width:600px)" srcset="rack-md.png">
        <source media="(min-width:300px)" srcset="rack-sm.png">
        <img src="rack.png" alt="Rack">
      </picture>
    </section></main></body></html>`);
    const section = report.sections[0];
    const image = section.editableNodes.find((candidate) => candidate.kind === 'image')!;
    const next = applyObjectLayouts(report, section.id, [{
      nodeId: image.id,
      width: 360,
      height: 180
    }]);
    const picture = parseHtml(next.sections[0].html).querySelector<HTMLElement>('picture')!;

    expect(image.layoutTargetPath).not.toEqual(image.path);
    expect(picture.style.display).toBe('inline-block');
    expect(picture.style.width).toBe('360px');
    expect(picture.querySelector('img')?.style.width).toBe('100%');
    expect(picture.querySelector('img')?.style.height).toBe('100%');
  });

  it('keeps persisted layout after a text effect is removed', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><p>Effect then move</p></section></main></body></html>'
    );
    const section = report.sections[0];
    const node = section.editableNodes.find((candidate) => candidate.tagName === 'p')!;
    const effected = applyTextEffect(report, section.id, node.id, warningEffect);
    const effectedNode = effected.sections[0].editableNodes.find((candidate) => candidate.tagName === 'p')!;
    const moved = applyObjectLayouts(effected, section.id, [{
      nodeId: effectedNode.id,
      offsetX: 18,
      offsetY: 7,
      baseTranslateX: 0,
      baseTranslateY: 0,
      width: 260,
      height: 72
    }]);
    const movedNode = moved.sections[0].editableNodes.find((candidate) => candidate.tagName === 'p')!;
    const restored = applyTextEffect(moved, section.id, movedNode.id, noEffect);
    const paragraph = parseHtml(restored.sections[0].html).querySelector('p')!;

    expect(paragraph.style.getPropertyValue('translate')).toBe('18px 7px');
    expect(paragraph.style.width).toBe('260px');
    expect(paragraph.style.height).toBe('72px');
  });

  it('reapplies inline sizing prerequisites after a text effect restores the original style', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><span>Standalone badge</span></section></main></body></html>'
    );
    const section = report.sections[0];
    const node = section.editableNodes.find((candidate) => candidate.tagName === 'span')!;
    const effected = applyTextEffect(report, section.id, node.id, warningEffect);
    const effectedNode = effected.sections[0].editableNodes.find((candidate) => candidate.tagName === 'span')!;
    const resized = applyObjectLayouts(effected, section.id, [{
      nodeId: effectedNode.id,
      width: 180,
      height: 48
    }]);
    const resizedNode = resized.sections[0].editableNodes.find((candidate) => candidate.tagName === 'span')!;
    const restored = applyTextEffect(resized, section.id, resizedNode.id, noEffect);
    const span = parseHtml(restored.sections[0].html).querySelector('span')!;

    expect(span.style.display).toBe('inline-block');
    expect(span.style.maxWidth).toBe('none');
    expect(span.style.maxHeight).toBe('none');
    expect(span.style.width).toBe('180px');
    expect(span.style.height).toBe('48px');
  });

  it('migrates image layout to an annotation host so later Reset Position remains correct', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><img src="data:image/png;base64,AA==" alt="Rack" style="translate:12px 4px"></section></main></body></html>'
    );
    const section = report.sections[0];
    const image = section.editableNodes.find((candidate) => candidate.kind === 'image')!;
    const moved = applyObjectLayouts(report, section.id, [{
      nodeId: image.id,
      offsetX: 32,
      offsetY: 14,
      baseTranslateX: 12,
      baseTranslateY: 4,
      width: 240,
      height: 120
    }]);
    const movedImage = moved.sections[0].editableNodes.find((candidate) => candidate.kind === 'image')!;
    const annotated = addImageArrowAnnotation(moved, section.id, movedImage.id, {
      startX: 10,
      startY: 10,
      endX: 80,
      endY: 70
    });
    const annotatedDocument = parseHtml(annotated.sections[0].html);
    const host = annotatedDocument.querySelector<HTMLElement>('[data-htmlpoint-image-annotation-host="true"]')!;
    const hostedImage = host.querySelector('img')!;

    expect(host.dataset.htmlpointLayoutX).toBe('32');
    expect(host.style.getPropertyValue('translate')).toBe('32px 14px');
    expect(host.style.width).toBe('240px');
    expect(host.style.height).toBe('120px');
    expect(hostedImage.hasAttribute('data-htmlpoint-layout-x')).toBe(false);
    expect(hostedImage.style.getPropertyValue('translate')).toBe('12px 4px');
    expect(hostedImage.style.width).toBe('100%');
    expect(hostedImage.style.height).toBe('100%');

    const reparsedImage = annotated.sections[0].editableNodes.find((candidate) => candidate.kind === 'image')!;
    const reset = applyObjectLayouts(annotated, section.id, [{
      nodeId: reparsedImage.id,
      resetPosition: true
    }]);
    const resetHost = parseHtml(reset.sections[0].html)
      .querySelector<HTMLElement>('[data-htmlpoint-image-annotation-host="true"]')!;
    expect(resetHost.hasAttribute('data-htmlpoint-layout-x')).toBe(false);
    expect(resetHost.style.getPropertyValue('translate')).toBe('');
    expect(resetHost.querySelector('img')?.style.getPropertyValue('translate')).toBe('12px 4px');
  });

  it('rejects non-finite and excessive geometry without dirtying the report', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><p>Safe</p></section></main></body></html>'
    );
    const section = report.sections[0];
    const node = section.editableNodes[0];
    const next = applyObjectLayouts(report, section.id, [
      { nodeId: node.id, offsetX: Number.POSITIVE_INFINITY },
      { nodeId: node.id, width: 100_000 }
    ]);

    expect(next).toBe(report);
    expect(next.dirty).toBe(false);
    expect(next.operations).toHaveLength(0);
  });

  it('rejects a mixed valid and invalid layout batch atomically', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><p>One</p><p>Two</p></section></main></body></html>'
    );
    const section = report.sections[0];
    const [first, second] = section.editableNodes.filter((candidate) => candidate.tagName === 'p');
    const next = applyObjectLayouts(report, section.id, [
      { nodeId: first.id, offsetX: 20, baseTranslateX: 0, baseTranslateY: 0 },
      { nodeId: second.id, height: Number.NaN }
    ]);

    expect(next).toBe(report);
    expect(parseHtml(next.sections[0].html).querySelector('p')?.style.getPropertyValue('translate')).toBe('');
  });

  it('merges duplicate semantic-target patch fields into one atomic edit', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><p>Outer <span>Inner</span></p></section></main></body></html>'
    );
    const section = report.sections[0];
    const paragraph = section.editableNodes.find((candidate) => candidate.tagName === 'p')!;
    const span = section.editableNodes.find((candidate) => candidate.tagName === 'span')!;
    const next = applyObjectLayouts(report, section.id, [
      { nodeId: paragraph.id, offsetX: 15, offsetY: 6, baseTranslateX: 0, baseTranslateY: 0 },
      { nodeId: span.id, width: 320 }
    ]);
    const target = parseHtml(next.sections[0].html).querySelector('p')!;

    expect(target.style.getPropertyValue('translate')).toBe('15px 6px');
    expect(target.style.width).toBe('320px');
    expect(next.operations).toHaveLength(1);
  });
});
