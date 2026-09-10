import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import * as editingModule from '../src/lib/editing';
import {
  applyTextEffect,
  editTextNode,
  updateChartPresentation
} from '../src/lib/editing';
import { parseHtml, parseReportHtml } from '../src/lib/htmlParser';
import { serializeReportHtml } from '../src/lib/htmlSerializer';
import type {
  ChartPresentationSettings,
  EditableNode,
  ReportDocument,
  TextEffectSettings
} from '../src/types/htmlpoint';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

afterEach(() => {
  act(() => {
    mountedRoots.splice(0).forEach(({ container, root }) => {
      root.unmount();
      container.remove();
    });
  });
  document.body.replaceChildren();
  window.htmlpoint = undefined;
});

const warningEffect: TextEffectSettings = {
  preset: 'warning',
  fill: '#fff3c4',
  textColor: '#805600',
  borderColor: '#f2c94c',
  radius: 999,
  bold: true
};

const dangerEffect: TextEffectSettings = {
  preset: 'danger',
  fill: '#ffe4e0',
  textColor: '#8f1d16',
  borderColor: '#f3a5aa',
  radius: 8,
  bold: false
};

const noEffect: TextEffectSettings = {
  preset: 'none',
  fill: '',
  textColor: '',
  borderColor: '',
  radius: 0,
  bold: false
};

