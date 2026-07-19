import { OpenedHtmlFile } from './fileServices';

export interface FileLike {
  name: string;
  type?: string;
}

export function isAcceptedHtmlFile(file: FileLike): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.html') || name.endsWith('.htm') || file.type === 'text/html';
}

export async function acceptDroppedHtmlFile(file: File): Promise<OpenedHtmlFile> {
  if (!isAcceptedHtmlFile(file)) {
    throw new Error('HTML 파일만 열 수 있습니다.');
  }

  if (window.htmlpoint?.openDroppedHtmlFile) {
    return window.htmlpoint.openDroppedHtmlFile(file);
  }

  const opened = {
    fileName: file.name,
    html: await readFileText(file)
  };

  if (hasRelativeAssetReference(opened.html)) {
    throw new Error('상대 경로 자산이 있는 문서는 Open 버튼으로 열어야 자산을 보존할 수 있습니다.');
  }
  return opened;
}

export function hasRelativeAssetReference(html: string): boolean {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(document.querySelectorAll('[src], [href], [poster], [srcset], style')).some((element) => {
    const values = [
      element.getAttribute('src'), element.getAttribute('href'), element.getAttribute('poster'),
      element.getAttribute('srcset'), element.getAttribute('style')
    ].filter((value): value is string => Boolean(value));
    return values.some((value) => extractReferences(value).some((reference) =>
      reference.length > 0 && !/^(?:data:|blob:|https?:|#|\/|\\\\)/i.test(reference)
    ));
  });
}

function extractReferences(value: string): string[] {
  if (/^\s*(?:data:|blob:|https?:|#|\/|\\\\)/i.test(value)) return [value.trim()];
  const urls = [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].map((match) => match[2].trim());
  return urls.length ? urls : value.split(',').map((entry) => entry.trim().split(/\s+/)[0]);
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Dropped file read failed.'));
    reader.readAsText(file, 'utf-8');
  });
}
