const IMAGE_FRAME_SELECTOR = [
  '[data-htmlpoint-image-annotation-host="true"]',
  '[data-htmlpoint-frame="image"]',
  '.action-photo-frame',
  '.image-frame',
  '.photo-frame'
].join(',');

export const TABLE_LAYOUT_TARGET_SELECTOR = [
  '[data-htmlpoint-runtime-table-snapshot]',
  '[data-htmlpoint-table-frame]',
  '.table-scroll',
  '.table-wrap',
  '.table-wrapper',
  '.table-responsive'
].join(',');

/** Finds only a direct visual frame; generic content containers are deliberately excluded. */
export function findImageFrame(
  image: HTMLImageElement,
  boundary?: HTMLElement
): HTMLElement | null {
  const parent = image.parentElement;
  if (
    !parent ||
    parent === boundary ||
    parent.matches('section, header')
  ) {
    return null;
  }
  if (parent.matches(IMAGE_FRAME_SELECTOR)) {
    return parent;
  }
  if (parent.matches('figure, picture')) {
    return parent;
  }
  if (parent.children.length > 3) {
    return null;
  }
  const identity = `${parent.id} ${parent.className}`;
  return /(?:^|[-_\s])(image|photo|frame|card)(?:$|[-_\s])/i.test(identity)
    ? parent
    : null;
}

/** True only when resizing the frame should deliberately stretch its image child. */
export function shouldFillImageFrame(
  frame: HTMLElement,
  image: HTMLImageElement
): boolean {
  return (
    frame.tagName.toLowerCase() === 'picture' ||
    frame.dataset.htmlpointImageAnnotationHost === 'true' ||
    frame.classList.contains('action-photo-frame') ||
    frame.dataset.htmlpointFrame === 'image' ||
    image.style.objectFit === 'cover' ||
    image.style.width === '100%' ||
    image.style.height === '100%'
  );
}
