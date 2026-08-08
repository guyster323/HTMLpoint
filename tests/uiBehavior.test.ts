import { describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/App';
import { ChangeSummaryTimeline } from '../src/components/ChangeSummaryTimeline';
import { PropertiesPanel } from '../src/components/PropertiesPanel';
import { Ribbon } from '../src/components/Ribbon';
import { StatusBar } from '../src/components/StatusBar';
import { buildPreviewHtml, buildPreviewSelectionPayload, buildThumbnailHtml } from '../src/lib/preview';
import { resizeWithAspectLock } from '../src/lib/imageSizing';
import {
  shouldApplyPreviewSelectionState,
  shouldStorePreviewSnapshot
} from '../src/lib/selectionMessages';
import { tooltipProps } from '../src/lib/tooltips';
import { clampPropertiesWidth, getAutoTextareaRows } from '../src/lib/uiSizing';
import { parseReportHtml } from '../src/lib/htmlParser';

type HtmlpointBridge = NonNullable<Window['htmlpoint']>;
type BridgeOpenedFile = Parameters<Parameters<HtmlpointBridge['onOpenedFile']>[0]>[0];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const html = `<!doctype html><html><body><main>
  <section><h2>Final</h2><p>현장 점검 미진행</p><table><tbody><tr><td>A</td></tr></tbody></table></section>
</main></body></html>`;

const leakedPreviewHtml = `<!doctype html><html><body><main>
  <header>
    .htmlpoint-preview-node { cursor: pointer !important; }
    .htmlpoint-selected-node { outline: 3px solid #0f6cbd !important; }
    <h1>Clean report title</h1>
  </header>
</main></body></html>`;

describe('interactive UI behavior helpers', () => {
  it('clamps resizable properties panel width to practical desktop bounds', () => {
    expect(clampPropertiesWidth(120)).toBe(280);
    expect(clampPropertiesWidth(420)).toBe(420);
    expect(clampPropertiesWidth(900)).toBe(560);
  });

  it('sizes active edit textareas from content length and line count', () => {
    expect(getAutoTextareaRows('short')).toBe(4);
    expect(getAutoTextareaRows('line 1\nline 2\nline 3\nline 4\nline 5')).toBe(6);
    expect(getAutoTextareaRows('가'.repeat(900))).toBe(18);
  });

  it('builds preview node payload so sandboxed canvas clicks can select report objects', () => {
    const report = parseReportHtml(html);
    const payload = buildPreviewSelectionPayload(report, report.sections[0].id);

    expect(payload.map((entry) => entry.kind)).toContain('text');
    expect(payload.map((entry) => entry.kind)).toContain('table');
    expect(payload[0]).toEqual(expect.objectContaining({
      id: report.sections[0].editableNodes[0].id,
      path: report.sections[0].editableNodes[0].path
    }));
  });

  it('injects sandbox-safe selection effect and postMessage hook into preview html', () => {
    const report = parseReportHtml(html);
    const selectedNode = report.sections[0].editableNodes.find((node) => node.text.includes('현장'))!;
    const preview = buildPreviewHtml(report, report.sections[0].id, 'ko', selectedNode.id);

    expect(preview).toContain('htmlpoint-preview-node');
    expect(preview).toContain('htmlpoint-selected-node');
    expect(preview).toContain('htmlpoint-select-node');
    expect(preview).toContain(selectedNode.id);
  });

  it('sends computed object values from the preview when a canvas object is selected', () => {
    const report = parseReportHtml(html);
    const selectedNode = report.sections[0].editableNodes.find((node) => node.text.includes('현장'))!;
    const preview = buildPreviewHtml(report, report.sections[0].id, 'ko', selectedNode.id);

    expect(preview).toContain('getComputedStyle');
    expect(preview).toContain('textStyle');
    expect(preview).toContain('textEffect');
    expect(preview).toContain('imageMetrics');
    expect(preview).toContain('frameMetrics');
  });

  it('supports direct canvas text editing through a double-click commit message', () => {
    const report = parseReportHtml(html);
    const selectedNode = report.sections[0].editableNodes.find((node) => node.text.includes('현장'))!;
    const preview = buildPreviewHtml(report, report.sections[0].id, 'ko', selectedNode.id);

    expect(preview).toContain('dblclick');
    expect(preview).toContain('event.detail >= 2');
    expect(preview).toContain('contentEditable');
    expect(preview).toContain('htmlpoint-edit-text');
    expect(preview).toContain('htmlpoint-inline-editing');
  });

  it('lets the editor update preview selection without rebuilding the iframe document', () => {
    const report = parseReportHtml(html);
    const selectedNode = report.sections[0].editableNodes.find((node) => node.text.includes('현장'))!;
    const preview = buildPreviewHtml(report, report.sections[0].id, 'ko', selectedNode.id);

    expect(preview).toContain('htmlpoint-set-selection');
    expect(preview).toContain('htmlpoint-editor');
  });

  it('does not let iframe previewSync messages overwrite the active user selection', () => {
    const stalePreviewSync = {
      type: 'htmlpoint-select-node',
      nodeId: 'old-node',
      previewSync: true,
      selectedNodeIds: ['old-node']
    };
    const userSelection = {
      type: 'htmlpoint-select-node',
      nodeId: 'new-node',
      selectedNodeIds: ['new-node']
    };

    expect(shouldApplyPreviewSelectionState(stalePreviewSync)).toBe(false);
    expect(shouldStorePreviewSnapshot(stalePreviewSync, 'new-node', ['new-node'])).toBe(false);
    expect(shouldApplyPreviewSelectionState(userSelection)).toBe(true);
    expect(shouldStorePreviewSnapshot(userSelection, 'old-node', ['old-node'])).toBe(true);
  });

  it('keeps image dimensions proportional when aspect lock is enabled', () => {
    expect(
      resizeWithAspectLock(
        { width: 400, height: 200, unit: 'px' },
        { width: 300, height: 200, unit: 'px' },
        'width',
        true
      )
    ).toEqual({ width: 300, height: 150, unit: 'px' });
    expect(
      resizeWithAspectLock(
        { width: 400, height: 200, unit: 'px' },
        { width: 300, height: 100, unit: 'px' },
        'height',
        false
      )
    ).toEqual({ width: 300, height: 100, unit: 'px' });
  });

  it('keeps preview-only CSS and runtime artifacts out of visible report content', () => {
    const report = parseReportHtml(leakedPreviewHtml);
    const preview = buildPreviewHtml(report, report.sections[0].id, 'ko', report.sections[0].editableNodes[0].id);
    const previewDocument = new DOMParser().parseFromString(preview, 'text/html');
    const thumbnailDocument = new DOMParser().parseFromString(buildThumbnailHtml(report.sections[0].html), 'text/html');

    expect(report.sections[0].html).not.toContain('htmlpoint-preview-node');
    expect(report.sourceHtml).not.toContain('htmlpoint-preview-node');
    expect(previewDocument.head.querySelector('[data-htmlpoint-preview-style]')).toBeTruthy();
    expect(previewDocument.body.textContent).not.toContain('.htmlpoint-preview-node');
    expect(preview).not.toContain('style.textContent =');
    expect(thumbnailDocument.body.textContent).not.toContain('htmlpoint-selected-node');
    expect(thumbnailDocument.body.textContent).toContain('Clean report title');
  });

  it('injects Ctrl multi-select marquee behavior into preview html', () => {
    const report = parseReportHtml(html);
    const textNodes = report.sections[0].editableNodes.filter((node) => node.kind === 'text');
    const preview = buildPreviewHtml(
      report,
      report.sections[0].id,
      'ko',
      textNodes[0].id,
      textNodes.slice(0, 2).map((node) => node.id)
    );

    expect(preview).toContain('htmlpoint-selected-node-multi');
    expect(preview).toContain('htmlpoint-select-nodes');
    expect(preview).toContain('ctrlKey');
    expect(preview).toContain('htmlpoint-marquee');
  });

  it('builds delayed custom tooltip attributes for toolbar buttons', () => {
    expect(tooltipProps('Save As HTML')).toEqual({
      'aria-label': 'Save As HTML',
      'data-tooltip': 'Save As HTML',
      title: 'Save As HTML'
    });
  });

  it('keeps sample files out of the production ribbon file group', () => {
    const markup = renderToStaticMarkup(
      React.createElement(Ribbon, {
        report: null,
        samples: [{ fileName: 'sample.html', filePath: 'HTML_reference/sample.html' }],
        activeTab: 'Home',
        selectedSectionIndex: -1,
        sectionCount: 0,
        sectionHidden: false,
        canUndo: false,
        canRedo: false,
        onTabChange: () => undefined,
        onOpen: () => undefined,
        onSampleOpen: () => undefined,
        onSaveAs: () => undefined,
        onUndo: () => undefined,
        onRedo: () => undefined,
        onTextStyle: () => undefined,
        onInsertTable: () => undefined,
        onInsertImage: () => undefined,
        onDuplicate: () => undefined,
        onDelete: () => undefined,
        onHideToggle: () => undefined,
        onMove: () => undefined,
        onTableAddRow: () => undefined,
        onTableAddColumn: () => undefined,
        onTableDeleteRow: () => undefined,
        onTableDeleteColumn: () => undefined,
        onTableSort: () => undefined,
        onImageReplace: () => undefined,
        onImageCrop: () => undefined,
        onReviewSummary: () => undefined,
        onLanguageChange: () => undefined
      })
    );

    expect(markup).toContain('Open');
    expect(markup).not.toContain('Sample 4종');
    expect(markup).not.toContain('sample.html');
  });

  it('gives every StatusBar zoom control an accessible name', () => {
    const container = renderComponent(
      React.createElement(StatusBar, {
        report: null,
        selectedIndex: 0,
        zoom: 100,
        onZoomChange: () => undefined
      })
    );

    expect(container.querySelector('button[aria-label="Zoom out"]')).not.toBeNull();
    expect(container.querySelector('input[type="range"][aria-label="Preview zoom"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Zoom in"]')).not.toBeNull();
  });

  it('renders the selected text kind as non-interactive Properties status', () => {
    const report = makeUiReport();
    const section = report.sections[0];
    const textNode = section.editableNodes.find((node) => node.kind === 'text')!;
    const container = renderComponent(
      React.createElement(
        PropertiesPanel,
        propertiesProps(report, textNode.id, [textNode.id])
      )
    );

    const propertyKind = container.querySelector<HTMLElement>('.property-kind');
    expect(propertyKind).not.toBeNull();
    expect(propertyKind!.textContent).toContain('Text');
    expect(propertyKind!.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(propertyKind!.querySelector('button')).toBeNull();
    expect(propertyKind!.getAttribute('tabindex')).toBeNull();
    expect(container.querySelector('.property-tabs')).toBeNull();
  });

  it('does not present Text as the object kind for empty or mixed Properties selections', () => {
    const report = makeUiReport();
    const section = report.sections[0];
    const textNode = section.editableNodes.find((node) => node.kind === 'text')!;
    const tableNode = section.editableNodes.find((node) => node.kind === 'table')!;
    const empty = renderComponent(
      React.createElement(PropertiesPanel, propertiesProps(report, undefined, []))
    );
    const mixed = renderComponent(
      React.createElement(
        PropertiesPanel,
        propertiesProps(report, textNode.id, [textNode.id, tableNode.id])
      )
    );

    const emptyKind = empty.querySelector('.property-kind');
    const mixedKind = mixed.querySelector('.property-kind');
    expect(emptyKind).not.toBeNull();
    expect(mixedKind).not.toBeNull();
    expect(emptyKind!.textContent).toContain('No object selected');
    expect(mixedKind!.textContent).toContain('Mixed selection');
  });

  it('disables Ribbon section commands at first, last, singleton, and invalid boundaries', () => {
    const report = makeUiReport();
    const first = renderComponent(
      React.createElement(Ribbon, ribbonProps(report, {
        selectedSectionIndex: 0,
        sectionCount: 2
      }))
    );
    const last = renderComponent(
      React.createElement(Ribbon, ribbonProps(report, {
        selectedSectionIndex: 1,
        sectionCount: 2
      }))
    );
    const singletonReport = parseReportHtml(
      '<!doctype html><html><body><main><section><p>Only</p></section></main></body></html>'
    );
    const singleton = renderComponent(
      React.createElement(Ribbon, ribbonProps(singletonReport, {
        selectedSectionIndex: 0,
        sectionCount: 1
      }))
    );
    const invalid = renderComponent(
      React.createElement(Ribbon, ribbonProps(report, {
        selectedSectionIndex: -1,
        sectionCount: 2
      }))
    );

    expect(buttonWithText(first, 'Up').disabled).toBe(true);
    expect(buttonWithText(first, 'Down').disabled).toBe(false);
    expect(buttonWithText(last, 'Up').disabled).toBe(false);
    expect(buttonWithText(last, 'Down').disabled).toBe(true);
    expect(buttonWithText(singleton, 'Delete').disabled).toBe(true);
    expect(buttonWithText(invalid, 'Duplicate').disabled).toBe(true);
    expect(buttonWithText(invalid, 'Up').disabled).toBe(true);
    expect(buttonWithText(invalid, 'Down').disabled).toBe(true);
  });

  it('labels section visibility as an action and exposes the current state', () => {
    const report = makeUiReport();
    const hidden = renderComponent(
      React.createElement(Ribbon, ribbonProps(report, {
        selectedSectionIndex: 0,
        sectionCount: 2,
        sectionHidden: true
      }))
    );
    const visible = renderComponent(
      React.createElement(Ribbon, ribbonProps(report, {
        selectedSectionIndex: 0,
        sectionCount: 2,
        sectionHidden: false
      }))
    );
    const show = Array.from(hidden.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Show'
    );
    const hide = Array.from(visible.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Hide'
    );

    expect(show).toBeDefined();
    expect(show!.getAttribute('aria-label')).toBe('Show section — currently hidden');
    expect(show!.getAttribute('aria-pressed')).toBeNull();
    expect(hide).toBeDefined();
    expect(hide!.getAttribute('aria-label')).toBe('Hide section — currently visible');
    expect(hide!.getAttribute('aria-pressed')).toBeNull();
  });

  it('exposes Ribbon navigation as one selected tab and its labelled tabpanel', () => {
    const report = makeUiReport();
    const container = renderComponent(
      React.createElement(Ribbon, ribbonProps(report, { activeTab: 'Home' }))
    );
    const tablist = container.querySelector('[role="tablist"]');
    const home = container.querySelector<HTMLElement>('[role="tab"][aria-label="Home tab"]');
    const insert = container.querySelector<HTMLElement>('[role="tab"][aria-label="Insert tab"]');
    const panel = container.querySelector<HTMLElement>('[role="tabpanel"]');

    expect(tablist).not.toBeNull();
    expect(home?.getAttribute('aria-selected')).toBe('true');
    expect(home?.getAttribute('tabindex')).toBe('0');
    expect(insert?.getAttribute('aria-selected')).toBe('false');
    expect(insert?.getAttribute('tabindex')).toBe('-1');
    expect(home?.getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.getAttribute('aria-labelledby')).toBe(home?.id);
  });

  it('moves and activates Ribbon tabs with horizontal tablist keys', () => {
    const report = makeUiReport();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let activeTab = 'Home';
    const renderRibbon = () => {
      root.render(
        React.createElement(Ribbon, ribbonProps(report, {
          activeTab,
          onTabChange: (tab: string) => {
            activeTab = tab;
            renderRibbon();
          }
        }))
      );
    };

    try {
      act(renderRibbon);
      const home = buttonWithText(container, 'Home');
      home.focus();
      act(() => {
        home.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      });

      expect(activeTab).toBe('Insert');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Insert tab');
      expect(
        container.querySelector('[aria-label="Insert tab"]')?.getAttribute('aria-selected')
      ).toBe('true');

      const insert = container.querySelector<HTMLButtonElement>('[aria-label="Insert tab"]')!;
      act(() => {
        insert.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      });
      expect(activeTab).toBe('Home');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Home tab');

      const selectedHome = container.querySelector<HTMLButtonElement>('[aria-label="Home tab"]')!;
      act(() => {
        selectedHome.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      });
      expect(activeTab).toBe('Export');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Export tab');

      const exportTab = container.querySelector<HTMLButtonElement>('[aria-label="Export tab"]')!;
      act(() => {
        exportTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      });
      expect(activeTab).toBe('Home');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Home tab');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('dispatches row and column deletion from the table Ribbon and inspector at the selected coordinates', () => {
    const report = makeUiReport();
    const table = report.sections[0].editableNodes.find((node) => node.kind === 'table')!;
    const onRibbonDeleteRow = vi.fn();
    const onRibbonDeleteColumn = vi.fn();
    const onInspectorDeleteRow = vi.fn();
    const onInspectorDeleteColumn = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      act(() => root.render(React.createElement(Ribbon, ribbonProps(report, {
        activeTab: 'Table',
        selectedKind: 'table',
        onTableDeleteRow: onRibbonDeleteRow,
        onTableDeleteColumn: onRibbonDeleteColumn
      }))));
      act(() => buttonWithText(container, '- Row').click());
      act(() => buttonWithText(container, '- Column').click());
      expect(onRibbonDeleteRow).toHaveBeenCalledTimes(1);
      expect(onRibbonDeleteColumn).toHaveBeenCalledTimes(1);

      act(() => root.render(React.createElement(PropertiesPanel, {
        ...propertiesProps(report, table.id, [table.id]),
        selectedCell: { row: 0, cell: 0 },
        onDeleteTableRow: onInspectorDeleteRow,
        onDeleteTableColumn: onInspectorDeleteColumn
      })));
      act(() => buttonWithText(container, '- Row').click());
      act(() => buttonWithText(container, '- Column').click());
      expect(onInspectorDeleteRow).toHaveBeenCalledWith(table.id, 0);
      expect(onInspectorDeleteColumn).toHaveBeenCalledWith(table.id, 0);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('renders ordinary output as polite status and explicit errors as alerts', () => {
    const harness = renderAppHarness();

    try {
      const status = harness.container.querySelector<HTMLElement>('.message-line');
      expect(status?.getAttribute('role')).toBe('status');
      expect(status?.getAttribute('aria-live')).toBe('polite');

      harness.reportOperationError('Renderer bridge failed');
      const alert = harness.container.querySelector<HTMLElement>('.message-line');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(alert?.textContent).toContain('Renderer bridge failed');
    } finally {
      harness.dispose();
    }
  });

  it('renders change entries newest first and only discloses meaningful text excerpts', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ChangeSummaryTimeline, {
        entries: [
          {
            id: 'older',
            category: '텍스트',
            label: 'Older change',
            timestamp: '2026. 8. 8. 오전 9:00',
            sectionTitle: 'Background'
          },
          {
            id: 'newer',
            category: '이미지',
            label: 'Newer change',
            timestamp: '2026. 8. 8. 오전 10:00',
            before: 'Before safe excerpt',
            after: 'After safe excerpt'
          }
        ]
      })
    );

    expect(markup).toContain('<ol class="change-summary-timeline" aria-label="변경 이력">');
    expect(markup.indexOf('Newer change')).toBeLessThan(markup.indexOf('Older change'));
    expect(markup).toContain('변경 전후 보기');
    expect(markup).toContain('Before safe excerpt');
    expect(markup).toContain('After safe excerpt');
    expect(markup.match(/<details/g)).toHaveLength(1);
  });

  it('moves focus into Summary, closes on Escape, and restores the Summary button', async () => {
    const harness = renderAppHarness();

    try {
      await harness.openReport(openedReport('summary.html', 'Summary report'));
      act(() => buttonWithText(harness.container, 'Review').click());
      const summaryButton = harness.container.querySelector<HTMLButtonElement>(
        '[aria-label="Change summary"]'
      )!;
      summaryButton.focus();
      act(() => summaryButton.click());

      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const labelledBy = dialog?.getAttribute('aria-labelledby');
      expect(labelledBy ? document.getElementById(labelledBy)?.textContent : '').toBe('변경 요약');
      expect(dialog?.textContent).toContain('아직 변경 내역이 없습니다.');
      expect(document.activeElement?.textContent).toBe('Close');

      act(() => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(summaryButton);
    } finally {
      harness.dispose();
    }
  });
});

function renderComponent(element: React.ReactElement): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(element);
  return container;
}

function makeUiReport() {
  return parseReportHtml(`<!doctype html><html><body><main>
    <section><h2>First</h2><p>Text object</p><table><tbody><tr><td>A</td></tr></tbody></table></section>
    <section><h2>Second</h2><p>More text</p></section>
  </main></body></html>`);
}

function ribbonProps(
  report: ReturnType<typeof parseReportHtml> | null,
  overrides: Record<string, unknown> = {}
): ComponentProps<typeof Ribbon> {
  return {
    report,
    activeTab: 'Home',
    selectedSectionIndex: report ? 0 : -1,
    sectionCount: report?.sections.length ?? 0,
    sectionHidden: false,
    canUndo: false,
    canRedo: false,
    onTabChange: () => undefined,
    onOpen: () => undefined,
    onSaveAs: () => undefined,
    onUndo: () => undefined,
    onRedo: () => undefined,
    onTextStyle: () => undefined,
    onInsertTable: () => undefined,
    onInsertImage: () => undefined,
    onDuplicate: () => undefined,
    onDelete: () => undefined,
    onHideToggle: () => undefined,
    onMove: () => undefined,
    onTableAddRow: () => undefined,
    onTableAddColumn: () => undefined,
    onTableDeleteRow: () => undefined,
    onTableDeleteColumn: () => undefined,
    onTableSort: () => undefined,
    onImageReplace: () => undefined,
    onImageCrop: () => undefined,
    onReviewSummary: () => undefined,
    onLanguageChange: () => undefined,
    ...overrides
  } as unknown as ComponentProps<typeof Ribbon>;
}

function propertiesProps(
  report: ReturnType<typeof parseReportHtml>,
  selectedNodeId?: string,
  selectedNodeIds: string[] = selectedNodeId ? [selectedNodeId] : []
): ComponentProps<typeof PropertiesPanel> {
  return {
    report,
    selectedSectionId: report.sections[0].id,
    selectedNodeId,
    selectedNodeIds,
    selectedCell: { row: 0, cell: 0 },
    onNodeSelect: () => undefined,
    onCellSelect: () => undefined,
    onTextChange: () => undefined,
    onTextEffect: () => undefined,
    onTextStyle: () => undefined,
    onTranslationChange: () => undefined,
    onTableCellText: () => undefined,
    onAddTableRow: () => undefined,
    onAddTableColumn: () => undefined,
    onDeleteTableRow: () => undefined,
    onDeleteTableColumn: () => undefined,
    onSortTable: () => undefined,
    onFilterTable: () => undefined,
    onMergeRight: () => undefined,
    onUnmerge: () => undefined,
    onCellStyle: () => undefined,
    onPasteTable: () => undefined,
    onReplaceImage: () => undefined,
    onImageFilter: () => undefined,
    onResizeImage: () => undefined,
    onResizeImageFrame: () => undefined,
    onCropImage: () => undefined,
    onImageAnnotation: () => undefined,
    onChartPresentation: () => undefined,
    onChartData: () => undefined
  };
}

function buttonWithText(container: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

function openedReport(fileName: string, title: string): BridgeOpenedFile {
  return {
    fileName,
    filePath: `C:\\reports\\${fileName}`,
    html: `<!doctype html><html><head><title>${title}</title></head><body><section><h1>${title}</h1></section></body></html>`
  };
}

function renderAppHarness() {
  let openedListener: ((opened: BridgeOpenedFile) => void) | undefined;
  let operationErrorListener: ((message: string) => void) | undefined;
  window.htmlpoint = {
    listSamples: async () => [],
    openHtmlDialog: async () => null,
    openSample: async (filePath: string) => ({ ...openedReport('sample.html', 'Sample'), filePath }),
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
    onOperationError: (listener) => {
      operationErrorListener = listener;
      return () => {
        operationErrorListener = undefined;
      };
    },
    onCloseRequested: () => () => undefined,
    confirmClose: async () => undefined
  } as HtmlpointBridge;

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(React.createElement(App)));

  return {
    container,
    openReport: async (opened: BridgeOpenedFile) => {
      if (!openedListener) {
        throw new Error('Opened-file listener was not registered.');
      }
      await act(async () => {
        openedListener?.(opened);
        await nextTask();
      });
    },
    reportOperationError: (message: string) => {
      if (!operationErrorListener) {
        throw new Error('Operation-error listener was not registered.');
      }
      act(() => operationErrorListener?.(message));
    },
    dispose: () => {
      act(() => root.unmount());
      container.remove();
      window.htmlpoint = undefined;
    }
  };
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
