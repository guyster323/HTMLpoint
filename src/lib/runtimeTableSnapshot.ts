import { parseHtml } from './htmlParser';

export const RUNTIME_TABLE_HOST_ATTRIBUTE = 'data-htmlpoint-runtime-table-host';
export const RUNTIME_TABLE_SNAPSHOT_ATTRIBUTE = 'data-htmlpoint-runtime-table-snapshot';

const MAX_RUNTIME_TABLE_HTML_BYTES = 2 * 1024 * 1024;
const MAX_RUNTIME_TABLE_ELEMENTS = 20_000;
const MAX_RUNTIME_TABLE_CELLS = 10_000;

const ACTIVE_TABLE_ELEMENTS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'base',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'option',
  'optgroup',
  'textarea',
  'template',
  'noscript',
  'svg',
  'math',
  'canvas',
  'audio',
  'video',
  'source',
  'track',
  'picture'
]);

const SAFE_TABLE_ELEMENTS = new Set([
  'caption',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'div',
  'span',
  'p',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'small',
  'mark',
  'code',
  'kbd',
  'samp',
  'var',
  'sub',
  'sup',
  'br',
  'wbr',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'abbr',
  'time',
  'q'
]);

const SAFE_TABLE_STYLE_PROPERTIES = new Set([
  'background',
  'background-color',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-color',
  'border-style',
  'border-width',
  'border-radius',
  'border-collapse',
  'border-spacing',
  'box-shadow',
  'color',
  'display',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'height',
  'line-height',
  'letter-spacing',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'opacity',
  'overflow',
  'overflow-x',
  'overflow-y',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'table-layout',
  'text-align',
  'text-decoration',
  'text-overflow',
  'text-transform',
  'vertical-align',
  'visibility',
  'white-space',
  'width',
  'word-break',
  'word-wrap'
]);

export function sanitizeRuntimeTableHtml(tableHtml: string): HTMLTableElement | undefined {
  if (
    typeof tableHtml !== 'string' ||
    !tableHtml.trim() ||
    tableHtml.length > MAX_RUNTIME_TABLE_HTML_BYTES ||
    utf8ByteLength(tableHtml) > MAX_RUNTIME_TABLE_HTML_BYTES ||
    !/^\s*<table(?:\s|>)/i.test(tableHtml)
  ) {
    return undefined;
  }

  const document = parseHtml(tableHtml);
  const table = document.body.firstElementChild;
  const hasUnexpectedRootContent = Array.from(document.body.childNodes).some(
    (node) =>
      node !== table &&
      (node.nodeType !== Node.TEXT_NODE || Boolean(node.textContent?.trim()))
  );
  if (
    !(table instanceof HTMLTableElement) ||
    document.body.children.length !== 1 ||
    hasUnexpectedRootContent
  ) {
    return undefined;
  }

  if (table.dataset.htmlpointRuntimeWired === 'true') {
    table.removeAttribute('title');
  }

  const initialElements = [table, ...Array.from(table.querySelectorAll<HTMLElement>('*'))];
  if (
    initialElements.length > MAX_RUNTIME_TABLE_ELEMENTS ||
    table.querySelectorAll('th,td').length > MAX_RUNTIME_TABLE_CELLS
  ) {
    return undefined;
  }

  removeTableComments(table);
  initialElements.slice(1).forEach((element) => {
    const tagName = element.tagName.toLowerCase();
    if (ACTIVE_TABLE_ELEMENTS.has(tagName)) {
      element.remove();
      return;
    }
    if (!SAFE_TABLE_ELEMENTS.has(tagName)) {
      unwrapElement(element);
    }
  });
  [table, ...Array.from(table.querySelectorAll<HTMLElement>('*'))].forEach(
    sanitizeRuntimeTableElement
  );

  table.hidden = false;
  table.removeAttribute('aria-hidden');
  table.style.maxWidth = '100%';
  setSerializableImportantStyles(table, [
    ['display', 'table'],
    ['visibility', 'visible'],
    ['opacity', '1']
  ]);

  return utf8ByteLength(table.outerHTML) <= MAX_RUNTIME_TABLE_HTML_BYTES
    ? table
    : undefined;
}

export function setSerializableImportantStyles(
  element: HTMLElement,
  declarations: ReadonlyArray<readonly [property: string, value: string]>
): void {
  const existing = element.getAttribute('style')?.trim() ?? '';
  const prefix = existing
    ? `${existing}${existing.endsWith(';') ? '' : ';'}`
    : '';
  const importantDeclarations = declarations
    .map(([property, value]) => `${property}: ${value} !important;`)
    .join(' ');
  element.setAttribute(
    'style',
    [prefix, importantDeclarations].filter(Boolean).join(' ')
  );
}

