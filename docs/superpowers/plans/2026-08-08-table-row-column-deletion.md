# Table Row and Column Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Complete Milestone 3 by safely deleting a selected table row or column from both editor command surfaces.

**Architecture:** Add two fail-closed DOM mutations beside current insertion functions. Route them through the editor-session commit contract with a table-specific selection clamp, then expose them through Ribbon and PropertiesPanel callbacks. Reparsed table snapshots remain the source of truth after mutation.

**Tech Stack:** React 18, TypeScript 5, JSDOM, Vitest 2, Electron/Vite.

## Global Constraints

- A row deletion removes only the selected tr from its owning thead or tbody.
- Reject an invalid index, the final physical row or column, and a deletion intersecting an effective rowspan or colspan greater than one.
- Do not split or reflow merged cells; a rejected operation returns the original report reference and produces no history entry.
- Successful operations use mutateTable and labels 표 행 삭제 or 표 열 삭제.
- After success, retain the table node and clamp its physical row and cell coordinate to an existing snapshot cell.
- Final gates are npm test, npm run build, and git diff --check.

---

## File structure

| File | Responsibility |
| --- | --- |
| src/lib/editing.ts | Fail-closed row and column DOM mutations through mutateTable. |
| src/lib/editorSession.ts | Pure selection clamp for a reparsed table snapshot. |
| src/App.tsx | Atomic report and selection deletion commit. |
| src/components/Ribbon.tsx | Table-tab delete command props and buttons. |
| src/components/PropertiesPanel.tsx | Inspector delete callbacks and buttons. |
| src/lib/phaseReport.ts | Milestone 3 completion record. |
| tests/tableStabilization.test.ts | DOM mutation and inspector callback regressions. |
| tests/editorSession.test.ts | Selection clamp and history regression. |
| tests/uiBehavior.test.ts | Ribbon callback regression. |

### Task 1: Fail-closed table deletion model

**Files:**

- Modify: src/lib/editing.ts:266-370
- Test: tests/tableStabilization.test.ts:1-175

**Interfaces:**

- Consumes: mutateTable(report, sectionId, nodeId, mutator, label) and mapTableSectionCellPositions(rowGroup).
- Produces: deleteTableRow(report, sectionId, nodeId, rowIndex): ReportDocument and deleteTableColumn(report, sectionId, nodeId, columnIndex): ReportDocument.

- [ ] **Step 1: Write failing model tests**

Import deleteTableColumn and deleteTableRow. Add tests that:

1. delete a body row at global index 1 and expect only the first row remains plus an operation labelled 표 행 삭제;
2. delete physical column 1 from a rectangular two-by-two table and expect [['A'], ['C']] plus 표 열 삭제;
3. return the original report reference when deleting its final row, when a row intersects rowspan="2", or when a column intersects rowspan="2" or colspan="2".

Add local reportWithTableHtml, tableIdentity, and tableCellRows helpers. Each must parse a fresh complete report section.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: npx vitest run tests/tableStabilization.test.ts

Expected: TypeScript reports that the two deletion operations are not exported.

- [ ] **Step 3: Implement minimal safe mutations**

~~~ts
export function deleteTableRow(report: ReportDocument, sectionId: string, nodeId: string, rowIndex: number): ReportDocument {
  return mutateTable(report, sectionId, nodeId, (table) => {
    const row = table.rows.item(rowIndex);
    const group = row?.parentElement;
    if (!(row instanceof HTMLTableRowElement) || !(group instanceof HTMLTableSectionElement) || table.rows.length <= 1) return false;
    const localRowIndex = Array.from(group.rows).indexOf(row);
    const crossesBoundary = Array.from(mapTableSectionCellPositions(group).values()).some(
      ({ rowIndex: start, rowSpan }) => rowSpan > 1 && start <= localRowIndex && localRowIndex < start + rowSpan
    );
    if (localRowIndex < 0 || crossesBoundary) return false;
    row.remove();
  }, '표 행 삭제');
}

export function deleteTableColumn(report: ReportDocument, sectionId: string, nodeId: string, columnIndex: number): ReportDocument {
  return mutateTable(report, sectionId, nodeId, (table) => {
    const rows = Array.from(table.rows);
    if (!rows.length || rows.some((row) => row.cells.length <= 1)) return false;
    const cells = rows.map((row) => row.cells.item(columnIndex));
    if (cells.some((cell) => !(cell instanceof HTMLTableCellElement) || cell.colSpan > 1 || cell.rowSpan > 1)) return false;
    cells.forEach((cell) => cell!.remove());
  }, '표 열 삭제');
}
~~~

The column operation accepts only rectangular, unmerged tables: every row must have the selected physical coordinate.

- [ ] **Step 4: Run focused model tests**

Run: npx vitest run tests/tableStabilization.test.ts

Expected: all table stabilization tests pass.

- [ ] **Step 5: Commit the model slice**

~~~bash
git add src/lib/editing.ts tests/tableStabilization.test.ts
git commit -m "feat: add safe table row and column deletion"
~~~

### Task 2: Atomic selection normalization and command plumbing

**Files:**