function readFirst<T extends Element>(html: string, selector: string): T {
  const element = parseHtml(html).querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing ${selector}`);
  }
  return element;
}

function chartPresentation(node: EditableNode): ChartPresentationSettings {
  return (node as EditableNode & { chartPresentation?: ChartPresentationSettings })
    .chartPresentation ?? {
    caption: '',
    width: 640,
    height: 320,
    frame: false,
    align: 'center'
  };
}

type TextEditOutcome = {
  report: ReportDocument;
  validation?: {
    ok: false;
    code: string;
    message: string;
  };
};

type EditTextNodeWithOutcome = (
  report: ReportDocument,
  sectionId: string,
  nodeId: string,
  text: string,
  language?: string
) => TextEditOutcome;

function getEditTextNodeWithOutcome(): EditTextNodeWithOutcome | undefined {
  const candidate = (
    editingModule as unknown as {
      editTextNodeWithOutcome?: EditTextNodeWithOutcome;
    }
  ).editTextNodeWithOutcome;
  expect(candidate).toBeTypeOf('function');
  return candidate;
}

describe('data preservation', () => {
  it('preserves a nested pill span and changes only the parent direct text', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><li><span class="pill bad">상태</span> 기존 설명</li></section></main></body></html>'
    );
    const section = report.sections[0];
    const parent = section.editableNodes.find((node) => node.html.startsWith('<li'))!;

    const next = editTextNode(report, section.id, parent.id, '상태 새 설명');
    const listItem = readFirst<HTMLLIElement>(next.sections[0].html, 'li');
    const pill = listItem.querySelector('span');

    expect(pill?.outerHTML).toBe('<span class="pill bad">상태</span>');
    expect(listItem.textContent).toBe('상태 새 설명');
    expect(Array.from(listItem.childNodes).at(-1)?.textContent).toBe(' 새 설명');
  });

  it('preserves two child subtrees, attributes, comments, and intervening direct text', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <p>앞 <!--keep--><strong data-code="a">강조</strong> 중간 <a class="report-link" href="#detail" data-track="b">링크</a> 뒤</p>
    </section></main></body></html>`);
    const section = report.sections[0];
    const parent = section.editableNodes.find((node) => node.html.startsWith('<p>'))!;

    const next = editTextNode(report, section.id, parent.id, '새 앞 강조 새 중간 링크 새 뒤');
    const paragraph = readFirst<HTMLParagraphElement>(next.sections[0].html, 'p');

    expect(paragraph.innerHTML).toContain('<!--keep-->');
    expect(paragraph.querySelector('strong')?.outerHTML).toBe(
      '<strong data-code="a">강조</strong>'
    );
    expect(paragraph.querySelector('a')?.outerHTML).toBe(
      '<a class="report-link" href="#detail" data-track="b">링크</a>'
    );
    expect(paragraph.textContent).toBe('새 앞 강조 새 중간 링크 새 뒤');
  });

  it('returns an explicit validation outcome and the exact original report when a child token is missing', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><li><span class="pill bad">상태</span> 기존 설명</li></section></main></body></html>'
    );
    const section = report.sections[0];
    const parent = section.editableNodes.find((node) => node.html.startsWith('<li'))!;
    const editWithOutcome = getEditTextNodeWithOutcome();
    if (!editWithOutcome) {
      return;
    }

    const outcome = editWithOutcome(report, section.id, parent.id, '새 설명');

    expect(outcome.report).toBe(report);
    expect(outcome.report.dirty).toBe(false);
    expect(outcome.report.operations).toHaveLength(0);
    expect(outcome.validation).toEqual(
      expect.objectContaining({
        ok: false,
        code: 'rich-text-child-token-mismatch'
      })
    );
    expect(outcome.validation?.message).toContain('child object');
  });

  it('rejects an ambiguous duplicate child-token mapping without changing the report', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><p><strong>상태</strong> 기존 설명</p></section></main></body></html>'
    );
    const section = report.sections[0];
    const parent = section.editableNodes.find((node) => node.html.startsWith('<p>'))!;
    const editWithOutcome = getEditTextNodeWithOutcome();
    if (!editWithOutcome) {
      return;
    }

    const outcome = editWithOutcome(report, section.id, parent.id, '상태 새 상태 설명');

    expect(outcome.report).toBe(report);
    expect(outcome.validation?.code).toBe('rich-text-child-token-ambiguous');
  });

  it('rejects child tokens that are both present but reversed without changing the report', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><p><strong>first</strong> middle <a href="#second">second</a> tail</p></section></main></body></html>'
    );
    const section = report.sections[0];
    const parent = section.editableNodes.find((node) => node.html.startsWith('<p>'))!;
    const editWithOutcome = getEditTextNodeWithOutcome();
    if (!editWithOutcome) {
      return;
    }

    const outcome = editWithOutcome(report, section.id, parent.id, 'second reversed first');

    expect(outcome.report).toBe(report);
    expect(outcome.report.dirty).toBe(false);
    expect(outcome.report.operations).toHaveLength(0);
    expect(outcome.validation?.code).toBe('rich-text-child-token-mismatch');
  });

  it('surfaces the rich-text validation message from a Properties text apply without creating history', async () => {
    const harness = renderTextEditingApp();
    await harness.openRichReport();
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '.inspector-section textarea'
    );
    const applyText = buttonWithText('Apply Text');
    expect(textarea).toBeTruthy();

    act(() => {
      setTextareaValue(textarea!, '새 설명');
      applyText.click();
    });

    expect(document.querySelector('.message-line')?.textContent).toContain('child object');
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')?.disabled).toBe(
      true
    );
    expect(document.querySelector<HTMLIFrameElement>('iframe')?.srcdoc).toContain(
      '<span class="pill bad">상태</span> 기존 설명'
    );
  });

  it('surfaces the same rich-text validation message from an iframe text edit without creating history', async () => {
    const harness = renderTextEditingApp();
    await harness.openRichReport();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: getPreviewWindow(),
          data: {
            source: 'htmlpoint-preview',
            type: 'htmlpoint-edit-text',
            nodeId: 'section-1:text:0',
            text: '새 설명'
          }
        })
      );
    });

    expect(document.querySelector('.message-line')?.textContent).toContain('child object');
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')?.disabled).toBe(
      true
    );
    expect(document.querySelector<HTMLIFrameElement>('iframe')?.srcdoc).toContain(
      '<span class="pill bad">상태</span> 기존 설명'
    );
  });

  it('applies the latest of two preview text edits batched before a render', async () => {
    const harness = renderTextEditingApp();
    await harness.openRichReport();
    const previewEdit = (text: string) =>
      new MessageEvent('message', {
        source: getPreviewWindow(),
        data: {
          source: 'htmlpoint-preview',
          type: 'htmlpoint-edit-text',
          nodeId: 'section-1:text:0',
          text
        }
      });

    act(() => {
      window.dispatchEvent(previewEdit('상태 첫 설명'));
      window.dispatchEvent(previewEdit('상태 둘째 설명'));
    });

    const previewHtml = document.querySelector<HTMLIFrameElement>('iframe')?.srcdoc;
    expect(previewHtml).toContain('<span class="pill bad">상태</span> 둘째 설명');
    expect(previewHtml).not.toContain('첫 설명');
  });

  it('restores the exact original inline style after applying an effect then None', () => {
    const originalStyle =
      'color:#123456;font-size:22px;font-weight:400;line-height:2;width:75%;';
    let report = parseReportHtml(
      `<!doctype html><html><body><main><section><span class="business-label" style="${originalStyle}">Styled</span></section></main></body></html>`
    );
    const section = report.sections[0];
    const node = section.editableNodes.find((item) => item.text === 'Styled')!;

    report = applyTextEffect(report, section.id, node.id, warningEffect);
    report = applyTextEffect(report, section.id, node.id, noEffect);

    const element = readFirst<HTMLElement>(report.sections[0].html, 'span');
    expect(element.getAttribute('style')).toBe(originalStyle);
    expect(element.className).toBe('business-label');
    expect(element.hasAttribute('data-htmlpoint-effect')).toBe(false);
  });

  it('keeps the first original style when effects are applied twice before None', () => {
    const originalStyle =
      'color:#123456;font-size:22px;font-weight:400;line-height:2;width:75%;';
    let report = parseReportHtml(
      `<!doctype html><html><body><main><section><span style="${originalStyle}">Styled</span></section></main></body></html>`
    );
    const section = report.sections[0];
    const node = section.editableNodes.find((item) => item.text === 'Styled')!;

    report = applyTextEffect(report, section.id, node.id, warningEffect);
    report = applyTextEffect(report, section.id, node.id, dangerEffect);
    report = applyTextEffect(report, section.id, node.id, noEffect);

    const element = readFirst<HTMLElement>(report.sections[0].html, 'span');
    expect(element.getAttribute('style')).toBe(originalStyle);
  });

  it('distinguishes an absent style attribute from an explicitly empty one', () => {
    for (const source of ['<span>Absent</span>', '<span style="">Empty</span>']) {
      let report = parseReportHtml(
        `<!doctype html><html><body><main><section>${source}</section></main></body></html>`
      );
      const section = report.sections[0];
      const node = section.editableNodes.find((item) => item.tagName === 'span')!;
      const originallyPresent = readFirst<HTMLElement>(section.html, 'span').hasAttribute('style');

      report = applyTextEffect(report, section.id, node.id, warningEffect);
      report = applyTextEffect(report, section.id, node.id, noEffect);

      const restored = readFirst<HTMLElement>(report.sections[0].html, 'span');
      expect(restored.hasAttribute('style')).toBe(originallyPresent);
      expect(restored.getAttribute('style')).toBe(originallyPresent ? '' : null);
    }
  });

  it('removes a class-based badge effect without touching inline typography or unrelated classes', () => {
    const originalStyle = 'color:#123456;font-size:22px;font-weight:400;line-height:2;';
    let report = parseReportHtml(
      `<!doctype html><html><body><main><section><span class="business-label pill warn" style="${originalStyle}">Badge</span></section></main></body></html>`
    );
    const section = report.sections[0];
    const node = section.editableNodes.find((item) => item.text === 'Badge')!;

    report = applyTextEffect(report, section.id, node.id, noEffect);

    const restored = readFirst<HTMLElement>(report.sections[0].html, 'span');
    expect(restored.getAttribute('style')).toBe(originalStyle);
    expect(restored.className).toBe('business-label');
  });

  it('removes stale effect-owned metadata while retaining unrelated data attributes', () => {
    const originalStyle = 'color:#123456;font-size:22px;';
    let report = parseReportHtml(
      `<!doctype html><html><body><main><section><span class="pill warn business-label" data-htmlpoint-effect-original-style-present="true" data-business-key="keep" style="${originalStyle}">Badge</span></section></main></body></html>`
    );
    const section = report.sections[0];
    const node = section.editableNodes.find((item) => item.text === 'Badge')!;

    report = applyTextEffect(report, section.id, node.id, noEffect);

    const restored = readFirst<HTMLElement>(report.sections[0].html, 'span');
    expect(restored.hasAttribute('data-htmlpoint-effect-original-style-present')).toBe(false);
    expect(restored.dataset.businessKey).toBe('keep');
    expect(restored.getAttribute('style')).toBe(originalStyle);
  });

  it('retains the original-style snapshot across serialization and reparse', () => {
    const originalStyle = 'color:#123456;font-size:22px;line-height:2;width:75%;';
    const source = `<!doctype html><html><head>
      <style>.business-label { letter-spacing: .2px; }</style>
      <script>const translations = [["#label", "English label"]];</script>
    </head><body><main><section><span id="label" class="business-label" style="${originalStyle}">라벨</span></section></main></body></html>`;
    const baselineDocument = parseHtml(serializeReportHtml(parseReportHtml(source)).html);
    let report = parseReportHtml(source);
    let section = report.sections[0];
    let node = section.editableNodes.find((item) => item.text === '라벨')!;

    report = applyTextEffect(report, section.id, node.id, warningEffect);
    const activeEffectHtml = serializeReportHtml(report).html;
    const activeEffectDocument = parseHtml(activeEffectHtml);
    expect(activeEffectHtml).toContain('data-htmlpoint-effect-original-style');
    expect(activeEffectDocument.querySelector('style')?.textContent).toBe(
      baselineDocument.querySelector('style')?.textContent
    );
    expect(activeEffectDocument.querySelector('script')?.textContent).toBe(
      baselineDocument.querySelector('script')?.textContent
    );

    report = parseReportHtml(activeEffectHtml);
    section = report.sections[0];
    node = section.editableNodes.find((item) => item.text === '라벨')!;
    report = applyTextEffect(report, section.id, node.id, noEffect);

    const restored = readFirst<HTMLElement>(report.sections[0].html, '#label');
    expect(restored.getAttribute('style')).toBe(originalStyle);
    expect(restored.className).toBe('business-label');
    expect(restored.hasAttribute('data-htmlpoint-effect-original-style')).toBe(false);
  });

  it('retains an existing generated caption after two presentation applies', () => {
    let report = parseReportHtml(`<!doctype html><html><body><main><section>
      <svg aria-label="trend" width="320" height="180"><text>Chart</text></svg>
      <figcaption data-htmlpoint-chart-caption="section-1:chart:0">Persistent caption</figcaption>
    </section></main></body></html>`);
    const sectionId = report.sections[0].id;
    let chart = report.sections[0].editableNodes.find((node) => node.kind === 'chart')!;

    report = updateChartPresentation(report, sectionId, chart.id, chartPresentation(chart));
    chart = report.sections[0].editableNodes.find((node) => node.kind === 'chart')!;
    report = updateChartPresentation(report, sectionId, chart.id, chartPresentation(chart));

    const caption = readFirst<HTMLElement>(
      report.sections[0].html,
      'figcaption[data-htmlpoint-chart-caption]'
    );
    expect(caption.textContent).toBe('Persistent caption');
  });

  it('parses the current chart caption, dimensions, frame, and alignment', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <svg aria-label="trend" width="420" height="210" style="display:block;margin-left:auto;margin-right:0;border:1px solid #cdd6e3"><text>Chart</text></svg>
      <figcaption data-htmlpoint-chart-caption="section-1:chart:0">Current caption</figcaption>
    </section></main></body></html>`);
    const chart = report.sections[0].editableNodes.find((node) => node.kind === 'chart')!;
    const presentation = (
      chart as EditableNode & { chartPresentation?: ChartPresentationSettings }
    ).chartPresentation;

    expect(presentation).toEqual({
      caption: 'Current caption',
      width: 420,
      height: 210,
      frame: true,
      align: 'right'
    });
  });

  it('prefers inline pixel dimensions over conflicting chart attributes', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <svg aria-label="trend" width="320" height="180" style="width:420px;height:210px"><text>Chart</text></svg>
    </section></main></body></html>`);
    const chart = report.sections[0].editableNodes.find((node) => node.kind === 'chart')!;

    expect(chart.chartPresentation).toEqual(
      expect.objectContaining({ width: 420, height: 210 })
    );
  });

  it('parses px-suffixed SVG dimension attributes when inline sizes are absent', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <svg aria-label="trend" width="420px" height="210px"><text>Chart</text></svg>
    </section></main></body></html>`);
    const chart = report.sections[0].editableNodes.find((node) => node.kind === 'chart')!;

    expect(chart.chartPresentation).toEqual(
      expect.objectContaining({ width: 420, height: 210 })
    );
  });

  it('initializes rendered Chart Properties and preserves them across two no-edit applies', async () => {
    const harness = renderTextEditingApp();
    await harness.openChartReport();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: getPreviewWindow(),
          data: {
            source: 'htmlpoint-preview',
            type: 'htmlpoint-select-node',
            nodeId: 'section-1:chart:0'
          }
        })
      );
    });

    const captionInput = document.querySelector<HTMLInputElement>('input[value="Current caption"]');
    const numberInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('.size-grid input[type="number"]')
    );
    const alignSelect = document.querySelector<HTMLSelectElement>('.size-grid select');
    const frame = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    ).find((input) => input.parentElement?.textContent?.includes('Frame'));
    expect(captionInput).toBeTruthy();
    expect(numberInputs.map((input) => input.value)).toEqual(['420', '210']);
    expect(alignSelect?.value).toBe('right');
    expect(frame?.checked).toBe(true);

    act(() => buttonWithText('Apply Chart').click());
    act(() => buttonWithText('Apply Chart').click());

    const previewDocument = parseHtml(
      document.querySelector<HTMLIFrameElement>('iframe')?.srcdoc ?? ''
    );
    const chart = previewDocument.querySelector<SVGElement>('svg[aria-label="trend"]');
    const captions = previewDocument.querySelectorAll(
      'figcaption[data-htmlpoint-chart-caption]'
    );
    expect(chart?.getAttribute('width')).toBe('420');
    expect(chart?.getAttribute('height')).toBe('210');
    expect(chart?.style.border).toContain('1px');
    expect(chart?.style.marginLeft).toBe('auto');
    expect(chart?.style.marginRight).toBe('0px');
    expect(captions).toHaveLength(1);
    expect(captions[0].textContent).toBe('Current caption');
  });

  it('keeps adjacent captions associated when inserting one shifts a later chart node id', () => {
    let report = parseReportHtml(`<!doctype html><html><body><main><section>
      <svg aria-label="first" width="300" height="150"><text>First</text></svg>
      <svg aria-label="second" width="360" height="180"><text>Second</text></svg>
      <figcaption data-htmlpoint-chart-caption="section-1:chart:1">Second caption</figcaption>
    </section></main></body></html>`);
    const sectionId = report.sections[0].id;
    const first = report.sections[0].editableNodes.find((node) => node.label === 'first')!;

    report = updateChartPresentation(report, sectionId, first.id, {
      caption: 'First caption',
      width: 300,
      height: 150,
      frame: false,
      align: 'left'
    });

    const second = report.sections[0].editableNodes.find((node) => node.label === 'second')!;
    const secondPresentation = (
      second as EditableNode & { chartPresentation?: ChartPresentationSettings }
    ).chartPresentation;
    expect(second.id).not.toBe('section-1:chart:1');
    expect(secondPresentation?.caption).toBe('Second caption');
    if (!secondPresentation) {
      return;
    }

    report = updateChartPresentation(report, sectionId, second.id, secondPresentation);
    const captions = Array.from(
      parseHtml(report.sections[0].html).querySelectorAll<HTMLElement>(
        'figcaption[data-htmlpoint-chart-caption]'
      )
    );
    expect(captions.map((caption) => caption.textContent)).toEqual([
      'First caption',
      'Second caption'
    ]);
    expect(captions[1].dataset.htmlpointChartCaption).toBe(second.id);
  });

  it('removes a chart caption only when an explicit empty caption is applied', () => {
    let report = parseReportHtml(`<!doctype html><html><body><main><section>
      <svg aria-label="trend" width="320" height="180"><text>Chart</text></svg>
      <figcaption data-htmlpoint-chart-caption="section-1:chart:0">Clear me</figcaption>
    </section></main></body></html>`);
    const sectionId = report.sections[0].id;
    let chart = report.sections[0].editableNodes.find((node) => node.kind === 'chart')!;
    const current = (
      chart as EditableNode & { chartPresentation?: ChartPresentationSettings }
    ).chartPresentation;
    expect(current).toBeDefined();
    if (!current) {
      return;
    }

    report = updateChartPresentation(report, sectionId, chart.id, {
      ...current,
      caption: undefined
    } as ChartPresentationSettings);
    expect(report.sections[0].html).toContain('Clear me');

    chart = report.sections[0].editableNodes.find((node) => node.kind === 'chart')!;
    report = updateChartPresentation(report, sectionId, chart.id, {
      ...chartPresentation(chart),
      caption: ''
    });
    expect(report.sections[0].html).not.toContain('Clear me');
    expect(
      parseHtml(report.sections[0].html).querySelectorAll(
        'figcaption[data-htmlpoint-chart-caption]'
      )
    ).toHaveLength(0);
  });
});

function renderTextEditingApp(): {
  openRichReport: () => Promise<void>;
  openChartReport: () => Promise<void>;
} {
  type HtmlpointBridge = NonNullable<Window['htmlpoint']>;
  type OpenedFile = Parameters<Parameters<HtmlpointBridge['onOpenedFile']>[0]>[0];
  let openedListener: ((opened: OpenedFile) => void) | undefined;
  window.htmlpoint = {
    listSamples: async () => [],
    openHtmlDialog: async () => null,
    openSample: async () => null,
    saveAsHtml: async () => null,
    createBackup: async () => ({}),
    openImageDialog: async () => null,
    onOpenedFile: (listener) => {
      openedListener = listener;
      return () => {
        openedListener = undefined;
      };
    },
    onMenuSaveAs: () => () => undefined,
    onOperationError: () => () => undefined,
    onCloseRequested: () => () => undefined,
    confirmClose: async () => undefined
  } as HtmlpointBridge;

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push({ container, root });
  act(() => root.render(React.createElement(App)));

  const openReport = async (opened: OpenedFile): Promise<void> => {
      if (!openedListener) {
        throw new Error('Opened-file listener was not registered.');
      }
      await act(async () => {
        openedListener?.(opened);
        await nextTask();
      });
  };

  return {
    openRichReport: () =>
      openReport({
          fileName: 'rich.html',
          filePath: 'C:\\reports\\rich.html',
          html: '<!doctype html><html><head><title>Rich</title></head><body><main><section><li><span class="pill bad">상태</span> 기존 설명</li></section></main></body></html>'
      }),
    openChartReport: () =>
      openReport({
        fileName: 'chart.html',
        filePath: 'C:\\reports\\chart.html',
        html: '<!doctype html><html><head><title>Chart</title></head><body><main><section><svg aria-label="trend" width="320" height="180" style="width:420px;height:210px;display:block;margin-left:auto;margin-right:0;border:1px solid #cdd6e3"><text>Chart</text></svg><figcaption data-htmlpoint-chart-caption="section-1:chart:0">Current caption</figcaption></section></main></body></html>'
      })
  };
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonWithText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function getPreviewWindow(): Window {
  const previewWindow = document.querySelector<HTMLIFrameElement>(
    'iframe[title="Report preview"]'
  )?.contentWindow;
  if (!previewWindow) {
    throw new Error('Preview iframe window is unavailable.');
  }
  return previewWindow;
}
