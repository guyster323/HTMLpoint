export interface AssetDependency {
  reference: string;
  relativePath: string;
}

const IGNORABLE_REFERENCE = /^(?:data:|blob:|https?:|#|\/|\\\\)/i;

export function collectRelativeAssetReferences(html: string): AssetDependency[] {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const references = new Set<string>();
  const add = (value: string | null) => {
    if (!value) return;
    extractReferences(value).forEach((reference) => {
      if (!IGNORABLE_REFERENCE.test(reference)) references.add(reference);
    });
  };
  document.querySelectorAll('[src], [href], [poster]').forEach((element) => {
    add(element.getAttribute('src'));
    add(element.getAttribute('href'));
    add(element.getAttribute('poster'));
  });
  document.querySelectorAll('[srcset]').forEach((element) => add(element.getAttribute('srcset')));
  document.querySelectorAll('[style]').forEach((element) => add(element.getAttribute('style')));
  document.querySelectorAll('style').forEach((element) => add(element.textContent));
  return [...references].map((reference) => ({ reference, relativePath: stripQueryAndFragment(reference) }));
}

function extractReferences(value: string): string[] {
  const urlReferences = [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].map((match) => match[2]);
  if (urlReferences.length) return urlReferences;
  return value.split(',').map((entry) => entry.trim().split(/\s+/)[0]).filter(Boolean);
}

function stripQueryAndFragment(reference: string): string {
  try { return decodeURIComponent(reference.split(/[?#]/, 1)[0]); } catch { return reference.split(/[?#]/, 1)[0]; }
}
