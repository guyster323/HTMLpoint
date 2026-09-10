import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session } from 'electron';
import { copyFile, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PREVIEW_ASSET_SCHEME, PreviewAssetRegistry } from './previewProtocol.js';
import {
  AUTOSAVE_RETENTION,
  SOURCE_BACKUP_RETENTION,
  copyFileAtomically,
  decodeAssetReference,
  isRelativeAssetReference,
  makeBackupFileName,
  parseSourceSetUrls,
  pruneGeneratedBackups,
  writeTextFileAtomically
} from './filePersistence.js';
protocol.registerSchemesAsPrivileged([
  {
    scheme: PREVIEW_ASSET_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      stream: true
    }
  }
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const MAX_HTML_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

interface HtmlFilePayload {
  fileName: string;
  filePath: string;
  html: string;
  backupPath?: string;
  warnings?: string[];
  recovered?: boolean;
}
interface SaveHtmlPayload {
  defaultPath?: string;
  filePath?: string;
  html: string;
  sourcePath?: string;
  warnings?: string[];
}
const confirmedCloseWindows = new WeakSet<BrowserWindow>();
const previewAssetRegistry = new PreviewAssetRegistry(randomUUID, realpath);
const previewRegistryCleanupOwners = new Set<number>();
const ALLOWED_PREVIEW_ASSET_RESOURCE_TYPES = new Set([
  'font',
  'image',
  'media',
  'script',
  'stylesheet'
]);
function getRendererUrl(): string {
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL;
  }
  return pathToFileURL(path.join(__dirname, '../dist/index.html')).toString();
}

function getSampleDirectory(): string {
  if (isDev) {
    return path.join(app.getAppPath(), 'HTML_reference');
  }
  return path.join(process.resourcesPath, 'HTML_reference');
}
async function createWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#f4f5f7',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (mainWindow.isDestroyed() || details.reason === 'clean-exit') {
      return;
    }
    void showRendererRecoveryDialog(mainWindow, details.reason);
  });
  mainWindow.on('close', (event) => {
    if (confirmedCloseWindows.has(mainWindow)) {
      confirmedCloseWindows.delete(mainWindow);
      return;
    }
    if (mainWindow.webContents.isDestroyed()) {
      return;
    }
    event.preventDefault();
    mainWindow.webContents.send('htmlpoint:close-requested');
  });
  installApplicationMenu(mainWindow);
  try {
    await mainWindow.loadURL(getRendererUrl());
  } catch (error) {
    mainWindow.show();
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'HTMLpoint 시작 실패',
      message: '애플리케이션을 시작할 수 없습니다.',
      detail: errorMessage(error),
      buttons: ['닫기']
    });
    mainWindow.destroy();
  }
}

