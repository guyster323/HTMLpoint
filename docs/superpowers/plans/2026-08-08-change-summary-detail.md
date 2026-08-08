# Change Summary Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Milestone 2 by presenting the existing edit-operation history as an accessible, safe detailed timeline in the Review modal.

**Architecture:** A pure formatter transforms `EditOperation` records and current `ReportSection` metadata into text-only timeline entries. A focused timeline component renders those entries inside App's existing modal; App remains responsible for modal visibility and focus. No editor history, serialization, or persisted data structures change.

**Tech Stack:** React 18, TypeScript 5, JSDOM, Vitest 2, Electron/Vite.

## Global Constraints

- Use `ReportDocument.operations` as the only history source; do not change its type or persistence behavior.
- Render operation payloads as text only, never with `dangerouslySetInnerHTML`.
- Excerpts collapse whitespace, strip markup, and are capped at 240 characters plus a truncation ellipsis when needed.
- A deleted or unresolved section shows no synthetic internal ID to the user.
- Timeline order is newest operation first; records with no before/after payload render no disclosure control.
- Keep the Review command, modal close button initial focus, Escape behavior, and focus restoration unchanged.
- Final gates are `npm test`, `npm run build`, and `git diff --check`.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/changeSummary.ts` | Pure operation-to-display transformation and safe excerpts. |
| `src/components/ChangeSummaryTimeline.tsx` | Semantic reverse-chronological list and optional before/after disclosure. |
| `src/App.tsx` | Formats current report operations and places the timeline in the existing modal. |
| `src/styles.css` | Timeline-only layout, metadata, chip, and disclosure styles. |
| `src/lib/phaseReport.ts` | Milestone 2 completion evidence. |
| `tests/changeSummary.test.ts` | Pure formatter behavior regressions. |
| `tests/uiBehavior.test.ts` | Timeline markup, empty state, and existing modal keyboard/focus behavior. |
| `tests/phaseReport.test.ts` | Milestone completion assertion. |

### Task 1: Safe operation-summary formatter

**Files:**

- Create: `src/lib/changeSummary.ts`
- Create: `tests/changeSummary.test.ts`

**Interfaces:**

- Consumes: `EditOperation` and `ReportSection` from `src/types/htmlpoint.ts`.
- Produces: `ChangeSummaryEntry` and `formatChangeOperation(operation, sections): ChangeSummaryEntry`.

- [ ] **Step 1: Write the failing formatter tests**

Create `tests/changeSummary.test.ts`, import `formatChangeOperation`, and define a stable operation fixture. Assert that it returns:

```ts
expect(formatChangeOperation(operation, sections)).toMatchObject({
  category: '표', label: '표 열 삭제', sectionTitle: '점검 결과',
  before: 'Before value', after: 'After value'
});
```

Add separate expectations that `'<p>  전 <strong>내용</strong> </p>'` becomes `'전 내용'`, a 241-character string becomes 240 characters plus `…`, absent payloads remain `undefined`, and an unknown `sectionId` leaves `sectionTitle` undefined. Include one assertion for each category: `텍스트`, `번역`, `표`, `이미지`, `차트`, `섹션`, `저장`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run tests/changeSummary.test.ts`

Expected: FAIL because `../src/lib/changeSummary` and `formatChangeOperation` do not exist.

- [ ] **Step 3: Implement the minimal pure formatter**

Create `src/lib/changeSummary.ts` with:

```ts
export interface ChangeSummaryEntry {
  id: string; category: string; label: string; timestamp: string;
  sectionTitle?: string; before?: string; after?: string;
}
export function formatChangeOperation(
  operation: EditOperation, sections: ReportSection[]
): ChangeSummaryEntry
```

Map operation types to the category labels above. Resolve the optional title only through `sections.find((section) => section.id === operation.sectionId)?.title`. Convert payload with a detached `div` or `DOMParser`, read `textContent`, collapse `\s+`, trim, return undefined for empty text, and return the first 240 characters plus `…` only when truncated. Format time with `new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })`. Do not mutate inputs or expose IDs in display fields.

- [ ] **Step 4: Run focused formatter tests**

Run: `npx vitest run tests/changeSummary.test.ts`

Expected: PASS for safe excerpts, truncation, missing values, categories, and unresolved sections.

- [ ] **Step 5: Commit the formatter slice**

Run `git add src/lib/changeSummary.ts tests/changeSummary.test.ts` then `git commit -m "feat: format detailed change summaries"`.

### Task 2: Render the accessible detailed timeline

**Files:**

- Create: `src/components/ChangeSummaryTimeline.tsx`
- Modify: `src/App.tsx:1-80,1323-1347`
- Modify: `src/styles.css:1241-1264`
- Modify: `tests/uiBehavior.test.ts:1-25,488-518`

