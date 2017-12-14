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

import {generateSharedDepsMergeStrategy, mergeMatchingBundles} from '../bundle-manifest';
import {Bundler, BundleResult, Options} from '../bundler';

import {undent} from './test-utils';

chai.config.showDiff = true;

const assert = chai.assert;

async function bundle(root: string, urls: string[], options?: Options):
    Promise<BundleResult> {
      const bundlerOptions = Object.assign({}, options) as Options;
      if (!bundlerOptions.analyzer) {
        bundlerOptions.analyzer = new Analyzer({
          urlLoader: new FSUrlLoader(path.resolve(root)),
        });
      }
      const bundler = new Bundler(bundlerOptions);
      return bundler.bundle(await bundler.generateManifest(urls));
    }

suite('Bundling JS Modules', () => {

  suite('import declaration forms', () => {

    const root = 'test/html/modules';

    suite('single entrypoint', () => {

      const bundleOne = async (url: string) =>
          (await bundle(root, [`import-declaration-forms/${url}`]))
              .documents.get(`import-declaration-forms/${url}`)!.code;

      test('default specifier', async () => {
        const code = await bundleOne('default-specifier.js');
        assert.deepEqual(code, undent(`
          const value = 'DEFAULT';
          console.log(value);
        `));
      });

      test('dynamic import await', async () => {
        const code = await bundleOne('dynamic-import-await.js');
        assert.deepEqual(code, undent(`
          async function dynamicExample() {
            const moduleC = await import("../module-c.js");
            console.log(moduleC.value);
          }

          export { dynamicExample };
        `));
      });

      test('multiple specifiers (default and named)', async () => {
        const code = await bundleOne('multiple-specifiers-1.js');
        assert.deepEqual(code, undent(`
          const value = 'DEFAULT';
          const otherValue = 'OTHER';
          console.log('default value:', value);
          console.log('other value:', otherValue);
        `));
      });

      test('multiple specifiers (default and namespaced)', async () => {
        const code = await bundleOne('multiple-specifiers-2.js');
        assert.deepEqual(code, undent(`
          const value = 'DEFAULT';
          const otherValue = 'OTHER';
          console.log('default value:', value);
          console.log('other value:', otherValue);
        `));
      });

      test('named specifier', async () => {
        const code = await bundleOne('named-specifier.js');
        assert.deepEqual(code, undent(`
          const a = {
            value: 'A'
          };
          console.log('module-a side-effect');
          console.log(a.value);
        `));
      });

      test('namespace specifier', async () => {
        const code = await bundleOne('namespace-specifier.js');
        assert.deepEqual(code, undent(`
          const b = {
            value: 'B'
          };
          console.log('module-b side-effect');
          console.log(b.value);
        `));
      });

      test('no specifier', async () => {
        const code = await bundleOne('no-specifier.js');
        assert.deepEqual(code, undent(`
          console.log('module-b side-effect');
          console.log('no-specifier side-effect');
        `));
      });

      test('renamed local specifier', async () => {
        const code = await bundleOne('renamed-local-specifier.js');
        assert.deepEqual(code, undent(`
          const a = {
            value: 'A'
          };
          console.log('module-a side-effect');
          console.log(a.value);
        `));
      });
    });

    suite('shared bundles', () => {

      const bundleMultiple = async (urls: string[], options?: Options) => {
        return (await bundle(
            root, urls.map((u) => `import-declaration-forms/${u}`), options));
      };

      test('shared bundle with 2 exported modules', async () => {

        const result = await bundleMultiple(
            [
              'named-specifier.js',
              'namespace-specifier.js',
              'no-specifier.js',
              'renamed-local-specifier.js',
            ],
            {strategy: generateSharedDepsMergeStrategy(2)});

        const namedSpecifier =
            result.documents.get('import-declaration-forms/named-specifier.js')!
                .code;
        assert.deepEqual(namedSpecifier, undent(`
          import { $bundled$module$a } from "../shared_bundle_1.js";
          const {
            a: a
          } = $bundled$module$a;
          console.log(a.value);
        `));

        const namespaceSpecifier =
            result.documents
                .get('import-declaration-forms/namespace-specifier.js')!.code;
        assert.deepEqual(namespaceSpecifier, undent(`
          import { $bundled$module$b } from "../shared_bundle_1.js";
          const {
            b: b
          } = $bundled$module$b;
          console.log(b.value);
        `));

        const noSpecifier =
            result.documents.get('import-declaration-forms/no-specifier.js')!
                .code;
        assert.deepEqual(noSpecifier, undent(`
          import { $bundled$module$b } from "../shared_bundle_1.js";
          console.log('no-specifier side-effect');
        `));

        const renamedLocalSpecifier =
            result.documents
                .get('import-declaration-forms/renamed-local-specifier.js')!
                .code;
        assert.deepEqual(renamedLocalSpecifier, undent(`
          import { $bundled$module$a } from "../shared_bundle_1.js";
          const {
            a: a
          } = $bundled$module$a;
          console.log(a.value);
        `));

        const sharedBundle = result.documents.get('shared_bundle_1.js')!.code;
        assert.deepEqual(sharedBundle, undent(`
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

      test('dynamically importing from a shared bundle', async () => {

        const result = await bundleMultiple(
            ['dynamic-import-await.js', 'dynamic-import-then.js'], {
              strategy: (bundles) => mergeMatchingBundles(
                  bundles,
                  (b) => [...b.files].some((f) => !!f.match(/module-/))),
            });

        const dynamicImportAwait =
            result.documents
                .get('import-declaration-forms/dynamic-import-await.js')!.code;
        assert.deepEqual(dynamicImportAwait, undent(`
          async function dynamicExample() {
            const moduleC = await import("../shared_bundle_1.js").then(({
              $bundled$module$c: $bundled$module$c
            }) => $bundled$module$c);
            console.log(moduleC.value);
          }

          export { dynamicExample };
        `));

        const dynamicImportThen =
            result.documents
                .get('import-declaration-forms/dynamic-import-then.js')!.code;
        assert.deepEqual(dynamicImportThen, undent(`
          import("../shared_bundle_1.js").then(({
            $bundled$module$b: $bundled$module$b
          }) => $bundled$module$b).then(b => console.log(b.value));
        `));

        const sharedBundle = result.documents.get('shared_bundle_1.js')!.code;
        assert.deepEqual(sharedBundle, undent(`
          const c = {
            value: 'C'
          };
          console.log('module-c side-effect');
          var moduleC = Object.freeze({
            c: c
          });
          const b = {
            value: 'B'
          };
          console.log('module-b side-effect');
          var moduleB = Object.freeze({
            b: b
          });
          export { moduleC as $bundled$module$c, moduleB as $bundled$module$b };
        `));
      });
    });
  });
});
