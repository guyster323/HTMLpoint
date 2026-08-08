# Image Arrow Annotation Implementation Plan

**Goal:** Add direct, reversible, non-destructive arrow annotations to supported report images.

**Architecture:** The Image Inspector arms one selected image; Canvas forwards that mode to the sandboxed preview. The preview normalizes a direct drag and posts it to App. App persists a generated SVG overlay through the current `commit` history path.

## Constraints

- Preserve the original image source and attributes.
- Support only bare, uncropped, unrotated images; reject unsupported structures without mutation.
- Keep pointer handling inside the iframe preview and use its existing message protocol.
- Persist percentage-normalized endpoints and ensure Undo/Redo works through `commit`.

## Work items

1. Add failing editing tests for SVG overlay persistence, source preservation, and safe rejection.
2. Add `ImageArrowCoordinates` plus a focused image-arrow mutation helper in `editing.ts`.
3. Add failing preview/App tests for arming, direct drag message wiring, and committed undo/redo.
4. Add Image Inspector arming UI, Canvas editor-to-preview mode messages, preview drag handling, and App message validation/commit handling.
5. Mark the arrow annotation milestone evidence complete and run focused tests, full tests, build, and whitespace validation.

## Completion evidence

`addImageArrowAnnotation` persists the overlay and `htmlpoint-add-image-arrow` routes a direct preview drag through the editor history.
