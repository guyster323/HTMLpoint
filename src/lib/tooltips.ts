export function tooltipProps(label: string): {
  'aria-label': string;
  'data-tooltip': string;
  title: string;
} {
  return {
    'aria-label': label,
    'data-tooltip': label,
    title: label
  };
}
