import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SectionRail } from '../src/components/SectionRail';
import { StatusBar } from '../src/components/StatusBar';
import { moveSection } from '../src/lib/editing';
import { editorSessionReducer, emptyEditorSession } from '../src/lib/editorSession';
import { parseReportHtml } from '../src/lib/htmlParser';
import { serializeReportHtml } from '../src/lib/htmlSerializer';
import {
  collectExternalReportUrls,
  buildPreviewHtml,
  buildPreviewSectionPayloads,
  normalizeExternalPreviewUrl
} from '../src/lib/preview';
import {
  findFragmentPath,
  findSectionForFragment,
  findSectionForLanguage,
  getVisibleSections
} from '../src/lib/sectionNavigation';

const multilingualHtml = `<!doctype html><html lang="ko"><body>
  <div class="language-dock">
    <button data-lang="ko">KO</button><button data-lang="en">EN</button><button data-lang="de">DE</button>
  </div>
  <article data-report-lang="ko"><header id="cover"><h1>KO Cover</h1></header><section id="details"><h2>KO Details</h2></section></article>
  <article data-report-lang="en"><header id="cover"><h1>EN Cover</h1></header><section id="details"><h2>EN Details</h2></section></article>
  <article data-report-lang="de"><header id="cover"><h1>DE Cover</h1></header><section id="details"><h2>DE Details</h2></section></article>
</body></html>`;