- Modify: src/lib/editorSession.ts:279-332
- Modify: src/App.tsx:1-30, 125-145, 930-950, 1080-1100
- Modify: src/components/Ribbon.tsx:25-55, 279-284
- Modify: src/components/PropertiesPanel.tsx:20-45, 680-685
- Test: tests/editorSession.test.ts:1-170, tests/uiBehavior.test.ts:500-645, and tests/tableStabilization.test.ts:630-670

**Interfaces:**

- Consumes: Task 1 operations, reparsed ReportDocument, and current EditorSelection.
- Produces: selectionAfterTableMutation(report, sectionId, nodeId, current): EditorSelection, Ribbon onTableDeleteRow and onTableDeleteColumn, PropertiesPanel onDeleteTableRow and onDeleteTableColumn.

- [ ] **Step 1: Write failing selection and command tests**

Create a two-by-two table, select row 1 cell 1, delete its final row, and assert the next selection is row 0 cell 1. Run this through editorSessionReducer and assert Undo restores the original selection while Redo restores the clamped selection.

Render a table Ribbon, click - Row and - Column, and assert its deletion spies each receive one call. Extend ribbonProps with no-op deletion callbacks. Pass deletion spies to the inspector fixture, click its two new buttons, and assert calls are table id plus the selected row and table id plus the selected cell.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: npx vitest run tests/editorSession.test.ts tests/uiBehavior.test.ts tests/tableStabilization.test.ts

Expected: the helper, props, and buttons are absent.

- [ ] **Step 3: Implement selection helper and UI contract**

~~~ts
export function selectionAfterTableMutation(report: ReportDocument, sectionId: string, nodeId: string, current: EditorSelection): EditorSelection {
  const node = report.sections.find((section) => section.id === sectionId)?.editableNodes.find((candidate) => candidate.id === nodeId);
  const rows = node?.table?.rows;
  if (!rows?.length) return current;
  const row = Math.min(Math.max(0, current.cell.row), rows.length - 1);
  const cells = rows[row];
  if (!cells?.length) return current;
  return { ...current, cell: { row, cell: Math.min(Math.max(0, current.cell.cell), cells.length - 1) } };
}
~~~

Import Task 1 functions and this helper in App.tsx. Extend commit with an optional editor-session updateSelection callback. Deletion callbacks call the helper only when nextReport differs from previousReport, so rejected deletions leave selection and history intact.

Add the two callbacks to Ribbon and PropertiesPanel prop types. Render labelled - Row and - Column buttons beside insertion controls. Ribbon disables them unless isTable; inspector passes its selected row or cell.

- [ ] **Step 4: Run focused interaction tests**

Run: npx vitest run tests/editorSession.test.ts tests/uiBehavior.test.ts tests/tableStabilization.test.ts

Expected: selection clamps after success, Undo/Redo restores matching snapshots, and both command surfaces dispatch current coordinates.

- [ ] **Step 5: Commit the interaction slice**

~~~bash
git add src/lib/editorSession.ts src/App.tsx src/components/Ribbon.tsx src/components/PropertiesPanel.tsx tests/editorSession.test.ts tests/uiBehavior.test.ts tests/tableStabilization.test.ts
git commit -m "feat: expose table deletion commands"
~~~

### Task 3: Record completion and run release gates

**Files:**

- Modify: src/lib/phaseReport.ts:45
- Test: tests/phaseReport.test.ts:1-13

**Interfaces:**

- Consumes: v1PlanItems and calculatePlanAchievement(items).
- Produces: 행/열 삭제 status complete with evidence deleteTableRow/deleteTableColumn.

- [ ] **Step 1: Write failing completion assertion**

~~~ts
expect(v1PlanItems.find((item) => item.label === '행/열 삭제')).toMatchObject({
  status: 'complete',
  evidence: 'deleteTableRow/deleteTableColumn'
});
~~~

- [ ] **Step 2: Run the report test to verify it fails**

Run: npx vitest run tests/phaseReport.test.ts

Expected: the item remains pending.

- [ ] **Step 3: Update completion evidence**

~~~ts
{ milestone: 'Milestone 3', label: '행/열 삭제', status: 'complete', evidence: 'deleteTableRow/deleteTableColumn' },
~~~

- [ ] **Step 4: Run final verification gates**

~~~bash
npm test
npm run build
git diff --check
~~~

Expected: all unit tests pass, the TypeScript/Vite/Electron build completes, and whitespace checking emits no errors.

- [ ] **Step 5: Commit completion evidence**

~~~bash
git add src/lib/phaseReport.ts tests/phaseReport.test.ts
git commit -m "docs: mark table deletion complete"
~~~

## Plan self-review

- Spec coverage: Task 1 covers safe mutations, row-group boundaries, and merged/final-dimension rejection. Task 2 covers commands, selection, and history. Task 3 records completion and performs every required gate.
- Placeholder scan: every changed interface, behavior, command, and verification invocation is explicitly named.
- Type consistency: callbacks use the current node id plus row or column number; model functions consume ReportDocument, section id, node id, and number; the session helper consumes the reparsed report and existing EditorSelection.

