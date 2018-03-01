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

import {Bundle, mergeBundles} from '../bundle-manifest';
import {Bundler} from '../bundler';
import {Es6ModuleBundler} from '../es6-module-bundler';
import {heredoc} from './test-utils';

suite('Es6ModuleBundler', () => {

  test('inline modules', async () => {
    const root = 'test/html/imports/es6-modules';
    const bundler = new Bundler();
    const multipleInlineBundlesUrl =
        bundler.analyzer.resolveUrl(`${root}/multiple-inline-modules.html`)!;
    const sharedBundleUrl = bundler.analyzer.resolveUrl(`shared_bundle_1.js`)!;
    const abcUrl = bundler.analyzer.resolveUrl(`${root}/abc.js`)!;
    const defUrl = bundler.analyzer.resolveUrl(`${root}/def.js`)!;
    const manifest = await bundler.generateManifest([multipleInlineBundlesUrl]);
    const multipleInlineBundlesBundle =
        manifest.getBundleForFile(multipleInlineBundlesUrl)!;
    const sharedBundle = {
      url: sharedBundleUrl,
      bundle: manifest.bundles.get(sharedBundleUrl)!
    };
    assert.deepEqual(manifest.getBundleForFile(abcUrl)!, sharedBundle);
    assert.deepEqual(
        manifest.getBundleForFile(defUrl)!, multipleInlineBundlesBundle);
    const sharedBundleBundler =
        new Es6ModuleBundler(bundler, sharedBundle, manifest);
    const sharedBundleDocument = await sharedBundleBundler.bundle();
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

      export { abc as $all, upcase$1 as $all$1, xyz as $all$2, A, B, C, upcase, X, Y, Z };`);
  });

  test('resolving name conflict in a shared bundle', async () => {
    const root = 'test/html/imports/es6-modules';
    const bundler = new Bundler();
    bundler.strategy = (bundles: Bundle[]) => [mergeBundles(bundles)];
    const sharedBundleUrl = bundler.analyzer.resolveUrl(`shared_bundle_1.js`)!;
    const xyzUrl = bundler.analyzer.resolveUrl(`${root}/xyz.js`)!;
    const omgzUrl = bundler.analyzer.resolveUrl(`${root}/omgz.js`)!;
    const manifest = await bundler.generateManifest([xyzUrl, omgzUrl]);
    const sharedBundle = {
      url: sharedBundleUrl,
      bundle: manifest.bundles.get(sharedBundleUrl)!
    };
    const sharedBundleBundler =
        new Es6ModuleBundler(bundler, sharedBundle, manifest);
    const sharedBundleDocument = await sharedBundleBundler.bundle();
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

      export { omgz as $all, upcase$1 as $all$1, xyz as $all$2, Z, upcase, X, Y, Z$1 };`);
  });
});
