import React, { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { Canvas } from '../src/components/Canvas';
import { PropertiesPanel } from '../src/components/PropertiesPanel';
import { getElementByPath } from '../src/lib/domPaths';
import { editorSessionReducer, emptyEditorSession } from '../src/lib/editorSession';
import {
  addTableRow,
  deleteTableColumn,
  deleteTableRow,
  insertImageAfterNode,
  insertTableAfterNode,
  unmergeTableCell
} from '../src/lib/editing';
import { parseHtml, parseReportHtml } from '../src/lib/htmlParser';
import type { ReportDocument } from '../src/types/htmlpoint';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('table stabilization', () => {
  it('deletes a body row at global index 1 and records the table-row operation', () => {
    const report = reportWithTableHtml('<tbody><tr><td>First</td></tr><tr><td>Second</td></tr></tbody>');
    const { section, table } = tableIdentity(report);

    const updated = deleteTableRow(report, section.id, table.id, 1);

    expect(tableCellRows(updated)).toEqual([['First']]);
    expect(updated.operations.at(-1)?.label).toBe('표 행 삭제');
  });

  it('deletes a physical column from every row in a rectangular table', () => {
    const report = reportWithTableHtml('<tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody>');
    const { section, table } = tableIdentity(report);

    const updated = deleteTableColumn(report, section.id, table.id, 1);

    expect(tableCellRows(updated)).toEqual([['A'], ['C']]);
    expect(updated.operations.at(-1)?.label).toBe('표 열 삭제');
  });

  it('rejects a column delete when rowspan makes DOM cell indices physically ambiguous', () => {
    const report = reportWithTableHtml(
      '<tbody><tr><td rowspan="2">Unrelated</td><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td><td>E</td></tr></tbody>'
    );
    const { section, table } = tableIdentity(report);

    expect(deleteTableColumn(report, section.id, table.id, 1)).toBe(report);
  });

  it.each([
    [
      'a two-cell row before a three-cell row',
      '<tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td><td>E</td></tr></tbody>'
    ],
    [
      'a three-cell row before a two-cell row',
      '<tbody><tr><td>A</td><td>B</td><td>C</td></tr><tr><td>D</td><td>E</td></tr></tbody>'
    ]
  ])('rejects a column delete for a ragged table with %s', (_description, html) => {
    const report = reportWithTableHtml(html);
    const { section, table } = tableIdentity(report);
    const operationCount = report.operations.length;

    const updated = deleteTableColumn(report, section.id, table.id, 1);

    expect(updated).toBe(report);
    expect(updated.operations).toHaveLength(operationCount);
  });

  it('rejects a column delete for an effective rowspan zero', () => {
    const report = reportWithTableHtml(
      '<tbody><tr><td rowspan="0">Merged</td><td>A</td></tr><tr><td>B</td><td>C</td></tr></tbody>'
    );
    const { section, table } = tableIdentity(report);
    const operationCount = report.operations.length;

    const updated = deleteTableColumn(report, section.id, table.id, 1);

    expect(updated).toBe(report);
    expect(updated.operations).toHaveLength(operationCount);
  });

  it('returns the original report when deleting its final row', () => {
    const report = reportWithTableHtml('<tbody><tr><td>Only</td></tr></tbody>');
    const { section, table } = tableIdentity(report);

    expect(deleteTableRow(report, section.id, table.id, 0)).toBe(report);
  });

  it('returns the original report when deleting a row intersecting rowspan', () => {
    const report = reportWithTableHtml('<tbody><tr><td rowspan="2">Merged</td><td>A</td></tr><tr><td>B</td></tr></tbody>');
    const { section, table } = tableIdentity(report);

    expect(deleteTableRow(report, section.id, table.id, 1)).toBe(report);
  });

  it.each([
    ['rowspan="2"', '<tbody><tr><td rowspan="2">Merged</td><td>A</td></tr><tr><td>B</td></tr></tbody>', 0],
    ['colspan="2"', '<tbody><tr><td colspan="2">Merged</td></tr><tr><td>A</td><td>B</td></tr></tbody>', 0]
  ])('returns the original report when deleting a column intersecting %s', (_label, html, columnIndex) => {
    const report = reportWithTableHtml(html);
    const { section, table } = tableIdentity(report);

    expect(deleteTableColumn(report, section.id, table.id, columnIndex)).toBe(report);
  });

  it('inserts a blank row immediately after A in a tbody-only table', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <table><tbody>
        <tr><td>A</td></tr>
        <tr><td>B</td></tr>
        <tr><td>C</td></tr>
      </tbody></table>
    </section></main></body></html>`);
    const section = report.sections[0];
    const table = section.editableNodes.find((node) => node.kind === 'table')!;

    const updated = addTableRow(report, section.id, table.id, 0);

    expect(rowTexts(updated.sections[0].html)).toEqual(['A', '', 'B', 'C']);
  });

  it('uses the global rendered row index when a header row precedes body rows', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <table>
        <thead><tr><th>Header</th></tr></thead>
        <tbody>
          <tr><td>A</td></tr>
          <tr><td>B</td></tr>
          <tr><td>C</td></tr>
        </tbody>
      </table>
    </section></main></body></html>`);
    const section = report.sections[0];
    const table = section.editableNodes.find((node) => node.kind === 'table')!;

    const updated = addTableRow(report, section.id, table.id, 1);

    expect(rowTexts(updated.sections[0].html)).toEqual(['Header', 'A', '', 'B', 'C']);
  });

  it('inserts into the selected row owning group instead of the first tbody', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <table>
        <thead><tr><th>Header</th></tr></thead>
        <tbody><tr><td>First body</td></tr></tbody>
        <tbody><tr><td>A</td></tr><tr><td>B</td></tr></tbody>
      </table>
    </section></main></body></html>`);
    const section = report.sections[0];
    const table = section.editableNodes.find((node) => node.kind === 'table')!;

    const updated = addTableRow(report, section.id, table.id, 2);
    const document = parseHtml(updated.sections[0].html);
    const bodies = document.querySelectorAll('tbody');

    expect(Array.from(bodies[0].rows, (row) => row.textContent?.trim())).toEqual(['First body']);
    expect(Array.from(bodies[1].rows, (row) => row.textContent?.trim())).toEqual(['A', '', 'B']);
  });

  it('does not insert after an unrelated row when the selected row index is stale', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <table><tbody><tr><td>A</td></tr><tr><td>B</td></tr></tbody></table>
    </section></main></body></html>`);
    const section = report.sections[0];
    const table = section.editableNodes.find((node) => node.kind === 'table')!;

    const updated = addTableRow(report, section.id, table.id, 99);

    expect(updated).toBe(report);
  });

  it('restores the missing cell in every row covered by a rowspan', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <table><tbody>
        <tr><td rowspan="2">Target</td><td>A</td></tr>
        <tr><td>B</td></tr>
      </tbody></table>
    </section></main></body></html>`);
    const section = report.sections[0];
    const table = section.editableNodes.find((node) => node.kind === 'table')!;

    const updated = unmergeTableCell(report, section.id, table.id, 0, 0);
    const rows = parseHtml(updated.sections[0].html).querySelectorAll<HTMLTableRowElement>('table tr');

    expect(Array.from(rows, renderedColumnCount)).toEqual([2, 2]);
    expect(Array.from(rows[1].cells, (cell) => cell.textContent?.trim())).toEqual(['', 'B']);
    expect(rows[1].cells[0].tagName).toBe('TD');
  });

  it('restores a rowspan and colspan rectangle at the selected logical column', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <table><tbody>
        <tr><td colspan="2">Left</td><th rowspan="2" colspan="2">Target</th><td>R0</td></tr>
        <tr><td>L1</td><td>L2</td><td>R1</td></tr>
      </tbody></table>
    </section></main></body></html>`);
    const section = report.sections[0];
    const table = section.editableNodes.find((node) => node.kind === 'table')!;

    const updated = unmergeTableCell(report, section.id, table.id, 0, 1);
    const rows = parseHtml(updated.sections[0].html).querySelectorAll<HTMLTableRowElement>('table tr');

    expect(Array.from(rows, renderedColumnCount)).toEqual([5, 5]);
    expect(Array.from(rows[0].cells, (cell) => cell.textContent?.trim())).toEqual([
      'Left',
      'Target',
      '',
      'R0'
    ]);
    expect(Array.from(rows[1].cells, (cell) => cell.textContent?.trim())).toEqual([
      'L1',
      'L2',
      '',
      '',
      'R1'
    ]);
    expect(Array.from(rows[1].cells).slice(2, 4).map((cell) => cell.tagName)).toEqual([
      'TH',
      'TH'
    ]);
  });

  it('expands rowspan zero through the owning row group without crossing into the next tbody', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <table>
        <tbody>
          <tr><th rowspan="0">Target</th><td>A</td></tr>
          <tr><td>B</td></tr>
          <tr><td>C</td></tr>
        </tbody>
        <tbody><tr><td>Next group</td><td>D</td></tr></tbody>
      </table>
    </section></main></body></html>`);
    const section = report.sections[0];
    const table = section.editableNodes.find((node) => node.kind === 'table')!;

    const updated = unmergeTableCell(report, section.id, table.id, 0, 0);
    const bodies = parseHtml(updated.sections[0].html).querySelectorAll('tbody');

    expect(Array.from(bodies[0].rows, (row) => Array.from(row.cells, cellText))).toEqual([
      ['Target', 'A'],
      ['', 'B'],
      ['', 'C']
    ]);
    expect(Array.from(bodies[0].rows).slice(1).map((row) => row.cells[0].tagName)).toEqual([
      'TH',
      'TH'
    ]);
    expect(Array.from(bodies[1].rows[0].cells, cellText)).toEqual(['Next group', 'D']);
  });

  it('renders every cell on a 20-row page and exposes pagination for larger tables', () => {
    const report = makeTableReport(25, 10);
    const markup = renderToStaticMarkup(
      React.createElement(PropertiesPanel, propertiesProps(report, { row: 0, cell: 0 }))
    );
    const document = parseHtml(markup);
    const mini = document.querySelector('.table-mini')!;

    expect(mini.textContent).toContain('R1C10');
    expect(mini.textContent).toContain('R20C10');
    expect(document.querySelector('.table-pagination')?.textContent).toContain('Rows 1–20 of 25');
    expect(document.querySelector('.table-pagination')?.textContent).toContain('Previous');
    expect(document.querySelector('.table-pagination')?.textContent).toContain('Next');
  });

  it('opens the page containing the externally selected table cell', () => {
    const report = makeTableReport(25, 10);
    const markup = renderToStaticMarkup(
      React.createElement(PropertiesPanel, propertiesProps(report, { row: 22, cell: 9 }))
    );
    const document = parseHtml(markup);
    const mini = document.querySelector('.table-mini')!;

    expect(mini.textContent).toContain('R23C10');
    expect(document.querySelector('.table-pagination')?.textContent).toContain('Rows 21–25 of 25');
    expect(mini.querySelector('button.active')?.textContent).toContain('R23C10');
  });

  it('pages forward and reports global physical cell coordinates', () => {
    const report = makeTableReport(25, 10);
    let selectedCell: { row: number; cell: number } | undefined;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      act(() => {
        root.render(
          React.createElement(
            PropertiesPanel,
            propertiesProps(report, { row: 0, cell: 0 }, (row, cell) => {
              selectedCell = { row, cell };
            })
          )
        );
      });
      const next = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim() === 'Next'
      );
      expect(next).toBeTruthy();

      act(() => next!.click());
      expect(container.querySelector('.table-pagination')?.textContent).toContain(
        'Rows 21–25 of 25'
      );
      const lastColumn = Array.from(
        container.querySelectorAll<HTMLButtonElement>('.table-mini button')
      ).find((button) => button.textContent?.trim() === 'R21C10');
      expect(lastColumn).toBeTruthy();

      act(() => lastColumn!.click());
      expect(selectedCell).toEqual({ row: 20, cell: 9 });
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('returns to the externally selected row page even when its page index is unchanged', () => {
    const report = makeTableReport(25, 2);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      act(() => {
        root.render(
          React.createElement(PropertiesPanel, propertiesProps(report, { row: 0, cell: 0 }))
        );
      });
      act(() => buttonWithText(container, 'Next').click());
      expect(container.querySelector('.table-pagination')?.textContent).toContain(
        'Rows 21–25 of 25'
      );

      act(() => {
        root.render(
          React.createElement(PropertiesPanel, propertiesProps(report, { row: 5, cell: 0 }))
        );
      });

      expect(container.querySelector('.table-pagination')?.textContent).toContain(
        'Rows 1–20 of 25'
      );
      expect(container.querySelector('.table-mini button.active')?.textContent).toContain('R6C1');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('resets table and cell-style drafts when selecting another table with the same cell text', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <table><tbody><tr><td>Same</td></tr></tbody></table>
      <table><tbody><tr><td>Same</td></tr></tbody></table>
    </section></main></body></html>`);
    const section = report.sections[0];
    const tables = section.editableNodes.filter((node) => node.kind === 'table');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const propsForTable = (nodeId: string): ComponentProps<typeof PropertiesPanel> => ({
      ...propertiesProps(report, { row: 0, cell: 0 }),
      selectedNodeId: nodeId,
      selectedNodeIds: [nodeId]
    });

    try {
      act(() => root.render(React.createElement(PropertiesPanel, propsForTable(tables[0].id))));
      const cellInput = fieldControl<HTMLInputElement>(container, 'Cell text');
      const filterInput = fieldControl<HTMLInputElement>(container, 'Filter');
      const pasteInput = fieldControl<HTMLTextAreaElement>(container, 'Excel paste');
      const colorInput = container.querySelector<HTMLInputElement>('.style-box input[type="color"]')!;
      const alignSelect = container.querySelector<HTMLSelectElement>('.style-box select')!;

      act(() => {
        setFormValue(cellInput, 'Unsaved cell');
        setFormValue(filterInput, 'old-filter');
        setFormValue(pasteInput, 'old\tpaste');
        setFormValue(colorInput, '#123456');
        setSelectValue(alignSelect, 'right');
      });
      expect(cellInput.value).toBe('Unsaved cell');
      expect(filterInput.value).toBe('old-filter');
      expect(pasteInput.value).toBe('old\tpaste');
      expect(colorInput.value).toBe('#123456');
      expect(alignSelect.value).toBe('right');

      act(() => root.render(React.createElement(PropertiesPanel, propsForTable(tables[1].id))));

      expect.soft(fieldControl<HTMLInputElement>(container, 'Cell text').value).toBe('Same');
      expect.soft(fieldControl<HTMLInputElement>(container, 'Filter').value).toBe('');
      expect.soft(fieldControl<HTMLTextAreaElement>(container, 'Excel paste').value).toBe('');
      expect.soft(
        container.querySelector<HTMLInputElement>('.style-box input[type="color"]')?.value
      ).toBe('#e8f2ff');
      expect.soft(container.querySelector<HTMLSelectElement>('.style-box select')?.value).toBe(
        'left'
      );
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('returns IDs that resolve to newly inserted table and image nodes', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <p>Anchor</p>
    </section></main></body></html>`);
    const section = report.sections[0];
    const anchor = section.editableNodes.find((node) => node.tagName === 'p')!;

    const tableResult = insertTableAfterNode(report, section.id, anchor.id, 2, 3);
    const insertedTable = tableResult.report.sections[0].editableNodes.find(
      (node) => node.id === tableResult.insertedNodeId
    );

    expect(insertedTable?.kind).toBe('table');
    expect(resolveNodeElement(tableResult.report, insertedTable!.id)?.getAttribute(
      'data-htmlpoint-inserted'
    )).toBe('table');

    const refreshedAnchor = tableResult.report.sections[0].editableNodes.find(
      (node) => node.tagName === 'p'
    )!;
    const imageResult = insertImageAfterNode(
      tableResult.report,
      section.id,
      refreshedAnchor.id,
      'data:image/png;base64,BBBB',
      'inserted.png'
    );
    const insertedImage = imageResult.report.sections[0].editableNodes.find(
      (node) => node.id === imageResult.insertedNodeId
    );

    expect(insertedImage?.kind).toBe('image');
    expect(resolveNodeElement(imageResult.report, insertedImage!.id)?.getAttribute(
      'data-htmlpoint-inserted'
    )).toBe('image');
  });

  it('resolves table and image insertions when a table cell text node is the anchor', () => {
    const report = parseReportHtml(`<!doctype html><html><body><main><section>
      <table><tbody><tr><td>Anchor</td><td>Tail</td></tr></tbody></table>
    </section></main></body></html>`);
    const section = report.sections[0];
    const cellAnchor = section.editableNodes.find((node) => node.text === 'Anchor')!;

    const tableResult = insertTableAfterNode(report, section.id, cellAnchor.id, 2, 2);
    const insertedTable = tableResult.report.sections[0].editableNodes.find(
      (node) => node.id === tableResult.insertedNodeId
    );

    expect(insertedTable?.kind).toBe('table');
    expect(resolveNodeElement(tableResult.report, insertedTable!.id)?.parentElement?.tagName).toBe(
      'SECTION'
    );
    expect(tableResult.report.sections[0].html).not.toContain('data-htmlpoint-insertion-token');

    const imageResult = insertImageAfterNode(
      report,
      section.id,
      cellAnchor.id,
      'data:image/png;base64,CCCC',
      'cell-anchor.png'
    );
    const insertedImage = imageResult.report.sections[0].editableNodes.find(
      (node) => node.id === imageResult.insertedNodeId
    );

    expect(insertedImage?.kind).toBe('image');
    expect(resolveNodeElement(imageResult.report, insertedImage!.id)?.parentElement?.tagName).toBe(
      'SECTION'
    );
    expect(imageResult.report.sections[0].html).not.toContain('data-htmlpoint-insertion-token');
  });

  it('omits the inserted node ID when the target section does not exist', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><p>Anchor</p></section></main></body></html>'
    );

    const result = insertTableAfterNode(report, 'missing-section', undefined, 2, 2);

    expect(result.report).toBe(report);
    expect(result.insertedNodeId).toBeUndefined();
  });

  it('commits and selects an inserted table with reset cell state and reversible selection history', async () => {
    const harness = renderAppReport(`<!doctype html><html><body><main><section>
      <table><tbody>
        <tr><td>A00</td><td>A01</td></tr>
        <tr><td>A10</td><td>A11</td></tr>
      </tbody></table>
    </section></main></body></html>`);

    try {
      await harness.open();
      let objectSelect = selectedObjectSelect(harness.container);
      const originalTableOption = Array.from(objectSelect.options).find((option) =>
        option.textContent?.trim().startsWith('table ·')
      );
      expect(originalTableOption).toBeTruthy();
      act(() => setSelectValue(objectSelect, originalTableOption!.value));
      objectSelect = selectedObjectSelect(harness.container);
      const originalTableId = objectSelect.value;

      const staleCell = Array.from(
        harness.container.querySelectorAll<HTMLButtonElement>('.table-mini button')
      ).find((button) => button.textContent?.trim() === 'A11');
      expect(staleCell).toBeTruthy();
      act(() => staleCell!.click());

      act(() => buttonWithText(harness.container, 'Insert').click());
      act(() => harness.container.querySelector<HTMLButtonElement>('[aria-label="Insert table"]')!.click());

      objectSelect = selectedObjectSelect(harness.container);
      const insertedTableId = objectSelect.value;
      expect(insertedTableId).not.toBe(originalTableId);
      expect(objectSelect.selectedOptions[0]?.textContent).toContain('table ·');
      expect(harness.container.querySelector('.table-mini button.active')?.textContent).toContain(
        'Header 1'
      );
      expect(harness.container.querySelector('.message-line')?.textContent).toContain(
        'Table inserted'
      );
      expect(harness.container.querySelectorAll('.object-chip.active')).toHaveLength(1);
      expect(harness.container.querySelector('.object-chip.active')?.textContent).toContain('table');

      act(() => harness.container.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
      expect(selectedObjectSelect(harness.container).value).toBe(originalTableId);
      expect(harness.container.querySelector('.table-mini button.active')?.textContent).toContain('A11');

      act(() => harness.container.querySelector<HTMLButtonElement>('[aria-label="Redo"]')!.click());
      expect(selectedObjectSelect(harness.container).value).toBe(insertedTableId);
      expect(harness.container.querySelector('.table-mini button.active')?.textContent).toContain(
        'Header 1'
      );
    } finally {
      harness.dispose();
    }
  });

  it('selects an inserted image and emits success feedback', async () => {
    const harness = renderAppReport(
      '<!doctype html><html><body><main><section><p>Anchor</p></section></main></body></html>',
      { fileName: 'inserted.png', dataUrl: 'data:image/png;base64,BBBB' }
    );

    try {
      await harness.open();
      const anchorId = selectedObjectSelect(harness.container).value;
      act(() => buttonWithText(harness.container, 'Insert').click());
      await act(async () => {
        harness.container.querySelector<HTMLButtonElement>('[aria-label="Insert image"]')!.click();
        await nextTask();
      });

      const objectSelect = selectedObjectSelect(harness.container);
      expect(objectSelect.value).not.toBe(anchorId);
      expect(objectSelect.selectedOptions[0]?.textContent).toContain('image · inserted.png');
      expect(harness.container.querySelector('.message-line')?.textContent).toContain(
        'Image inserted'
      );
      expect(harness.container.querySelectorAll('.object-chip.active')).toHaveLength(1);
      expect(harness.container.querySelector('.object-chip.active')?.textContent).toContain('image');
    } finally {
      harness.dispose();
    }
  });

  it('renders and scrolls the active object chip beyond the former 80-object limit', () => {
    const paragraphs = Array.from(
      { length: 85 },
      (_, index) => `<p>Paragraph ${index + 1}</p>`
    ).join('');
    const report = parseReportHtml(
      `<!doctype html><html><body><main><section>${paragraphs}<table><tbody><tr><td>Cell</td></tr></tbody></table></section></main></body></html>`
    );
    const table = report.sections[0].editableNodes.find((node) => node.kind === 'table')!;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    });

    try {
      act(() => {
        root.render(
          React.createElement(Canvas, {
            report,
            selectedSectionId: report.sections[0].id,
            selectedNodeId: table.id,
            selectedNodeIds: [table.id],
            zoom: 100,
            onSelectNode: () => undefined
          })
        );
      });

      expect(container.querySelectorAll('.object-chip').length).toBeGreaterThan(80);
      expect(container.querySelector('.object-chip.active')?.textContent).toContain('table');
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      container.remove();
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView
        });
      } else {
        delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
      }
    }
  });

  it('records a verified no-change result when a queued insertion cannot apply to current state', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><p>Anchor</p></section></main></body></html>'
    );
    const loaded = editorSessionReducer(emptyEditorSession(), { type: 'load', report });
    const currentReport = { ...report, updatedAt: report.updatedAt + 1 };
    const currentState = { ...loaded, report: currentReport };
    let receivedReport: ReportDocument | undefined;

    const nextState = editorSessionReducer(currentState, {
      type: 'insert-object',
      requestId: 'queued-insert',
      sectionId: report.sections[0].id,
      insert: (current) => {
        receivedReport = current;
        return { report: current };
      }
    });

    expect(receivedReport).toBe(currentReport);
    expect(nextState.report).toBe(currentReport);
    expect(nextState.selection).toBe(currentState.selection);
    expect(nextState.past).toBe(currentState.past);
    expect(nextState.lastInsertionResult).toEqual({
      requestId: 'queued-insert',
      didChange: false
    });
  });

  it('replays an insertion action without sharing mutable node ID state', () => {
    const report = parseReportHtml(
      '<!doctype html><html><body><main><section><p>Anchor</p></section></main></body></html>'
    );
    const section = report.sections[0];
    const anchor = section.editableNodes.find((node) => node.tagName === 'p')!;
    const loaded = editorSessionReducer(emptyEditorSession(), { type: 'load', report });
    const action = {
      type: 'insert-object' as const,
      requestId: 'replay-insert',
      sectionId: section.id,
      insert: (current: ReportDocument) =>
        insertTableAfterNode(current, section.id, anchor.id, 2, 2)
    };

    const first = editorSessionReducer(loaded, action);
    const replay = editorSessionReducer(loaded, action);

    expect(first.lastInsertionResult?.didChange).toBe(true);
    expect(replay.lastInsertionResult?.didChange).toBe(true);
    expect(first.selection.nodeId).toBe(first.lastInsertionResult?.insertedNodeId);
    expect(replay.selection.nodeId).toBe(replay.lastInsertionResult?.insertedNodeId);
    expect(first.report?.sections[0].editableNodes.some(
      (node) => node.id === first.lastInsertionResult?.insertedNodeId
    )).toBe(true);
    expect(replay.report?.sections[0].editableNodes.some(
      (node) => node.id === replay.lastInsertionResult?.insertedNodeId
    )).toBe(true);
  });
});

function rowTexts(sectionHtml: string): string[] {
  return Array.from(
    parseHtml(sectionHtml).querySelectorAll('table tr'),
    (row) => row.textContent?.trim() ?? ''
  );
}

function reportWithTableHtml(tableHtml: string): ReportDocument {
  return parseReportHtml(
    `<!doctype html><html><body><main><section><table>${tableHtml}</table></section></main></body></html>`
  );
}

function tableIdentity(report: ReportDocument): {
  section: ReportDocument['sections'][number];
  table: ReportDocument['sections'][number]['editableNodes'][number];
} {
  const section = report.sections[0];
  const table = section.editableNodes.find((node) => node.kind === 'table')!;
  return { section, table };
}

function tableCellRows(report: ReportDocument): string[][] {
  return Array.from(
    parseHtml(report.sections[0].html).querySelectorAll<HTMLTableRowElement>('table tr'),
    (row) => Array.from(row.cells, cellText)
  );
}

function renderedColumnCount(row: HTMLTableRowElement): number {
  return Array.from(row.cells).reduce((count, cell) => count + cell.colSpan, 0);
}

function cellText(cell: HTMLTableCellElement): string {
  return cell.textContent?.trim() ?? '';
}

function makeTableReport(rowCount: number, columnCount: number): ReportDocument {
  const rows = Array.from({ length: rowCount }, (_, rowIndex) =>
    `<tr>${Array.from(
      { length: columnCount },
      (_, cellIndex) => `<td>R${rowIndex + 1}C${cellIndex + 1}</td>`
    ).join('')}</tr>`
  ).join('');
  return parseReportHtml(
    `<!doctype html><html><body><main><section><table><tbody>${rows}</tbody></table></section></main></body></html>`
  );
}

function propertiesProps(
  report: ReportDocument,
  selectedCell: { row: number; cell: number },
  onCellSelect: (row: number, cell: number) => void = () => undefined
): ComponentProps<typeof PropertiesPanel> {
  const section = report.sections[0];
  const table = section.editableNodes.find((node) => node.kind === 'table')!;
  return {
    report,
    selectedSectionId: section.id,
    selectedNodeId: table.id,
    selectedNodeIds: [table.id],
    selectedCell,
    onNodeSelect: () => undefined,
    onCellSelect,
    onTextChange: () => undefined,
    onTextEffect: () => undefined,
    onTextStyle: () => undefined,
    onTranslationChange: () => undefined,
    onTableCellText: () => undefined,
    onAddTableRow: () => undefined,
    onAddTableColumn: () => undefined,
    onDeleteTableRow: () => undefined,
    onDeleteTableColumn: () => undefined,
    onSortTable: () => undefined,
    onFilterTable: () => undefined,
    onMergeRight: () => undefined,
    onUnmerge: () => undefined,
    onCellStyle: () => undefined,
    onPasteTable: () => undefined,
    onReplaceImage: () => undefined,
    onImageFilter: () => undefined,
    onResizeImage: () => undefined,
    onResizeImageFrame: () => undefined,
    onCropImage: () => undefined,
    onImageAnnotation: () => undefined,
    onChartPresentation: () => undefined,
    onChartData: () => undefined
  };
}

function resolveNodeElement(report: ReportDocument, nodeId: string): Element | null {
  const section = report.sections.find((candidate) =>
    candidate.editableNodes.some((node) => node.id === nodeId)
  );
  const node = section?.editableNodes.find((candidate) => candidate.id === nodeId);
  if (!section || !node) {
    return null;
  }
  const sectionDocument = parseHtml(section.html);
  const sectionRoot = sectionDocument.body.firstElementChild;
  return sectionRoot ? getElementByPath(sectionRoot, node.path) : null;
}

function renderAppReport(
  html: string,
  image: { fileName: string; dataUrl: string } | null = null
): {
  container: HTMLDivElement;
  open: () => Promise<void>;
  dispose: () => void;
} {
  type HtmlpointBridge = NonNullable<Window['htmlpoint']>;
  type OpenedFile = Parameters<Parameters<HtmlpointBridge['onOpenedFile']>[0]>[0];
  let openedListener: ((opened: OpenedFile) => void) | undefined;
  window.htmlpoint = {
    listSamples: async () => [],
    openHtmlDialog: async () => null,
    openSample: async () => null,
    saveAsHtml: async () => null,
    createBackup: async () => ({}),
    openImageDialog: async () => image,
    onOpenedFile: (listener) => {
      openedListener = listener;
      return () => {
        openedListener = undefined;
      };
    },
    onMenuSaveAs: () => () => undefined,
    onOperationError: () => () => undefined,
    onCloseRequested: () => () => undefined,
    confirmClose: async () => undefined
  } as HtmlpointBridge;

  const container = document.createElement('div');
  document.body.append(container);
  const root: Root = createRoot(container);
  act(() => root.render(React.createElement(App)));

  return {
    container,
    open: async () => {
      if (!openedListener) {
        throw new Error('Opened-file listener was not registered.');
      }
      await act(async () => {
        openedListener?.({
          fileName: 'task-4.html',
          filePath: 'C:\\reports\\task-4.html',
          html
        });
        await nextTask();
      });
    },
    dispose: () => {
      act(() => root.unmount());
      container.remove();
      window.htmlpoint = undefined;
    }
  };
}

function selectedObjectSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>('.property-body > .field select');
  if (!select) {
    throw new Error('Selected object picker was not rendered.');
  }
  return select;
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function setFormValue(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const prototype =
    control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

function fieldControl<T extends HTMLInputElement | HTMLTextAreaElement>(
  container: HTMLElement,
  label: string
): T {
  const field = Array.from(container.querySelectorAll<HTMLElement>('label.field')).find(
    (candidate) => candidate.querySelector('span')?.textContent?.trim() === label
  );
  const control = field?.querySelector<T>('input, textarea');
  if (!control) {
    throw new Error(`Field control not found: ${label}`);
  }
  return control;
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
