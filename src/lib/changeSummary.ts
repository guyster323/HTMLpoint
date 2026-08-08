import type { EditOperation, ReportSection } from '../types/htmlpoint';

export interface ChangeSummaryEntry {
  id: string;
  category: string;
  label: string;
  timestamp: string;
  sectionTitle?: string;
  before?: string;
  after?: string;
}

interface ChangeSummarySource {
  operations: EditOperation[];
  sections: ReportSection[];
}

type ChangeOperationFormatter = (
  operation: EditOperation,
  sections: ReportSection[]
) => ChangeSummaryEntry;

const CATEGORY_BY_OPERATION_TYPE: Record<EditOperation['type'], string> = {
  text: '텍스트',
  translation: '번역',
  table: '표',
  image: '이미지',
  chart: '차트',
  section: '섹션',
  serialize: '저장'
};

export function formatChangeOperation(
  operation: EditOperation,
  sections: ReportSection[]
): ChangeSummaryEntry {
  return {
    id: operation.id,
    category: CATEGORY_BY_OPERATION_TYPE[operation.type],
    label: operation.label,
    timestamp: new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(operation.timestamp),
    sectionTitle: sections.find((section) => section.id === operation.sectionId)?.title,
    before: formatExcerpt(operation.before),
    after: formatExcerpt(operation.after)
  };
}

export function buildChangeSummaryEntries(
  open: boolean,
  report: ChangeSummarySource | null | undefined,
  formatter: ChangeOperationFormatter = formatChangeOperation
): ChangeSummaryEntry[] {
  if (!open || !report) {
    return [];
  }

  return report.operations.map((operation) => formatter(operation, report.sections));
}

function formatExcerpt(payload: string | undefined): string | undefined {
  if (!payload) {
    return undefined;
  }

  const parsed = new DOMParser().parseFromString(payload, 'text/html');
  parsed
    .querySelectorAll('script, style, template, noscript, iframe, object, embed')
    .forEach((element) => element.remove());
  const text = parsed.body.textContent?.replace(/\s+/g, ' ').trim();

  if (!text) {
    return undefined;
  }

  const codePoints = Array.from(text);
  return codePoints.length > 240 ? `${codePoints.slice(0, 240).join('')}…` : text;
}
