import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  copyFileAtomically,
  isRelativeAssetReference,
  makeBackupFileName,
  parseSourceSetUrls,
  pruneGeneratedBackups,
  writeTextFileAtomically
} from '../electron/filePersistence';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'htmlpoint-persistence-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('file persistence safeguards', () => {
  it('writes complete text through a same-directory temporary file', async () => {
    const directory = await makeTemporaryDirectory();
    const target = path.join(directory, 'report.autosave.html');

    await writeTextFileAtomically(target, '<html>complete</html>', () => 'fixed-token');

    expect(await readFile(target, 'utf8')).toBe('<html>complete</html>');
    expect(await readdir(directory)).toEqual(['report.autosave.html']);
  });

  it('copies a source file without leaving a partial temporary file', async () => {
    const directory = await makeTemporaryDirectory();
    const source = path.join(directory, 'source.html');
    const destination = path.join(directory, 'source.backup.html');
    await writeFile(source, 'source contents', 'utf8');

    await copyFileAtomically(source, destination, () => 'copy-token');

    expect(await readFile(destination, 'utf8')).toBe('source contents');
    expect((await readdir(directory)).sort()).toEqual(['source.backup.html', 'source.html']);
  });

  it('retains only the newest generated backups', async () => {
    const directory = await makeTemporaryDirectory();
    const names = ['report.1.autosave.html', 'report.2.autosave.html', 'report.3.autosave.html'];
    for (const [index, name] of names.entries()) {
      const filePath = path.join(directory, name);
      await writeFile(filePath, name, 'utf8');
      const modifiedAt = new Date(1_700_000_000_000 + index * 1_000);
      await utimes(filePath, modifiedAt, modifiedAt);
    }

    await pruneGeneratedBackups(directory, 'report.', '.autosave.html', 2);

    expect((await readdir(directory)).sort()).toEqual(names.slice(1));

    await pruneGeneratedBackups(directory, 'report.', '.autosave.html', 0);
    expect(await readdir(directory)).toEqual([]);
  });

  it('creates collision-resistant, recognizable backup names', () => {
    expect(
      makeBackupFileName(
        path.join('documents', 'report.html'),
        'autosave',
        new Date('2026-09-10T04:00:00.123Z'),
        () => '12345678-rest'
      )
    ).toBe('report.2026-09-10T04-00-00-123Z.12345678.autosave.html');
  });
});

describe('asset reference parsing', () => {
  it('does not split a data URL at its embedded comma', () => {
    expect(parseSourceSetUrls('data:image/png;base64,AAAA 1x, images/report%202x.png 2x')).toEqual([
      'data:image/png;base64,AAAA',
      'images/report%202x.png'
    ]);
  });

  it('accepts only relative file references', () => {
    expect(isRelativeAssetReference('images/report.png')).toBe(true);
    expect(isRelativeAssetReference('../shared/theme.css')).toBe(true);
    expect(isRelativeAssetReference('data:image/png;base64,AAAA')).toBe(false);
    expect(isRelativeAssetReference('mailto:owner@example.com')).toBe(false);
    expect(isRelativeAssetReference('javascript:void(0)')).toBe(false);
    expect(isRelativeAssetReference('https://example.com/theme.css')).toBe(false);
    expect(isRelativeAssetReference('/absolute/image.png')).toBe(false);
  });
});
