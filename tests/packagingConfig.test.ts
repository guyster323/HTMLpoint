import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('packaged Electron renderer configuration', () => {
  it('uses relative asset paths so app.asar file URLs can load the React bundle', () => {
    const source = readFileSync('vite.config.ts', 'utf8');

    expect(source).toContain("base: './'");
  });
  it('builds both an installer and a portable Windows distribution', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    const targets = packageJson.build.win.target.map((target: { target: string }) => target.target);

    expect(targets).toEqual(['nsis', 'portable']);
    expect(packageJson.build.nsis.oneClick).toBe(false);
    expect(packageJson.build.nsis.allowToChangeInstallationDirectory).toBe(true);
    expect(packageJson.build.nsis.artifactName).toContain('HTMLpoint-Setup-');
    expect(packageJson.build.portable.artifactName).toContain('HTMLpoint-Portable-');
    expect(packageJson.build.extraResources).toBeUndefined();
  });
  it('publishes tagged builds through the Windows release workflow', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm run test:unit');
    expect(workflow).toContain('npm run test:e2e:renderer');
    expect(workflow).toContain('npm run package');
    expect(workflow).toContain('SHA256SUMS.txt');
    expect(workflow).toContain('gh release create');
  });
  it('uses a Windows-safe renderer URL and a single sandboxed app instance', () => {
    const source = readFileSync('electron/main.ts', 'utf8');

    expect(source).toContain("pathToFileURL(path.join(__dirname, '../dist/index.html')).toString()");
    expect(source).toContain('sandbox: true');
    expect(source).toContain('app.requestSingleInstanceLock()');
  });
  it('allows the preview asset scheme only for display assets in the packaged CSP', () => {
    const source = readFileSync('index.html', 'utf8');
    const document = new DOMParser().parseFromString(source, 'text/html');
    const policy =
      document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content') ?? '';
    const directives = new Map(
      policy
        .split(';')
        .map((entry) => entry.trim().split(/\s+/))
        .filter(([name]) => Boolean(name))
        .map(([name, ...sources]) => [name, sources])
    );
    const schemeDirectives = Array.from(directives.entries())
      .filter(([, sources]) => sources.includes('htmlpoint-asset:'))
      .map(([name]) => name)
      .sort();
    expect(schemeDirectives).toEqual(['font-src', 'img-src', 'media-src', 'style-src']);
    expect(directives.get('script-src')).not.toContain('htmlpoint-asset:');
    expect(directives.get('connect-src')).not.toContain('htmlpoint-asset:');
    expect(directives.get('frame-src')).not.toContain('htmlpoint-asset:');
  });
});
