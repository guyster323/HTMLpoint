import { describe, expect, it } from 'vitest';
import { collectRelativeAssetReferences } from '../src/lib/assetDependencies';

describe('relative asset dependency collection', () => {
  it('collects document and CSS references while excluding external and inline content', () => {
    const dependencies = collectRelativeAssetReferences(`<!doctype html><html><head>
      <link rel="stylesheet" href="styles/report.css"><style>.hero { background:url('images/cover.png') }</style>
      </head><body style="background:url(data:image/png;base64,AA==)">
      <img src="images/photo.png?version=2"><video poster="media/poster.jpg"></video>
      <img srcset="images/small.png 1x, images/large.png 2x"><a href="#section">x</a>
      </body></html>`);
    expect(dependencies.map((dependency) => dependency.relativePath).sort()).toEqual([
      'images/cover.png', 'images/large.png', 'images/photo.png', 'images/small.png',
      'media/poster.jpg', 'styles/report.css'
    ]);
  });
});
