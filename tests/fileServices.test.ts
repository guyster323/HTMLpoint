import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseReportHtml } from '../src/lib/htmlParser';
import { parseOpenedFile, saveHtml } from '../src/lib/fileServices';

afterEach(() => {
  delete window.htmlpoint;
});

describe('user-facing save behavior', () => {
  it('saves directly to the current source path when the bridge supports it', async () => {
    const directSave = vi.fn(async (payload: { filePath: string }) => ({ filePath: payload.filePath }));
    const saveAs = vi.fn(async () => null);
    window.htmlpoint = {
      saveHtml: directSave,
      saveAsHtml: saveAs
    } as unknown as NonNullable<typeof window.htmlpoint>;
    const report = parseReportHtml('<!doctype html><html><body><section><p>Report</p></section></body></html>', {
      fileName: 'report.html',
      sourcePath: 'C:\\Reports\\report.html'
    });

    await saveHtml(report);

    expect(directSave).toHaveBeenCalledOnce();
    expect(directSave.mock.calls[0][0].filePath).toBe('C:\\Reports\\report.html');
    expect(saveAs).not.toHaveBeenCalled();
  });

  it('uses Save As when the document has no current path', async () => {
    const saveAs = vi.fn(async () => ({ filePath: 'report.html' }));
    window.htmlpoint = {
      saveAsHtml: saveAs
    } as unknown as NonNullable<typeof window.htmlpoint>;
    const report = parseReportHtml('<!doctype html><html><body><section><p>Report</p></section></body></html>');

    await saveHtml(report);

    expect(saveAs).toHaveBeenCalledOnce();
  });

  it('marks a recovered autosave as modified until the user saves it', () => {
    const report = parseOpenedFile({
      fileName: 'report.html',
      filePath: 'C:\\Reports\\report.html',
      html: '<!doctype html><html><body><section><p>Recovered</p></section></body></html>',
      recovered: true
    });

    expect(report.dirty).toBe(true);
  });
});
