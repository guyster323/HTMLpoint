export function getElementPath(root: Element, target: Element): number[] {
  if (root === target) {
    return [];
  }

  const path: number[] = [];
  let current: Element | null = target;

  while (current && current !== root) {
    const parent: Element | null = current.parentElement;
    if (!parent) {
      return [];
    }
    path.unshift(Array.from(parent.children).indexOf(current));
    current = parent;
  }

  return current === root ? path : [];
}

export function getElementByPath(root: Element, path: number[]): Element | null {
  let current: Element | null = root;

  for (const index of path) {
    if (!current || index < 0 || index >= current.children.length) {
      return null;
    }
    current = current.children.item(index);
  }

  return current;
}

export function makeNodeId(sectionId: string, path: number[], kindHint?: string): string {
  const suffix = path.length ? path.join('.') : 'root';
  return `${sectionId}:${kindHint ?? 'node'}:${suffix}`;
}

export function elementPathKey(root: Element, target: Element): string {
  const path = getElementPath(root, target);
  return path.length ? path.join('.') : 'root';
}
