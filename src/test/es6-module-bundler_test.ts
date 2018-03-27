/**
 * @license
 * Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
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

import {Bundle, mergeBundles} from '../bundle-manifest';
import {Bundler} from '../bundler';
import {bundle} from '../es6-module-bundler';
import {heredoc, inMemoryAnalyzer} from './test-utils';

suite('Es6ModuleBundler', () => {

  const analyzer = inMemoryAnalyzer({
    'multiple-inline-modules.html': `
      <script type="module">
        import {A, B} from './abc.js';
        console.log(A,B);
      </script>

      <script type="module">
        import {B, C} from './abc.js';
        import {Y} from './xyz.js';
        console.log(B,C,Y);
      </script>

      <script type="module">
        import {D,F} from './def.js';
        console.log(D,F);
      </script>
    `,
    'abc.js': `
      import { upcase } from './upcase.js';
      export const A = upcase('a');
      export const B = upcase('b');
      export const C = upcase('c');
    `,
    'def.js': `
      import { X, Y, Z } from './xyz.js';
      const D = X + X;
      const E = Y + Y;
      const F = Z + Z;
      export { D, E, F }
    `,
    'omgz.js': `
      import { upcase } from './upcase.js';
      export const Z = upcase('omgz');
    `,
    'upcase.js': `
      export function upcase(str) {
        return str.toUpperCase();
      }
    `,
    'xyz.js': `
      import { upcase } from './upcase.js';
      export const X = upcase('x');
      export const Y = upcase('y');
      export const Z = upcase('z');
    `,
  });

  const abcUrl = analyzer.resolveUrl('abc.js')!;
  const defUrl = analyzer.resolveUrl('def.js')!;
  const omgzUrl = analyzer.resolveUrl('omgz.js')!;
  const multipleInlineModulesUrl =
      analyzer.resolveUrl('multiple-inline-modules.html')!;
  const sharedBundleUrl = analyzer.resolveUrl('shared_bundle_1.js')!;
  const xyzUrl = analyzer.resolveUrl('xyz.js')!;

  test('inline modules', async () => {
    const bundler = new Bundler({analyzer});
    const manifest = await bundler.generateManifest([multipleInlineModulesUrl]);
    const multipleInlineModulesBundle =
        manifest.getBundleForFile(multipleInlineModulesUrl)!;
    const sharedBundle = {
      url: sharedBundleUrl,
      bundle: manifest.bundles.get(sharedBundleUrl)!
    };
    assert.deepEqual(manifest.getBundleForFile(abcUrl)!, sharedBundle);
    assert.deepEqual(
        manifest.getBundleForFile(defUrl)!, multipleInlineModulesBundle);
    const sharedBundleDocument =
        await bundle(bundler, manifest, sharedBundleUrl);
    assert.deepEqual(sharedBundleDocument.content, heredoc`
      function upcase(str) {
        return str.toUpperCase();
      }

      var upcase$1 = {
        upcase: upcase
      };
      const A = upcase('a');
      const B = upcase('b');
      const C = upcase('c');
      var abc = {
        A: A,
        B: B,
        C: C
      };
      const X = upcase('x');
      const Y = upcase('y');
      const Z = upcase('z');
      var xyz = {
        X: X,
        Y: Y,
        Z: Z
      };
      export { abc as $abc, upcase$1 as $upcase, xyz as $xyz, A, B, C, upcase, X, Y, Z };`);
  });

  test('resolving name conflict in a shared bundle', async () => {
    const bundler = new Bundler(
        {analyzer, strategy: (bundles: Bundle[]) => [mergeBundles(bundles)]});
    const manifest = await bundler.generateManifest([xyzUrl, omgzUrl]);
    const sharedBundleDocument =
        await bundle(bundler, manifest, sharedBundleUrl);
    assert.deepEqual(sharedBundleDocument.content, heredoc`
      function upcase(str) {
        return str.toUpperCase();
      }

      var upcase$1 = {
        upcase: upcase
      };
      const Z = upcase('omgz');
      var omgz = {
        Z: Z
      };
      const X = upcase('x');
      const Y = upcase('y');
      const Z$1 = upcase('z');
      var xyz = {
        X: X,
        Y: Y,
        Z: Z$1
      };
      export { omgz as $omgz, upcase$1 as $upcase, xyz as $xyz, Z, upcase, X, Y, Z$1 };`);
  });
});
