# HTMLpoint Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every production change. This workspace is not a Git repository, so execute tasks serially in the shared folder and use fresh test/build evidence instead of commits.

**Goal:** Resolve HPT-001 through HPT-020 while preserving the current visual language, approved sample compatibility, and serialized HTML assets.

**Architecture:** Add pure editor-session helpers for selection/history, keep DOM mutations in `editing.ts`, introduce one accessible modal primitive, and make UI state explicit through props rather than effect-driven synchronization. Every behavior change starts with a focused Vitest regression, followed by rendered Playwright validation.

**Tech Stack:** React 18, TypeScript 5.7, Vite 6, Electron 33, Vitest/jsdom, Playwright 1.61.

## Global Constraints

- Preserve the current PowerPoint-style shell and major panel arrangement.
- Preserve original `<style>`, `<script>`, translations, and the four approved sample reports.
- Do not add runtime dependencies.
- Do not silently discard dirty work or remove unrelated HTML styles.
- Keep Electron minimum size at 1180×720.
- Keep Browser plugin classification as unavailable and use Playwright.

---

### Task 1: Stable selection and history

**Files:**
- Create: `src/lib/editorSession.ts`
- Modify: `src/App.tsx`
- Create: `tests/editorSession.test.ts`

**Interfaces:**
- Produces `EditorSelection`, `EditorHistoryEntry`, `emptySelection()`, `normalizeSelection()`, and `selectionAfterSectionDelete()`.
- `App.tsx` stores history entries containing both report and selection.

- [ ] **Step 1: Write failing selection tests**

```ts
import { describe, expect, it } from 'vitest';
import { emptySelection, normalizeSelection, selectionAfterSectionDelete } from '../src/lib/editorSession';
import { parseReportHtml } from '../src/lib/htmlParser';

describe('editor session selection', () => {
  it('returns the same empty selection when no report is loaded', () => {
    const selection = emptySelection();
    expect(normalizeSelection(null, selection)).toBe(selection);
  });

  it('selects the next section after deleting the current section', () => {
    const report = parseReportHtml('<section><p>A</p></section><section><p>B</p></section><section><p>C</p></section>');
    const selection = selectionAfterSectionDelete(report, report.sections[1].id, 1);
    expect(selection.sectionId).toBe(report.sections[1].id);
    expect(selection.nodeId).toBe(report.sections[1].editableNodes[0].id);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the expected import failure**

Run: `npx vitest run tests/editorSession.test.ts --reporter=verbose`

Expected: FAIL because `src/lib/editorSession.ts` does not exist.

- [ ] **Step 3: Implement the pure session helpers**

```ts
export interface EditorSelection {
  sectionId?: string;
  nodeId?: string;
  nodeIds: string[];
  cell: { row: number; cell: number };
}

export interface EditorHistoryEntry {
  report: ReportDocument;
  selection: EditorSelection;
}

export function emptySelection(): EditorSelection {
  return { nodeIds: [], cell: { row: 0, cell: 0 } };
}

