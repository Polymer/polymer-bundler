/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */
/// <reference path="../../node_modules/@types/chai/index.d.ts" />
/// <reference path="../../node_modules/@types/node/index.d.ts" />
/// <reference path="../../node_modules/@types/mocha/index.d.ts" />
import {assert} from 'chai';
import {PackageRelativeUrl} from 'polymer-analyzer';

import {generateShellMergeStrategy} from '../bundle-manifest';
import {Bundler} from '../bundler';

import {heredoc, inMemoryAnalyzer} from './test-utils';

suite('Es6 Module Bundling', () => {
  test('export from', async () => {
    const analyzer = inMemoryAnalyzer({
      'a.js': `
        export * from './b.js';
        export const A = 'a';
      `,
      'b.js': `
        export * from './c.js';
        export const B = 'b';
      `,
      'c.js': `
        export const C = 'c';
        export {C as default};
      `,
    });
    const aUrl = analyzer.resolveUrl('a.js')!;
    const bundler = new Bundler({analyzer});
    const {documents} =
        await bundler.bundle(await bundler.generateManifest([aUrl]));
    assert.deepEqual(documents.get(aUrl)!.content, heredoc`
      const C = 'c';
      var c = {
        C: C,
        default: C
      };
      const B = 'b';
      var b = {
        B: B,
        C: C
      };
      const A = 'a';
      var a = {
        A: A,
        B: B,
        C: C
      };
      export { a as $a, b as $b, c as $c, C, B, A, C as C$1, B as B$1, C as C$2, C as $cDefault };`);
  });

  suite('rewriting import specifiers', () => {
    const analyzer = inMemoryAnalyzer({
      'a.js': `
        import bee from './b.js';
        import * as b from './b.js';
        import {honey} from './b.js';
        import sea from './c.js';
        import * as c from './c.js';
        import {boat} from './c.js';
        console.log(bee, b, honey);
        console.log(sea, c, boat);
      `,
      'b.js': `
        import sea from './c.js';
        export default bee = '🐝';
        export const honey = '🍯';
        export const beeSea = bee + sea;
      `,
      'c.js': `
        export default sea = '🌊';
        export const boat = '⛵️';
      `,
      'd.js': `
        import {boat} from './c.js';
        export default deer = '🦌';
        export const deerBoat = deer + boat;
      `,
    });

    const aUrl = analyzer.resolveUrl('a.js')!;
    const bUrl = analyzer.resolveUrl('b.js')!;
    const cUrl = analyzer.resolveUrl('c.js')!;
    const dUrl = analyzer.resolveUrl('d.js')!;

    test('non-shared bundles', async () => {
      const bundler = new Bundler({analyzer});
      const {documents} = await bundler.bundle(
          await bundler.generateManifest([aUrl, bUrl, cUrl]));
      assert.deepEqual(documents.get(aUrl)!.content, heredoc`
        import { $b as bee, $bDefault as bee__default, honey } from './b.js';
        import { $c as sea, $cDefault as sea__default, boat } from './c.js';
        console.log(bee__default, bee, honey);
        console.log(sea__default, sea, boat);`);
      assert.deepEqual(documents.get(bUrl)!.content, heredoc`
        import { $cDefault as sea } from './c.js';
        var b = bee = '🐝';
        const honey = '🍯';
        const beeSea = bee + sea;
        var b$1 = {
          default: b,
          honey: honey,
          beeSea: beeSea
        };
        export { b$1 as $b, b as $bDefault, honey, beeSea };`);
      assert.deepEqual(documents.get(cUrl)!.content, heredoc`
        var c = sea = '🌊';
        const boat = '⛵️';
        var c$1 = {
          default: c,
          boat: boat
        };
        export { c$1 as $c, c as $cDefault, boat };`);
    });

    test('shared bundle', async () => {
      const bundler = new Bundler({analyzer});
      const {documents} =
          await bundler.bundle(await bundler.generateManifest([bUrl, dUrl]));
      assert.deepEqual(documents.get(bUrl)!.content, heredoc`
        import { $cDefault as sea } from './shared_bundle_1.js';
        var b = bee = '🐝';
        const honey = '🍯';
        const beeSea = bee + sea;
        var b$1 = {
          default: b,
          honey: honey,
          beeSea: beeSea
        };
        export { b$1 as $b, b as $bDefault, honey, beeSea };`);
      assert.deepEqual(documents.get(dUrl)!.content, heredoc`
        import { boat } from './shared_bundle_1.js';
        var d = deer = '🦌';
        const deerBoat = deer + boat;
        var d$1 = {
          default: d,
          deerBoat: deerBoat
        };
        export { d$1 as $d, d as $dDefault, deerBoat };`);
    });

    test('shell bundle', async () => {
      const bundler =
          new Bundler({analyzer, strategy: generateShellMergeStrategy(bUrl)});
      const {documents} =
          await bundler.bundle(await bundler.generateManifest([aUrl, bUrl]));
      assert.deepEqual(documents.get(aUrl)!.content, heredoc`
        import { $b as bee, $bDefault as bee__default, honey, $c as sea, $cDefault as sea__default, boat } from './b.js';
        console.log(bee__default, bee, honey);
        console.log(sea__default, sea, boat);`);
      assert.deepEqual(documents.get(bUrl)!.content, heredoc`
        var sea$1 = sea = '🌊';
        const boat = '⛵️';
        var c = {
          default: sea$1,
          boat: boat
        };
        var b = bee = '🐝';
        const honey = '🍯';
        const beeSea = bee + sea$1;
        var b$1 = {
          default: b,
          honey: honey,
          beeSea: beeSea
        };
        export { b$1 as $b, c as $c, b as $bDefault, honey, beeSea, sea$1 as $cDefault, boat };`);
    });
  });

  suite('dynamic imports', () => {
    test('await expression', async () => {
      const analyzer = inMemoryAnalyzer({
        'a.js': `
          export async function go() {
            const b = await import('./b.js');
            console.log(b.bee);
          }
        `,
        'b.js': `
          export const bee = '🐝';
        `,
      });
      const aUrl = analyzer.urlResolver.resolve('a.js' as PackageRelativeUrl)!;
      const bundler = new Bundler({analyzer});
      const {documents} =
          await bundler.bundle(await bundler.generateManifest([aUrl]));
      assert.deepEqual(documents.get(aUrl)!.content, heredoc`
        async function go() {
          const b = await import('./b.js').then(({
            $b
          }) => $b);
          console.log(b.bee);
        }

        var a = {
          go: go
        };
        export { a as $a, go };`);
    });

    test('expression statement', async () => {
      const analyzer = inMemoryAnalyzer({
        'a.js': `
          import('./b.js').then((b) => console.log(b.bee));
        `,
        'b.js': `
          export const bee = '🐝';
        `,
      });
      const aUrl = analyzer.resolveUrl('a.js')!;
      const bundler = new Bundler({analyzer});
      const {documents} =
          await bundler.bundle(await bundler.generateManifest([aUrl]));
      assert.deepEqual(documents.get(aUrl)!.content, heredoc`
        import('./b.js').then(({
          $b
        }) => $b).then(b => console.log(b.bee));`);
    });

    test('updates external module script src', async () => {
      const analyzer = inMemoryAnalyzer({
        'index.html': `
          <script type="module" src="./a.js"></script>
        `,
        'a.js': `
          import {b} from './b.js';
          export const a = 'a' + b;
        `,
        'b.js': `
          export const b = 'b';
        `,
      });
      const indexUrl = analyzer.resolveUrl('index.html')!;
      const sharedBundleUrl = analyzer.resolveUrl('shared_bundle_1.js')!;
      const bundler = new Bundler({analyzer, inlineScripts: false});
      const manifest = await bundler.generateManifest([indexUrl]);
      assert.deepEqual(
          [...manifest.bundles.keys()], [indexUrl, sharedBundleUrl]);
      const {documents} =
          await bundler.bundle(await bundler.generateManifest([indexUrl]));

      assert.deepEqual(documents.get(indexUrl)!.content, heredoc`
        <script type="module" src="shared_bundle_1.js"></script>
      `);

      assert.deepEqual(documents.get(sharedBundleUrl)!.content, heredoc`
        const b = 'b';
        var b$1 = {
          b: b
        };
        const a = 'a' + b;
        var a$1 = {
          a: a
        };
        export { a$1 as $a, b$1 as $b, a, b };`);
    });
  });
});
