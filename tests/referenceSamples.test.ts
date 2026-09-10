import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseReportHtml } from '../src/lib/htmlParser';
import { serializeReportHtml } from '../src/lib/htmlSerializer';

const sampleDirectory = path.resolve('HTML_reference');
const hasLocalSamples = existsSync(sampleDirectory);
const sampleFiles = hasLocalSamples
  ? readdirSync(sampleDirectory).filter((fileName) => fileName.toLowerCase().endsWith('.html'))
  : [];
const describeLocalSamples = hasLocalSamples ? describe : describe.skip;
describeLocalSamples('HTML_reference sample compatibility (local fixture set)', () => {
  it('keeps all four approved sample reports parseable and serializable', () => {
    expect(sampleFiles).toHaveLength(4);

    sampleFiles.forEach((fileName) => {
      const html = readFileSync(path.join(sampleDirectory, fileName), 'utf8');
      const report = parseReportHtml(html, { fileName });
      const saved = serializeReportHtml(report);
      expect(report.sections.length, fileName).toBeGreaterThan(0);
      expect(report.sections[0].editableNodes.length, fileName).toBeGreaterThan(0);
      expect(saved.warnings, fileName).toEqual([]);
      expect(saved.html, fileName).toContain('<style');
      expect(saved.html.length, fileName).toBeGreaterThan(html.length * 0.9);
    });
  });
});
