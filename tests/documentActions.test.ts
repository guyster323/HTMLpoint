import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { Modal } from '../src/components/Modal';
import {
  isCurrentBackupSnapshot,
  nextReportAfterSave,
  shouldCreateAutoBackup,
  validateOpenedReport
} from '../src/lib/documentActions';
import { parseReportHtml } from '../src/lib/htmlParser';
import { saveAsHtml } from '../src/lib/fileServices';

type HtmlpointBridge = NonNullable<Window['htmlpoint']>;
type BridgeOpenedFile = Parameters<Parameters<HtmlpointBridge['onOpenedFile']>[0]>[0];

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

describe('document actions', () => {
  it('rejects opened HTML without an editable header or section', () => {
    expect(() =>
      validateOpenedReport({
        fileName: 'unsupported.html',
        filePath: 'C:\\reports\\unsupported.html',
        html: '<!doctype html><html><body><main><div>Unsupported</div></main></body></html>'
      })
    ).toThrow('편집 가능한 <header> 또는 <section>을 찾지 못했습니다.');
  });

  it('updates the source path and file name after Save As succeeds', () => {
    const report = {
      ...parseReportHtml(
        '<!doctype html><html><body><section><h1>Report</h1></section></body></html>',
        { fileName: 'original.html', sourcePath: 'C:\\reports\\original.html' }
      ),
      dirty: true
    };

    const saved = nextReportAfterSave(report, 'D:\\exports\\renamed.html');

    expect(saved).toMatchObject({
      fileName: 'renamed.html',
      sourcePath: 'D:\\exports\\renamed.html',
      dirty: false
    });
    expect(saved).not.toBe(report);
  });

  it('preserves a nonblocking backup warning returned with a successful Save As', async () => {
    renderAppHarness({
      saveResult: {
        filePath: 'D:\\exports\\saved.html',
        warnings: ['기존 파일 백업을 만들지 못했습니다.']
      }
    });
    const report = parseReportHtml(
      '<!doctype html><html><body><section><h1>Report</h1></section></body></html>'
    );

    await expect(saveAsHtml(report)).resolves.toEqual({
      filePath: 'D:\\exports\\saved.html',
      warnings: ['기존 파일 백업을 만들지 못했습니다.']
    });
  });

  it('rejects an auto-backup result after the report snapshot changes', () => {
    const requestedReport = parseReportHtml(
      '<!doctype html><html><body><section><h1>Report</h1></section></body></html>',
      { sourcePath: 'C:\\reports\\report.html' }
    );
    const newerSnapshot = { ...requestedReport, dirty: true, updatedAt: Date.now() + 1 };

    expect(isCurrentBackupSnapshot(requestedReport, requestedReport)).toBe(true);
    expect(isCurrentBackupSnapshot(newerSnapshot, requestedReport)).toBe(false);
    expect(
      isCurrentBackupSnapshot(
        { ...requestedReport, sourcePath: 'D:\\exports\\report.html' },
        requestedReport
      )
    ).toBe(false);
  });

  it('auto-backs up every dirty sourced snapshot even with no operations', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><section><h1>Report</h1></section></body></html>',
      { sourcePath: 'C:\\reports\\report.html' }
    );

    expect(shouldCreateAutoBackup({ ...report, dirty: true, operations: [] })).toBe(true);
    expect(shouldCreateAutoBackup({ ...report, dirty: false })).toBe(false);
    expect(shouldCreateAutoBackup({ ...report, sourcePath: undefined, dirty: true })).toBe(false);
  });
});

