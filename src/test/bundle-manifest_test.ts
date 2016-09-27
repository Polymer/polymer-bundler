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

import {Bundle, generateBundles, generateSharedDepsMergeStrategy, generateShellMergeStrategy, IBundle, IFileTransDepsIndex, invertFileTransDepsIndex} from '../bundle-manifest';

chai.config.showDiff = true;

const assert = chai.assert;
const matchers = require('../matchers');

suite('BundleManifest', () => {

  function serializeBundle(bundle: IBundle) {
    assert(bundle, 'Tried to serialize ${bundle}');
    return `[${Array.from(bundle.entrypoints)
        .sort()
        .join(', ')}] -> [${Array.from(bundle.files)
        .sort()
        .join(', ')}]`;
  }

  suite('generateBundles', () => {

    test('produces an array of bundles from dependencies index', () => {
      const depsIndex = new Map<string, Set<string>>();
      depsIndex.set('A', new Set(['B', 'C', 'G']));
      depsIndex.set('D', new Set(['B', 'E']));
      depsIndex.set('F', new Set(['G']));

      const bundles = generateBundles(depsIndex).map(serializeBundle).sort();
      assert.equal(bundles.length, 5);
      assert.equal(bundles[0], '[A, D] -> [B]');
      assert.equal(bundles[1], '[A, F] -> [G]');
      assert.equal(bundles[2], '[A] -> [A, C]');
      assert.equal(bundles[3], '[D] -> [D, E]');
      assert.equal(bundles[4], '[F] -> [F]');
    });
  });

  suite('invertFileTransDepsIndex', () => {

    test('produces an index of dependencies and dependent files', () => {
      const depsIndex = new Map<string, Set<string>>();
      depsIndex.set('A', new Set(['B', 'C', 'G']));
      depsIndex.set('D', new Set(['B', 'E']));
      depsIndex.set('F', new Set(['G']));

      const invertedIndex = invertFileTransDepsIndex(depsIndex);
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

  suite('Bundle Strategies', () => {

    const bundles: IBundle[] = [];
    bundles.push(new Bundle(new Set(['A']), new Set(['A', '1'])));
    bundles.push(new Bundle(new Set(['A', 'B']), new Set(['2'])));
    bundles.push(new Bundle(new Set(['A', 'B', 'C']), new Set(['3'])));
    bundles.push(new Bundle(new Set(['B']), new Set(['B', '4'])));
    bundles.push(new Bundle(new Set(['B', 'C']), new Set(['5'])));
    bundles.push(new Bundle(new Set(['B', 'C', 'D']), new Set(['6'])));
    bundles.push(new Bundle(new Set(['C']), new Set(['C', '7'])));
    bundles.push(new Bundle(new Set(['D']), new Set(['D', '8'])));

    suite('generateSharedDepsMergeStrategy', () => {

      test('produces a function to merge bundles with shared deps', () => {

        const strategy3 = generateSharedDepsMergeStrategy(3);
        const bundles3 = strategy3(bundles).map(serializeBundle).sort();
        assert.equal(bundles3.length, 7);
        assert.equal(bundles3[0], '[A, B, C, D] -> [3, 6]');
        assert.equal(bundles3[1], '[A, B] -> [2]');
        assert.equal(bundles3[2], '[A] -> [1, A]');
        assert.equal(bundles3[3], '[B, C] -> [5]');
        assert.equal(bundles3[4], '[B] -> [4, B]');
        assert.equal(bundles3[5], '[C] -> [7, C]');
        assert.equal(bundles3[6], '[D] -> [8, D]');

        const strategy2 = generateSharedDepsMergeStrategy(2);
        const bundles2 = strategy2(bundles).map(serializeBundle).sort();
        assert.equal(bundles2.length, 5);
        assert.equal(bundles2[0], '[A, B, C, D] -> [2, 3, 5, 6]');
        assert.equal(bundles2[1], '[A] -> [1, A]');
        assert.equal(bundles2[2], '[B] -> [4, B]');
        assert.equal(bundles2[3], '[C] -> [7, C]');
        assert.equal(bundles2[4], '[D] -> [8, D]');

        // Prove the original bundles list is unmodified.
        assert.equal(bundles.length, 8);
      });
    });

    suite('generateShellMergeStrategy', () => {

      test('produces function to merge shared deps in shell', () => {
        const shellStrategy = generateShellMergeStrategy('D');
        const shelled = shellStrategy(bundles).map(serializeBundle).sort();
        assert.equal(shelled.length, 4);

        assert.equal(shelled[0], '[A, B, C, D] -> [2, 3, 5, 6, 8, D]');
        assert.equal(shelled[1], '[A] -> [1, A]');
        assert.equal(shelled[2], '[B] -> [4, B]');
        assert.equal(shelled[3], '[C] -> [7, C]');
      });
    });

  });

  suite('Shop example', () => {

    const depsIndex: IFileTransDepsIndex = new Map();

    depsIndex.set('app-shell.html', new Set());
    depsIndex.set('catalog-list.html', new Set([
                    'tin-photo.html', 'tin-add-to-cart.html',
                    'tin-caption.html', 'tin-paginator.html'
                  ]));
    depsIndex.set('catalog-item.html', new Set([
                    'tin-photo.html', 'tin-add-to-cart.html', 'tin-gallery.html'
                  ]));
    depsIndex.set('cart.html', new Set(['tin-photo.html', 'tin-caption.html']));
    depsIndex.set('checkout.html', new Set(['tin-point-of-sale.html']));

    test('generates expected maximal sharding based on dependencies', () => {

      const expected = [
        '[app-shell.html] -> [app-shell.html]',
        '[cart.html, catalog-item.html, catalog-list.html] -> [tin-photo.html]',
        '[cart.html, catalog-list.html] -> [tin-caption.html]',
        '[cart.html] -> [cart.html]',
        '[catalog-item.html, catalog-list.html] -> [tin-add-to-cart.html]',
        '[catalog-item.html] -> [catalog-item.html, tin-gallery.html]',
        '[catalog-list.html] -> [catalog-list.html, tin-paginator.html]',
        '[checkout.html] -> [checkout.html, tin-point-of-sale.html]'
      ];

      const bundles = generateBundles(depsIndex).map(serializeBundle).sort();
      expected.forEach((e, i) => assert.equal(bundles[i], e));
    });
  });
});
