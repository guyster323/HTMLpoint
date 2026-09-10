import type { ReportDocument, ReportLanguage, ReportSection } from '../types/htmlpoint';
import { parseHtml } from './htmlParser';
import { getElementPath } from './domPaths';

export function getVisibleSections(
  report: ReportDocument | null,
  language: ReportLanguage | undefined = report?.activeLanguage
): ReportSection[] {
  if (!report) {
    return [];
  }
  const hasMatchingScope = report.sections.some(
    (section) => section.languageScope === language
  );
  if (!hasMatchingScope) {
    return report.sections;
  }
  return report.sections.filter(
    (section) => !section.languageScope || section.languageScope === language
  );
}

export function findSectionForLanguage(
  report: ReportDocument,
  currentSectionId: string | undefined,
  language: ReportLanguage
): ReportSection | undefined {
  const current = report.sections.find((section) => section.id === currentSectionId);
  const targetSections = getVisibleSections(report, language);
  if (!current) {
    return targetSections[0];
  }
  if (!current.languageScope) {
    return current;
  }

  if (current.sourceId) {
    const sameSourceId = targetSections.find(
      (section) =>
        section.languageScope === language && section.sourceId === current.sourceId
    );
    if (sameSourceId) {
      return sameSourceId;
    }
  }

  const currentScopedSections = report.sections.filter(
    (section) => section.languageScope === current.languageScope
  );
  const targetScopedSections = report.sections.filter(
    (section) => section.languageScope === language
  );
  const logicalIndex = currentScopedSections.findIndex(
    (section) => section.id === current.id
  );
  return targetScopedSections[Math.max(0, logicalIndex)] ?? targetSections[0];
}

export function findSectionForFragment(
  report: ReportDocument,
  fragment: string,
  language: ReportLanguage = report.activeLanguage
): ReportSection | undefined {
  const normalized = decodeFragment(fragment);
  if (!normalized) {
    return undefined;
  }
  const matchesFragment = (section: ReportSection) =>
    section.sourceId === normalized || Boolean(parseHtml(section.html).getElementById(normalized));
  return getVisibleSections(report, language).find(matchesFragment);
}

export function findFragmentPath(
  section: ReportSection,
  fragment: string
): number[] | undefined {
  const normalized = decodeFragment(fragment);
  if (!normalized) {
    return undefined;
  }
  const document = parseHtml(section.html);
  const root = document.body.firstElementChild;
  const target = document.getElementById(normalized);
  return root && target && (target === root || root.contains(target))
    ? getElementPath(root, target)
    : undefined;
}

function decodeFragment(fragment: string): string {
  const withoutHash = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  try {
    return decodeURIComponent(withoutHash).trim();
  } catch {
    return withoutHash.trim();
  }
}
