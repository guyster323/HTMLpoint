const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto('http://127.0.0.1:4173');
    const narrowLayout = await page.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      hasOpen: Boolean(document.querySelector('button[aria-label="Open HTML"]')),
      saveDisabled: document.querySelector('button[aria-label="Save As HTML"]')?.disabled,
      hasSectionsControl: Boolean(document.querySelector('[aria-label="Collapse sections panel"]')),
      hasPropertiesControl: Boolean(document.querySelector('[aria-label="Collapse properties panel"]'))
    }));
    if (narrowLayout.scrollWidth !== narrowLayout.clientWidth) throw new Error('1024px page has horizontal overflow.');
    if (!narrowLayout.hasOpen || !narrowLayout.saveDisabled || !narrowLayout.hasSectionsControl || !narrowLayout.hasPropertiesControl) {
      throw new Error('1024px core command/panel gate failed.');
    }
    const paragraph = `<p>${'Large report content '.repeat(1200)}</p>`;
    const html = `<!doctype html><html><body>${Array.from(
      { length: 220 },
      (_, index) => `<section><h1>Section ${index + 1}</h1>${paragraph}</section>`
    ).join('')}</body></html>`;
    const started = Date.now();
    await page.evaluate(({ source }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([source], 'large-inline.html', { type: 'text/html' }));
      document.querySelector('.app-shell').dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
      );
    }, { source: html });
    await page.waitForSelector('iframe[title="Report preview"]', { timeout: 10000 });
    const activePreviewMs = Date.now() - started;
    const thumbnailCount = await page.locator('.thumbnail iframe').count();
    const sectionCount = await page.locator('.thumbnail').count();
    if (activePreviewMs > 6000) throw new Error(`Active preview SLO failed: ${activePreviewMs}ms`);
    if (thumbnailCount >= sectionCount) throw new Error('Offscreen thumbnails were not deferred.');
    console.log(JSON.stringify({ bytes: Buffer.byteLength(html), activePreviewMs, thumbnailCount, sectionCount, narrowLayout }));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
