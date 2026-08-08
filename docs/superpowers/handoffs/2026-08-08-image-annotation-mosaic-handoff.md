# Image Arrow Annotation and Mosaic Handoff

## Current repository state

- Branch: `main`
- Baseline commit: `bbce432 fix: harden change summary rendering`
- Remote: `origin/main` was pushed through `bbce432`.
- Last release verification: `npm test` passed 19 files / 158 tests; `npm run build` and `git diff --check` passed.

## Requested scope

Implement both remaining partial Milestone 4 capabilities:

1. Image arrow annotation
2. Region-based pixel mosaic

The user explicitly approved direct manipulation: users should drag directly on the image in the canvas to set an arrow direction or a mosaic rectangle.

## Confirmed boundaries

- Do not start implementation until a fresh design/spec approval is complete.
- The two capabilities are independent subprojects and should use separate spec → plan → implementation cycles. Complete arrow annotation first, then mosaic.
- Reuse the iframe preview's existing pointer/message architecture rather than adding page-level pointer capture outside the canvas.
- Keep changes reversible through the existing `commit` and Undo/Redo history.
- Preserve source image data. The user was asked whether mosaic must be non-destructive (removable/editable later), but did not answer before requesting this handoff. Resolve this first in the next session.

## Relevant implementation anchors

- `src/lib/preview.ts`: preview iframe script, image selection overlays, pointer handling, and preview-to-editor `postMessage` protocol. Image resize currently posts normalized resize results from selection handles.
- `src/components/Canvas.tsx`: builds the sandboxed iframe preview and sends editor messages into it.
- `src/App.tsx`: receives trusted preview messages, owns selected node state, and routes mutations through `commit`.
- `src/lib/editing.ts`: `addImageAnnotation` currently inserts text/box annotation divs after the image; `applyImageFilter` supports rotation, brightness, contrast, and blur.
- `src/components/PropertiesPanel.tsx`: Image Inspector contains image adjustments and the existing text/box annotation controls.
- `src/types/htmlpoint.ts`: `ImageFilterSettings` currently has rotation, brightness, contrast, and blur only.
- `src/lib/phaseReport.ts`: `화살표/박스/텍스트 주석` and `모자이크/블러` remain `partial`.

## Recommended design direction

### 1. Arrow annotation

Persist a non-destructive, percentage-normalized vector overlay associated with the selected image. In preview annotation mode, drag from arrow tail to head; post the normalized start/end coordinates to `App`; create/update a serializable SVG or HTML overlay layer. The overlay must reflow with image resizing and preserve undo/redo history. Text and box annotations remain unchanged.

### 2. Mosaic

After the user confirms non-destructive behavior, persist a percentage-normalized rectangle overlay. In preview mosaic mode, drag the rectangle; render a pixelated duplicate-image crop or an equivalent deterministic overlay without replacing the original image source. Do not use a destructive canvas bake unless the user explicitly asks for it. The implementation must account for image frames, crop, and rotation; reject unsupported image structures safely rather than guessing layout transformations.

## Recommended next-session sequence

1. Read this handoff and inspect the listed code anchors.
2. Ask and record the pending non-destructive mosaic decision.
3. Brainstorm and approve the arrow-annotation design, write and commit its spec, then plan and implement it with TDD.
4. Repeat the same spec/plan/implementation cycle for mosaic.
5. Run `npm test`, `npm run build`, and `git diff --check` after each completed capability.
