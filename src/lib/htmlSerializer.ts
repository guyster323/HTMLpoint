import { ReportDocument, SaveResult, TranslationEntry } from '../types/htmlpoint';
import { serializeFullDocument, stripEditorArtifacts } from './editorArtifacts';
import { getParentKey, getSlideElements, parseHtml } from './htmlParser';

interface SlideGroup {
  key: string;
  elements: HTMLElement[];
}

export function serializeReportHtml(report: ReportDocument): SaveResult {
  const document = parseHtml(report.sourceHtml);
  stripEditorArtifacts(document);
  const groups = groupSlideElements(document);
  const warnings: string[] = [];

  groups.forEach((group) => {
    const first = group.elements[0];
    const parent = first?.parentNode;
    if (!first || !parent) {
      warnings.push(`원본 그룹을 찾을 수 없습니다: ${group.key}`);
      return;
    }

    const marker = document.createComment(`htmlpoint:${group.key}`);
    parent.insertBefore(marker, first);
    group.elements.forEach((element) => element.remove());

    report.sections
      .filter((section) => section.parentKey === group.key)
      .forEach((section) => {
        const sectionDocument = parseHtml(section.html);
        const element = sectionDocument.body.firstElementChild as HTMLElement | null;
        if (!element) {
          warnings.push(`섹션을 저장할 수 없습니다: ${section.title}`);
          return;
        }
        stripEditorArtifacts(sectionDocument);
        cleanEditorAttributes(element);
        if (section.hidden) {
          element.dataset.htmlpointHidden = 'true';
          element.style.display = 'none';
        } else {
          element.removeAttribute('data-htmlpoint-hidden');
          if (element.style.display === 'none') {
            element.style.display = '';
          }
        }
        parent.insertBefore(document.importNode(element, true), marker);
      });

    marker.remove();
  });

  applyTranslationUpdates(document, report.translations);

  const html = serializeFullDocument(document);
  return {
    html,
    changedSections: report.sections
      .filter((section) => section.changed || section.hidden)
      .map((section) => section.title),
    warnings
  };
}

function groupSlideElements(document: Document): SlideGroup[] {
  const groups = new Map<string, HTMLElement[]>();
  getSlideElements(document).forEach((element) => {
    const key = element.parentElement ? getParentKey(document, element.parentElement) : 'body';
    const existing = groups.get(key) ?? [];
    existing.push(element);
    groups.set(key, existing);
  });
  return Array.from(groups, ([key, elements]) => ({ key, elements }));
}

function cleanEditorAttributes(element: HTMLElement): void {
  element.querySelectorAll<HTMLElement>('[data-htmlpoint-node-id]').forEach((node) => {
    node.removeAttribute('data-htmlpoint-node-id');
  });
  element.removeAttribute('data-htmlpoint-edited');
}

function applyTranslationUpdates(document: Document, translations: TranslationEntry[]): void {
  if (!translations.length) {
    return;
  }

  Array.from(document.scripts).forEach((script) => {
    const source = script.textContent ?? '';
    if (!source.includes('translations')) {
      return;
    }

    let nextSource = source;
    translations.forEach((entry) => {
      nextSource = replaceTranslationEntry(nextSource, entry.selector, entry.enHtml);
    });
    script.textContent = nextSource;
  });
}

function replaceTranslationEntry(source: string, selector: string, enHtml: string): string {
  const entryPattern = /\[\s*(['"])(.*?)\1\s*,\s*(['"])([\s\S]*?)\3\s*\]/g;
  return source.replace(entryPattern, (entry, _selectorQuote, rawSelector) => {
    if (unescapeScriptString(rawSelector) !== selector) {
      return entry;
    }
    return `[${quoteScriptString(selector)}, ${quoteScriptString(enHtml)}]`;
  });
}

function quoteScriptString(value: string): string {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}'`;
}

function unescapeScriptString(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}
