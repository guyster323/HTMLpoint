const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch();
  const samples = [];
  const paragraph = `<p>${'Large report content '.repeat(1200)}</p>`;
  const pixel = '<img alt="Inline fixture" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
  const html = `<!doctype html><html><body>${Array.from({ length: 220 }, (_, i) => `<section><h1>Section ${i + 1}</h1>${i === 0 ? pixel : ''}${paragraph}</section>`).join('')}</body></html>`;
  try {
    await verifyInlineEditing(browser);
    for (let run = 1; run <= 3; run++) {
      const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto('http://127.0.0.1:4173');
      await expect(page.getByRole('button', { name: 'Open HTML', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      const started = Date.now();
      await page.evaluate((source) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([source], 'large-inline.html', { type: 'text/html' }));
        document.querySelector('.app-shell').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      }, html);
      const preview = page.frameLocator('iframe[title="Report preview"]');
      await expect(preview.locator('html')).toHaveAttribute('data-htmlpoint-preview-ready', 'true', { timeout: 15000 });
      await expect(preview.locator('h1').first()).toHaveText('Section 1');
      await expect.poll(() => preview.locator('img').first().evaluate((e) => e.complete && e.naturalWidth > 0)).toBe(true);
      await preview.locator('h1').first().click({ position: { x: 40, y: 4 } });
      await expect(page.getByLabel('KO text', { exact: true })).toHaveValue('Section 1');
      const readyMs = Date.now() - started;
      const sectionCount = await page.locator('.thumbnail').count();
      const thumbnailCount = await page.locator('.thumbnail iframe').count();
      assert.equal(sectionCount, 220);
      assert(thumbnailCount < sectionCount);
      await page.getByLabel('KO text', { exact: true }).fill('Ready to edit');
      await page.getByRole('button', { name: 'Apply Text', exact: true }).click();
      await expect(preview.locator('h1').first()).toHaveText('Ready to edit');
      for (const width of [900, 1024, 1280]) {
        await page.setViewportSize({ width, height: 768 });
        await expect.poll(() => page.evaluate(() => {
          const stage = document.querySelector('.canvas-stage');
          return { bodyFits: document.body.scrollWidth <= document.documentElement.clientWidth,
            canvasFits: stage.scrollWidth <= stage.clientWidth + 1,
            zoomMatchesWidth: Number(document.querySelector('input[aria-label="Preview zoom"]').value) ===
              Math.max(1, Math.min(100, Math.floor((stage.clientWidth - 56) / 1120 * 100))) };
        })).toEqual({ bodyFits: true, canvasFits: true, zoomMatchesWidth: true });
      }
      assert.deepEqual(errors, []);
      samples.push({ run, readyMs, thumbnailCount, sectionCount });
      await context.close();
    }
    const medianReadyMs = samples.map((s) => s.readyMs).sort((a, b) => a - b)[1];
    console.log(JSON.stringify({ bytes: Buffer.byteLength(html), samples, medianReadyMs, sloMs: 6000 }));
    assert(medianReadyMs <= 6000, `Usable preview median exceeds 6000ms: ${medianReadyMs}ms`);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });

async function verifyInlineEditing(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173');
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['<html><head><style>section{padding:40px}p{font-size:22px}</style></head><body><section><h1>Inline test</h1><p id="rich">Before <strong>bold</strong> and <a href="https://example.com">link</a> text.</p></section></body></html>'], 'inline.html', { type: 'text/html' }));
      document.querySelector('.app-shell').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    });
    const preview = page.frameLocator('iframe[title="Report preview"]');
    const rich = preview.locator('#rich');
    await expect(preview.locator('html')).toHaveAttribute('data-htmlpoint-preview-ready', 'true');
    await rich.evaluate((e) => { window.originalStrong = e.querySelector('strong'); });
    await rich.dblclick({ position: { x: 35, y: 6 } });
    await expect(rich).toHaveAttribute('contenteditable', 'plaintext-only');
    await page.keyboard.insertText('Cancelled draft');
    await rich.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    await expect(rich).toHaveAttribute('contenteditable', 'plaintext-only');
    await page.keyboard.press('Escape');
    await expect(rich).toHaveText('Before bold and link text.');
    await expect(rich.locator('a')).toHaveAttribute('href', 'https://example.com');
    assert(await rich.evaluate((e) => e.querySelector('strong') === window.originalStrong));
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await rich.click({ position: { x: 35, y: 6 } });
    await page.keyboard.press('F2');
    await expect(rich).toHaveAttribute('contenteditable', 'plaintext-only');
    await page.keyboard.insertText('After bold and link text.');
    await page.keyboard.press('Enter');
    await expect(rich).toHaveText('After bold and link text.');
    await expect(rich.locator('strong')).toHaveText('bold');
    await expect(rich.locator('a')).toHaveText('link');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(rich).toHaveText('Before bold and link text.');
    console.log('Inline editing: double-click, F2, Escape markup restoration, composition guard, commit and Undo passed.');
  } finally { await context.close(); }
}
