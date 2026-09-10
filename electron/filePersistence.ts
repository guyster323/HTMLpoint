import { copyFile, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const AUTOSAVE_RETENTION = 20;
export const SOURCE_BACKUP_RETENTION = 10;

export async function writeTextFileAtomically(
  filePath: string,
  contents: string,
  createToken: () => string = randomUUID
): Promise<void> {
  const temporaryPath = temporarySiblingPath(filePath, createToken());
  const handle = await open(temporaryPath, 'wx');
  try {
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function copyFileAtomically(
  sourcePath: string,
  destinationPath: string,
  createToken: () => string = randomUUID
): Promise<void> {
  const temporaryPath = temporarySiblingPath(destinationPath, createToken());
  try {
    await copyFile(sourcePath, temporaryPath);
    // Windows can reject fsync on a read-only descriptor even though the copy
    // itself succeeded. Open the temporary file for read/write so the flush
    // is explicit before the rename becomes visible.
    const handle = await open(temporaryPath, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, destinationPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function pruneGeneratedBackups(
  directory: string,
  prefix: string,
  suffix: string,
  keep: number
): Promise<void> {
  if (keep < 0) {
    return;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(suffix))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const details = await stat(filePath);
        return { filePath, modifiedAt: details.mtimeMs };
      })
  );
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  await Promise.all(candidates.slice(keep).map(({ filePath }) => rm(filePath, { force: true })));
}

export function makeBackupFileName(
  sourcePath: string,
  kind: 'bak' | 'autosave',
  now: Date = new Date(),
  createToken: () => string = randomUUID
): string {
  const parsed = path.parse(sourcePath);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const unique = createToken().slice(0, 8);
  return `${parsed.name}.${stamp}.${unique}.${kind}${parsed.ext || '.html'}`;
}

export function parseSourceSetUrls(sourceSet: string): string[] {
  const urls: string[] = [];
  let index = 0;
  while (index < sourceSet.length) {
    while (index < sourceSet.length && (isSourceSetWhitespace(sourceSet[index]) || sourceSet[index] === ',')) {
      index += 1;
    }
    if (index >= sourceSet.length) {
      break;
    }
    const start = index;
    const isDataUrl = sourceSet.slice(index, index + 5).toLowerCase() === 'data:';
    while (
      index < sourceSet.length &&
      !isSourceSetWhitespace(sourceSet[index]) &&
      (isDataUrl || sourceSet[index] !== ',')
    ) {
      index += 1;
    }
    const value = sourceSet.slice(start, index);
    const trailingCommas = isDataUrl ? value.match(/,+$/)?.[0].length ?? 0 : 0;
    urls.push(trailingCommas ? value.slice(0, -trailingCommas) : value);
    if (trailingCommas) {
      continue;
    }
    let parentheses = 0;
    while (index < sourceSet.length) {
      const character = sourceSet[index];
      if (character === '(') parentheses += 1;
      else if (character === ')') parentheses = Math.max(0, parentheses - 1);
      else if (character === ',' && parentheses === 0) {
        index += 1;
        break;
      }
      index += 1;
    }
  }
  return urls.filter(Boolean);
}

export function isRelativeAssetReference(value: string): boolean {
  const reference = value.trim();
  return Boolean(
    reference &&
    !reference.startsWith('#') &&
    !path.isAbsolute(reference) &&
    !/^[a-z][a-z0-9+.-]*:/i.test(reference) &&
    !reference.startsWith('\\\\') &&
    !reference.startsWith('//')
  );
}

export function decodeAssetReference(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function temporarySiblingPath(filePath: string, token: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `.${parsed.base}.${token}.tmp`);
}

function isSourceSetWhitespace(character: string): boolean {
  return /[\u0009\u000a\u000c\u000d\u0020]/.test(character);
}