**Interfaces:**

- Consumes: `ChangeSummaryEntry[]` from Task 1 and App's current report operations and sections.
- Produces: `ChangeSummaryTimeline({ entries }: { entries: ChangeSummaryEntry[] }): JSX.Element`.

- [ ] **Step 1: Write the failing timeline and modal tests**

In `tests/uiBehavior.test.ts`, render `ChangeSummaryTimeline` with two entries ordered oldest-to-newest at input. Assert static markup contains `<ol aria-label="변경 이력">`, renders the newest label before the older label, includes `변경 전후 보기` and both safe text excerpts only for the entry with a payload, and omits `details` for the payload-free entry. Add an App-harness assertion after opening a fresh report and clicking Change summary that the empty state says `아직 변경 내역이 없습니다.` while retaining the current focus/Escape restoration test.

- [ ] **Step 2: Run the focused UI test to verify it fails**

Run: `npx vitest run tests/uiBehavior.test.ts`

Expected: FAIL because `ChangeSummaryTimeline` is not exported and the semantic timeline markup is absent.

- [ ] **Step 3: Implement the timeline, App wiring, and scoped styles**

Create the component with a text-only ordered list:

```tsx
export function ChangeSummaryTimeline({ entries }: { entries: ChangeSummaryEntry[] }): JSX.Element {
  if (!entries.length) return <p className="change-summary-empty">아직 변경 내역이 없습니다.</p>;
  return <ol className="change-summary-timeline" aria-label="변경 이력">{[...entries].reverse().map(/* entry */)}</ol>;
}
```

Each item renders category, label, timestamp, and optional `sectionTitle`. Render `<details><summary>변경 전후 보기</summary>…</details>` only when `before` or `after` exists, using ordinary React text children in labelled before/after blocks. Import `formatChangeOperation` and `ChangeSummaryTimeline` in `App`, derive `report?.operations.map((operation) => formatChangeOperation(operation, report.sections)) ?? []`, and replace only the existing `plan-remaining` modal body. Keep close-button props and visibility state unchanged. Add only `.change-summary-*` styles for chips, metadata, timeline, details, and narrow text wrapping; do not modify shared `.plan-remaining` rules.

- [ ] **Step 4: Run focused UI tests**

Run: `npx vitest run tests/uiBehavior.test.ts tests/changeSummary.test.ts`

Expected: PASS; timeline is reverse chronological, details appear only when meaningful, empty copy is Korean, and dialog focus/Escape stays green.

- [ ] **Step 5: Commit the timeline slice**

Run `git add src/components/ChangeSummaryTimeline.tsx src/App.tsx src/styles.css tests/uiBehavior.test.ts` then `git commit -m "feat: show detailed change summary timeline"`.

### Task 3: Record completion and run release gates

**Files:**

- Modify: `src/lib/phaseReport.ts:40`
- Modify: `tests/phaseReport.test.ts:4-18`

**Interfaces:**

- Consumes: `v1PlanItems` and `calculatePlanAchievement(items)`.
- Produces: `변경 요약` as complete with evidence `formatChangeOperation/ChangeSummaryTimeline`.

- [ ] **Step 1: Write the failing plan-status assertion**

```ts
expect(v1PlanItems.find((item) => item.label === '변경 요약')).toMatchObject({
  status: 'complete', evidence: 'formatChangeOperation/ChangeSummaryTimeline'
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run tests/phaseReport.test.ts`

Expected: FAIL because the item is still `partial`.

- [ ] **Step 3: Record completion evidence**

Replace the Milestone 2 item with:

```ts
{ milestone: 'Milestone 2', label: '변경 요약', status: 'complete', evidence: 'formatChangeOperation/ChangeSummaryTimeline' },
```

- [ ] **Step 4: Run final verification gates**

Run `npm test`, then `npm run build`, then `git diff --check`.

Expected: all Vitest files pass, the TypeScript/Vite/Electron build succeeds, and the whitespace check emits no errors.

- [ ] **Step 5: Commit completion evidence**

Run `git add src/lib/phaseReport.ts tests/phaseReport.test.ts` then `git commit -m "docs: mark detailed change summary complete"`.

## Plan self-review

- Spec coverage: Task 1 covers safe text conversion, bounded excerpts, missing values, categories, and unresolved sections. Task 2 covers chronological order, semantic disclosure, empty state, App wiring, styles, and modal accessibility. Task 3 records completion and runs every release gate.
- Placeholder scan: every test, public interface, label, data rule, command, and verification command is explicit.
- Type consistency: `formatChangeOperation` returns `ChangeSummaryEntry`; `ChangeSummaryTimeline` consumes its array; App builds it from unchanged report operations and sections.
