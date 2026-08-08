# Image Mosaic Implementation Plan

**Goal:** Add a non-destructive, direct-drag pixel mosaic for supported report images.

**Architecture:** The Image Inspector arms mosaic mode; Canvas forwards it to the iframe; the preview normalizes a direct drag; App persists a generated pixelated duplicate-image crop through `commit`.

## Constraints

- Never replace or modify the original image source.
- Store regions as normalized percentages and let their generated host reflow during image resize.
- Keep generated clone images out of editable image discovery.
- Reject frames, crop, rotation, and too-small regions without mutation.
- Keep arrow and mosaic drawing modes independent.

## Work items

1. Add failing persistence, parser-exclusion, safety, and history tests.
2. Implement the mosaic mutation helper and generated overlay markup.
3. Add Image Inspector arming UI, Canvas mode messages, iframe rectangle drawing, and App validation/commit routing.
4. Update the Milestone 4 completion evidence and run focused plus full release gates.
