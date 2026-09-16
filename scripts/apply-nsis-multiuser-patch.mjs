import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const nsisMax = '${' + 'NSIS_MAX_STRLEN}';
const folderId = '${' + 'FOLDERID_UserProgramFiles}';
const kfFlag = '${' + 'KF_FLAG_CREATE}';
const ifTok = '${' + 'If}';
const endifTok = '${' + 'endif}';

export const UNSAFE_MARKER = `System::Call '*$2(&w${nsisMax} .s)'`;
export const SAFE_MARKER = `System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i ${nsisMax})p'`;

export const SAFE_BLOCK = [
  '      Push $1',
  '      Push $2',
  '      # UserProgramFiles is the per-user install root and can be a non-default location',
  '      StrCpy $2 0',
  `      System::Call 'SHELL32::SHGetKnownFolderPath(g "${folderId}", i ${kfFlag}, p 0, *p .r2)i.r1'`,
  `      ${ifTok} $1 == 0`,
  `        ${SAFE_MARKER}`,
  `      ${endifTok}`,
  `      ${ifTok} $2 != 0`,
  "        System::Call 'OLE32::CoTaskMemFree(p r2)'",
  `      ${endifTok}`,
  '      Pop $2',
  '      Pop $1'
].join('\n');

const UNSAFE_RE =
  / {6}System::Store S\n {6}# Win7 has a per-user programfiles known folder[\s\S]*? {6}System::Store L/;

export function defaultTemplatePath(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  return path.join(root, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'multiUser.nsh');
}

export function patchMultiUserNsh(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const normalized = source.replace(/\r\n/g, '\n');
  if (normalized.includes(SAFE_MARKER)) {
    return { status: 'already-safe', text: source, newline };
  }
  if (!normalized.includes(UNSAFE_MARKER) || !UNSAFE_RE.test(normalized)) {
    throw new Error(
      'app-builder-lib multiUser.nsh does not contain the expected unsafe UserProgramFiles System.dll copy. ' +
        'Refusing to patch an unknown template.'
    );
  }
  const text = normalized.replace(UNSAFE_RE, SAFE_BLOCK);
  if (text.includes(UNSAFE_MARKER) || !text.includes(SAFE_MARKER)) {
    throw new Error('NSIS UserProgramFiles patch did not apply cleanly');
  }
  return { status: 'patched', text: newline === '\r\n' ? text.replace(/\n/g, '\r\n') : text, newline };
}

export function applyNsisMultiUserPatch(templatePath = defaultTemplatePath()) {
  const source = readFileSync(templatePath, 'utf8');
  const result = patchMultiUserNsh(source);
  if (result.status === 'patched') {
    writeFileSync(templatePath, result.text);
  }
  return { ...result, templatePath };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const dryRun = process.argv.includes('--dry-run');
  const applied = dryRun
    ? { ...patchMultiUserNsh(readFileSync(defaultTemplatePath(), 'utf8')), templatePath: defaultTemplatePath() }
    : applyNsisMultiUserPatch();
  const payload = {
    status: applied.status,
    templatePath: applied.templatePath,
    unsafePatternFound: applied.status === 'patched' || (dryRun && applied.status === 'patched'),
    alreadySafe: applied.status === 'already-safe',
    wouldPatch: applied.status === 'patched',
    wrote: !dryRun && applied.status === 'patched'
  };
  if (dryRun) {
    payload.unsafePatternFound = readFileSync(applied.templatePath, 'utf8').includes(UNSAFE_MARKER);
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