async function showRendererRecoveryDialog(mainWindow: BrowserWindow, reason: string): Promise<void> {
  if (mainWindow.isDestroyed()) {
    return;
  }
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: 'HTMLpoint 복구',
    message: '편집 화면이 예기치 않게 종료되었습니다.',
    detail: `자동 백업을 보존했습니다. 앱을 다시 시작한 뒤 원본 HTML을 여세요.\n원인: ${reason}`,
    buttons: ['다시 시작', '닫기'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (result.response === 0) {
    app.relaunch();
  }
  app.exit(1);
}
async function showOpenHtmlDialog(parentWindow?: BrowserWindow): Promise<HtmlFilePayload | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Open HTML Report',
    properties: ['openFile'],
    filters: [{ name: 'HTML', extensions: ['html', 'htm'] }]
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  return readHtmlFile(result.filePaths[0], parentWindow);
}
function installApplicationMenu(mainWindow: BrowserWindow): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open HTML...',
          accelerator: 'Ctrl+O',
          click: async () => {
            try {
              const opened = await showOpenHtmlDialog(mainWindow);
              if (opened) {
                mainWindow.webContents.send('htmlpoint:file-opened', opened);
              }
            } catch (error) {
              if (!mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send(
                  'htmlpoint:operation-error',
                  `열기 실패: ${errorMessage(error)}`
                );
              }
            }
          }
        },
        {
          label: 'Save',
          accelerator: 'Ctrl+S',
          click: () => {
            mainWindow.webContents.send('htmlpoint:menu-save');
          }
        },
        {
          label: 'Save As HTML...',
          accelerator: 'Ctrl+Shift+S',
          click: () => {
            mainWindow.webContents.send('htmlpoint:menu-save-as');
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'Ctrl+Z', click: () => mainWindow.webContents.send('htmlpoint:menu-undo') },
      { label: 'Redo', accelerator: 'Ctrl+Y', click: () => mainWindow.webContents.send('htmlpoint:menu-redo') },
      { label: 'Redo (alternate)', accelerator: 'Ctrl+Shift+Z', click: () => mainWindow.webContents.send('htmlpoint:menu-redo') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }
    ] },
    ...(isDev
      ? [{
          label: 'View',
          submenu: [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }]
        }]
      : []),
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    { label: 'Help', submenu: [{ label: `HTMLpoint v${app.getVersion()}`, enabled: false }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function installOfflineGuards(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url);
      const isNetwork =
        url.protocol === 'http:' ||
        url.protocol === 'https:' ||
        url.protocol === 'ws:' ||
        url.protocol === 'wss:';
      const isAllowedDevServer =
        isDev && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
      const isPreviewAsset = url.protocol === `${PREVIEW_ASSET_SCHEME}:`;
      const isAllowedPreviewAsset = ALLOWED_PREVIEW_ASSET_RESOURCE_TYPES.has(
        details.resourceType
      );
      callback({
        cancel:
          (isNetwork && !isAllowedDevServer) ||
          (isPreviewAsset && !isAllowedPreviewAsset)
      });
    } catch {
      callback({});
    }
  });
}
function installPreviewAssetProtocol(): void {
  protocol.handle(PREVIEW_ASSET_SCHEME, async (request) => {
    const assetPath = await previewAssetRegistry.resolve(request.url);
    if (!assetPath) {
      return new Response('Preview asset not found', { status: 404 });
    }
    try {
      return await net.fetch(pathToFileURL(assetPath).toString(), {
        bypassCustomProtocolHandlers: true
      });
    } catch {
      return new Response('Preview asset not found', { status: 404 });
    }
  });
}
async function createBackupFromPath(filePath: string): Promise<string | undefined> {
  if (!filePath || !existsSync(filePath)) {
    return undefined;
  }
  const parsed = path.parse(filePath);
  return writeBackupWithFallback(filePath, async (backupDir) => {
    const backupPath = path.join(backupDir, makeBackupFileName(filePath, 'bak'));
    await copyFileAtomically(filePath, backupPath);
    await pruneGeneratedBackups(
      backupDir,
      `${parsed.name}.`,
      `.bak${parsed.ext || '.html'}`,
      SOURCE_BACKUP_RETENTION
    ).catch(() => undefined);
    return backupPath;
  });
}
async function writeBackup(filePath: string, html: string): Promise<string | undefined> {
  if (!filePath) {
    return undefined;
  }
  const canonicalPath = await validateHtmlPath(filePath);
  const parsed = path.parse(canonicalPath);
  return writeBackupWithFallback(canonicalPath, async (backupDir) => {
    const backupPath = path.join(backupDir, makeBackupFileName(canonicalPath, 'autosave'));
    await writeTextFileAtomically(backupPath, html);
    await pruneGeneratedBackups(
      backupDir,
      `${parsed.name}.`,
      `.autosave${parsed.ext || '.html'}`,
      AUTOSAVE_RETENTION
    ).catch(() => undefined);
    return backupPath;
  });
}

async function writeBackupWithFallback<T>(
  sourcePath: string,
  writeBackupFile: (backupDirectory: string) => Promise<T>
): Promise<T> {
  const primaryDirectory = path.join(path.dirname(sourcePath), '.htmlpoint-backups');
  try {
    await mkdir(primaryDirectory, { recursive: true });
    return await writeBackupFile(primaryDirectory);
  } catch (primaryError) {
    const fallbackDirectory = fallbackBackupDirectory(sourcePath);
    try {
      await mkdir(fallbackDirectory, { recursive: true });
      return await writeBackupFile(fallbackDirectory);
    } catch (fallbackError) {
      throw new Error(
        `백업 생성 실패: ${errorMessage(primaryError)}; 대체 위치 실패: ${errorMessage(fallbackError)}`
      );
    }
  }
}

interface RecoveryCandidate {
  filePath: string;
  modifiedAt: number;
}

function fallbackBackupDirectory(sourcePath: string): string {
  const sourceKey = createHash('sha256').update(path.resolve(sourcePath)).digest('hex').slice(0, 16);
  return path.join(app.getPath('userData'), 'Backups', sourceKey);
}

