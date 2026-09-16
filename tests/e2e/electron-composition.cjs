// Chromium composition protocol checks; these do not simulate a physical Windows IME.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlpoint-composition-'));
const outputDir = path.join(root, 'artifacts/verification-2026-09-12');
const result = {method:'Chromium Input.imeSetComposition; physical Windows IME not exercised',checks:[],events:[]};
(async () => {
  fs.cpSync(path.join(root,'tests/fixtures/reports'),scratch,{recursive:true});
  const fixture = path.join(scratch,'relative-assets.html');
  const app = await electron.launch({executablePath:process.env.HTMLPOINT_E2E_EXE,
    args:[...(process.env.HTMLPOINT_E2E_EXE?[]:['.']),`--user-data-dir=${path.join(scratch,'profile')}`,
      '--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling'],cwd:root});
  try {
    const page=await app.firstWindow();
    const errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    const cdp=await page.context().newCDPSession(page);
    await app.evaluate(({dialog},fixture)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});},fixture);
    await page.getByRole('button',{name:'Open HTML',exact:true}).click();
    const preview=page.frameLocator('iframe[title="Report preview"]');
    await expect(preview.locator('html')).toHaveAttribute('data-htmlpoint-preview-ready','true');
    const input=page.getByLabel('KO text',{exact:true});
    await input.evaluate(element=>{
      window.compositionEvidence=[];
      for(const name of ['compositionstart','compositionupdate','compositionend','keydown'])element.addEventListener(name,event=>{
        window.compositionEvidence.push({type:event.type,data:event.data,key:event.key,isComposing:event.isComposing});
      });
    });
    await input.focus();
    await input.press('Control+A');
    for(const text of ['ㅎ','하','한'])await cdp.send('Input.imeSetComposition',{text,selectionStart:1,selectionEnd:1});
    await expect(input).toHaveValue('한');
    await input.press('Control+Enter');
    await expect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
    result.checks.push('Properties does not apply Ctrl+Enter while composing');
    await cdp.send('Input.insertText',{text:'한글 조합 확인'});
    await expect(input).toHaveValue('한글 조합 확인');
    result.events=await page.evaluate(()=>window.compositionEvidence);
    assert(result.events.some(event=>event.type==='compositionstart'));
    assert(result.events.some(event=>event.type==='compositionend'));
    assert(result.events.some(event=>event.type==='keydown'&&event.key==='Enter'&&event.isComposing===true));
    await input.press('Control+Enter');
    await expect(preview.locator('h1')).toHaveText('한글 조합 확인');
    result.checks.push('Completed Korean composition applies exactly once');
    const paragraph=preview.locator('#editable');
    await paragraph.dblclick({position:{x:25,y:6}});
    await expect(paragraph).toHaveAttribute('contenteditable','plaintext-only');
    for(const text of ['ㅎ','하','한'])await cdp.send('Input.imeSetComposition',{text,selectionStart:1,selectionEnd:1});
    await page.keyboard.press('Enter');
    await expect(paragraph).toHaveAttribute('contenteditable','plaintext-only');
    result.checks.push('Inline edit stays active on Enter while composing');
    await cdp.send('Input.insertText',{text:'한글 인라인 입력'});
    await page.keyboard.press('Enter');
    await expect(paragraph).toHaveText('한글 인라인 입력');
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await expect(preview.locator('#editable')).toHaveText('편집 전 문장입니다.');
    await page.getByRole('button',{name:'Redo',exact:true}).click();
    await expect(preview.locator('#editable')).toHaveText('한글 인라인 입력');
    result.checks.push('Inline composition commits with working Undo/Redo');
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await expect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
    assert(fs.readFileSync(fixture,'utf8').includes('한글 인라인 입력'));
    await page.getByRole('button',{name:'Open HTML',exact:true}).click();
    await expect(preview.locator('#editable')).toHaveText('한글 인라인 입력');
    await expect(preview.locator('h1')).toHaveText('한글 조합 확인');
    result.checks.push('Korean text persists through file save and reopen');
    assert.deepEqual(errors,[]);
    result.errors=errors;
    result.status='PASS';
  } catch(error) { result.failure=String(error.stack||error); result.status='FAIL'; throw error; }
  finally {
    fs.writeFileSync(path.join(outputDir,'composition-results.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
    await app.close();
    if(path.dirname(path.resolve(scratch))===path.resolve(os.tmpdir())&&path.basename(scratch).startsWith('htmlpoint-composition-'))
      fs.rmSync(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:300});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
