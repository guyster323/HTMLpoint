import { describe, expect, it } from 'vitest';
import {
  applyTextEffect,
  applyTextStyle,
  cropImage,
  resizeImage,
  resizeImageFrame,
  updateChartPresentation
} from '../src/lib/editing';
import { parseReportHtml } from '../src/lib/htmlParser';

const html = `<!doctype html><html><body><main>
  <section>
    <h2>Final</h2>
    <p><span>현장 점검 미진행</span> 현재 결론입니다.</p>
    <svg aria-label="trend" width="320" height="180"><text>Chart</text></svg>
    <figure class="protected-card" style="width:360px;height:220px;border:4px solid #174c9f;"><img src="data:image/png;base64,AAAA" alt="plot" width="300" height="180"></figure>
  </section>
</main></body></html>`;

const classEffectHtml = `<!doctype html><html><head><style>
  .pill { display:inline-block; border-radius:999px; padding:2px 7px; font-weight:700; font-size:12px; }
  .pill.warn { color:#805600; background:#fff3c4; }
  .pill.bad { color:#8f1d16; background:#ffe4e0; }
  .action-photo-frame { width:360px; height:630px; overflow:hidden; }
  .action-photo-frame img { width:100%; height:100%; object-fit:cover; }
</style></head><body><main>
  <section>
    <p><span class="pill warn">Battery 측 보완 한계</span> 현재 BMIC 부품 변경은 불가합니다.</p>
    <figure style="width:390px;height:660px;padding:15px;"><div class="action-photo-frame"><img src="data:image/png;base64,AAAA" alt="rack" /></div></figure>
  </section>
</main></body></html>`;

