const EDITOR_MARKERS = [
  'htmlpoint-preview-node',
  'htmlpoint-selected-node',
  'htmlpoint-selection-overlay',
  'htmlpoint-select-handle',
  'htmlpoint-marquee',
  'htmlpoint-runtime-table',
  'htmlpoint-source-path',
  'htmlpoint-section-id',
  'htmlpoint-preview-section',
  'htmlpoint-serialized-section',
  'htmlpoint-focus-target',
  'htmlpoint-preview'
];

const EDITOR_CLASSES = [
  'htmlpoint-preview-node',
  'htmlpoint-selected-node',
  'htmlpoint-selected-node-multi',
  'htmlpoint-selected-node-child',
  'htmlpoint-selection-overlay',
  'htmlpoint-select-handle',
  'htmlpoint-select-handle-nw',
  'htmlpoint-select-handle-ne',
  'htmlpoint-select-handle-sw',
  'htmlpoint-select-handle-se',
  'htmlpoint-marquee',
  'htmlpoint-runtime-table'
];

export function stripEditorArtifacts(document: Document): boolean {
  let changed = false;

  document.querySelectorAll('script, style').forEach((element) => {
    const content = element.textContent ?? '';
    if (
      element.hasAttribute('data-htmlpoint-preview-runtime') ||
      element.hasAttribute('data-htmlpoint-preview-style') ||
      hasEditorMarker(content)
    ) {
      element.remove();
      changed = true;
    }
  });
  document.querySelectorAll<HTMLElement>(
    '[data-htmlpoint-node-id], [data-htmlpoint-section-id], [data-htmlpoint-preview-section], [data-htmlpoint-serialized-section], [data-htmlpoint-source-path], [data-htmlpoint-focus-target], [data-htmlpoint-runtime-wired]'
  ).forEach((element) => {
    element.removeAttribute('data-htmlpoint-node-id');
    element.removeAttribute('data-htmlpoint-section-id');
    element.removeAttribute('data-htmlpoint-preview-section');
    element.removeAttribute('data-htmlpoint-serialized-section');
    element.removeAttribute('data-htmlpoint-source-path');
    element.removeAttribute('data-htmlpoint-focus-target');
    element.removeAttribute('data-htmlpoint-runtime-wired');
    changed = true;
  });

  document
    .querySelectorAll<HTMLElement>(
      '.htmlpoint-selection-overlay, .htmlpoint-select-handle, .htmlpoint-marquee'
    )
    .forEach((element) => {
      element.remove();
      changed = true;
    });

  document.querySelectorAll<HTMLElement>('*').forEach((element) => {
    const before = element.getAttribute('class');
    EDITOR_CLASSES.forEach((className) => element.classList.remove(className));
    if (before !== element.getAttribute('class')) {
      changed = true;
    }
    if (!element.getAttribute('class')?.trim()) {
      element.removeAttribute('class');
    }
  });

  const walker = document.createTreeWalker(document.body ?? document, NodeFilter.SHOW_TEXT);
  const leakedTextNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (hasVisibleEditorLeak(node.nodeValue ?? '')) {
      leakedTextNodes.push(node);
    }
  }
  leakedTextNodes.forEach((node) => {
    node.remove();
    changed = true;
  });

  return changed;
}

export function serializeFullDocument(document: Document): string {
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

function hasEditorMarker(value: string): boolean {
  return EDITOR_MARKERS.some((marker) => value.includes(marker));
}

function hasVisibleEditorLeak(value: string): boolean {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return false;
  }
  return (
    compact.includes('.htmlpoint-preview-node') ||
    compact.includes('.htmlpoint-selected-node') ||
    compact.includes('.htmlpoint-selection-overlay') ||
    compact.includes('source: htmlpoint-preview') ||
    compact.includes("source: 'htmlpoint-preview'") ||
    compact.includes('htmlpoint-select-handle')
  );
}
