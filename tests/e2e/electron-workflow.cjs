// Supplemental Electron/Playwright checks. Native file dialogs return fixture paths;
// actual renderer actions, IPC, serializer, preview protocol and disk writes are used.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const output = { method: 'Electron + Playwright; native file-dialog selection stubbed', checks: [], errors: [], requestsFailed: [] };
const root = path.resolve(__dirname, '../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlpoint-workflow-'));
const resultDir = process.env.HTMLPOINT_QA_DIR || path.join(root, 'artifacts', 'verification-2026-09-12');
fs.mkdirSync(resultDir, { recursive: true });
fs.cpSync(path.join(root, 'tests/fixtures/reports'), path.join(scratch, 'fixtures'), { recursive: true });
const fixture = path.join(scratch, 'fixtures', '점검 보고서.html');
fs.copyFileSync(path.join(scratch, 'fixtures', 'relative-assets.html'), fixture);
const destination = path.join(scratch, 'save-as', '저장 결과.html');
const original = fs.readFileSync(fixture, 'utf8');
const pass = (name, details = {}) => { output.checks.push({name, status:'PASS', ...details}); console.log('PASS', name, JSON.stringify(details)); };
(async () => {
  fs.mkdirSync(path.dirname(destination), {recursive:true});
  const executablePath = process.env.HTMLPOINT_E2E_EXE;
  const cdpUrl = process.env.HTMLPOINT_E2E_CDP;
  const app = cdpUrl
    ? await require('./attach-electron.cjs').attachElectron(cdpUrl, process.env.HTMLPOINT_E2E_INSPECTOR)
    : await electron.launch({executablePath,args:[...(executablePath ? [] : ['.']), '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion', `--user-data-dir=${path.join(scratch,'automation-profile')}`],cwd:root});
  output.executable = cdpUrl ? await app.evaluate(() => process.execPath) : executablePath || 'node_modules/electron (current production build)';
  const capture = async (name) => {
    try {
      const png = await app.evaluate(async ({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      fs.writeFileSync(path.join(resultDir,name),Buffer.from(png,'base64'));
    } catch(e) { (output.captureErrors ||= []).push(String(e)); }
  };
  let page;
  try {
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => output.errors.push(String(e)));
    page.on('requestfailed', r => output.requestsFailed.push({url:r.url(),failure:r.failure()}));
    await page.waitForSelector('button[aria-label="Open HTML"]');
    await expect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
    pass('Empty state: Save disabled');
    await app.evaluate(({dialog}, fixture) => {dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});}, fixture);
    await page.getByRole('button',{name:'Open HTML',exact:true}).click();
    await expect(page.locator('.thumbnail')).toHaveCount(3);
    const preview = () => page.frameLocator('iframe[title="Report preview"]');
    await expect(preview().locator('html')).toHaveAttribute('data-htmlpoint-preview-ready','true', {timeout:15000});
    await expect(preview().locator('#editable')).toHaveText('편집 전 문장입니다.');
    await expect.poll(()=>preview().locator('img').evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
    const mainAsset = await preview().locator('img').evaluate(e=>({width:e.naturalWidth,src:e.src}));
    const mainColor = await preview().locator('h1').evaluate(e=>getComputedStyle(e).color);
    assert.equal(mainColor,'rgb(21, 95, 141)');
    pass('Open Korean/spaced path; 3 sections; relative CSS and SVG load',{mainAsset,mainColor});
    const thumb=page.frameLocator('iframe[title="Section 1"]');
    await expect(thumb.getByRole('img', { name: '점검용 도형 · 본문에서 확인' })).toBeVisible();
    await expect(thumb.locator('img')).toHaveCount(0);
    output.thumbnail = { placeholder: true, text: await thumb.getByRole('img').textContent() };
    pass('Thumbnail placeholder replaces missing relative image');
    output.thumbnail.h1Color=await thumb.locator('h1').evaluate(e=>getComputedStyle(e).color);
    console.log('THUMBNAIL', JSON.stringify(output.thumbnail));
    await capture('electron-relative-assets.png');
    await page.locator('.object-chip').filter({hasText:'편집 전 문장입니다.'}).click();
    await page.locator('.properties textarea').first().fill('편집 후 저장 확인 문장입니다.');
    await expect(page.locator('.draft-note')).toBeVisible();
    await page.getByLabel('KO text', { exact: true }).press('Control+Enter');
    await expect(page.locator('.draft-note')).toHaveCount(0);
    await expect(preview().locator('#editable')).toHaveText('편집 후 저장 확인 문장입니다.');
    await expect(page.getByRole('button',{name:'Save',exact:true})).toBeEnabled();
    pass('Properties text edit and dirty state');
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await expect(preview().locator('#editable')).toHaveText('편집 전 문장입니다.');
    await page.getByRole('button',{name:'Redo',exact:true}).click();
    await expect(preview().locator('#editable')).toHaveText('편집 후 저장 확인 문장입니다.');
    pass('Undo and Redo reflect in preview');
    await page.locator('.layout-group > summary').click();
    await page.getByLabel('Object X position').fill('71');
    await page.getByRole('button',{name:'Apply Layout',exact:true}).click();
    await expect(page.getByLabel('Object X position')).toHaveValue('71');
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await expect(page.getByLabel('Object X position')).toHaveValue('41');
    pass('Numeric object movement and single Undo');
    await page.getByRole('button',{name:'Zoom in',exact:true}).click();
    await expect(page.getByRole('button',{name:'Fit preview to canvas'})).toHaveAttribute('aria-pressed','false');
    await page.getByRole('button',{name:'Fit preview to canvas'}).click();
    await expect(page.getByRole('button',{name:'Fit preview to canvas'})).toHaveAttribute('aria-pressed','true');
    pass('Manual zoom exits Fit; Fit restores');
    await page.locator('.thumbnail').filter({hasText:'측정 데이터'}).click();
    await page.locator('.object-chip').filter({hasText:'TABLE'}).click();
    await page.locator('.properties label').filter({has:page.locator('span').filter({hasText:/^Cell text$/})}).locator('input').fill('항목 수정');
    await page.getByRole('button',{name:'Apply Cell',exact:true}).click();
    await expect(preview().locator('#measurements th').first()).toHaveText('항목 수정');
    const count=await preview().locator('#measurements tr').count();
    await page.getByRole('button',{name:'+ Row',exact:true}).click();
    await expect(preview().locator('#measurements tr')).toHaveCount(count+1);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await expect(preview().locator('#measurements tr')).toHaveCount(count);
    pass('Section navigation; table cell editing; row insertion and Undo');
    await page.getByRole('tab',{name:'Review'}).click();
    await page.getByRole('button',{name:'Change summary'}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture('electron-change-summary.png');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    pass('Change summary modal and Escape');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button',{name:'저장 후 계속'})).toBeVisible();
    await capture('electron-dirty-close.png');
    await page.getByRole('button',{name:'취소',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Save',exact:true})).toBeEnabled();
    pass('Dirty close prompts; Cancel retains document');
    await expect.poll(()=>fs.readdirSync(path.join(path.dirname(fixture),'.htmlpoint-backups')).filter(n=>n.includes('.autosave.')).length,{timeout:15000}).toBeGreaterThan(0);
    pass('Autosave file created on disk');
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await expect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
    let saved=fs.readFileSync(fixture,'utf8');
    assert(saved.includes('편집 후 저장 확인 문장입니다.'));
    assert(saved.includes('항목 수정'));
    assert(saved.includes('<strong>보존</strong>'));
    assert(!saved.includes('data-htmlpoint-node-id'));
    pass('Save writes HTML; clean checkpoint; untouched inline markup preserved');
    await app.evaluate(({dialog},destination)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:destination});},destination);
    await page.getByRole('tab',{name:'Export'}).click();
    await page.getByRole('button',{name:'Save As HTML'}).click();
    await expect(page.locator('.document-title')).toContainText('저장 결과.html');
    assert(fs.readFileSync(destination,'utf8').includes('편집 후 저장 확인 문장입니다.'));
    assert.equal(fs.readFileSync(path.join(path.dirname(destination),'assets/report.css'),'utf8'),fs.readFileSync(path.join(path.dirname(fixture),'assets/report.css'),'utf8'));
    assert.equal(fs.readFileSync(path.join(path.dirname(destination),'assets/diagram.svg'),'utf8'),fs.readFileSync(path.join(path.dirname(fixture),'assets/diagram.svg'),'utf8'));
    pass('Save As to another folder copies relative CSS and image unchanged');
    await app.evaluate(({dialog},destination)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[destination]});},destination);
    await page.getByRole('tab',{name:'Home'}).click();
    await page.getByRole('button',{name:'Open HTML',exact:true}).click();
    await expect(page.locator('.document-title')).toContainText('저장 결과.html');
    await expect(preview().locator('#editable')).toHaveText('편집 후 저장 확인 문장입니다.');
    await expect.poll(()=>preview().locator('img').evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
    await capture('electron-reopened.png');
    pass('Reopen saved copy preserves text, table and relative image');
    const resizeAndCheckFit = async (width) => {
      const contentWidth = await app.evaluate(({BrowserWindow}, width) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setSize(width, 768);
        return window.getContentBounds().width;
      }, width);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(contentWidth);
      await expect.poll(() => page.locator('.canvas-stage').evaluate((stage) => {
        const expectedZoom = Math.max(1, Math.min(100, Math.floor((stage.clientWidth - 56) / 1120 * 100)));
        return stage.scrollWidth <= stage.clientWidth + 1 &&
          Number(document.querySelector('input[aria-label="Preview zoom"]').value) === expectedZoom;
      })).toBe(true);
    };
    await resizeAndCheckFit(1024);
    await expect(page.getByRole('button',{name:'Collapse sections panel'})).toBeVisible();
    const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.body.scrollWidth,clientWidth:document.documentElement.clientWidth}));
    assert.equal(layout.scrollWidth,layout.clientWidth);
    await page.getByRole('button',{name:'Collapse sections panel'}).click();
    await expect(page.getByRole('button',{name:'Expand sections panel'})).toBeVisible();
    await page.getByRole('button',{name:'Expand sections panel'}).click();
    await resizeAndCheckFit(1024);
    await capture('electron-narrow.png');
    pass('1024px native window: no body overflow; panels toggle',layout);
    for (const width of [900, 1024, 1280]) {
      await resizeAndCheckFit(width);
    }
    pass('Fit avoids canvas horizontal overflow at 900, 1024 and 1280px');
    assert.deepEqual(output.errors, []);
    fs.copyFileSync(destination, path.join(resultDir, 'saved-result.html'));
    fs.cpSync(path.join(scratch,'save-as','assets'),path.join(resultDir,'assets'),{recursive:true});
    const openFixture = async (name) => {
      await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.join(scratch,'fixtures',name));
      await page.getByRole('tab',{name:'Home'}).click();
      await page.getByRole('button',{name:'Open HTML',exact:true}).click();
      await expect(page.locator('.document-title')).toContainText(name);
      await expect(preview().locator('html')).toHaveAttribute('data-htmlpoint-preview-ready','true',{timeout:15000});
    };
    await openFixture('merged-table.html');
    await expect(preview().locator('th[rowspan="2"]')).toHaveCount(2);
    await expect(preview().locator('th[colspan="2"]')).toHaveCount(1);
    pass('Bundled merged table renders with row and column spans');
    await openFixture('multilingual.html');
    await page.getByRole('button',{name:'Language EN',exact:true}).click();
    await expect(page.locator('.thumbnail')).toHaveCount(1);
    await expect(page.locator('.thumb-title')).toHaveText('Measurement results');
    await expect(preview().locator('[data-report-lang="en"] h1')).toBeVisible();
    await expect(preview().locator('[data-report-lang="ko"] h1')).not.toBeVisible();
    pass('Bundled language switch updates visible preview and Section rail');
    await openFixture('dynamic-chart.html');
    await expect(preview().locator('.rack-heatmap-host td').last()).toHaveText('42');
    await page.locator('.object-chip').filter({hasText:'CHART'}).click();
    await page.locator('.chart-data-box textarea').fill('A,20\nB,10');
    await page.getByRole('button',{name:'Apply Data',exact:true}).click();
    await expect(preview().locator('svg rect').first()).toHaveAttribute('height','100');
    await expect(preview().locator('svg rect').nth(1)).toHaveAttribute('height','50');
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await expect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
    pass('Bundled dynamic table renders; SVG data edit updates bars and saves');
    assert.deepEqual(output.errors, []);
  } catch(e) {
    output.failure=String(e.stack||e);
    if(page) {await capture('electron-failure.png');console.log(await page.locator('body').innerText().catch(()=>''));}
    throw e;
  } finally {
    fs.writeFileSync(path.join(resultDir,'electron-functional-results.json'),JSON.stringify(output,null,2));
    await app.close();
    fs.writeFileSync(fixture,original,'utf8');
    const safeScratch = path.resolve(scratch);
    if (path.dirname(safeScratch) === path.resolve(os.tmpdir()) && path.basename(safeScratch).startsWith('htmlpoint-workflow-')) {
      fs.rmSync(safeScratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    }
  }
})().catch(e=>{console.error(e);process.exitCode=1});