export function normalizeSelection(report: ReportDocument | null, current: EditorSelection): EditorSelection {
  if (!report?.sections.length) {
    return !current.sectionId && !current.nodeId && current.nodeIds.length === 0 ? current : emptySelection();
  }
  const section = report.sections.find((item) => item.id === current.sectionId) ?? report.sections[0];
  const validIds = current.nodeIds.filter((id) => section.editableNodes.some((node) => node.id === id));
  const nodeId = section.editableNodes.some((node) => node.id === current.nodeId)
    ? current.nodeId
    : validIds[0] ?? section.editableNodes[0]?.id;
  const nodeIds = nodeId ? (validIds.includes(nodeId) ? validIds : [nodeId]) : [];
  if (section.id === current.sectionId && nodeId === current.nodeId && nodeIds.length === current.nodeIds.length && nodeIds.every((id, index) => id === current.nodeIds[index])) {
    return current;
  }
  return { sectionId: section.id, nodeId, nodeIds, cell: current.cell };
}
```

- [ ] **Step 4: Refactor App selection and history**

Replace the four independent selection state values with one `EditorSelection`. Replace the `selectedSection` effect that writes `[]` on every render with derived normalized selection applied only at load, delete, undo, and redo event boundaries. Store `{ report, selection }` in `past` and `future`.

- [ ] **Step 5: Verify RED→GREEN and existing behavior**

Run: `npx vitest run tests/editorSession.test.ts tests/uiBehavior.test.ts tests/editing.test.ts --reporter=verbose`

Expected: all selected tests PASS and no maximum-depth warning in the rendered empty app.

---

### Task 2: Dirty-work guard, validation, and save-path correctness

**Files:**
- Create: `src/components/Modal.tsx`
- Create: `src/lib/documentActions.ts`
- Modify: `src/App.tsx`
- Modify: `src/lib/fileServices.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/preload.cts`
- Modify: `src/types/electron.d.ts`
- Create: `tests/documentActions.test.ts`

**Interfaces:**
- Produces `validateOpenedReport(opened): ReportDocument`, `nextReportAfterSave(report, filePath)`, and `PendingDocumentAction`.
- Modal props are `open`, `title`, `description`, `initialFocus`, `onEscape`, and `children`.
- Electron preload adds `onCloseRequested(callback)` and `confirmClose()`.

- [ ] **Step 1: Write failing validation and save-path tests**

```ts
import { describe, expect, it } from 'vitest';
import { nextReportAfterSave, validateOpenedReport } from '../src/lib/documentActions';
import { parseReportHtml } from '../src/lib/htmlParser';

describe('document actions', () => {
  it('rejects documents without editable sections', () => {
    expect(() => validateOpenedReport({ fileName: 'plain.html', html: '<main>Hello</main>' }))
      .toThrow('편집 가능한 <header> 또는 <section>을 찾지 못했습니다.');
  });

  it('moves the source path after Save As', () => {
    const report = parseReportHtml('<section><p>A</p></section>', { fileName: 'a.html', sourcePath: 'C:/old/a.html' });
    const saved = nextReportAfterSave(report, 'D:/new/b.html');
    expect(saved.sourcePath).toBe('D:/new/b.html');
    expect(saved.fileName).toBe('b.html');
    expect(saved.dirty).toBe(false);
  });
});
```

- [ ] **Step 2: Verify the focused tests fail**

Run: `npx vitest run tests/documentActions.test.ts --reporter=verbose`

Expected: FAIL because `documentActions.ts` does not exist.

- [ ] **Step 3: Implement validation and path updates**

```ts
export function validateOpenedReport(opened: OpenedHtmlFile): ReportDocument {
  const report = parseOpenedFile(opened);
  if (!report.sections.length) {
    throw new Error('편집 가능한 <header> 또는 <section>을 찾지 못했습니다.');
  }
  return report;
}

export function nextReportAfterSave(report: ReportDocument, filePath: string): ReportDocument {
  return {
    ...report,
    sourcePath: filePath,
    fileName: filePath.split(/[\\/]/).pop() ?? report.fileName,
    dirty: false
  };
}
```

- [ ] **Step 4: Add one reusable accessible modal and dirty pending actions**

Open/drop/close actions call a single `requestDocumentAction`. Clean documents continue immediately. Dirty documents show Save/Discard/Cancel. Save failure or cancel keeps the current report and pending action. The modal traps focus, closes on Escape, restores focus, and marks the background inert while open.

- [ ] **Step 5: Wire Electron close interception**

Main prevents the first close and emits `htmlpoint:close-requested`. Renderer confirms through `htmlpoint:confirm-close`; main then allows one close. Clean renderer state confirms immediately; dirty state uses the shared modal.

- [ ] **Step 6: Verify document protection**

Run: `npx vitest run tests/documentActions.test.ts tests/dropImport.test.ts tests/htmlDocument.test.ts --reporter=verbose`

Expected: all selected tests PASS.

---

### Task 3: Preserve rich text, effects, and chart captions

**Files:**
- Modify: `src/lib/editing.ts`
- Modify: `src/lib/htmlParser.ts`
- Modify: `src/components/PropertiesPanel.tsx`
- Modify: `src/types/htmlpoint.ts`
- Create: `tests/dataPreservation.test.ts`

**Interfaces:**
- Produces `replaceTextPreservingChildren(element, text)` and `readChartPresentation(nodeHtml, sectionHtml, nodeId)`.
- `EditableNode` gains optional `chartPresentation` with caption, width, height, frame, and align.

- [ ] **Step 1: Write failing preservation tests**

```ts
it('preserves nested badge markup when parent text changes', () => {
  const report = parseReportHtml('<section><li><span class="pill bad">상태</span> 기존 설명</li></section>');
  const section = report.sections[0];
  const parent = section.editableNodes.find((node) => node.html.startsWith('<li'))!;
  const next = editTextNode(report, section.id, parent.id, '상태 새 설명');
  expect(next.sections[0].html).toContain('<span class="pill bad">상태</span> 새 설명');
});