function sanitizeRuntimeTableElement(element: HTMLElement): void {
  const tagName = element.tagName.toLowerCase();
  Array.from(element.attributes).forEach((attribute) => {
    const name = attribute.name.toLowerCase();
    if (!isAllowedRuntimeTableAttribute(tagName, name)) {
      element.removeAttribute(attribute.name);
      return;
    }
    if (name === 'style') {
      sanitizeRuntimeTableStyle(element);
      return;
    }
    if (name === 'class') {
      const safeClasses = Array.from(element.classList).filter(
        (className) => !className.toLowerCase().startsWith('htmlpoint-')
      );
      if (safeClasses.length) {
        element.className = safeClasses.join(' ');
      } else {
        element.removeAttribute('class');
      }
      return;
    }
    if (name === 'href') {
      if (!isSafeRuntimeUrl(attribute.value, 'link')) {
        element.removeAttribute(attribute.name);
      } else if (tagName === 'a') {
        element.setAttribute('rel', 'noopener noreferrer');
      }
      return;
    }
    if (name === 'src' && !isSafeRuntimeUrl(attribute.value, 'resource')) {
      element.removeAttribute(attribute.name);
    }
  });
}

function isAllowedRuntimeTableAttribute(tagName: string, name: string): boolean {
  if (
    name.startsWith('on') ||
    name.startsWith('data-htmlpoint-') ||
    [
      'srcdoc',
      'srcset',
      'target',
      'download',
      'ping',
      'autofocus',
      'contenteditable',
      'tabindex',
      'nonce',
      'integrity',
      'crossorigin',
      'referrerpolicy',
      'formaction',
      'action',
      'method',
      'background',
      'xlink:href',
      'id',
      'name'
    ].includes(name)
  ) {
    return false;
  }
  if (
    ['class', 'style', 'title', 'lang', 'dir', 'role'].includes(name) ||
    name.startsWith('aria-')
  ) {
    return true;
  }
  if (tagName === 'table') {
    return ['border', 'cellpadding', 'cellspacing', 'width'].includes(name);
  }
  if (tagName === 'col' || tagName === 'colgroup') {
    return ['span', 'width'].includes(name);
  }
  if (tagName === 'th' || tagName === 'td') {
    return ['colspan', 'rowspan', 'headers', 'scope', 'abbr', 'width', 'height'].includes(name);
  }
  if (tagName === 'ol') {
    return ['start', 'reversed', 'type'].includes(name);
  }
  if (tagName === 'li') {
    return name === 'value';
  }
  if (tagName === 'a') {
    return ['href', 'hreflang', 'rel'].includes(name);
  }
  if (tagName === 'img') {
    return ['src', 'alt', 'width', 'height', 'loading', 'decoding'].includes(name);
  }
  if (tagName === 'time') {
    return name === 'datetime';
  }
  if (tagName === 'q') {
    return name === 'cite';
  }
  return false;
}

function sanitizeRuntimeTableStyle(element: HTMLElement): void {
  const properties = Array.from(
    { length: element.style.length },
    (_value, index) => element.style.item(index)
  );
  properties.forEach((property) => {
    const value = element.style.getPropertyValue(property);
    if (
      !SAFE_TABLE_STYLE_PROPERTIES.has(property.toLowerCase()) ||
      /(?:url\s*\(|image-set\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|@import|-moz-binding|behavior\s*:|var\s*\(|\\)/i.test(
        value
      )
    ) {
      element.style.removeProperty(property);
    }
  });
  if (!element.getAttribute('style')?.trim()) {
    element.removeAttribute('style');
  }
}

function isSafeRuntimeUrl(value: string, kind: 'link' | 'resource'): boolean {
  const compact = value.trim().replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  if (!compact || compact.includes('\\') || compact.startsWith('//')) {
    return false;
  }
  if (kind === 'resource') {
    return /^data:image\/(?:png|gif|jpe?g|webp|avif|bmp);base64,/i.test(compact);
  }
  const scheme = compact.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme) {
    return true;
  }
  if (scheme === 'http' || scheme === 'https') {
    try {
      const url = new URL(compact);
      return Boolean(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  }
  return ['mailto', 'tel'].includes(scheme);
}

function removeTableComments(table: HTMLTableElement): void {
  const walker = table.ownerDocument.createTreeWalker(table, NodeFilter.SHOW_COMMENT);
  const comments: Comment[] = [];
  while (walker.nextNode()) {
    comments.push(walker.currentNode as Comment);
  }
  comments.forEach((comment) => comment.remove());
}

function unwrapElement(element: HTMLElement): void {
  const parent = element.parentNode;
  if (!parent) {
    return;
  }
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  element.remove();
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
