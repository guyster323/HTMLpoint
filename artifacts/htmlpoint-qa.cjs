const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('@playwright/test');

(async () => {
  const port = process.env.HTMLPOINT_QA_PORT || '4173';
  const samplePath = path.resolve(
    'HTML_reference',
    'GR23KR0005_에너지게이트_부산진구청_Cell전압벌어짐_Noise측정report_260610.html'
  );
  const content = fs.readFileSync(samplePath, 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1665, height: 970 } });
  const messages = [];
  page.on('console', (msg) => messages.push(`${msg.type()}: ${msg.text()}`));

  try {
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
    await page.evaluate(
      ({ name, content }) => {
        const shell = document.querySelector('.app-shell');
        if (!shell) {
          throw new Error('App shell was not mounted');
        }
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File([content], name, { type: 'text/html' }));
        ['dragenter', 'dragover', 'drop'].forEach((type) => {
          shell.dispatchEvent(
            new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer })
          );
        });
      },
      { name: path.basename(samplePath), content }
    );
    await page.waitForSelector('.thumbnail', { timeout: 20000 });
    await page.getByText('이슈 및 사이트 개요', { exact: true }).click();
    await page.waitForTimeout(750);

    const firstChip = page.locator('.object-chip').filter({ hasText: 'GR23KR0005' }).first();
    await firstChip.click();
    await page.waitForTimeout(400);
    let selectedLabel = await page
      .locator('.properties select')
      .first()
      .evaluate((el) => el.options[el.selectedIndex]?.textContent || '');
    let textValue = await page.locator('.properties textarea').first().inputValue();
    assert(selectedLabel.includes('GR23KR0005'), `Selected label mismatch: ${selectedLabel}`);
    assert.strictEqual(textValue.trim(), 'GR23KR0005');

    const secondChip = page
      .locator('.object-chip')
      .filter({ hasText: '에너지게이트_부산진구청' })
      .first();
    await secondChip.click();
    await page.waitForTimeout(400);
    selectedLabel = await page
      .locator('.properties select')
      .first()
      .evaluate((el) => el.options[el.selectedIndex]?.textContent || '');
    textValue = await page.locator('.properties textarea').first().inputValue();
    assert(
      selectedLabel.includes('에너지게이트_부산진구청'),
      `Selected label mismatch: ${selectedLabel}`
    );
    assert.strictEqual(textValue.trim(), '에너지게이트_부산진구청');

    const frame = page.frameLocator('iframe[title="Report preview"]');
    const inlineTarget = frame
      .locator('[data-htmlpoint-node-id][title^="TEXT"]')
      .filter({ hasText: '에너지게이트_부산진구청' })
      .first();
    await inlineTarget.evaluate((element) => {
      window.__htmlpointQaEvents = [];
      ['mousedown', 'mouseup', 'click', 'dblclick'].forEach((type) => {
        element.addEventListener(
          type,
          (event) => {
            window.__htmlpointQaEvents.push({
              type,
              detail: event.detail,
              target: event.target instanceof Element ? event.target.tagName : ''
            });
          },
          true
        );
      });
    });
    await inlineTarget.dblclick();
    const eventLog = await inlineTarget.evaluate(() => window.__htmlpointQaEvents || []);
    console.log(`Inline target events: ${JSON.stringify(eventLog)}`);
    const editState = await frame
      .locator('.htmlpoint-inline-editing')
      .first()
      .evaluate((element) => ({
        nodeId: element.getAttribute('data-htmlpoint-node-id'),
        contentEditable: element.getAttribute('contenteditable'),
        isContentEditable: element.isContentEditable,
        text: element.textContent
      }))
      .catch((error) => ({ error: String(error) }));
    assert.strictEqual(editState.error, undefined, `Inline edit did not start: ${editState.error}`);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type('CanvasEditTest');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.body.innerText.includes('CanvasEditTest'), null, {
      timeout: 10000
    });
    textValue = await page.locator('.properties textarea').first().inputValue();
    assert.strictEqual(textValue.trim(), 'CanvasEditTest');

    await page.getByText('조치 사항 사진', { exact: true }).click();
    await page.waitForTimeout(750);
    await page.locator('.object-chip').filter({ hasText: 'IMAGE' }).first().click();
    await page.waitForTimeout(400);
    await page.getByText('Lock ratio').first().waitFor({ timeout: 10000 });
    const ratioCount = await page.getByText('Lock ratio').count();
    assert(ratioCount >= 2, `Expected image and frame lock-ratio controls, saw ${ratioCount}`);

    await page.screenshot({
      path: 'artifacts/htmlpoint-selection-inline-ratio-qa.png',
      fullPage: true
    });
    console.log('Playwright QA passed');
  } finally {
    const errorMessages = messages.filter((message) => /error/i.test(message));
    if (errorMessages.length) {
      console.log('Console messages with error text:');
      console.log(errorMessages.join('\n'));
    }
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
