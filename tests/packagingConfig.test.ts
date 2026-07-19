import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('packaged Electron renderer configuration', () => {
  it('uses relative asset paths so app.asar file URLs can load the React bundle', () => {
    const source = readFileSync('vite.config.ts', 'utf8');

    expect(source).toContain("base: './'");
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
