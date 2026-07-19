interface PreviewSelectionMessage {
  nodeId?: string;
  previewSync?: boolean;
}

export function shouldApplyPreviewSelectionState(message: PreviewSelectionMessage): boolean {
  return !message.previewSync;
}

export function shouldStorePreviewSnapshot(
  message: PreviewSelectionMessage,
  currentNodeId: string | undefined,
  currentNodeIds: string[]
): boolean {
  if (!message.previewSync) {
    return true;
  }
  return Boolean(
    message.nodeId &&
      message.nodeId === currentNodeId &&
      currentNodeIds.includes(message.nodeId)
  );
}
