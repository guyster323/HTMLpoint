# Change Summary Detail Design

## Goal

Complete the remaining Milestone 2 change-summary capability by turning the existing operation list into an accessible, readable audit timeline without exposing raw document HTML or adding a second history store.

## Scope

- Keep the existing Review ribbon command and modal focus/escape behavior.
- Show every operation in reverse chronological order with its Korean action label, operation category, local timestamp, and current section title when that section still exists.
- Let a user expand an operation that has a before or after payload to compare safe, plain-text excerpts. Excerpts are bounded to 240 characters per side and never render operation HTML.
- Give the empty state and the detail control descriptive Korean copy and semantic list/disclosure markup.
- Keep the current `ReportDocument.operations` data shape and use it as the sole timeline source.
- Mark the Milestone 2 item complete after focused formatting, modal, and plan-status regressions pass.

## Non-goals

- Persisting, exporting, filtering, searching, or clearing the operation history.
- Reconstructing a visual HTML diff or restoring a document to a selected timeline entry.
- Changing undo/redo, serialization, operation recording, or the editor's saved-document format.
- Revealing internal section or node IDs as user-facing labels.

## Design

### Presentation data

Introduce a small pure `changeSummary` formatter module. It accepts an `EditOperation` and the current report sections and returns a view model containing the category label, action label, formatted local timestamp, optional current section title, and optional before/after excerpts.

The formatter strips markup into text before truncation, collapses whitespace, and appends an ellipsis only when it truncates content. Missing payloads stay absent rather than being represented by placeholder text. A deleted section cannot be resolved from the current document, so its timeline item omits the section title and continues to use the recorded action label.

### Modal timeline

`App` continues to own modal visibility. Its modal body becomes an ordered timeline with newest operations first. Each entry shows the operation category, label, timestamp, and resolved section title. When either excerpt exists, a native `details` element exposes a "변경 전후 보기" control and labelled before/after text blocks; otherwise no inert detail control is rendered.

The modal shows the total operation count in its description. The existing close button remains the initial focus target, Escape still closes the dialog, and focus still returns to the Review button. The timeline is text-only, so operation payloads cannot introduce executable markup into the renderer.

### Styling and completion evidence

Add narrowly scoped timeline styles beside the existing modal styles: category chips, metadata, disclosure content, and resilient narrow-window wrapping. Do not alter shared modal dimensions or unrelated plan-summary styles.

When the formatter and UI regressions are green, change the Milestone 2 `변경 요약` status to `complete` with formatter-and-modal evidence.

## Verification

Focused unit tests cover category mapping, safe HTML-to-text excerpting, truncation, missing payloads, and a deleted/unresolvable section. UI tests cover reverse chronological entries, the detail disclosure only when payload exists, empty copy, and the existing focus/Escape return contract. Final gates are `npm test`, `npm run build`, and `git diff --check`.