describe('uploaded report compatibility regressions', () => {
  it('shows only the active language pane in Sections and maps selection by source id', () => {
    const report = parseReportHtml(multilingualHtml);
    expect(report.languages).toEqual(['ko', 'en', 'de']);
    expect(report.sections.map((section) => section.languageScope)).toEqual([
      'ko', 'ko', 'en', 'en', 'de', 'de'
    ]);
    expect(getVisibleSections(report).map((section) => section.title)).toEqual([
      'KO Cover', 'KO Details'
    ]);

    const koDetails = report.sections.find((section) => section.title === 'KO Details')!;
    expect(findSectionForLanguage(report, koDetails.id, 'de')?.title).toBe('DE Details');

    const deReport = { ...report, activeLanguage: 'de' };
    const rail = renderToStaticMarkup(
      React.createElement(SectionRail, {
        report: deReport,
        selectedSectionId: findSectionForLanguage(report, koDetails.id, 'de')?.id,
        onSelect: () => undefined,
        onDuplicate: () => undefined
      })
    );
    expect(rail).toContain('DE Cover');
    expect(rail).toContain('DE Details');
    expect(rail).not.toContain('KO Details');
    expect(rail).not.toContain('EN Details');

    const status = renderToStaticMarkup(
      React.createElement(StatusBar, {
        report: deReport,
        selectedIndex: 1,
        zoom: 100,
        onZoomChange: () => undefined
      })
    );
    expect(status).toContain('Section 2 of 2');
  });

  it('maps language panes by ordinal when the source has no section ids', () => {
    const report = parseReportHtml(`<!doctype html><html><body>
      <article data-report-lang="ko"><header><h1>KO A</h1></header><section><h2>KO B</h2></section></article>
      <article data-report-lang="en"><header><h1>EN A</h1></header><section><h2>EN B</h2></section></article>
    </body></html>`);
    const current = report.sections.find((section) => section.title === 'KO B')!;
    expect(findSectionForLanguage(report, current.id, 'en')?.title).toBe('EN B');

    const state = editorSessionReducer(
      editorSessionReducer(emptyEditorSession(), { type: 'load', report }),
      { type: 'set-language', language: 'en' }
    );
    expect(state.report?.activeLanguage).toBe('en');
    expect(state.report?.dirty).toBe(false);
    expect(state.selection.sectionId).toBe(report.sections[2].id);
    expect(state.past).toHaveLength(0);
  });

  it('never moves or fragment-navigates into a hidden language pane', () => {
    const report = parseReportHtml(`<!doctype html><html><body>
      <section data-report-lang="ko" id="ko-first"><h2>KO First</h2></section>
      <section data-report-lang="en" id="en-only"><h2>EN Only</h2></section>
      <section data-report-lang="ko" id="ko-last"><h2>KO Last</h2></section>
      <section data-report-lang="de" id="hidden-target"><h2>DE Hidden</h2></section>
    </body></html>`);
    report.activeLanguage = 'en';
    expect(findSectionForFragment(report, '#hidden-target', 'en')).toBeUndefined();

    const koFirst = report.sections.find((section) => section.sourceId === 'ko-first')!;
    const moved = moveSection(report, koFirst.id, 1);
    expect(moved.sections.map((section) => section.sourceId)).toEqual([
      'ko-last',
      'en-only',
      'ko-first',
      'hidden-target'
    ]);
  });

  it('marks the exact selected duplicate-id pane in the preview', () => {
    const report = parseReportHtml(multilingualHtml);
    const selected = report.sections.find((section) => section.title === 'EN Details')!;
    const preview = buildPreviewHtml(report, selected.id, 'en');
    const document = new DOMParser().parseFromString(preview, 'text/html');
    const marked = Array.from(
      document.querySelectorAll('[data-htmlpoint-preview-section]')
    ).find(
      (element) =>
        element.getAttribute('data-htmlpoint-preview-section') === selected.id
    );
    expect(marked?.textContent).toContain('EN Details');
    expect(marked?.textContent).not.toContain('KO Details');
    expect(preview).toContain('selectedSlideElement');
    expect(preview).toContain('requestAnimationFrame(initializePreview)');
    expect(preview).toContain("scrollBehavior = 'auto'");
    expect(preview).toContain("behavior: 'auto'");
  });

  it('makes objects in every visible Section switch and preserve their object selection', () => {
    const report = parseReportHtml(multilingualHtml);
    const selected = report.sections.find((section) => section.title === 'EN Cover')!;
    const other = report.sections.find((section) => section.title === 'EN Details')!;
    const otherNode = other.editableNodes[0];
    const payloads = buildPreviewSectionPayloads(report, 'en');
    expect(payloads.map((payload) => payload.id)).toEqual([
      selected.id,
      other.id
    ]);

    const preview = buildPreviewHtml(report, selected.id, 'en');
    expect(preview).toContain('htmlpoint-select-section-node');
    expect(preview).toContain('htmlpoint-select-section-runtime');
    expect(preview).toContain(otherNode.id);
    expect(preview).toContain('data-htmlpoint-section-id');
    expect(preview).toContain('Section 이동');
  });

  it('keeps exact Section and object identities when serializer parent groups interleave', () => {
    const report = parseReportHtml(`<!doctype html><html><body>
      <section><h2>Outer A</h2><p>Object A</p></section>
      <div><section><h2>Nested B</h2><p>Object B</p></section></div>
      <section><h2>Outer C</h2><p>Object C</p></section>
    </body></html>`);
    const preview = buildPreviewHtml(report, report.sections[0].id, 'ko');
    const document = new DOMParser().parseFromString(preview, 'text/html');

    report.sections.forEach((section) => {
      const markedSection = Array.from(
        document.querySelectorAll<HTMLElement>('[data-htmlpoint-preview-section]')
      ).find(
        (element) => element.dataset.htmlpointPreviewSection === section.id
      );
      expect(markedSection?.textContent).toContain(section.title);
      section.editableNodes.forEach((node) => {
        const markedNode = Array.from(
          markedSection?.querySelectorAll<HTMLElement>('[data-htmlpoint-node-id]') ?? []
        ).find((element) => element.dataset.htmlpointNodeId === node.id);
        expect(markedNode?.dataset.htmlpointSectionId).toBe(section.id);
      });
    });
    expect(serializeReportHtml(report).html).not.toContain(
      'data-htmlpoint-serialized-section'
    );
  });

  it('pre-marks an editable object before source scripts can shift its DOM path', () => {
    const report = parseReportHtml(`<!doctype html><html><body><section>
      <h2>Scripted Section</h2><p id="stable-target">Stable target</p>
      <script>
        const target = document.getElementById('stable-target');
        target?.parentElement?.insertBefore(document.createElement('span'), target);
      </script>
    </section></body></html>`);
    const section = report.sections[0];
    const targetNode = section.editableNodes.find((node) => node.text === 'Stable target')!;
    const preview = buildPreviewHtml(report, section.id, 'ko');
    const document = new DOMParser().parseFromString(preview, 'text/html');
    const target = document.getElementById('stable-target');

    expect(target?.getAttribute('data-htmlpoint-node-id')).toBe(targetNode.id);
    expect(target?.getAttribute('data-htmlpoint-section-id')).toBe(section.id);
    expect(preview).toContain('function elementForNode');
  });

  it('exposes a dynamic heatmap disclosure as an editable outline target', () => {
    const report = parseReportHtml(`<!doctype html><html><body><section id="visuals">
      <h2>시각화</h2>
      <details class="rack-heatmap-details" open>
        <summary>전체 Rack Heatmap 보기 열기</summary>
        <div class="rack-heatmap-panel"><div class="rack-heatmap-host"></div></div>
      </details>
    </section></body></html>`);
    const section = report.sections[0];
    expect(section.outlineItems).toEqual([
      expect.objectContaining({
        label: '전체 Rack Heatmap 보기 열기',
        dynamic: true
      })
    ]);
    expect(section.editableNodes.some((node) => node.tagName === 'summary')).toBe(true);

    const preview = buildPreviewHtml(
      report,
      section.id,
      'ko',
      undefined,
      [],
      undefined,
      section.outlineItems?.[0].path
    );
    expect(preview).toContain('htmlpoint-capture-runtime-table');
    expect(preview).toContain('htmlpoint-runtime-table');
    expect(preview).toContain('MutationObserver');
    expect(preview).toContain('runtimeObserver.observe(document.body');
    expect(preview).not.toContain('runtimeObservers.forEach');
  });

  it('routes fragments within the active language and only allowlists safe external links', () => {
    const report = parseReportHtml(multilingualHtml);
    report.activeLanguage = 'de';
    const target = findSectionForFragment(report, '#details');
    expect(target?.title).toBe('DE Details');
    expect(findFragmentPath(target!, '#details')).toEqual([]);

    const links = collectExternalReportUrls(`<!doctype html><html><body>
      <a href="https://example.com/report?q=1">safe</a>
      <a href="//docs.example.com/help">protocol-relative</a>
      <a href="javascript:alert(1)">bad</a>
      <a href="https://user:pass@example.com/private">credentials</a>
      <a href="relative.html">relative</a>
    </body></html>`);
    expect([...links]).toEqual([
      'https://example.com/report?q=1',
      'https://docs.example.com/help'
    ]);
    expect(normalizeExternalPreviewUrl('data:text/html,bad')).toBeUndefined();

    const baseLinks = collectExternalReportUrls(`<!doctype html><html><head>
      <base href="https://docs.example.com/manual/">
    </head><body><a href="guide.html#rack">Guide</a></body></html>`);
    expect([...baseLinks]).toEqual([
      'https://docs.example.com/manual/guide.html#rack'
    ]);
  });
});
