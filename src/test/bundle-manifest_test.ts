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
import {ResolvedUrl} from 'polymer-analyzer';
import {resolvedUrl as r} from 'polymer-analyzer/lib/test/test-utils';

import {Bundle, BundleManifest, composeStrategies, generateBundles, generateCountingSharedBundleUrlMapper, generateEagerMergeStrategy, generateMatchMergeStrategy, generateSharedBundleUrlMapper, generateSharedDepsMergeStrategy, generateShellMergeStrategy, mergeBundles, mergeSingleEntrypointSubBundles, TransitiveDependenciesMap} from '../bundle-manifest';

chai.config.showDiff = true;

const assert = chai.assert;

suite('BundleManifest', () => {

  /**
   * Convenience method to load a bundle from the serialized form:
   * `[entrypoint1,entrypoint2]->[file1,file2]`
   */
  function deserializeBundle(serialized: string): Bundle {
    const arrowSplit = serialized.split(/->/);
    const entrypoints = arrowSplit[0].slice(1, -1).split(',') as ResolvedUrl[];
    const files = arrowSplit[1].slice(1, -1).split(',') as ResolvedUrl[];
    return new Bundle('html-fragment', new Set(entrypoints), new Set(files));
  }

  /**
   * Serializes a bundles as `[entrypoint1,entrypoint2]->[file1,file2]`.
   */
  function serializeBundle(bundle: Bundle): string {
    assert(bundle, `Tried to serialize ${bundle}`);
    const entrypoints = Array.from(bundle.entrypoints).sort().join();
    const files = Array.from(bundle.files).sort().join();
    return `[${entrypoints}]->[${files}]`;
  }

  function serializeWithType(bundle: Bundle): string {
    return serializeBundle(bundle) + `.${bundle.type}`;
  }

  suite('mergeBundles()', () => {

    test('can not work unless at least one Bundle provided', () => {
      assert.throws(() => mergeBundles([]));
    });

    test('can not merge bundles of different types', () => {
      assert.throws(
          () => mergeBundles([
            new Bundle('html-fragment', new Set([r`A`]), new Set([r`X`])),
            new Bundle('es6-module', new Set([r`B`]), new Set([r`Y`])),
          ]));
    });

    test('can successfully merge bundles of same type', () => {
      assert.equal(
          serializeBundle(mergeBundles([
            new Bundle('html-fragment', new Set([r`A`]), new Set([r`X`])),
            new Bundle('html-fragment', new Set([r`B`]), new Set([r`Y`])),
          ])),
          '[A,B]->[X,Y]');
    });
  });

  suite('constructor and generated maps', () => {

    const bundles = [
      '[A]->[A,C]',  //
      '[B]->[B,D]',
      '[A,B]->[E,F]',
    ].map(deserializeBundle);

    const underscoreJoinMapper = generateSharedBundleUrlMapper(
        (bundles) => bundles.map(
            (b) => Array.from(b.entrypoints).join('_') as ResolvedUrl));

    test('maps bundles to urls based on given mapper', () => {
      const manifest = new BundleManifest(bundles, underscoreJoinMapper);
      assert.equal(
          serializeBundle(manifest.bundles.get(r`A_B`)!), '[A,B]->[E,F]');
    });

    test('enables bundles to be found by constituent file', () => {
      const manifest = new BundleManifest(bundles, underscoreJoinMapper);
      assert.equal(manifest.getBundleForFile(r`E`)!.url, 'A_B');
      assert.equal(
          serializeBundle(manifest.getBundleForFile(r`E`)!.bundle),
          '[A,B]->[E,F]');
    });

    test('generateCountingSharedBundleUrlMapper allows a custom prefix', () => {
      const manifest = new BundleManifest(
          bundles, generateCountingSharedBundleUrlMapper(r`path/to/shared`));
      assert.equal(
          serializeBundle(manifest.bundles.get(r`path/to/shared1.html`)!),
          '[A,B]->[E,F]');
    });
  });

  suite('generateBundles', () => {

    test('produces an array of bundles from dependencies index', () => {
      const depsIndex = new Map<ResolvedUrl, Set<ResolvedUrl>>();
      depsIndex.set(r`A`, new Set([r`A`, r`B`, r`C`, r`G`]));
      depsIndex.set(r`D`, new Set([r`D`, r`B`, r`E`]));
      depsIndex.set(r`F`, new Set([r`F`, r`G`]));

      const bundles = generateBundles(depsIndex).map(serializeBundle).sort();
      assert.deepEqual(
          bundles,
          [
            '[A,D]->[B]',  //
            '[A,F]->[G]',
            '[A]->[A,C]',
            '[D]->[D,E]',
            '[F]->[F]'
          ]);
    });

    test('merges bundles for single script tags back into HTML bundle', () => {
      const depsIndex = new Map<ResolvedUrl, Set<ResolvedUrl>>();
      depsIndex.set(r`A`, new Set([r`A`]));
      depsIndex.set(r`A>1`, new Set([r`X`]));
      depsIndex.set(r`A>2`, new Set([r`Y`]));
      depsIndex.set(r`B`, new Set([r`B`]));
      depsIndex.set(r`B>1`, new Set([r`Y`]));

      const bundles = generateBundles(depsIndex);
      assert.deepEqual(bundles.map(serializeBundle).sort(), [
        '[A>1]->[X]',
        '[A>2,B>1]->[Y]',
        '[A]->[A]',
        '[B]->[B]',
      ]);

      mergeSingleEntrypointSubBundles(bundles);
      assert.deepEqual(bundles.map(serializeBundle).sort(), [
        '[A>2,B>1]->[Y]',
        '[A]->[A,X]',
        '[B]->[B]',
      ]);
    });
  });

  suite('BundleStrategy', () => {

    test('composeStrategies', () => {

      const bundles: Bundle[] = [
        '[A]->[1,A]',
        '[B]->[2,B]',
        '[C]->[3,C]',
        '[A,B]->[4]',
        '[A,C]->[5]',
        '[B,C]->[6]',
        '[A,B,C]->[7]',
        '[D]->[8,D]'
      ].map(deserializeBundle);

      const strategyABCD = composeStrategies([
        generateMatchMergeStrategy(
            (b) => b.files.has(r`B`) || b.entrypoints.has(r`A`)),
        generateMatchMergeStrategy(
            (b) => b.files.has(r`D`) || b.entrypoints.has(r`C`))
      ]);

      const composedABCD = strategyABCD(bundles).map(serializeBundle).sort();
      assert.deepEqual(composedABCD, ['[A,B,C,D]->[1,2,3,4,5,6,7,8,A,B,C,D]']);

      const strategyCDBD = composeStrategies([
        generateMatchMergeStrategy(
            (b) => b.files.has(r`D`) || b.entrypoints.has(r`C`)),
        generateMatchMergeStrategy(
            (b) => b.files.has(r`D`) || b.entrypoints.has(r`B`))
      ]);

      const composedCDBD = strategyCDBD(bundles).map(serializeBundle).sort();
      assert.deepEqual(
          composedCDBD, ['[A,B,C,D]->[2,3,4,5,6,7,8,B,C,D]', '[A]->[1,A]']);
    });

    suite('generateEagerMergeStrategy', () => {

      suite('simple dependency graph', () => {
        const bundles: Bundle[] = [
          '[A]->[1,A]',
          '[A,B]->[2]',
          '[A,B,C]->[3]',
          '[B]->[4,B]',
          '[B,C]->[5]',
          '[B,C,D]->[6]',
          '[C]->[7,C]',
          '[D]->[8,D]',
          '[E]->[E]',
        ].map(deserializeBundle);

        const eagerStrategyA = generateEagerMergeStrategy(r`A`);
        const eagerA = eagerStrategyA(bundles).map(serializeBundle).sort();
        const eagerStrategyB = generateEagerMergeStrategy(r`B`);
        const eagerB = eagerStrategyB(bundles).map(serializeBundle).sort();
        const eagerStrategyD = generateEagerMergeStrategy(r`D`);
        const eagerD = eagerStrategyD(bundles).map(serializeBundle).sort();
        const eagerStrategyE = generateEagerMergeStrategy(r`E`);
        const eagerE = eagerStrategyE(bundles).map(serializeBundle).sort();

        test('merges 2 bundles into eager A', () => {
          assert.deepEqual(eagerA, [
            '[A,B,C]->[1,2,3,A]',
            '[B,C,D]->[6]',
            '[B,C]->[5]',
            '[B]->[4,B]',
            '[C]->[7,C]',
            '[D]->[8,D]',
            '[E]->[E]'
          ]);
        });

        test('merges 4 bundles into eager B', () => {
          assert.deepEqual(eagerB, [
            '[A,B,C,D]->[2,3,4,5,6,B]',
            '[A]->[1,A]',
            '[C]->[7,C]',
            '[D]->[8,D]',
            '[E]->[E]'
          ]);
        });

        test('merges 1 bundle into shell D', () => {
          assert.deepEqual(eagerD, [
            '[A,B,C]->[3]',
            '[A,B]->[2]',
            '[A]->[1,A]',
            '[B,C,D]->[6,8,D]',
            '[B,C]->[5]',
            '[B]->[4,B]',
            '[C]->[7,C]',
            '[E]->[E]'
          ]);
        });

        test('merges no bundles into shell E', () => {
          assert.deepEqual(eagerE, [
            '[A,B,C]->[3]',
            '[A,B]->[2]',
            '[A]->[1,A]',
            '[B,C,D]->[6]',
            '[B,C]->[5]',
            '[B]->[4,B]',
            '[C]->[7,C]',
            '[D]->[8,D]',
            '[E]->[E]'
          ]);
        });
      });

      test('will not merge entrypoint bundles', () => {
        const bundles = [
          '[A]->[1,A]',  //
          '[A,B]->[2,B]',
          '[A,C]->[3]',
          '[A,D]->[5,D]'
        ].map(deserializeBundle);
        const eagerStrategy = generateEagerMergeStrategy(r`A`);
        const eager = eagerStrategy(bundles).map(serializeBundle).sort();
        assert.deepEqual(
            eager,
            [
              '[A,B]->[2,B]',  //
              '[A,C]->[1,3,A]',
              '[A,D]->[5,D]'
            ]);
      });
    });

    suite('generateSharedDepsMergeStrategy', () => {

      const bundles: Bundle[] = [
        '[A]->[A,1]',
        '[A,B]->[2]',
        '[A,B,C]->[3]',
        '[B]->[4,B]',
        '[B,C]->[5]',
        '[B,C,D]->[6]',
        '[C]->[7,C]',
        '[D]->[8,D]'
      ].map(deserializeBundle);

      const strategy9 = generateSharedDepsMergeStrategy(9);
      const bundles9 = strategy9(bundles).map(serializeBundle).sort();
      const strategy3 = generateSharedDepsMergeStrategy(3);
      const bundles3 = strategy3(bundles).map(serializeBundle).sort();
      const strategy2 = generateSharedDepsMergeStrategy(2);
      const bundles2 = strategy2(bundles).map(serializeBundle).sort();
      const strategyDefault = generateSharedDepsMergeStrategy();
      const bundlesDefault =
          strategyDefault(bundles).map(serializeBundle).sort();

      test('merged bundles with at least 2 entrypoints by default', () => {
        assert.deepEqual(bundlesDefault, bundles2);
      });

      test('merges bundles with at least 2 entrypoints', () => {
        assert.deepEqual(bundles2, [
          '[A,B,C,D]->[2,3,5,6]',
          '[A]->[1,A]',
          '[B]->[4,B]',
          '[C]->[7,C]',
          '[D]->[8,D]'
        ]);
      });

      test('merges bundles with at least 3 entrypoints', () => {
        assert.deepEqual(bundles3, [
          '[A,B,C,D]->[3,6]',
          '[A,B]->[2]',
          '[A]->[1,A]',
          '[B,C]->[5]',
          '[B]->[4,B]',
          '[C]->[7,C]',
          '[D]->[8,D]'
        ]);
      });

      test('does not modify original bundles array', () => {
        assert.deepEqual(bundles.map(serializeBundle), [
          '[A]->[1,A]',
          '[A,B]->[2]',
          '[A,B,C]->[3]',
          '[B]->[4,B]',
          '[B,C]->[5]',
          '[B,C,D]->[6]',
          '[C]->[7,C]',
          '[D]->[8,D]'
        ]);
      });

      test('does not change bundles if threshold is not met', () => {
        const originalBundles = bundles.map(serializeBundle).sort();
        assert.deepEqual(bundles9, originalBundles);
      });

      // TODO(usergenic): It feels like the generateSharedDepsMergeStrategy
      // could do something smarter for the case where groups of deps are
      // exclusive.  Leaving this test here as a future behavior to consider.
      test.skip('generates distinct bundles for exclusive graphs', () => {

        const bundlesSplit: Bundle[] = [
          // group [A,B,C]
          '[A]->[1,A]',
          '[A,B]->[2]',
          '[B]->[3,B]',
          '[B,C]->[4]',
          '[C]->[5,C]',

          // group [D,E,F]
          '[D]->[6,D]',
          '[D,E]->[7]',
          '[E]->[8,E]',
          '[E,F]->[9]',
          '[F]->[F]'
        ].map(deserializeBundle);

        const strategy2 = generateSharedDepsMergeStrategy(2);
        const bundles2 = strategy2(bundlesSplit).map(serializeBundle).sort();

        assert.deepEqual(bundles2, [
          '[A,B,C]->[2,4]',
          '[A]->[1,A]',
          '[B]->[3,B]',
          '[C]->[5,C]',
          '[D,E,F]->[7,9]',
          '[D]->[6,D]',
          '[E]->[8,E]',
          '[F]->[F]'
        ]);
      });
    });

    suite('generateShellMergeStrategy', () => {

      test('will merge shop-style shell app dependencies into shell', () => {
        const bundles = [
          '[CART]->[1,CART]',
          '[CART,CHECKOUT]->[2]',
          '[CART,LIST]->[3]',
          '[CHECKOUT]->[4,CHECKOUT]',
          '[DETAIL]->[5,DETAIL]',
          '[DETAIL,LIST]->[6]',
          '[LIST]->[7,LIST]',
          '[SHELL]->[8,SHELL]'
        ].map(deserializeBundle);

        const shellStrategy2 = generateShellMergeStrategy(r`SHELL`, 2);
        const shelled = shellStrategy2(bundles).map(serializeBundle).sort();

        assert.deepEqual(shelled, [
          '[CART,CHECKOUT,DETAIL,LIST,SHELL]->[2,3,6,8,SHELL]',
          '[CART]->[1,CART]',
          '[CHECKOUT]->[4,CHECKOUT]',
          '[DETAIL]->[5,DETAIL]',
          '[LIST]->[7,LIST]'
        ]);
      });

      test('will not merge entrypoint bundles into the shell', () => {
        const bundles = [
          '[A]->[1,A]',  //
          '[A,B]->[2,B]',
          '[A,C]->[3]',
          '[A,C,D]->[5]',
          '[B,D]->[6,D]'
        ].map(deserializeBundle);
        const shellStrategy = generateShellMergeStrategy(r`B`, 2);
        const shelled = shellStrategy(bundles).map(serializeBundle).sort();
        assert.deepEqual(
            shelled,
            [
              '[A,B,C,D]->[2,3,5,B]',  //
              '[A]->[1,A]',
              '[B,D]->[6,D]'
            ]);
      });
    });
  });

  suite('Bundle types', () => {
    test('inferred properly from resolved URLs of entrypoints', () => {
      const depsIndex: TransitiveDependenciesMap = new Map();
      depsIndex.set(r`page1.html`, new Set([r`page1.html`]));
      depsIndex.set(
          r`page1.html>inline#1>es6-module`,
          new Set([r`shared-1.js`, r`shared-2.js`]));
      depsIndex.set(
          r`page1.html>inline#2>es6-module`,
          new Set([r`shared-1.js`, r`shared-2.js`]));
      depsIndex.set(r`page2.html`, new Set([r`page2.html`]));
      depsIndex.set(
          r`page2.html>inline#1>es6-module`,
          new Set([r`page2-only.js`, r`shared-2.js`]));
      depsIndex.set(r`dynamic-import.js`, new Set([r`dynamic-import.js`]));
      const expected = [
        '[dynamic-import.js]->[dynamic-import.js].es6-module',
        '[page1.html>inline#1>es6-module,page1.html>inline#2>es6-module,page2.html>inline#1>es6-module]->[shared-2.js].es6-module',
        '[page1.html>inline#1>es6-module,page1.html>inline#2>es6-module]->[shared-1.js].es6-module',
        '[page1.html]->[page1.html].html-fragment',
        '[page2.html>inline#1>es6-module]->[page2-only.js].es6-module',
        '[page2.html]->[page2.html].html-fragment',
      ];
      const bundles = generateBundles(depsIndex);
      const serializedBundles = bundles.map(serializeWithType).sort();
      assert.deepEqual(serializedBundles, expected);
    });
  });

  suite('Shop example', () => {

    test('generates expected maximal sharding based on dependencies', () => {

      const depsIndex: TransitiveDependenciesMap = new Map();

      depsIndex.set(r`app-shell.html`, new Set([r`app-shell.html`]));
      depsIndex.set(r`catalog-list.html`, new Set([
                      r`catalog-list.html`,
                      r`tin-photo.html`,
                      r`tin-add-to-cart.html`,
                      r`tin-caption.html`,
                      r`tin-paginator.html`,
                    ]));
      depsIndex.set(r`catalog-item.html`, new Set([
                      r`catalog-item.html`,
                      r`tin-photo.html`,
                      r`tin-add-to-cart.html`,
                      r`tin-gallery.html`,
                    ]));
      depsIndex.set(
          r`cart.html`,
          new Set([r`cart.html`, r`tin-photo.html`, r`tin-caption.html`]));
      depsIndex.set(
          r`checkout.html`,
          new Set([r`checkout.html`, r`tin-point-of-sale.html`]));

      const expected = [
        '[app-shell.html]->[app-shell.html]',
        '[cart.html,catalog-item.html,catalog-list.html]->[tin-photo.html]',
        '[cart.html,catalog-list.html]->[tin-caption.html]',
        '[cart.html]->[cart.html]',
        '[catalog-item.html,catalog-list.html]->[tin-add-to-cart.html]',
        '[catalog-item.html]->[catalog-item.html,tin-gallery.html]',
        '[catalog-list.html]->[catalog-list.html,tin-paginator.html]',
        '[checkout.html]->[checkout.html,tin-point-of-sale.html]'
      ];

      const bundles = generateBundles(depsIndex).map(serializeBundle).sort();
      assert.equal(expected.length, bundles.length);

      for (let i = 0; i < bundles.length; ++i) {
        assert.equal(bundles[i], expected[i]);
      }
    });
  });
});
