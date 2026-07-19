import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session } from 'electron';
import { copyFile, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PREVIEW_ASSET_SCHEME, PreviewAssetRegistry } from './previewProtocol.js';

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

interface HtmlFilePayload {
  fileName: string;
  filePath: string;
  html: string;
  backupPath?: string;
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
  return `file://${path.join(__dirname, '../dist/index.html')}`;
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
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#f4f5f7',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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
  await mainWindow.loadURL(getRendererUrl());
}

async function showOpenHtmlDialog(): Promise<HtmlFilePayload | null> {
  const result = await dialog.showOpenDialog({
    title: 'Open HTML Report',
    properties: ['openFile'],
    filters: [{ name: 'HTML', extensions: ['html', 'htm'] }]
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  return readHtmlFile(result.filePaths[0]);
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
              const opened = await showOpenHtmlDialog();
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
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    { label: 'Help', submenu: [{ label: 'HTMLpoint v1', enabled: false }] }
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
  const backupDir = path.join(parsed.dir, '.htmlpoint-backups');
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `${parsed.name}.${stamp}.bak${parsed.ext || '.html'}`);
  await copyFile(filePath, backupPath);
  return backupPath;
}

async function writeBackup(filePath: string, html: string): Promise<string | undefined> {
  if (!filePath) {
    return undefined;
  }
  const parsed = path.parse(filePath);
  const backupDir = path.join(parsed.dir, '.htmlpoint-backups');
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `${parsed.name}.${stamp}.autosave${parsed.ext || '.html'}`);
  await writeFile(backupPath, html, 'utf8');
  return backupPath;
}

async function readHtmlFile(filePath: string): Promise<HtmlFilePayload> {
  const canonicalPath = await validateHtmlPath(filePath);
  const html = await readFile(canonicalPath, 'utf8');
  let backupPath: string | undefined;
  const warnings: string[] = [];
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
    warnings
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
      value.split(',').forEach((item) => {
        const candidate = item.trim().split(/\s+/)[0];
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
  return [...values].map((value) => value.split(/[?#]/, 1)[0]).filter((value) =>
    value && !/^(?:data:|blob:|https?:|#|\/|\\\\)/i.test(value)
  );
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
    const candidate = path.resolve(baseDirectory, reference);
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

function getMimeType(filePath: string): string {
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
  return 'image/png';
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
    const htmlFiles = entries.filter((entry) => entry.toLowerCase().endsWith('.html'));
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

  ipcMain.handle('htmlpoint:open-dialog', async (): Promise<HtmlFilePayload | null> => showOpenHtmlDialog());

  ipcMain.handle('htmlpoint:open-dropped-file', async (_event, filePath: string): Promise<HtmlFilePayload> => readHtmlFile(filePath));

  ipcMain.handle('htmlpoint:open-sample', async (_event, filePath: string): Promise<HtmlFilePayload> => {
    return readHtmlFile(filePath);
  });

  ipcMain.handle(
    'htmlpoint:save-as',
    async (
      _event,
      payload: { defaultPath?: string; html: string; sourcePath?: string; warnings?: string[] }
    ): Promise<{ filePath: string; warnings?: string[] } | null> => {
      const result = await dialog.showSaveDialog({
        title: 'Save As HTML',
        defaultPath: payload.defaultPath,
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
    const buffer = await readFile(filePath);
    return {
      fileName: path.basename(filePath),
      dataUrl: `data:${getMimeType(filePath)};base64,${buffer.toString('base64')}`
    };
  });
}

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
