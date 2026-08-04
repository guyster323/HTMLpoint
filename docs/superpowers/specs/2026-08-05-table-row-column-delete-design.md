# Table Row and Column Deletion Design

## Goal

Complete the remaining Milestone 3 table-editing capability by allowing a user to delete the selected physical row or column without producing an invalid table or losing recoverable editor history.

## Scope

- Add `- Row` and `- Column` commands to the Table ribbon and Table Inspector.
- Add model operations that take the existing `(report, sectionId, nodeId, selectedRow, selectedCell)` identity and return the original report when the operation is unsafe or invalid.
- Preserve table section boundaries: deleting a row only removes the selected `tr` from its `thead` or `tbody`; deleting a column removes the selected physical cell from every table row.
- Reject deletion when it would remove the final physical row or column, or when any affected cell has an effective `rowspan` or `colspan` greater than one. The UI command remains available but is a safe no-op for unsupported merged-cell cases.
- Keep existing editor-session history behavior by routing successful operations through `commit`; clamp the selected row and cell to an existing cell after an operation.
- Mark the Milestone 3 item complete and add focused model and UI regression coverage.

## Non-goals

- Reflowing or splitting merged cells during structural deletion.
- Deleting filtered rows as a group, altering sort/filter semantics, or adding confirmation dialogs.
- Changing the existing table insertion, merge/unmerge, or serialization contracts.

## Design

### Model operations

`deleteTableRow` locates the selected `HTMLTableRowElement` using the current global row index. It rejects an out-of-range selection, a one-row table, or a row whose cells (including cells originating in earlier rows) cross the deletion boundary via `rowspan`. On success it removes exactly that `tr` from its owning row group.

`deleteTableColumn` uses the existing physical cell coordinate model. It rejects an out-of-range selection, a one-column table, or any row whose selected cell is missing or has `colspan > 1`. On success it removes the selected cell from every table row. This intentionally supports only rectangular, unmerged columns.

Both operations use the existing `mutateTable` path, keep the document’s HTML and editable-node metadata synchronized, and record the labels `표 행 삭제` and `표 열 삭제` in the change history.

### UI and selection

Ribbon and inspector commands use the same selected table node and physical coordinates as their insertion counterparts. The App owns post-delete selection normalization: after a successful mutation, it keeps the same row/column where possible and otherwise clamps to the last remaining physical cell. This makes the next inspector action target a real cell and keeps Undo/Redo reversible through the current session reducer.

### Verification

Tests cover normal body/header deletion, middle and final-coordinate selection clamping, one-row/one-column rejection, and rejection for row/column spans. Component tests assert that both command surfaces invoke their callbacks with the selected coordinates. The full Vitest suite, production build, and whitespace check remain required gates.
