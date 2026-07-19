export const MIN_PROPERTIES_WIDTH = 280;
export const MAX_PROPERTIES_WIDTH = 560;

export function clampPropertiesWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return 330;
  }
  return Math.min(MAX_PROPERTIES_WIDTH, Math.max(MIN_PROPERTIES_WIDTH, Math.round(width)));
}

export function getAutoTextareaRows(value: string): number {
  const lineCount = value.split(/\r?\n/).length;
  const lengthRows = Math.ceil(value.length / 50);
  return Math.min(18, Math.max(4, lineCount + 1, lengthRows));
}
