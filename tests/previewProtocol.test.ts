import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  PREVIEW_ASSET_SCHEME,
  PreviewAssetRegistry,
  previewBaseUrlForToken
} from '../electron/previewProtocol';

describe('preview asset protocol registry', () => {
  it('issues opaque token bases and resolves encoded paths inside the registered root', async () => {
    const registry = new PreviewAssetRegistry(() => 'token-a');
    const baseUrl = await registry.register(17, 'C:\\Reports\\Quarter One\\deck.html');

    expect(PREVIEW_ASSET_SCHEME).toBe('htmlpoint-asset');
    expect(baseUrl).toBe('htmlpoint-asset://token-a/');
    expect(previewBaseUrlForToken('token-a')).toBe(baseUrl);
    await expect(registry.resolve(`${baseUrl}assets/plot%20one.png`)).resolves.toBe(
      path.resolve('C:\\Reports\\Quarter One\\assets\\plot one.png')
    );
  });

  it('rejects traversal, unknown tokens, and real-path escapes', async () => {
    const root = path.resolve('C:\\Reports\\Quarter One');
    const registry = new PreviewAssetRegistry(
      () => 'token-a',
      async (candidate) =>
        candidate.endsWith(`${path.sep}linked${path.sep}secret.png`)
          ? path.resolve('C:\\Secrets\\secret.png')
          : path.resolve(candidate)
    );
    const baseUrl = await registry.register(17, path.join(root, 'deck.html'));

    await expect(registry.resolve(`${baseUrl}..%2Fsecret.txt`)).resolves.toBeUndefined();
    await expect(registry.resolve(`${baseUrl}linked/secret.png`)).resolves.toBeUndefined();
    await expect(
      registry.resolve('htmlpoint-asset://unknown/assets/plot.png')
    ).resolves.toBeUndefined();
  });

  it('replaces the previous token per renderer and cleans registrations on revoke or clear', async () => {
    const tokens = ['token-a', 'token-b'];
    const registry = new PreviewAssetRegistry(() => tokens.shift() ?? 'token-c');
    const firstBase = await registry.register(17, 'C:\\Reports\\One\\first.html');
    const secondBase = await registry.register(17, 'D:\\Reports\\Two\\second.html');

    expect(registry.size).toBe(1);
    await expect(registry.resolve(`${firstBase}assets/a.png`)).resolves.toBeUndefined();
    await expect(registry.resolve(`${secondBase}assets/b.png`)).resolves.toBe(
      path.resolve('D:\\Reports\\Two\\assets\\b.png')
    );

    registry.revokeOwner(17);
    expect(registry.size).toBe(0);
    await expect(registry.resolve(`${secondBase}assets/b.png`)).resolves.toBeUndefined();

    await registry.register(18, 'C:\\Reports\\Three\\third.html');
    registry.clear();
    expect(registry.size).toBe(0);
  });

  it('keeps the newest registration when canonicalization completes out of order', async () => {
    let resolveFirstRoot: ((rootPath: string) => void) | undefined;
    let resolveSecondRoot: ((rootPath: string) => void) | undefined;
    const firstRoot = new Promise<string>((resolve) => {
      resolveFirstRoot = resolve;
    });
    const secondRoot = new Promise<string>((resolve) => {
      resolveSecondRoot = resolve;
    });
    const registry = new PreviewAssetRegistry(
      () => 'current-token',
      async (candidate) => {
        if (candidate.endsWith(`${path.sep}One`)) {
          return firstRoot;
        }
        if (candidate.endsWith(`${path.sep}Two`)) {
          return secondRoot;
        }
        return path.resolve(candidate);
      }
    );

    const firstRegistration = registry
      .register(17, 'C:\\Reports\\One\\first.html')
      .then(() => 'resolved', (error: unknown) => String(error));
    const secondRegistration = registry.register(17, 'D:\\Reports\\Two\\second.html');

    resolveSecondRoot?.(path.resolve('D:\\Reports\\Two'));
    const secondBase = await secondRegistration;
    resolveFirstRoot?.(path.resolve('C:\\Reports\\One'));

    expect(await firstRegistration).toContain('superseded');
    await expect(registry.resolve(`${secondBase}assets/current.png`)).resolves.toBe(
      path.resolve('D:\\Reports\\Two\\assets\\current.png')
    );
  });

  it('does not let a pre-clear registration collide with a newer owner generation', async () => {
    let resolveOldRoot: ((rootPath: string) => void) | undefined;
    let resolveNewRoot: ((rootPath: string) => void) | undefined;
    const oldRoot = new Promise<string>((resolve) => {
      resolveOldRoot = resolve;
    });
    const newRoot = new Promise<string>((resolve) => {
      resolveNewRoot = resolve;
    });
    const tokens = ['new-token', 'old-token'];
    const registry = new PreviewAssetRegistry(
      () => tokens.shift() ?? 'extra-token',
      async (candidate) => {
        if (candidate.endsWith(`${path.sep}Old`)) {
          return oldRoot;
        }
        if (candidate.endsWith(`${path.sep}New`)) {
          return newRoot;
        }
        return path.resolve(candidate);
      }
    );

    const oldRegistration = registry
      .register(17, 'C:\\Reports\\Old\\old.html')
      .then(() => 'resolved', (error: unknown) => String(error));
    registry.clear();
    const newRegistration = registry.register(17, 'D:\\Reports\\New\\new.html');

    resolveNewRoot?.(path.resolve('D:\\Reports\\New'));
    const newBase = await newRegistration;
    resolveOldRoot?.(path.resolve('C:\\Reports\\Old'));

    expect(await oldRegistration).toContain('superseded');
    await expect(registry.resolve(`${newBase}assets/current.png`)).resolves.toBe(
      path.resolve('D:\\Reports\\New\\assets\\current.png')
    );
  });

  it('keeps the custom scheme privileged while retaining Electron web security', () => {
    const mainSource = readFileSync('electron/main.ts', 'utf8');
    const runtimePreloadSource = readFileSync('electron/preload.cts', 'utf8');

    expect(mainSource).toContain('protocol.registerSchemesAsPrivileged');
    expect(mainSource).toContain("scheme: PREVIEW_ASSET_SCHEME");
    expect(mainSource).toContain("ipcMain.handle('htmlpoint:register-preview-source'");
    expect(mainSource).not.toContain('supportFetchAPI: true');
    expect(mainSource).not.toContain('corsEnabled: true');
    expect(mainSource).toContain('ALLOWED_PREVIEW_ASSET_RESOURCE_TYPES');
    expect(mainSource).toContain('details.resourceType');
    expect(mainSource).not.toContain('request.destination');
    expect(mainSource).toContain("url.protocol === 'ws:'");
    expect(mainSource).toContain("url.protocol === 'wss:'");
    expect(mainSource).toContain("webSecurity: true");
    expect(mainSource).not.toContain("webSecurity: false");
    expect(mainSource).toContain("preload: path.join(__dirname, 'preload.cjs')");
    expect(runtimePreloadSource).toContain('registerPreviewSource');
    expect(existsSync('electron/preload.ts')).toBe(false);
  });
});