it('restores original typography when effect None is applied', () => {
  const report = parseReportHtml('<section><span style="color:#123456;font-size:22px">Styled</span></section>');
  const node = report.sections[0].editableNodes.find((item) => item.text === 'Styled')!;
  const applied = applyTextEffect(report, report.sections[0].id, node.id, effectPresets.warning);
  const cleared = applyTextEffect(applied, report.sections[0].id, node.id, effectPresets.none);
  expect(cleared.sections[0].html).toContain('color:#123456');
  expect(cleared.sections[0].html).toContain('font-size:22px');
});
```

- [ ] **Step 2: Run the tests and confirm current data-loss failures**

Run: `npx vitest run tests/dataPreservation.test.ts --reporter=verbose`

Expected: nested markup and original typography assertions FAIL.

- [ ] **Step 3: Implement child-preserving text replacement**

For elements with no child elements, continue assigning `textContent`. For parents with children, preserve child nodes and update only direct text nodes. Require child text tokens to appear in order in the edited combined text; otherwise return the original report and surface a validation message instructing the user to edit the child object.

- [ ] **Step 4: Snapshot and restore effect-owned styles**

On first effect application, store the original inline style in `data-htmlpoint-effect-original-style`. Applying presets changes only effect properties. Applying None restores the original style exactly and removes only known report-effect classes plus editor effect metadata.

- [ ] **Step 5: Parse and retain chart presentation**

Populate Inspector settings from the selected chart and its generated caption. Repeated Apply uses those current values, so a second Apply cannot remove a caption unless the user explicitly clears it.

- [ ] **Step 6: Verify preservation tests and existing presentation tests**

Run: `npx vitest run tests/dataPreservation.test.ts tests/presentationEditing.test.ts tests/v15v2Editing.test.ts tests/v2ChartEditing.test.ts --reporter=verbose`

Expected: all selected tests PASS.

---

### Task 4: Correct table operations and insertion selection

**Files:**
- Modify: `src/lib/editing.ts`
- Modify: `src/components/PropertiesPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/types/htmlpoint.ts`
- Create: `tests/tableStabilization.test.ts`

**Interfaces:**
- `insertTableAfterNode` and `insertImageAfterNode` return `EditResult` containing `report` and optional `insertedNodeId`.
- Table inspector receives `page`, `pageSize`, and `onPageChange` local UI state.

- [ ] **Step 1: Write failing table-order and unmerge tests**

```ts
it('inserts a tbody row directly after the selected row', () => {
  const report = reportWithTable(['A', 'B', 'C']);
  const next = addTableRow(report.document, report.sectionId, report.nodeId, 0);
  expect(readFirstColumn(next)).toEqual(['A', '', 'B', 'C']);
});