async function findNewestAutoBackup(
  sourcePath: string,
  sourceModifiedAt: number
): Promise<RecoveryCandidate | undefined> {
  const parsed = path.parse(sourcePath);
  const directories = [
    path.join(parsed.dir, '.htmlpoint-backups'),
    fallbackBackupDirectory(sourcePath)
  ];
  const candidates: RecoveryCandidate[] = [];
  for (const directory of directories) {
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch {
      continue;
    }
    const names = entries.filter(
      (name) => name.startsWith(`${parsed.name}.`) && name.endsWith(`.autosave${parsed.ext || '.html'}`)
    );
    for (const name of names) {
      const candidatePath = path.join(directory, name);
      try {
        const details = await stat(candidatePath);
        if (details.isFile() && details.mtimeMs > sourceModifiedAt) {
          candidates.push({ filePath: candidatePath, modifiedAt: details.mtimeMs });
        }
      } catch {
        // A concurrent retention pass may remove an older candidate.
      }
    }
  }
  return candidates.sort((left, right) => right.modifiedAt - left.modifiedAt)[0];
}

async function clearAutoBackups(sourcePath: string): Promise<void> {
  const parsed = path.parse(sourcePath);
  const directories = [
    path.join(parsed.dir, '.htmlpoint-backups'),
    fallbackBackupDirectory(sourcePath)
  ];
  await Promise.all(
    directories.map((directory) =>
      pruneGeneratedBackups(
        directory,
        `${parsed.name}.`,
        `.autosave${parsed.ext || '.html'}`,
        0
      ).catch(() => undefined)
    )
  );
}

