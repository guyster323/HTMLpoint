import { describe, expect, it, vi } from 'vitest';
import { buildChangeSummaryEntries, formatChangeOperation } from '../src/lib/changeSummary';
import type { ChangeSummaryEntry } from '../src/lib/changeSummary';
import type { EditOperation, ReportSection } from '../src/types/htmlpoint';

const sections: ReportSection[] = [
  {
    id: 'section-results',
    kind: 'section',
    title: '점검 결과',
    parentKey: 'main',
    html: '<section></section>',
    textPreview: '',
    hidden: false,
    editableNodes: [],
    changed: false
  }
];

const operation: EditOperation = {
  id: 'operation-table-column-delete',
  type: 'table',
  label: '표 열 삭제',
  sectionId: 'section-results',
  before: 'Before value',
  after: 'After value',
  timestamp: Date.UTC(2026, 7, 8, 3, 4)
};

describe('buildChangeSummaryEntries', () => {
  const laterOperation: EditOperation = {
    ...operation,
    id: 'operation-later',
    label: 'Later operation',
    timestamp: operation.timestamp + 1
  };

  const formatter = vi.fn(
    (currentOperation: EditOperation, _sections: ReportSection[]): ChangeSummaryEntry => ({
      id: currentOperation.id,
      category: '표',
      label: currentOperation.label,
      timestamp: String(currentOperation.timestamp)
    })
  );

  it('returns no entries without invoking the formatter while closed', () => {
    formatter.mockClear();

    const entries = buildChangeSummaryEntries(
      false,
      { operations: [operation, laterOperation], sections },
      formatter
    );

    expect(entries).toEqual([]);
    expect(formatter).not.toHaveBeenCalled();
  });

  it('formats each operation once in original history order while open', () => {
    formatter.mockClear();

    const entries = buildChangeSummaryEntries(
      true,
      { operations: [operation, laterOperation], sections },
      formatter
    );

    expect(entries.map((entry) => entry.id)).toEqual([operation.id, laterOperation.id]);
    expect(formatter.mock.calls.map(([currentOperation]) => currentOperation.id)).toEqual([
      operation.id,
      laterOperation.id
    ]);
    expect(formatter).toHaveBeenCalledTimes(2);
  });
});

describe('formatChangeOperation', () => {
  it('formats a table operation with its resolved section title and safe excerpts', () => {
    expect(formatChangeOperation(operation, sections)).toMatchObject({
      category: '표',
      label: '표 열 삭제',
      sectionTitle: '점검 결과',
      before: 'Before value',
      after: 'After value'
    });
  });

  it('strips markup and collapses whitespace in payload excerpts', () => {
    const formatted = formatChangeOperation(
      { ...operation, before: '<p>  전 <strong>내용</strong> </p>' },
      sections
    );

    expect(formatted.before).toBe('전 내용');
  });

  it('extracts only inert visible text from untrusted HTML payloads', () => {
    const executionGlobal = globalThis as typeof globalThis & {
      __changeSummaryExecutionMarker?: string;
    };
    delete executionGlobal.__changeSummaryExecutionMarker;

    try {
      const formatted = formatChangeOperation(
        {
          ...operation,
          before: [
            '<p>Safe visible text</p>',
            '<img src="missing-image" onerror="globalThis.__changeSummaryExecutionMarker = \'IMAGE_MARKER\'">',
            '<script>globalThis.__changeSummaryExecutionMarker = \'SCRIPT_MARKER\'</script>'
          ].join('')
        },
        sections
      );

      expect(formatted.before).toBe('Safe visible text');
      expect(formatted.before).not.toContain('SCRIPT_MARKER');
      expect(executionGlobal.__changeSummaryExecutionMarker).toBeUndefined();
    } finally {
      delete executionGlobal.__changeSummaryExecutionMarker;
    }
  });

  it('truncates excerpts longer than 240 characters with an ellipsis', () => {
    const formatted = formatChangeOperation({ ...operation, after: 'a'.repeat(241) }, sections);

    expect(formatted.after).toBe(`${'a'.repeat(240)}…`);
  });

  it('keeps a supplementary character whole at the 240th code point', () => {
    const formatted = formatChangeOperation(
      { ...operation, after: `${'a'.repeat(239)}😀b` },
      sections
    );

    expect(formatted.after).toBe(`${'a'.repeat(239)}😀…`);
  });

  it('keeps absent payloads and unresolved section titles undefined', () => {
    const formatted = formatChangeOperation(
      { ...operation, sectionId: 'missing-section', before: undefined, after: undefined },
      sections
    );

    expect(formatted.before).toBeUndefined();
    expect(formatted.after).toBeUndefined();
    expect(formatted.sectionTitle).toBeUndefined();
  });

  it.each([
    ['text', '텍스트'],
    ['translation', '번역'],
    ['table', '표'],
    ['image', '이미지'],
    ['chart', '차트'],
    ['section', '섹션'],
    ['serialize', '저장']
  ] as const)('maps %s operations to the %s category', (type, category) => {
    expect(formatChangeOperation({ ...operation, type }, sections).category).toBe(category);
  });
});
