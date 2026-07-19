import { describe, expect, it } from 'vitest';
import { acceptDroppedHtmlFile, hasRelativeAssetReference, isAcceptedHtmlFile } from '../src/lib/dropImport';

describe('HTML drag and drop import', () => {
  it('accepts .html/.htm files and rejects other files', () => {
    expect(isAcceptedHtmlFile({ name: 'report.html', type: 'text/html' })).toBe(true);
    expect(isAcceptedHtmlFile({ name: 'report.htm', type: '' })).toBe(true);
    expect(isAcceptedHtmlFile({ name: 'report.png', type: 'image/png' })).toBe(false);
  });

  it('turns a dropped HTML File into the same opened-file payload used by Open HTML', async () => {
    const file = new File(['<!doctype html><html><body><section><h2>Dropped</h2></section></body></html>'], 'dropped.html', {
      type: 'text/html'
    });

    await expect(acceptDroppedHtmlFile(file)).resolves.toMatchObject({
      fileName: 'dropped.html',
      html: expect.stringContaining('Dropped')
    });
  });

  it('detects relative dependencies when a browser drop cannot provide a safe source path', () => {
    expect(hasRelativeAssetReference('<img src="assets/photo.png">')).toBe(true);
    expect(hasRelativeAssetReference('<link href="https://example.com/app.css">')).toBe(false);
    expect(hasRelativeAssetReference('<img src="data:image/png;base64,AA==">')).toBe(false);
  });
});