it('restores cells in every row covered by rowspan', () => {
  const report = reportWithHtml('<section><table><tbody><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></tbody></table></section>');
  const next = unmergeTableCell(report.document, report.sectionId, report.nodeId, 0, 0);
  expect(readColumnCounts(next)).toEqual([2, 2]);
});
```

- [ ] **Step 2: Run and confirm both tests fail for the documented reasons**

Run: `npx vitest run tests/tableStabilization.test.ts --reporter=verbose`

Expected: row order is `A,B,C,''` and the second row remains short.

- [ ] **Step 3: Implement section-aware row insertion and span restoration**

Convert the selected global row index to the owning table section's local index, then insert after that local row. For rowspan unmerge, calculate the selected cell's logical column and insert one empty matching-tag cell into each covered row at that logical column.

- [ ] **Step 4: Replace the fixed 12×8 slice with paged full-width access**

Render 20 rows per page and every cell in those rows inside the existing scroll container. Add Previous/Next controls and `Rows 1–20 of N` text. Preserve `selectedCell` across pages and automatically open the page containing a selection.

- [ ] **Step 5: Select inserted objects**

Return the inserted table/image ID, commit the report, select that ID, update the message line, and scroll the active object chip into view.

- [ ] **Step 6: Verify table and insertion tests**

Run: `npx vitest run tests/tableStabilization.test.ts tests/editing.test.ts tests/v15v2Editing.test.ts --reporter=verbose`

Expected: all selected tests PASS.

---

### Task 5: Semantic controls, command states, and modal UX

**Files:**
- Modify: `src/components/Ribbon.tsx`
- Modify: `src/components/PropertiesPanel.tsx`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `tests/uiBehavior.test.ts`

**Interfaces:**
- Ribbon receives `selectedSectionIndex`, `sectionCount`, and `sectionHidden`.
- StatusBar receives `onFit` and `fitActive`.
- Properties object-kind header is non-interactive status text.

- [ ] **Step 1: Add failing rendered semantic tests**

```ts
import { renderToStaticMarkup } from 'react-dom/server';

it('exposes labels for all zoom controls', () => {
  const html = renderToStaticMarkup(
    <StatusBar report={null} selectedIndex={0} zoom={100} onZoomChange={() => undefined} onFit={() => undefined} fitActive />
  );
  expect(html).toContain('aria-label="Zoom out"');
  expect(html).toContain('aria-label="Preview zoom"');
  expect(html).toContain('aria-label="Zoom in"');
});

it('renders selected object kind as status instead of inert tabs', () => {
  const html = renderToStaticMarkup(renderPropertiesPanelWithTextSelection());
  expect(html).not.toContain('class="property-tabs"');
  expect(html).toContain('class="property-kind"');
});
```

- [ ] **Step 2: Confirm the semantic tests fail**

Run: `npx vitest run tests/uiBehavior.test.ts --reporter=verbose`

Expected: the new accessibility assertions FAIL.

- [ ] **Step 3: Implement command state semantics**

Disable Up at index 0, Down at the last index, and Delete when only one section remains. Change Hide to Show when hidden and expose `aria-pressed`. Add `tablist/tab/tabpanel` semantics to Ribbon tabs.

- [ ] **Step 4: Replace Properties fake tabs**

Render the selected kind as a single `property-kind` status with the matching icon and label. Keep the object picker as the only selector.

- [ ] **Step 5: Label zoom and status output**

Add names to zoom buttons/range. Add `role="status" aria-live="polite"` to ordinary messages and `role="alert"` for error messages.

- [ ] **Step 6: Verify modal keyboard behavior with a component test or Playwright**

Open Summary, assert focus is inside, press Escape, assert closed, and assert focus returns to Summary.

---

### Task 6: Fit zoom, responsive fallback, relative assets, and errors

**Files:**
- Modify: `src/components/Canvas.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/preview.ts`
- Modify: `src/lib/htmlSerializer.ts`
- Modify: `src/styles.css`
- Create: `tests/previewStabilization.test.ts`

**Interfaces:**
- Produces `calculateFitZoom(canvasWidth, pageWidth, padding): number`.
- `buildPreviewHtml` accepts optional `sourceBaseUrl` used only in preview output.

- [ ] **Step 1: Write failing fit and base-URL tests**

```ts
it('calculates a bounded fit zoom', () => {
  expect(calculateFitZoom(820, 1120, 28)).toBe(68);
  expect(calculateFitZoom(2000, 1120, 28)).toBe(100);
});

