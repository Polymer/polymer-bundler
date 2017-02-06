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

import {Bundle, BundleManifest, generateBundles, generateSharedDepsMergeStrategy, generateShellMergeStrategy, invertMultimap, TransitiveDependenciesMap} from '../bundle-manifest';

chai.config.showDiff = true;

const assert = chai.assert;

suite('BundleManifest', () => {

  /**
   * Convenience method to load a bundle from the serialized form:
   * `[entrypoint1,entrypoint2]->[file1,file2]`
   */
  function deserializeBundle(serialized: string): Bundle {
    const arrowSplit = serialized.split(/->/);
    const entrypoints = arrowSplit[0].slice(1, -1).split(',');
    const files = arrowSplit[1].slice(1, -1).split(',');
    return new Bundle(new Set(entrypoints), new Set(files));
  }

  /**
   * Serializes a bundles as `[entrypoint1,entrypoint2]->[file1,file2]`.
   */
  function serializeBundle(bundle: Bundle): string {
    assert(bundle, `Tried to serialize ${bundle}`);
    return `[${Array.from(bundle.entrypoints)
        .sort()
        .join()}]->[${Array.from(bundle.files)
        .sort()
        .join()}]`;
  }

  suite('constructor and generated maps', () => {

    const bundles = [
      '[A]->[A,C]',  //
      '[B]->[B,D]',
      '[A,B]->[E]'
    ].map(deserializeBundle);

    function mapper(bundles: Bundle[]) {
      const entries = bundles.map((bundle): [string, Bundle] => {
        return [Array.from(bundle.entrypoints).join('_'), bundle];
      });
      return new Map(entries);
    }

    const manifest = new BundleManifest(bundles, mapper);

    test('maps bundles to urls based on given mapper', () => {
      assert.equal(serializeBundle(manifest.bundles.get('A_B')!), '[A,B]->[E]');
    });

    test('enables bundles to be found by constituent file', () => {
      assert.equal(manifest.bundleUrlForFile.get('E'), 'A_B');
      assert.equal(
          serializeBundle(manifest.getBundleForFile('E')!.bundle),
          '[A,B]->[E]');
    });
  });

  suite('generateBundles', () => {

    test('produces an array of bundles from dependencies index', () => {
      const depsIndex = new Map<string, Set<string>>();
      depsIndex.set('A', new Set(['A', 'B', 'C', 'G']));
      depsIndex.set('D', new Set(['D', 'B', 'E']));
      depsIndex.set('F', new Set(['F', 'G']));

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
  });

  suite('invertMultimap', () => {

    test('produces an index of dependencies and dependent files', () => {
      const depsIndex = new Map<string, Set<string>>();
      depsIndex.set('A', new Set(['A', 'B', 'C', 'G']));
      depsIndex.set('D', new Set(['D', 'B', 'E']));
      depsIndex.set('F', new Set(['F', 'G']));

      const invertedIndex = invertMultimap(depsIndex);
      assert.equal(
          Array.from(invertedIndex.keys()).sort().join(), 'A,B,C,D,E,F,G');
      assert.equal(Array.from(invertedIndex.get('A')!).join(), 'A');
      assert.equal(Array.from(invertedIndex.get('B')!).join(), 'A,D');
      assert.equal(Array.from(invertedIndex.get('C')!).join(), 'A');
      assert.equal(Array.from(invertedIndex.get('D')!).join(), 'D');
      assert.equal(Array.from(invertedIndex.get('E')!).join(), 'D');
      assert.equal(Array.from(invertedIndex.get('F')!).join(), 'F');
      assert.equal(Array.from(invertedIndex.get('G')!).join(), 'A,F');
    });
  });

  suite('BundleStrategy', () => {

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

      // TODO(usergenic): It feels like the generateSharedDepsMergeStrategy
      // could do something smarter for the case where groups of deps are
      // exclusive.  Leaving this test here as a future behavior to consider.
      test.skip('produces a function which generates 2 shared bundles', () => {

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
          '[A]->[A,1]',
          '[B]->[B,3]',
          '[C]->[C,5]',
          '[D,E,F]->[7,9]',
          '[D]->[D,6]',
          '[E]->[E,8]',
          '[F]->[F]'
        ]);
      });
    });

    suite('generateShellMergeStrategy', () => {

      suite('simple dependency graph', () => {
        const bundles: Bundle[] = [
          '[A]->[A,1]',
          '[A,B]->[2]',
          '[A,B,C]->[3]',
          '[B]->[B,4]',
          '[B,C]->[5]',
          '[B,C,D]->[6]',
          '[C]->[C,7]',
          '[D]->[D,8]'
        ].map(deserializeBundle);

        const shellStrategy3 = generateShellMergeStrategy('D', 3);
        const shelled3 = shellStrategy3(bundles).map(serializeBundle).sort();
        const shellStrategy2 = generateShellMergeStrategy('D', 2);
        const shelled2 = shellStrategy2(bundles).map(serializeBundle).sort();
        const shellStrategyDefault = generateShellMergeStrategy('D');
        const shelledDefault =
            shellStrategyDefault(bundles).map(serializeBundle).sort();

        test('merge shared deps with min 3 entrypoints in shell', () => {
          assert.deepEqual(shelled3, [
            '[A,B,C,D]->[3,6,8,D]',
            '[A,B]->[2]',
            '[A]->[1,A]',
            '[B,C]->[5]',
            '[B]->[4,B]',
            '[C]->[7,C]'
          ]);
        });

        test('merges shared deps with min 2 entrypoints in shell', () => {
          assert.deepEqual(shelled2, [
            '[A,B,C,D]->[2,3,5,6,8,D]',
            '[A]->[1,A]',
            '[B]->[4,B]',
            '[C]->[7,C]'
          ]);
        });

        test('default min entrypoints is 2', () => {
          assert.deepEqual(shelledDefault, shelled2);
        });

        test('throws an error if shell does not exist in any bundle', () => {
          const shellStrategy = generateShellMergeStrategy('X');
          assert.throws(() => shellStrategy(bundles));
        });
      });

      test('shell merge strategy will not merge entrypoints into shell', () => {
        const bundles = [
          '[A]->[1,A]',  //
          '[A,B]->[2,B]',
          '[A,C]->[3]',
          '[SHELL]->[5,SHELL]'
        ].map(deserializeBundle);
        const shellStrategy = generateShellMergeStrategy('SHELL');
        const shelled = shellStrategy(bundles).map(serializeBundle).sort();
        assert.deepEqual(
            shelled,
            [
              '[A,B]->[2,B]',  //
              '[A,C,SHELL]->[3,5,SHELL]',
              '[A]->[1,A]'
            ]);
      });
    });

  });

  suite('Shop example', () => {

    test('generates expected maximal sharding based on dependencies', () => {

      const depsIndex: TransitiveDependenciesMap = new Map();

      depsIndex.set('app-shell.html', new Set(['app-shell.html']));
      depsIndex.set('catalog-list.html', new Set([
                      'catalog-list.html',
                      'tin-photo.html',
                      'tin-add-to-cart.html',
                      'tin-caption.html',
                      'tin-paginator.html'
                    ]));
      depsIndex.set('catalog-item.html', new Set([
                      'catalog-item.html',
                      'tin-photo.html',
                      'tin-add-to-cart.html',
                      'tin-gallery.html'
                    ]));
      depsIndex.set(
          'cart.html',
          new Set(['cart.html', 'tin-photo.html', 'tin-caption.html']));
      depsIndex.set(
          'checkout.html',
          new Set(['checkout.html', 'tin-point-of-sale.html']));

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