describe('Modal', () => {
  it('moves focus inside, handles Escape, and restores the invoking focus', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open modal';
    document.body.append(opener);
    opener.focus();

    const initialFocusRef = createRef<HTMLButtonElement>();
    const onEscape = vi.fn();
    const { container, root } = createMountedRoot();
    const modal = (open: boolean) =>
      React.createElement(
        Modal,
        {
          open,
          title: 'Test modal',
          description: 'Focus behavior',
          initialFocusRef,
          onEscape
        },
        React.createElement('button', { ref: initialFocusRef }, 'First action'),
        React.createElement('button', null, 'Last action')
      );

    act(() => root.render(modal(true)));
    expect(document.activeElement).toBe(initialFocusRef.current);
    expect(container.inert).toBe(true);
    expect(container.getAttribute('aria-hidden')).toBe('true');

    act(() => {
      initialFocusRef.current?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    expect(onEscape).toHaveBeenCalledTimes(1);

    act(() => root.render(modal(false)));
    expect(container.inert).toBe(false);
    expect(container.hasAttribute('aria-hidden')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('traps forward and reverse Tab navigation inside the dialog', () => {
    const initialFocusRef = createRef<HTMLButtonElement>();
    const { container, root } = createMountedRoot();

    act(() => {
      root.render(
        React.createElement(
          Modal,
          {
            open: true,
            title: 'Keyboard modal',
            initialFocusRef,
            onEscape: () => undefined
          },
          React.createElement('button', { ref: initialFocusRef }, 'First action'),
          React.createElement('button', null, 'Last action')
        )
      );
    });

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const buttons = Array.from(dialog?.querySelectorAll('button') ?? []);
    const first = buttons[0];
    const last = buttons[1];
    last.focus();
    act(() => {
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(first);

    first.focus();
    act(() => {
      first.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      );
    });
    expect(document.activeElement).toBe(last);
  });
});

describe('App document guard', () => {
  it('keeps the dirty document and pending open action when save is cancelled', async () => {
    const harness = renderAppHarness({ saveResult: null });
    await harness.openFile(openedReport('first.html', 'First report'));

    const boldButton = document.querySelector<HTMLButtonElement>('button[aria-label="Bold"]');
    expect(boldButton).toBeTruthy();
    expect(boldButton?.disabled).toBe(false);
    act(() => boldButton?.click());
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')?.disabled).toBe(false);

    await harness.openFile(openedReport('second.html', 'Second report'));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('저장하지 않은 변경');

    const saveAndContinue = buttonWithText('저장 후 계속');
    await act(async () => {
      saveAndContinue.click();
      await nextTask();
    });

    expect(harness.saveAsHtml).toHaveBeenCalledTimes(1);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('저장하지 않은 변경');
    expect(dialog?.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(dialog?.querySelector('[role="status"]')?.textContent).toContain('저장이 취소되었습니다.');
    expect(dialog?.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain('First report');
    expect(document.body.textContent).not.toContain('Second report');
  });

  it('surfaces a pending Save As failure inside the active dirty-work modal', async () => {
    const harness = renderAppHarness({ saveError: new Error('disk full') });
    await harness.openFile(openedReport('first.html', 'First report'));

    const boldButton = document.querySelector<HTMLButtonElement>('button[aria-label="Bold"]');
    act(() => boldButton?.click());
    await harness.openFile(openedReport('second.html', 'Second report'));

    await act(async () => {
      buttonWithText('저장 후 계속').click();
      await nextTask();
    });

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('저장하지 않은 변경');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('저장 실패: disk full');
    expect(document.body.textContent).toContain('First report');
    expect(document.body.textContent).not.toContain('Second report');
  });

  it('confirms an Electron close request immediately when the document is clean', async () => {
    const harness = renderAppHarness();

    await act(async () => {
      harness.requestClose();
      await nextTask();
    });

    expect(harness.confirmClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('requires acknowledgement of a Save As backup warning before a pending close continues', async () => {
    const warning = '기존 파일 백업을 만들지 못했습니다.';
    const harness = renderAppHarness({
      saveResult: { filePath: 'D:\\exports\\saved.html', warnings: [warning] }
    });
    await harness.openFile(openedReport('first.html', 'First report'));

    const boldButton = document.querySelector<HTMLButtonElement>('button[aria-label="Bold"]');
    expect(boldButton?.disabled).toBe(false);
    act(() => boldButton?.click());
    act(() => harness.requestClose());

    await act(async () => {
      buttonWithText('저장 후 계속').click();
      await nextTask();
    });

    expect(harness.confirmClose).not.toHaveBeenCalled();
    const warningDialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(warningDialog?.textContent).toContain('백업 경고');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(warning);
    expect(warningDialog?.contains(document.activeElement)).toBe(true);

    await act(async () => {
      buttonWithText('계속').click();
      await nextTask();
    });
    expect(harness.confirmClose).toHaveBeenCalledTimes(1);
  });
});

function createMountedRoot(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push({ container, root });
  return { container, root };
}

function openedReport(fileName: string, title: string): BridgeOpenedFile {
  return {
    fileName,
    filePath: `C:\\reports\\${fileName}`,
    html: `<!doctype html><html><head><title>${title}</title></head><body><section><h1>${title}</h1></section></body></html>`
  };
}

function renderAppHarness(
  options: {
    saveResult?: { filePath: string; warnings?: string[] } | null;
    saveError?: Error;
  } = {}
) {
  let openedListener: ((opened: BridgeOpenedFile) => void) | undefined;
  let closeListener: (() => void) | undefined;
  const saveAsHtml = vi.fn(async () => {
    if (options.saveError) {
      throw options.saveError;
    }
    return options.saveResult ?? null;
  });
  const confirmClose = vi.fn(async () => undefined);

  window.htmlpoint = {
    listSamples: async () => [],
    openHtmlDialog: async () => null,
    openSample: async (filePath: string) => ({
      ...openedReport('sample.html', 'Sample'),
      filePath
    }),
    saveAsHtml,
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
    onCloseRequested: (listener) => {
      closeListener = listener;
      return () => {
        closeListener = undefined;
      };
    },
    confirmClose
  } as HtmlpointBridge;

  const { root } = createMountedRoot();
  act(() => root.render(React.createElement(App)));

  return {
    saveAsHtml,
    confirmClose,
    openFile: async (opened: BridgeOpenedFile) => {
      if (!openedListener) {
        throw new Error('Opened-file listener was not registered.');
      }
      await act(async () => {
        openedListener?.(opened);
        await nextTask();
      });
    },
    requestClose: () => {
      if (!closeListener) {
        throw new Error('Close listener was not registered.');
      }
      closeListener();
    }
  };
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
