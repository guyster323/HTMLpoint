import { describe, expect, it } from 'vitest';
import { createRenderedDocumentSnapshot } from '../src/lib/renderSnapshot';
import { findImportCandidates, parseReportHtml } from '../src/lib/htmlParser';
import { serializeReportHtml } from '../src/lib/htmlSerializer';

const cases = [
  {
    name: 'semantic section with assets',
    html: '<!doctype html><html><body><section><h1>Report</h1><img src="assets/report.png" alt="chart"></section></body></html>'
  },
  {
    name: 'merged table',
    html: '<!doctype html><html><body><section><table><thead><tr><th colspan="2">Header</th></tr></thead><tbody><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></tbody></table></section></body></html>'
  },
  {
    name: 'multilingual report panes',
    html: '<!doctype html><html><body><article data-report-lang="ko"><section><h2>한국어</h2></section></article><article data-report-lang="en"><section><h2>English</h2></section></article></body></html>'
  },
  {
    name: 'dynamic svg chart',
    html: '<!doctype html><html><body><section><svg class="chart"><rect x="0" y="0" width="40" height="120"></rect><text>10</text></svg></section></body></html>'
  },
  {
    name: 'minimal fig canvas',
    html: '<!doctype html><html><body><div class="fig-canvas"><div class="fig-node" data-node-id="a">A</div><div class="fig-edge" data-edge-id="e" data-from="a" data-to="a"></div></div></body></html>'
  },
  {
    name: 'multiple canvas regions',
    html: '<!doctype html><html><body><div class="fig-canvas"><div class="fig-node" data-node-id="a">A</div></div><div class="fig-canvas"><div class="fig-node" data-node-id="b">B</div></div></body></html>'
  },
  {
    name: 'static fig svg',
    html: '<!doctype html><html><body><div class="fig-canvas"><svg><rect width="120" height="40"></rect><text>Static</text></svg></div></body></html>'
  },
  {
    name: 'portrait and landscape slide containers',
    html: '<!doctype html><html><body><div class="slide-portrait"><h1>Portrait</h1></div><div class="slide"><h1>Landscape</h1></div></body></html>'
  },
  {
    name: 'rich text and links',
    html: '<!doctype html><html><body><section><p><strong>Bold</strong> <em>Italic</em> <a href="https://example.com">Link</a></p><ul><li>Item</li></ul></section></body></html>'
  },
  {
    name: 'rotated shape and stacking context',
    html: '<!doctype html><html><body><section><div class="htmlpoint-shape" data-htmlpoint-object-id="shape-1" data-shape-type="ellipse" style="transform:rotate(10deg);z-index:2">Shape</div></section></body></html>'
  },
  {
    name: 'large table page',
    html: `<!doctype html><html><body><section><h2>Rows</h2><table><tbody>${Array.from({ length: 20 }, (_, index) => `<tr><td>${index + 1}</td><td>Value ${index + 1}</td></tr>`).join('')}</tbody></table></section></body></html>`
  },
  {
    name: 'unsupported asset and css warning',
    html: '<!doctype html><html><body><section style="width:640px;height:360px"><img style="width:800px;height:420px" alt="Missing"><div style="filter:blur(4px)">CSS</div></section></body></html>',
    snapshot: true
  }
] as const;

describe('2026-09 improvement verification cases', () => {
  it.each(cases)('loads, serializes, and reopens $name', (testCase) => {
    const { html } = testCase;
    const report = parseReportHtml(html);
    expect(report.sections.length).toBeGreaterThan(0);
    const serialized = serializeReportHtml(report);
    const reopened = parseReportHtml(serialized.html);
    expect(reopened.sections.length).toBe(report.sections.length);
    expect(serialized.html).toContain('<html');
    if ('snapshot' in testCase && testCase.snapshot) {
      const rendered = createRenderedDocumentSnapshot(report);
      expect(rendered.warnings.some((warning) => warning.code === 'missing-asset')).toBe(true);
    }
  });

  it('keeps candidate selection explicit for unknown wrappers', () => {
    const html = '<!doctype html><html><body><main><div><h1>Candidate</h1><p>Text</p></div></main></body></html>';
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(findImportCandidates(document)).toHaveLength(1);
  });
});