describe('presentation object editing', () => {
  it('applies PPT-like badge/effect styles to selected AI-written text', () => {
    let report = parseReportHtml(html);
    const section = report.sections[0];
    const effectNode = section.editableNodes.find((node) => node.text === '현장 점검 미진행')!;

    report = applyTextEffect(report, section.id, effectNode.id, {
      preset: 'warning',
      fill: '#fff4ce',
      textColor: '#7a5200',
      borderColor: '#f2c94c',
      radius: 999,
      bold: true
    });

    expect(report.sections[0].html).toContain('background-color: #fff4ce');
    expect(report.sections[0].html).toContain('border: 1px solid #f2c94c');
    expect(report.sections[0].html).toContain('border-radius: 999px');
    expect(report.sections[0].html).toContain('data-htmlpoint-effect="warning"');
  });

  it('removes AI/PPT effect styles when the None preset is applied', () => {
    let report = parseReportHtml(html);
    const section = report.sections[0];
    const effectNode = section.editableNodes.find((node) => node.text === '현장 점검 미진행')!;

    report = applyTextEffect(report, section.id, effectNode.id, {
      preset: 'none',
      fill: '',
      textColor: '',
      borderColor: '',
      radius: 0,
      bold: false
    });

    expect(report.sections[0].html).not.toContain('data-htmlpoint-effect');
    expect(report.sections[0].html).not.toContain('border-radius');
    expect(report.sections[0].html).not.toContain('background-color');
  });

  it('detects existing class-based report badges as AI/PPT effects', () => {
    const report = parseReportHtml(classEffectHtml);
    const section = report.sections[0];
    const effectNode = section.editableNodes.find((node) => node.text === 'Battery 측 보완 한계')!;

    expect(effectNode.html).toContain('class="pill warn"');
    expect(effectNode.textEffect).toEqual(expect.objectContaining({
      preset: 'warning',
      fill: '#fff3c4',
      textColor: '#805600',
      radius: 999,
      bold: true
    }));
  });

  it('removes class-based report badge styling when None is applied', () => {
    let report = parseReportHtml(classEffectHtml);
    const section = report.sections[0];
    const effectNode = section.editableNodes.find((node) => node.text === 'Battery 측 보완 한계')!;

    report = applyTextEffect(report, section.id, effectNode.id, {
      preset: 'none',
      fill: '',
      textColor: '',
      borderColor: '',
      radius: 0,
      bold: false
    });

    expect(report.sections[0].html).toContain('<span>Battery 측 보완 한계</span>');
    expect(report.sections[0].html).not.toContain('class="pill warn"');
    expect(report.sections[0].html).not.toContain('border-radius');
    expect(report.sections[0].html).not.toContain('background-color');
  });

  it('applies font controls to selected text nodes', () => {
    let report = parseReportHtml(html);
    const section = report.sections[0];
    const textNode = section.editableNodes.find((node) => node.text === '현장 점검 미진행')!;

    report = applyTextStyle(report, section.id, textNode.id, {
      fontFamily: 'Malgun Gothic',
      fontSize: 16,
      bold: true,
      italic: true,
      underline: true,
      color: '#123456'
    });

    expect(report.sections[0].html).toContain('font-family: Malgun Gothic');
    expect(report.sections[0].html).toContain('font-size: 16px');
    expect(report.sections[0].html).toContain('font-weight: 700');
    expect(report.sections[0].html).toContain('font-style: italic');
    expect(report.sections[0].html).toContain('text-decoration: underline');
    expect(report.sections[0].html).toContain('color: #123456');
  });

  it('edits chart presentation while preserving the original chart markup', () => {
    let report = parseReportHtml(html);
    const section = report.sections[0];
    const chartNode = section.editableNodes.find((node) => node.kind === 'chart')!;

    report = updateChartPresentation(report, section.id, chartNode.id, {
      caption: 'BSC01 trend comparison',
      width: 640,
      height: 320,
      frame: true,
      align: 'center'
    });

    expect(report.sections[0].html).toContain('<svg');
    expect(report.sections[0].html).toContain('width="640"');
    expect(report.sections[0].html).toContain('height="320"');
    expect(report.sections[0].html).toContain('BSC01 trend comparison');
    expect(report.sections[0].html).toContain('data-htmlpoint-chart-caption');
  });

  it('crops images by scaling the image inside the same frame and supports explicit size edits', () => {
    let report = parseReportHtml(html);
    const section = report.sections[0];
    const imageNode = section.editableNodes.find((node) => node.kind === 'image')!;

    report = cropImage(report, section.id, imageNode.id, 20);
    expect(report.sections[0].html).toContain('clip-path: inset(20% 20% 20% 20%)');
    expect(report.sections[0].html).toContain('--htmlpoint-crop-scale: 1.67');

    const nextImageNode = report.sections[0].editableNodes.find((node) => node.kind === 'image')!;
    report = resizeImage(report, section.id, nextImageNode.id, { width: 520, height: 260, unit: 'px' });
    expect(report.sections[0].html).toContain('width="520"');
    expect(report.sections[0].html).toContain('height="260"');
    expect(report.sections[0].html).toContain('width: 520px');
  });

  it('resizes the image frame separately from the image content', () => {
    let report = parseReportHtml(html);
    const section = report.sections[0];
    const imageNode = section.editableNodes.find((node) => node.kind === 'image')!;

    report = resizeImageFrame(report, section.id, imageNode.id, { width: 620, height: 260, unit: 'px' });

    expect(report.sections[0].html).toContain('class="protected-card"');
    expect(report.sections[0].html).toContain('width: 620px');
    expect(report.sections[0].html).toContain('height: 260px');
    expect(report.sections[0].html).toContain('<img');
    expect(report.sections[0].html).toContain('width="300"');
  });

  it('resizes nested image frames without corrupting frame-contained image behavior', () => {
    let report = parseReportHtml(classEffectHtml);
    const section = report.sections[0];
    const imageNode = section.editableNodes.find((node) => node.kind === 'image')!;

    report = resizeImageFrame(report, section.id, imageNode.id, { width: 300, height: 500, unit: 'px' });

    expect(report.sections[0].html).toContain('class="action-photo-frame"');
    expect(report.sections[0].html).toContain('width: 300px');
    expect(report.sections[0].html).toContain('height: 500px');
    expect(report.sections[0].html).toContain('overflow: hidden');
    expect(report.sections[0].html).toContain('object-fit: cover');
    expect(report.sections[0].html).toContain('width: 100%');
    expect(report.sections[0].html).toContain('height: 100%');
  });
});
