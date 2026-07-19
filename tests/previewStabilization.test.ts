import { describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/App';
import * as CanvasModule from '../src/components/Canvas';
import { StatusBar } from '../src/components/StatusBar';
import { serializeReportHtml } from '../src/lib/htmlSerializer';
import * as PreviewModule from '../src/lib/preview';
import { parseReportHtml } from '../src/lib/htmlParser';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const sourceHtml = `<!doctype html><html><head><title>Relative assets</title></head><body>
  <section><h1>Preview</h1><img src="assets/plot one.png" alt="Plot"></section>
</body></html>`;

describe('preview stabilization', () => {
  it('calculates bounded integer Fit zoom from the stage width', () => {
    const calculateFitZoom = (
      CanvasModule as typeof CanvasModule & {
        calculateFitZoom?: (canvasWidth: number, pageWidth: number, padding: number) => number;
      }
    ).calculateFitZoom;

    expect(calculateFitZoom).toBeTypeOf('function');
    expect(calculateFitZoom?.(820, 1120, 28)).toBe(68);
    expect(calculateFitZoom?.(4000, 1120, 28)).toBe(100);
    expect(calculateFitZoom?.(100, 1120, 28)).toBe(50);
  });

  it('injects the supplied base into preview only without mutating source HTML', () => {
    const report = parseReportHtml(sourceHtml, {
      fileName: 'deck.html',
      sourcePath: 'C:\\Reports\\Quarter One\\deck.html'
    });
    const originalSource = report.sourceHtml;
    const buildPreviewHtml = PreviewModule.buildPreviewHtml as (
      documentReport: ReturnType<typeof parseReportHtml>,
      selectedSectionId: string,
      language: string,
      selectedNodeId?: string,
      selectedNodeIds?: string[],
      sourceBaseUrl?: string
    ) => string;
    const preview = buildPreviewHtml(
      report,
      report.sections[0].id,
      'ko',
      undefined,
      [],
      'file:///C:/Reports/Quarter%20One/'
    );
    const previewDocument = new DOMParser().parseFromString(preview, 'text/html');
    const saved = serializeReportHtml(report);

    expect(previewDocument.head.firstElementChild?.tagName).toBe('BASE');
    expect(previewDocument.head.firstElementChild?.getAttribute('href')).toBe(
      'file:///C:/Reports/Quarter%20One/'
    );
    expect(previewDocument.querySelector('img')?.getAttribute('src')).toBe(
      'assets/plot one.png'
    );
    expect(saved.html).not.toContain('<base');
    expect(report.sourceHtml).toBe(originalSource);
  });

  it('prevents thumbnails from resolving non-memory src and srcset URLs against app.asar', () => {
    const thumbnail = PreviewModule.buildThumbnailHtml(`<section>
      <img id="relative" src="assets/plot.png" srcset="assets/plot.png 1x, /assets/plot@2x.png 2x">
      <video><source id="relative-source" src="media/demo.mp4"></video>
      <img id="protocol-relative" src="//cdn.example.com/plot.png">
      <img id="remote" src="https://cdn.example.com/plot.png" srcset="https://cdn.example.com/plot.png 1x">
      <img id="local-file" src="file:///C:/Reports/private.png">
      <img id="nbsp-data" src="\u00a0data:image/png;base64,AAAA">
      <img id="data" src="data:image/png;base64,AAAA" srcset="data:image/png;base64,AAAA 1x">
      <img id="blob" src="blob:https://htmlpoint.local/image-id" srcset="blob:https://htmlpoint.local/image-id 2x">
      <source id="mixed" srcset="data:image/png;base64,AAAA 1x, assets/plot@2x.png 2x">
      <source id="mixed-no-descriptor" srcset="data:image/png;base64,AAAA, assets/plot@2x.png 2x">
      <source id="nbsp-data-srcset" srcset="\u00a0data:image/png;base64,AAAA 1x">
    </section>`);
    const document = new DOMParser().parseFromString(thumbnail, 'text/html');
    const element = (id: string) => document.getElementById(id)!;

    for (const id of [
      'relative',
      'relative-source',
      'protocol-relative',
      'remote',
      'local-file',
      'nbsp-data'
    ]) {
      expect(element(id).hasAttribute('src')).toBe(false);
    }
    expect(element('relative').hasAttribute('srcset')).toBe(false);
    expect(element('remote').hasAttribute('srcset')).toBe(false);
    expect(element('mixed').hasAttribute('srcset')).toBe(false);
    expect(element('mixed-no-descriptor').hasAttribute('srcset')).toBe(false);
    expect(element('nbsp-data-srcset').hasAttribute('srcset')).toBe(false);
    expect(element('data').getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(element('data').getAttribute('srcset')).toBe('data:image/png;base64,AAAA 1x');
    expect(element('blob').getAttribute('src')).toBe('blob:https://htmlpoint.local/image-id');
    expect(element('blob').getAttribute('srcset')).toBe(
      'blob:https://htmlpoint.local/image-id 2x'
    );
  });

  it('derives an encoded file directory URL from a Windows source path', () => {
    const sourcePathToBaseUrl = (
      PreviewModule as typeof PreviewModule & {
        sourcePathToBaseUrl?: (sourcePath?: string) => string | undefined;
      }
    ).sourcePathToBaseUrl;

    expect(sourcePathToBaseUrl).toBeTypeOf('function');
    expect(sourcePathToBaseUrl?.('C:\\Reports\\Quarter One\\deck.html')).toBe(
      'file:///C:/Reports/Quarter%20One/'
    );
    expect(sourcePathToBaseUrl?.(undefined)).toBeUndefined();
  });

  it('renders a labelled Fit control with its pressed state', () => {
    const FitStatusBar = StatusBar as React.ComponentType<{
      report: null;
      selectedIndex: number;
      zoom: number;
      fitMode: boolean;
      onZoomChange: (zoom: number) => void;
      onFit: () => void;
    }>;
    const markup = renderToStaticMarkup(
      React.createElement(FitStatusBar, {
        report: null,
        selectedIndex: 0,
        zoom: 68,
        fitMode: true,
        onZoomChange: () => undefined,
        onFit: () => undefined
      })
    );

    expect(markup).toContain('aria-label="Fit preview to canvas"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('>Fit</button>');
  });

  it('observes the canvas border-box width only in Fit mode and disconnects cleanly', () => {
    const report = parseReportHtml(sourceHtml);
    const onFitZoomChange = vi.fn();
    let observerCallback: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    const originalResizeObserver = globalThis.ResizeObserver;

    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        observerCallback = callback;
      }

      observe(): void {}
      unobserve(): void {}
      disconnect(): void {
        disconnect();
      }
    }

    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
    const FitCanvas = CanvasModule.Canvas as React.ComponentType<{
      report: typeof report;
      selectedSectionId: string;
      zoom: number;
      fitMode: boolean;
      onFitZoomChange: (zoom: number) => void;
      onSelectNode: () => void;
    }>;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      act(() => {
        root.render(
          React.createElement(FitCanvas, {
            report,
            selectedSectionId: report.sections[0].id,
            zoom: 100,
            fitMode: true,
            onFitZoomChange,
            onSelectNode: () => undefined
          })
        );
      });
      const stage = container.querySelector<HTMLElement>('.canvas-stage')!;
      Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 820 });

      expect(observerCallback).toBeTypeOf('function');
      act(() => {
        observerCallback?.(
          [{ target: stage, contentRect: { width: 999 } as DOMRectReadOnly } as unknown as ResizeObserverEntry],
          {} as ResizeObserver
        );
      });

      expect(onFitZoomChange).toHaveBeenLastCalledWith(68);
      act(() => root.unmount());
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      if (container.isConnected) {
        act(() => root.unmount());
      }
      container.remove();
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it('waits for the Electron token base before building preview srcdoc', async () => {
    const report = parseReportHtml(sourceHtml, {
      fileName: 'deck.html',
      sourcePath: 'C:\\Reports\\Quarter One\\deck.html'
    });
    let resolveBaseUrl: ((baseUrl: string) => void) | undefined;
    const baseUrlPromise = new Promise<string>((resolve) => {
      resolveBaseUrl = resolve;
    });
    const registerPreviewSource = vi.fn(() => baseUrlPromise);
    window.htmlpoint = {
      listSamples: async () => [],
      openHtmlDialog: async () => null,
      openSample: async () => null,
      saveAsHtml: async () => null,
      createBackup: async () => ({}),
      openImageDialog: async () => null,
      registerPreviewSource,
      onOpenedFile: () => () => undefined,
      onMenuSaveAs: () => () => undefined,
      onOperationError: () => () => undefined,
      onCloseRequested: () => () => undefined,
      confirmClose: async () => undefined
    } as NonNullable<Window['htmlpoint']> & {
      registerPreviewSource: (sourcePath: string) => Promise<string>;
    };
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      act(() => {
        root.render(
          React.createElement(CanvasModule.Canvas, {
            report,
            selectedSectionId: report.sections[0].id,
            zoom: 100,
            onSelectNode: () => undefined
          })
        );
      });
      const iframe = container.querySelector<HTMLIFrameElement>('iframe[title="Report preview"]')!;

      expect(registerPreviewSource).toHaveBeenCalledWith(report.sourcePath);
      expect(iframe.getAttribute('srcdoc')).toBe('');

      await act(async () => {
        resolveBaseUrl?.('htmlpoint-asset://token-a/');
        await baseUrlPromise;
      });
      const previewDocument = new DOMParser().parseFromString(
        iframe.getAttribute('srcdoc') ?? '',
        'text/html'
      );
      expect(previewDocument.head.querySelector('base')?.getAttribute('href')).toBe(
        'htmlpoint-asset://token-a/'
      );
    } finally {
      act(() => root.unmount());
      container.remove();
      window.htmlpoint = undefined;
    }
  });

  it('ignores stale token responses and reports resolver failures without using file URLs', async () => {
    const firstReport = parseReportHtml(sourceHtml, {
      fileName: 'first.html',
      sourcePath: 'C:\\Reports\\One\\first.html'
    });
    const secondReport = parseReportHtml(sourceHtml, {
      fileName: 'second.html',
      sourcePath: 'D:\\Reports\\Two\\second.html'
    });
    let resolveFirst: ((baseUrl: string) => void) | undefined;
    let resolveSecond: ((baseUrl: string) => void) | undefined;
    const firstPromise = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });
    const registerPreviewSource = vi.fn((sourcePath: string) =>
      sourcePath === firstReport.sourcePath ? firstPromise : secondPromise
    );
    window.htmlpoint = {
      listSamples: async () => [],
      openHtmlDialog: async () => null,
      openSample: async () => null,
      saveAsHtml: async () => null,
      createBackup: async () => ({}),
      openImageDialog: async () => null,
      registerPreviewSource,
      onOpenedFile: () => () => undefined,
      onMenuSaveAs: () => () => undefined,
      onOperationError: () => () => undefined,
      onCloseRequested: () => () => undefined,
      confirmClose: async () => undefined
    } as NonNullable<Window['htmlpoint']>;
    const onPreviewAssetError = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const renderCanvas = (report: typeof firstReport) =>
      React.createElement(CanvasModule.Canvas, {
        report,
        selectedSectionId: report.sections[0].id,
        zoom: 100,
        onPreviewAssetError,
        onSelectNode: () => undefined
      });

    try {
      act(() => root.render(renderCanvas(firstReport)));
      act(() => root.render(renderCanvas(secondReport)));
      await act(async () => {
        resolveSecond?.('htmlpoint-asset://token-b/');
        await secondPromise;
        resolveFirst?.('htmlpoint-asset://token-a/');
        await firstPromise;
      });

      const iframe = container.querySelector<HTMLIFrameElement>('iframe[title="Report preview"]')!;
      expect(iframe.getAttribute('srcdoc')).toContain('htmlpoint-asset://token-b/');
      expect(iframe.getAttribute('srcdoc')).not.toContain('htmlpoint-asset://token-a/');

      const failedReport = parseReportHtml(sourceHtml, {
        fileName: 'missing.html',
        sourcePath: 'E:\\Missing\\missing.html'
      });
      registerPreviewSource.mockImplementationOnce(async () => {
        throw new Error('registration denied');
      });
      await act(async () => {
        root.render(renderCanvas(failedReport));
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });

      expect(onPreviewAssetError).toHaveBeenCalledWith(
        '상대경로 자산 미리보기 준비 실패: registration denied'
      );
      expect(iframe.getAttribute('srcdoc')).toContain('htmlpoint-asset://unavailable/');
      expect(iframe.getAttribute('srcdoc')).not.toContain('file:///E:/');
    } finally {
      act(() => root.unmount());
      container.remove();
      window.htmlpoint = undefined;
    }
  });

  it('offers labelled side-panel collapse and expand controls for the narrow fallback', () => {
    window.htmlpoint = {
      listSamples: async () => [],
      openHtmlDialog: async () => null,
      openSample: async () => null,
      saveAsHtml: async () => null,
      createBackup: async () => ({}),
      openImageDialog: async () => null,
      onOpenedFile: () => () => undefined,
      onMenuSaveAs: () => () => undefined,
      onOperationError: () => () => undefined,
      onCloseRequested: () => () => undefined,
      confirmClose: async () => undefined
    } as NonNullable<Window['htmlpoint']>;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      act(() => root.render(React.createElement(App)));
      const sectionsButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Collapse sections panel"]'
      );
      const propertiesButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Collapse properties panel"]'
      );

      expect(sectionsButton?.getAttribute('aria-expanded')).toBe('true');
      expect(propertiesButton?.getAttribute('aria-expanded')).toBe('true');

      act(() => sectionsButton?.click());
      expect(container.querySelector('.workspace')?.classList.contains('sections-collapsed')).toBe(true);
      expect(
        container.querySelector('button[aria-label="Expand sections panel"]')?.getAttribute('aria-expanded')
      ).toBe('false');

      act(() => propertiesButton?.click());
      expect(container.querySelector('.workspace')?.classList.contains('properties-collapsed')).toBe(true);
      expect(
        container.querySelector('button[aria-label="Expand properties panel"]')?.getAttribute('aria-expanded')
      ).toBe('false');
    } finally {
      act(() => root.unmount());
      container.remove();
      window.htmlpoint = undefined;
    }
  });

  it('leaves Fit for manual zoom controls, restores it on request, and resets it on load', async () => {
    type OpenedFile = Parameters<Parameters<NonNullable<Window['htmlpoint']>['onOpenedFile']>[0]>[0];
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
    } as NonNullable<Window['htmlpoint']>;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const opened = (fileName: string): OpenedFile => ({
      fileName,
      filePath: `C:\\Reports\\${fileName}`,
      html: sourceHtml
    });

    try {
      act(() => root.render(React.createElement(App)));
      await act(async () => {
        openedListener?.(opened('first.html'));
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });

      expect(
        container.querySelector('button[aria-label="Fit preview to canvas"]')?.getAttribute('aria-pressed')
      ).toBe('true');

      act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')?.click());
      expect(
        container.querySelector('button[aria-label="Fit preview to canvas"]')?.getAttribute('aria-pressed')
      ).toBe('false');

      act(() =>
        container.querySelector<HTMLButtonElement>('button[aria-label="Fit preview to canvas"]')?.click()
      );
      expect(
        container.querySelector('button[aria-label="Fit preview to canvas"]')?.getAttribute('aria-pressed')
      ).toBe('true');

      const slider = container.querySelector<HTMLInputElement>('input[aria-label="Preview zoom"]')!;
      const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      act(() => {
        setInputValue?.call(slider, '80');
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(
        container.querySelector('button[aria-label="Fit preview to canvas"]')?.getAttribute('aria-pressed')
      ).toBe('false');

      await act(async () => {
        openedListener?.(opened('second.html'));
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      expect(
        container.querySelector('button[aria-label="Fit preview to canvas"]')?.getAttribute('aria-pressed')
      ).toBe('true');
    } finally {
      act(() => root.unmount());
      container.remove();
      window.htmlpoint = undefined;
    }
  });
});
