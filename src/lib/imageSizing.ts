import { ImageResizeSettings } from '../types/htmlpoint';

export function resizeWithAspectLock(
  baseSize: ImageResizeSettings,
  nextSize: ImageResizeSettings,
  changedDimension: 'width' | 'height',
  locked: boolean
): ImageResizeSettings {
  if (!locked || !baseSize.width || !baseSize.height || baseSize.width <= 0 || baseSize.height <= 0) {
    return nextSize;
  }

  const ratio = baseSize.width / baseSize.height;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return nextSize;
  }

  if (changedDimension === 'width' && nextSize.width && nextSize.width > 0) {
    return {
      ...nextSize,
      height: Math.max(1, Math.round(nextSize.width / ratio))
    };
  }

  if (changedDimension === 'height' && nextSize.height && nextSize.height > 0) {
    return {
      ...nextSize,
      width: Math.max(1, Math.round(nextSize.height * ratio))
    };
  }

  return nextSize;
}
