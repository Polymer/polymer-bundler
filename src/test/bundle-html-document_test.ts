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
import * as chai from 'chai';
import * as path from 'path';
import {Analyzer, FSUrlLoader} from 'polymer-analyzer';

import {generateSharedDepsMergeStrategy} from '../bundle-manifest';
import {Bundler, BundleResult, Options} from '../bundler';
import {undent} from './test-utils';

chai.config.showDiff = true;

const assert = chai.assert;

async function bundle(root: string, urls: string[], options?: Options):
    Promise<BundleResult> {
      const bundler = new Bundler(Object.assign(
          {
            analyzer: new Analyzer({
              urlLoader: new FSUrlLoader(path.resolve(root)),
            }),
          },
          options));
      return bundler.bundle(await bundler.generateManifest(urls));
    }

suite('Bundling HTML Documents', () => {

  suite('import declaration forms', () => {

    const root = 'test/html/modules';

    suite('single entrypoint', () => {

      const bundleOne = async (url: string) =>
          (await bundle(root, [`import-declaration-forms/${url}`]))
              .documents.get(`import-declaration-forms/${url}`)!.code;

      test('default specifier', async () => {
        const code = await bundleOne('default-specifier.html');
        assert.deepEqual(code.trim(), undent(`
          <script type="module">const value = 'DEFAULT';

          console.log(value);</script>
        `));
      });

      test('dynamic import await', async () => {
        const code = await bundleOne('dynamic-import-await.html');
        assert.deepEqual(code.trim(), undent(`
          <script type="module">async function dynamicExample() {
            const moduleC = await import("../module-c.js");
            console.log(moduleC.value);
          }

          dynamicExample();</script>
        `));
      });

      test('named specifier', async () => {
        const code = await bundleOne('named-specifier.html');
        assert.deepEqual(code.trim(), undent(`
          <script type="module">const a = { value: 'A' };

          console.log('module-a side-effect');

          console.log(a.value);</script>
        `));
      });

      test('namespace specifier', async () => {
        const code = await bundleOne('namespace-specifier.html');
        assert.deepEqual(code.trim(), undent(`
          <script type="module">const b = { value: 'B' };

          console.log('module-b side-effect');

          console.log(b.value);</script>
        `));
      });

      test('no specifier', async () => {
        const code = await bundleOne('no-specifier.html');
        assert.deepEqual(code.trim(), undent(`
          <script type="module">console.log('module-b side-effect');

          console.log('no-specifier side-effect');</script>
        `));
      });

      test('renamed local specifier', async () => {
        const code = await bundleOne('renamed-local-specifier.html');
        assert.deepEqual(code.trim(), undent(`
          <script type="module">const a = { value: 'A' };

          console.log('module-a side-effect');

          console.log(a.value);</script>
        `));
      });
    });

    suite('shared bundles', () => {

      const bundleMultiple = async (urls: string[], options?: Options) => {
        return (await bundle(
            root, urls.map((u) => `import-declaration-forms/${u}`, options)));
      };

      test('shared bundle with 2 exported modules', async () => {

        const result = await bundleMultiple(
            [
              'named-specifier.html',
              'namespace-specifier.html',
              'no-specifier.html',
              'renamed-local-specifier.html',
            ],
            {strategy: generateSharedDepsMergeStrategy(2)});

        const namedSpecifier =
            result.documents
                .get('import-declaration-forms/named-specifier.html')!.code;
        assert.deepEqual(namedSpecifier.trim(), undent(`
          <script type="module">import { $bundled$module$a } from "../shared_bundle_1.js";

          const {
            a: a
          } = $bundled$module$a;
          console.log(a.value);</script>
        `));

        const namespaceSpecifier =
            result.documents
                .get('import-declaration-forms/namespace-specifier.html')!.code;
        assert.deepEqual(namespaceSpecifier.trim(), undent(`
          <script type="module">import { $bundled$module$b } from "../shared_bundle_1.js";

          const {
            b: b
          } = $bundled$module$b;
          console.log(b.value);</script>
        `));

        const noSpecifier =
            result.documents.get('import-declaration-forms/no-specifier.html')!
                .code;
        assert.deepEqual(noSpecifier.trim(), undent(`
          <script type="module">import { $bundled$module$b } from "../shared_bundle_1.js";

          console.log('no-specifier side-effect');</script>
        `));

        const renamedLocalSpecifier =
            result.documents
                .get('import-declaration-forms/renamed-local-specifier.html')!
                .code;
        assert.deepEqual(renamedLocalSpecifier.trim(), undent(`
          <script type="module">import { $bundled$module$a } from "../shared_bundle_1.js";

          const {
            a: a
          } = $bundled$module$a;
          console.log(a.value);</script>
        `));

        const sharedBundle = result.documents.get('shared_bundle_1.js')!.code;
        assert.deepEqual(sharedBundle.trim(), undent(`
          const a = {
            value: 'A'
          };
          console.log('module-a side-effect');
          var moduleA = Object.freeze({
            a: a
          });
          const b = {
            value: 'B'
          };
          console.log('module-b side-effect');
          var moduleB = Object.freeze({
            b: b
          });
          export { moduleA as $bundled$module$a, moduleB as $bundled$module$b };
        `));
      });
    });
  });
});