it('uses a source base only in preview output', () => {
  const report = parseReportHtml('<section><img src="images/a.png"></section>', { sourcePath: 'C:/reports/a.html' });
  const preview = buildPreviewHtml(report, report.sections[0].id, 'ko', undefined, [], 'file:///C:/reports/');
  expect(preview).toContain('<base href="file:///C:/reports/">');
  expect(serializeReportHtml(report).html).not.toContain('<base href="file:///C:/reports/">');
});
```

- [ ] **Step 2: Confirm both tests fail**

Run: `npx vitest run tests/previewStabilization.test.ts --reporter=verbose`

Expected: missing fit helper/signature and missing preview base.

- [ ] **Step 3: Implement Fit mode**

Measure `.canvas-stage` with ResizeObserver. Apply calculated zoom until the user changes the range or buttons. Add a Fit button to re-enable automatic mode.

- [ ] **Step 4: Add preview-only base URL**

Derive a file directory URL from `sourcePath` in Electron, escape it, and inject it into preview `<head>`. Never mutate `report.originalHtml`; serializer output remains unchanged.

- [ ] **Step 5: Add small-viewport fallback**

At widths below 1100px allow workspace horizontal scrolling and add collapsible side panels. Keep Electron's 1180px minimum and default panel visibility unchanged.

- [ ] **Step 6: Verify focused and compatibility tests**

Run: `npx vitest run tests/previewStabilization.test.ts tests/uiBehavior.test.ts tests/referenceSamples.test.ts --reporter=verbose`

Expected: all selected tests PASS.

---

### Task 7: Full rendered and packaged verification

**Files:**
- Create outside repository: `../htmlpoint-audit/post-fix-qa.cjs`
- Update: `findings.md` with resolution status and verification evidence

**Interfaces:**
- QA JSON output: `../htmlpoint-audit/results/post-fix-qa.json`.
- Screenshots: empty, loaded, delete recovery, dirty modal, fit desktop, narrow fallback, packaged Electron.

- [ ] **Step 1: Run the entire unit suite**

Run: `npm test -- --reporter=dot`

Expected: 11 existing files plus new stabilization files PASS with zero failures.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: TypeScript, Vite renderer, and Electron TypeScript all exit 0.

- [ ] **Step 3: Run Playwright target flows**

The flow under test is: empty app → clean console → sample load → edit/undo → dirty replacement guard → delete recovery → insert/select → modal keyboard → fit zoom → 1024px fallback.

Required assertions: page title, meaningful DOM, no framework overlay, no relevant console error/warning, screenshots, and state proof after every interaction.

- [ ] **Step 4: Run packaged Electron smoke test**

Launch `release/win-unpacked/HTMLpoint.exe`, verify preload APIs, load the 13-section sample by drop, exercise one edit and Undo, and capture a screenshot.

- [ ] **Step 5: Update finding resolution status**

For each HPT-001 through HPT-020, record `Resolved`, `Partially resolved`, or `Open`, the verifying test, and any remaining limitation. Do not mark resolved from source inspection alone when a rendered flow is required.

## Finding-to-task mapping

| Finding | Task |
|---|---|
| HPT-001 | Task 1 stable empty selection |
| HPT-002 | Task 2 dirty-work guard |
| HPT-003 | Task 1 delete selection recovery |
| HPT-004 | Task 3 rich-text preservation |
| HPT-005 | Task 3 chart caption persistence |
| HPT-006 | Task 3 effect style restoration |
| HPT-007 | Task 2 structure validation |
| HPT-008 | Task 1 selection-aware history |
| HPT-009 | Task 4 table row placement |
| HPT-010 | Task 4 paged table picker |
| HPT-011 | Task 5 property kind status |
| HPT-012 | Task 4 inserted object selection |
| HPT-013 | Task 6 Fit zoom |
| HPT-014 | Task 2 and Task 5 accessible modal |
| HPT-015 | Task 2 Save As source path |
| HPT-016 | Task 6 preview-only base URL |
| HPT-017 | Task 4 rowspan restoration |
| HPT-018 | Task 2 and Task 5 error/status delivery |
| HPT-019 | Task 6 small-viewport fallback |
| HPT-020 | Task 5 command state and labels |

## Plan self-review

- All HPT-001 through HPT-020 map to Tasks 1–7.
- Every production change begins with a focused failing test.
- New interfaces are defined before dependent tasks use them.
- No runtime dependency or visual redesign is introduced.
- Git commit steps are intentionally omitted because the workspace is not a Git repository.