async function readHtmlFile(filePath: string, parentWindow?: BrowserWindow): Promise<HtmlFilePayload> {
  const canonicalPath = await validateHtmlPath(filePath);
  const details = await stat(canonicalPath);
  if (details.size > MAX_HTML_BYTES) {
    throw new Error('HTML 파일이 100 MB를 초과하여 열 수 없습니다. 이미지 자산을 외부 파일로 분리해 주세요.');
  }
  const recoveryCandidate = await findNewestAutoBackup(canonicalPath, details.mtimeMs);
  let contentPath = canonicalPath;
  let recovered = false;
  const warnings: string[] = [];
  if (recoveryCandidate) {
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      title: '자동 복구본 발견',
      message: '원본보다 새로운 자동 복구본이 있습니다.',
      detail: '이전 편집이 비정상 종료되었다면 자동 복구본을 여는 것을 권장합니다.',
      buttons: ['자동 복구본 열기', '원본 열기'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    };
    const choice = parentWindow
      ? await dialog.showMessageBox(parentWindow, options)
      : await dialog.showMessageBox(options);
    if (choice.response === 0) {
      contentPath = recoveryCandidate.filePath;
      recovered = true;
      warnings.push(`자동 복구본을 열었습니다: ${recoveryCandidate.filePath}`);
    }
  }
  const html = await readFile(contentPath, 'utf8');
  let backupPath: string | undefined;
  try {
    backupPath = await createBackupFromPath(canonicalPath);
  } catch (error) {
    warnings.push(`원본 백업을 만들지 못했습니다: ${errorMessage(error)}`);
  }
  return {
    fileName: path.basename(canonicalPath),
    filePath: canonicalPath,
    html,
    backupPath,
    warnings,
    recovered
  };
}
async function validateHtmlPath(candidate: string): Promise<string> {
  if (typeof candidate !== 'string' || !/\.html?$/i.test(candidate)) {
    throw new Error('HTML 파일만 열 수 있습니다.');
  }
  const details = await stat(candidate);
  if (!details.isFile()) throw new Error('일반 HTML 파일만 열 수 있습니다.');
  return realpath(candidate);
}
function collectRelativeAssetPaths(html: string): string[] {
  const values = new Set<string>();
  const add = (value: string, sourceSet = false) => {
    const urls = [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].map((match) => match[2]);
    if (urls.length) {
      urls.forEach((url) => values.add(url));
      return;
    }
    if (sourceSet) {
      parseSourceSetUrls(value).forEach((item) => {
        const candidate = item.trim();
        if (candidate) values.add(candidate);
      });
      return;
    }
    const candidate = value.trim();
    if (candidate) values.add(candidate);
  };
  for (const match of html.matchAll(/\b(?:src|href|poster)\s*=\s*(['"])(.*?)\1/gi)) add(match[2]);
  for (const match of html.matchAll(/\bsrcset\s*=\s*(['"])(.*?)\1/gi)) add(match[2], true);
  for (const match of html.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) values.add(match[2]);
  for (const match of html.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/gi)) values.add(match[1]);
  return [...values]
    .map((value) => value.split(/[?#]/, 1)[0])
    .filter(isRelativeAssetReference);
}
function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function collectAssets(sourceRoot: string, html: string): Promise<string[]> {
  const pending = collectRelativeAssetPaths(html).map((reference) => ({ reference, baseDirectory: sourceRoot }));
  const assets = new Set<string>();
  while (pending.length) {
    const { reference, baseDirectory } = pending.shift()!;
    const candidate = path.resolve(baseDirectory, decodeAssetReference(reference));
    if (!isWithin(sourceRoot, candidate)) throw new Error(`허용되지 않은 자산 경로: ${reference}`);
    let canonical: string;
    try { canonical = await realpath(candidate); } catch { throw new Error(`자산을 찾을 수 없습니다: ${reference}`); }
    if (!isWithin(sourceRoot, canonical) || !(await stat(canonical)).isFile()) {
      throw new Error(`허용되지 않은 자산 파일: ${reference}`);
    }
    if (assets.has(canonical)) continue;
    assets.add(canonical);
    if (/\.css$/i.test(canonical)) {
      pending.push(...collectRelativeAssetPaths(await readFile(canonical, 'utf8')).map((nestedReference) => ({
        reference: nestedReference,
        baseDirectory: path.dirname(canonical)
      })));
    }
  }
  return [...assets];
}
async function saveWithAssets(targetPath: string, html: string, sourcePath?: string): Promise<void> {
  const targetDirectory = path.dirname(targetPath);
  const canonicalSource = sourcePath ? await validateHtmlPath(sourcePath) : undefined;
  const sourceRoot = canonicalSource ? path.dirname(canonicalSource) : undefined;
  const assets = sourceRoot && path.resolve(targetDirectory) !== sourceRoot
    ? await collectAssets(sourceRoot, html)
    : [];
  const staging = path.join(targetDirectory, `.htmlpoint-stage-${randomUUID()}`);
  const copied: Array<{ destination: string; existed: boolean; rollback?: string }> = [];
  await mkdir(staging, { recursive: true });
  try {
    await writeFile(path.join(staging, path.basename(targetPath)), html, 'utf8');
    for (const asset of assets) {
      const relative = path.relative(sourceRoot!, asset);
      const stagedAsset = path.join(staging, relative);
      await mkdir(path.dirname(stagedAsset), { recursive: true });
      await copyFile(asset, stagedAsset);
    }
    if (existsSync(targetPath)) await createBackupFromPath(targetPath);
    for (const asset of assets) {
      const relative = path.relative(sourceRoot!, asset);
      const stagedAsset = path.join(staging, relative);
      const destination = path.join(targetDirectory, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      const existed = existsSync(destination);
      const rollback = existed ? path.join(staging, '.rollback', relative) : undefined;
      if (rollback) {
        await mkdir(path.dirname(rollback), { recursive: true });
        await copyFile(destination, rollback);
      }
      await copyFile(stagedAsset, destination);
      copied.push({ destination, existed, rollback });
    }
    await rename(path.join(staging, path.basename(targetPath)), targetPath);
  } catch (error) {
    for (const file of copied.reverse()) {
      try {
        if (file.existed && file.rollback) {
          await copyFile(file.rollback, file.destination);
        } else {
          await rm(file.destination, { force: true });
        }
      } catch {
        // Preserve the original failure; the caller still refuses to change sourcePath/checkpoint.
      }
    }
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getMimeType(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }
  if (extension === '.webp') {
    return 'image/webp';
  }
  if (extension === '.gif') {
    return 'image/gif';
  }
  if (extension === '.svg') {
    return 'image/svg+xml';
  }
  if (extension === '.png') {
    return 'image/png';
  }
  return undefined;
}
function installIpcHandlers(): void {
  ipcMain.handle('htmlpoint:register-preview-source', async (event, sourcePath: string) => {
    if (
      typeof sourcePath !== 'string' ||
      !/\.html?$/i.test(sourcePath) ||
      !(await stat(sourcePath)).isFile()
    ) {
      throw new Error('Preview source must be an existing HTML file.');
    }
    const ownerId = event.sender.id;
    if (!previewRegistryCleanupOwners.has(ownerId)) {
      previewRegistryCleanupOwners.add(ownerId);
      event.sender.once('destroyed', () => {
        previewAssetRegistry.revokeOwner(ownerId);
        previewRegistryCleanupOwners.delete(ownerId);
      });
    }
    return previewAssetRegistry.register(ownerId, sourcePath);
  });
  ipcMain.on('htmlpoint:confirm-close', (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }
    confirmedCloseWindows.add(targetWindow);
    targetWindow.close();
  });
  ipcMain.handle('htmlpoint:list-samples', async () => {
    const sampleDir = getSampleDirectory();
    if (!existsSync(sampleDir)) {
      return [];
    }
    const entries = await readdir(sampleDir);
    const htmlFiles = entries
      .filter((entry) => entry.toLowerCase().endsWith('.html'))
      .sort((left, right) => left.localeCompare(right));
    return Promise.all(
      htmlFiles.map(async (fileName) => {
        const filePath = path.join(sampleDir, fileName);
        const details = await stat(filePath);
        return {
          fileName,
          filePath,
          size: details.size,
          modifiedAt: details.mtime.toISOString()
        };
      })
    );
  });
  ipcMain.handle('htmlpoint:open-dialog', async (event): Promise<HtmlFilePayload | null> => {
    return showOpenHtmlDialog(BrowserWindow.fromWebContents(event.sender) ?? undefined);
  });

  ipcMain.handle('htmlpoint:open-dropped-file', async (event, filePath: string): Promise<HtmlFilePayload> => {
    return readHtmlFile(filePath, BrowserWindow.fromWebContents(event.sender) ?? undefined);
  });

  ipcMain.handle('htmlpoint:open-sample', async (event, filePath: string): Promise<HtmlFilePayload> => {
    const sampleDirectory = await realpath(getSampleDirectory());
    const canonicalPath = await validateHtmlPath(filePath);
    if (!isWithin(sampleDirectory, canonicalPath)) {
      throw new Error('등록된 샘플 폴더의 HTML만 열 수 있습니다.');
    }
    return readHtmlFile(canonicalPath, BrowserWindow.fromWebContents(event.sender) ?? undefined);
  });
  ipcMain.handle(
    'htmlpoint:save',
    async (_event, payload: SaveHtmlPayload): Promise<{ filePath: string; warnings?: string[] }> => {
      if (!payload || typeof payload.html !== 'string' || typeof payload.filePath !== 'string') {
        throw new Error('저장 요청이 올바르지 않습니다.');
      }
      const targetPath = await validateHtmlPath(payload.filePath);
      await saveWithAssets(targetPath, payload.html, payload.sourcePath);
      return { filePath: targetPath, warnings: [...(payload.warnings ?? [])] };
    }
  );
  ipcMain.handle(
    'htmlpoint:save-as',
    async (
      _event,
      payload: SaveHtmlPayload
    ): Promise<{ filePath: string; warnings?: string[] } | null> => {
      if (!payload || typeof payload.html !== 'string') {
        throw new Error('저장 요청이 올바르지 않습니다.');
      }
      const result = await dialog.showSaveDialog({
        title: 'Save As HTML',
        defaultPath: payload.sourcePath ?? payload.defaultPath,
        filters: [{ name: 'HTML', extensions: ['html'] }]
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      const warnings = [...(payload.warnings ?? [])];
      try { await saveWithAssets(result.filePath, payload.html, payload.sourcePath); }
      catch (error) { throw new Error(`저장 또는 자산 복사 실패: ${errorMessage(error)}`); }
      return { filePath: result.filePath, warnings };
    }
  );
  ipcMain.handle(
    'htmlpoint:create-backup',
    async (_event, payload: { filePath: string; html: string }): Promise<{ backupPath?: string }> => {
      return { backupPath: await writeBackup(payload.filePath, payload.html) };
    }
  );
  ipcMain.handle('htmlpoint:discard-auto-backups', async (_event, filePath: string) => {
    const canonicalPath = await validateHtmlPath(filePath);
    await clearAutoBackups(canonicalPath);
  });
  ipcMain.handle('htmlpoint:open-image-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Replace Image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    const filePath = result.filePaths[0];
    const details = await stat(filePath);
    const mimeType = getMimeType(filePath);
    if (!details.isFile() || details.size > MAX_IMAGE_BYTES || !mimeType) {
      throw new Error('25 MB 이하의 일반 이미지 파일만 열 수 있습니다.');
    }
    const buffer = await readFile(filePath);
    return {
      fileName: path.basename(filePath),
      dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`
    };
  });
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) {
      void createWindow();
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    installOfflineGuards();
    installPreviewAssetProtocol();
    installIpcHandlers();
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
    });
  }).catch(async (error) => {
    await dialog.showMessageBox({
      type: 'error',
      title: 'HTMLpoint 시작 실패',
      message: '애플리케이션 초기화 중 오류가 발생했습니다.',
      detail: errorMessage(error),
      buttons: ['닫기']
    });
    app.exit(1);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
  app.on('will-quit', () => {
    protocol.unhandle(PREVIEW_ASSET_SCHEME);
    previewAssetRegistry.clear();
    previewRegistryCleanupOwners.clear();
  });
}
