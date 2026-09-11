import type { EditableNode } from '../types/htmlpoint';

function layoutPath(node: EditableNode): number[] {
  return node.layoutTargetPath ?? node.path;
}

function pathKey(path: number[]): string {
  return path.join('.');
}

function pathsEqual(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function isStrictPathPrefix(parent: number[], child: number[]): boolean {
  return parent.length < child.length && parent.every((part, index) => part === child[index]);
}

function representativePriority(node: EditableNode): number {
  if (node.kind === 'table') return 0;
  if (node.kind === 'image') return 1;
  if (node.kind === 'chart') return 2;
  if (pathsEqual(node.path, layoutPath(node))) return 3;
  if (node.kind === 'list') return 4;
  return 5;
}

/** Returns one user-facing object per visual layout target. */
export function semanticLayoutNodes(nodes: EditableNode[]): EditableNode[] {
  const representatives = new Map<string, { node: EditableNode; index: number }>();
  nodes.forEach((node, index) => {
    const key = pathKey(layoutPath(node));
    const current = representatives.get(key);
    if (
      !current ||
      representativePriority(node) < representativePriority(current.node)
    ) {
      representatives.set(key, { node, index: current?.index ?? index });
    }
  });
  return Array.from(representatives.values())
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.node);
}

export function semanticRepresentativeId(
  nodes: EditableNode[],
  nodeId?: string
): string | undefined {
  const selected = nodes.find((node) => node.id === nodeId);
  if (!selected) return nodeId;
  const key = pathKey(layoutPath(selected));
  return semanticLayoutNodes(nodes).find((node) => pathKey(layoutPath(node)) === key)?.id;
}

export interface SemanticLayoutSelection {
  nodeIds: string[];
  primaryNodeId?: string;
}

/**
 * Canonicalizes layout selection to visual representatives and lets a selected
 * ancestor own descendants, matching the iframe's group-movement behavior.
 */
export function normalizeSemanticLayoutSelection(
  nodes: EditableNode[],
  selectedNodeIds: string[],
  primaryNodeId?: string
): SemanticLayoutSelection {
  const representativeNodes = semanticLayoutNodes(nodes);
  const representativeByPath = new Map(
    representativeNodes.map((node) => [pathKey(layoutPath(node)), node] as const)
  );
  const requested = selectedNodeIds.length
    ? selectedNodeIds
    : primaryNodeId
      ? [primaryNodeId]
      : [];
  const unique = new Map<string, EditableNode>();
  requested.forEach((nodeId) => {
    const selected = nodes.find((node) => node.id === nodeId);
    if (!selected) return;
    const representative = representativeByPath.get(pathKey(layoutPath(selected)));
    if (representative) unique.set(representative.id, representative);
  });
  const candidates = Array.from(unique.values());
  const survivors = candidates.filter((candidate) =>
    !candidates.some(
      (other) =>
        other !== candidate &&
        isStrictPathPrefix(layoutPath(other), layoutPath(candidate))
    )
  );
  const primaryRepresentativeId = semanticRepresentativeId(nodes, primaryNodeId);
  const primaryRepresentative = representativeNodes.find(
    (node) => node.id === primaryRepresentativeId
  );
  const primary =
    survivors.find((node) => node.id === primaryRepresentativeId) ??
    (primaryRepresentative
      ? survivors.find((node) =>
          isStrictPathPrefix(layoutPath(node), layoutPath(primaryRepresentative))
        )
      : undefined) ??
    survivors[0];
  return {
    nodeIds: survivors.map((node) => node.id),
    primaryNodeId: primary?.id
  };
}

/** Mirrors the runtime rule that a selected ancestor owns its selected descendants. */
export function semanticLayoutSelectionCount(
  nodes: EditableNode[],
  selectedNodeIds: string[]
): number {
  return normalizeSemanticLayoutSelection(nodes, selectedNodeIds).nodeIds.length;
}
