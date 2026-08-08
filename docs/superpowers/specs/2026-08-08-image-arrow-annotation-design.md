# Image Arrow Annotation Design

## Goal

Complete the arrow portion of Milestone 4 with a direct, reversible image annotation that preserves the original image source.

## Scope

- Add a `Draw Arrow` command to the Image Inspector for the selected image.
- In the sandboxed preview, let the user drag from an arrow tail to its head directly on that image.
- Persist the arrow as a percentage-normalized SVG overlay that reflows when the supported image is resized.
- Route persistence through the existing editor `commit` path so Undo and Redo restore the image before and after the annotation.
- Keep existing text and box annotations unchanged.

## Non-goals

- Editing, moving, recoloring, or deleting individual arrows in this slice.
- Supporting arrows on an image that is inside a pre-existing image frame, cropped, or rotated.
- Replacing or rasterizing the source image.

## Design

### Supported source structure

The feature accepts a bare `img` whose parent is the report `section` or `header`, with no image transform or crop style. Other structures are rejected before drawing and the editor shows a clear status message. This prevents guessing coordinate transforms for frames, crop, or rotation.

### Persisted markup

On a successful drag, the editor wraps the bare image in a generated `span[data-htmlpoint-image-annotation-host]` and appends a generated `svg[data-htmlpoint-image-arrow]`. The original `src`, image attributes, and image styles remain on the `img` unchanged. The host is `position: relative; display: inline-block`; the SVG is an absolute, pointer-transparent 100-by-100 viewBox overlay.

The SVG stores normalized start/end values in its line geometry and a polygon arrow head. Its dimensions use `width="100%"`, `height="100%"`, and `preserveAspectRatio="none"`, so it follows supported image resizing without recalculating source pixels.

### Preview protocol

`App` owns an armed node ID. The Image Inspector arms that selected image, and `Canvas` sends an `htmlpoint-set-image-arrow-mode` editor message to the iframe. The iframe attaches pointer handling to the selected image only. It captures that pointer, shows a transient line during the drag, normalizes the completed endpoints against `getBoundingClientRect()`, and sends `htmlpoint-add-image-arrow` to the parent. No page-level pointer handling is introduced outside the preview iframe.

`App` validates that the message matches the selected section and armed image, calls the image-arrow editing helper through `commit`, then disarms the mode. A too-short drag is ignored.

### Accessibility and safety

The saved SVG has an `aria-label` and `role="img"`; it never receives pointer events. Preview-only drawing state remains in the iframe and is removed before serialization. Existing image selection, resize, text annotation, and box annotation behavior remains intact.

## Verification

Focused tests cover normalized SVG persistence, original-source preservation, supported-structure rejection, preview mode/message wiring, and App-level undo/redo behavior. Final gates are `npm test`, `npm run build`, and `git diff --check`.
