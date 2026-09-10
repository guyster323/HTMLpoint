import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Electron external-link boundary', () => {
  it('exposes one narrow renderer method and handles it only in the main process', () => {
    const preload = readFileSync('electron/preload.cts', 'utf8');
    const main = readFileSync('electron/main.ts', 'utf8');

    expect(preload).toContain("ipcRenderer.invoke('htmlpoint:open-external-link', url)");
    expect(preload).not.toContain('shell.openExternal');
    expect(main).toContain("ipcMain.handle('htmlpoint:open-external-link'");
    expect(main).toContain('event.senderFrame !== event.sender.mainFrame');
    expect(main).toContain('trustedRendererContents.has(event.sender.id)');
  });

  it('keeps popups denied and adds a subframe navigation guard', () => {
    const main = readFileSync('electron/main.ts', 'utf8');

    expect(main).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))");
    expect(main).toContain("webContents.on('will-frame-navigate'");
    expect(main).toContain('shouldPreventSubframeNavigation(navigationUrl)');
  });

  it('requires native confirmation before the main-process shell opener', () => {
    const main = readFileSync('electron/main.ts', 'utf8');

    expect(main).toContain('dialog.showMessageBox(targetWindow');
    expect(main).toContain('EXTERNAL_LINK_PROMPT_COOLDOWN_MS');
    expect(main).toContain('externalLinkLastPromptAt');
    expect(main).toContain('openExternalLinkWithConfirmation(candidate');
    expect(main).toContain('open: (url) => shell.openExternal(url)');
    expect(main).not.toContain('shell.openExternal(candidate)');
  });
});
