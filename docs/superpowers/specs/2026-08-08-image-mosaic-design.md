# Image Mosaic Design

## Goal

Complete the remaining Milestone 4 mosaic capability with direct region selection while preserving the original image data.

## Scope

- Add a `Draw Mosaic` command for the selected image.
- Let the user drag a rectangle directly on a supported image in the sandboxed preview.
- Persist a percentage-normalized, non-destructive mosaic overlay that uses a pixelated duplicate of the original image.
- Keep the result reversible through the current `commit` and Undo/Redo history.

## Non-goals

- Replacing or raster-baking the source image.
- Editing, moving, resizing, or removing an individual saved mosaic region in this slice.
- Supporting pre-existing image frames, crop, or rotation transforms.

## Design

### Persisted overlay

For a bare, uncropped, unrotated image, reuse the generated image-annotation host introduced for arrows. A saved mosaic is an absolute, overflow-hidden region with normalized `left`, `top`, `width`, and `height` percentages. Inside it, a duplicate `img` retains the source URL and is reduced then CSS-scaled with `image-rendering: pixelated`. It shows the matching source crop as visible mosaic blocks while the original `img` remains unchanged.

Generated duplicate images are marked as mosaic sources and excluded from the editor's normal editable-image collection. The mosaic region is inserted below any saved arrow SVG overlays, so arrows remain legible when both annotations exist.

### Preview protocol

The Inspector arms a mosaic mode for one selected image. Canvas sends that state via `htmlpoint-set-image-mosaic-mode`; the iframe handles pointer input only on the armed image, renders a temporary rectangle, normalizes the completed corners, and posts `htmlpoint-add-image-mosaic`. App validates the armed node and selected section, commits the mutation, then disarms.

### Constraints and safety

Only a direct `img` under a `section` or `header`, or one already inside the generated annotation host, is supported. Existing frame, crop, or rotation styling is rejected before drawing. Once a mosaic exists, crop and non-zero rotation are also rejected, so later operations cannot silently misalign it. A region smaller than 2% in either dimension is ignored.

## Verification

Tests cover normalized region persistence, source preservation, pixelated clone geometry, parser exclusion of generated clone images, history reversibility, unsupported-image rejection, preview protocol wiring, and plan-status completion. Release gates remain `npm test`, `npm run build`, and `git diff --check`.
