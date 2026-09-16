import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseReportHtml } from '../src/lib/htmlParser';
import { serializeReportHtml } from '../src/lib/htmlSerializer';
import { getVisibleSections } from '../src/lib/sectionNavigation';

const fixtures = ['relative-assets.html', 'merged-table.html', 'multilingual.html', 'dynamic-chart.html'];
const directory = path.resolve('tests/fixtures/reports');
describe('required bundled report compatibility', () => {
  it.each(fixtures)('round-trips %s without losing source structure', (fileName) => {
    const source = readFileSync(path.join(directory, fileName), 'utf8');
    const report = parseReportHtml(source, { fileName });
    const saved = serializeReportHtml(report);
    expect(saved.warnings).toEqual([]);
    expect(report.sections.length).toBeGreaterThan(0);
    const before = new DOMParser().parseFromString(source, 'text/html');
    const after = new DOMParser().parseFromString(saved.html, 'text/html');
    for (const selector of ['section', 'script', 'style', 'link', 'img', 'svg', 'table', '[rowspan]', '[colspan]', 'strong', 'a']) {
      expect(Array.from(after.querySelectorAll(selector), (e) => e.outerHTML)).toEqual(
        Array.from(before.querySelectorAll(selector), (e) => e.outerHTML)
      );
    }
    if (fileName === 'relative-assets.html') {
      for (const ref of before.querySelectorAll('link[href], img[src]')) {
        expect(existsSync(path.resolve(directory, ref.getAttribute('href') ?? ref.getAttribute('src')!))).toBe(true);
      }
    }
    if (fileName === 'multilingual.html') {
      expect(report.languages).toEqual(['ko', 'en', 'de']);
      expect(getVisibleSections({ ...report, activeLanguage: 'en' }).map((s) => s.title)).toEqual(['Measurement results']);
    }
    if (fileName === 'dynamic-chart.html') {
      const chart = report.sections[0].editableNodes.find((n) => n.kind === 'chart');
      expect(chart?.chart?.rows.map((r) => r.value)).toEqual([10, 20]);
    }
  });
});

// Private field samples are an explicit additional gate; bundled fixtures are always required.
const sampleDirectory = path.resolve('HTML_reference');
if (existsSync(sampleDirectory) || process.env.HTMLPOINT_REQUIRE_LOCAL_SAMPLES === '1') {
  describe('approved local field samples', () => {
    it('requires and round-trips the four approved reports', () => {
      expect(existsSync(sampleDirectory), 'HTML_reference/ with 4 approved reports is required').toBe(true);
      const files = readdirSync(sampleDirectory).filter((name) => name.toLowerCase().endsWith('.html'));
      expect(files).toHaveLength(4);
      for (const fileName of files) {
        const source = readFileSync(path.join(sampleDirectory, fileName), 'utf8');
        const report = parseReportHtml(source, { fileName });
        expect(report.sections.length).toBeGreaterThan(0);
        expect(report.sections[0].editableNodes.length).toBeGreaterThan(0);
        const saved = serializeReportHtml(report);
        expect(saved.warnings).toEqual([]);
        expect(saved.html).toContain('<style');
        expect(saved.html.length).toBeGreaterThan(source.length * 0.9);
      }
    });
  });
}
