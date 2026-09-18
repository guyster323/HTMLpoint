import { describe, expect, it } from 'vitest';
import { parseReportHtml } from '../src/lib/htmlParser';
import { serializeDeploymentHtml } from '../src/lib/deployment';

describe('deployment HTML export', () => {
  it('freezes the active language and removes editor/runtime scripts', () => {
    const report = parseReportHtml(`<!doctype html><html><body>
      <div data-report-lang="ko"><section><h1>한국어</h1></section></div>
      <div data-report-lang="en"><section><h1>English</h1></section></div>
      <script>window.dynamicReport = true;</script>
    </body></html>`);
    const result = serializeDeploymentHtml({ ...report, activeLanguage: 'en' });
    const document = new DOMParser().parseFromString(result.html, 'text/html');
    expect(result.removedScripts).toBe(1);
    expect(document.scripts).toHaveLength(0);
    expect(document.querySelector<HTMLElement>('[data-report-lang="ko"]')?.style.display).toBe('none');
    expect(document.querySelector<HTMLElement>('[data-report-lang="en"]')?.style.display).not.toBe('none');
    expect(result.html).not.toContain('data-htmlpoint-node-id');
    expect(result.warnings).toContain('배포용 HTML에서 동적 script 1개를 제거했습니다.');
  });
});
