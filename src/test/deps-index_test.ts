
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
import {Analyzer, FSUrlLoader} from 'polymer-analyzer';

import {buildDepsIndex} from '../deps-index';

chai.config.showDiff = true;

suite('Bundler', () => {

  function serializeMap(map: Map<string, Set<string>>): string {
    let s = '';
    for (const key of Array.from(map.keys()).sort()) {
      const set = map.get(key)!;
      s = s + `${key}:\n`;
      for (const value of Array.from(set).sort()) {
        s = s + ` - ${value}\n`;
      }
    }
    return s;
  }

  suite('Deps index tests', () => {

    test('with 3 endpoints', async () => {
      const common = 'common.html';
      const dep1 = 'dep1.html';
      const dep2 = 'dep2.html';
      const endpoint1 = 'endpoint1.html';
      const endpoint2 = 'endpoint2.html';
      const analyzer = new Analyzer({
        urlLoader: new FSUrlLoader('test/html/shards/polymer_style_project')
      });
      const expectedEntrypointsToDeps = new Map([
        [common, new Set([common])],
        [endpoint1, new Set([common, dep1, endpoint1])],
        [endpoint2, new Set([common, dep2, endpoint1, endpoint2, dep1])],
      ]);
      const index =
          await buildDepsIndex([common, endpoint1, endpoint2], analyzer);
      chai.assert.deepEqual(
          serializeMap(index.entrypointToDeps),
          serializeMap(expectedEntrypointsToDeps));
    });

    // Deps index currently treats lazy imports as eager imports.
    test('with lazy imports', async () => {
      const entrypoint = 'lazy-imports.html';
      const lazyImport1 = 'lazy-imports/lazy-import-1.html';
      const lazyImport2 = 'lazy-imports/lazy-import-2.html';
      const lazyImport3 = 'lazy-imports/subfolder/lazy-import-3.html';
      const shared1 = 'lazy-imports/shared-eager-import-1.html';
      const shared2 = 'lazy-imports/shared-eager-import-2.html';
      const shared3 = 'lazy-imports/shared-eager-and-lazy-import-1.html';
      const eager1 = 'lazy-imports/subfolder/eager-import-1.html';
      const eager2 = 'lazy-imports/subfolder/eager-import-2.html';
      const deeply1 = 'lazy-imports/deeply-lazy-import-1.html';
      const deeply2 = 'lazy-imports/deeply-lazy-imports-eager-import-1.html';
      const analyzer =
          new Analyzer({urlLoader: new FSUrlLoader('test/html/imports')});
      const expectedEntrypointsToDeps = new Map([
        [entrypoint, new Set([entrypoint, shared3])],
        [lazyImport1, new Set([lazyImport1, shared1, shared2])],
        [
          lazyImport2,
          new Set([lazyImport2, shared1, shared2, shared3, eager1, eager2])
        ],
        [lazyImport3, new Set([lazyImport3])],
        [shared3, new Set([shared3])],
        [deeply1, new Set([deeply1, deeply2])],
      ]);
      const index = await buildDepsIndex([entrypoint], analyzer);
      chai.assert.deepEqual(
          serializeMap(index.entrypointToDeps),
          serializeMap(expectedEntrypointsToDeps));
    });

    test('when an entrypoint imports an entrypoint', async () => {
      const entrypoint = 'eagerly-importing-a-fragment.html';
      const fragmentA = 'importing-fragments/fragment-a.html';
      const fragmentB = 'importing-fragments/fragment-a.html';
      const util = 'importing-fragments/shared-util.html';
      const shell = 'importing-fragments/shell.html';
      const analyzer =
          new Analyzer({urlLoader: new FSUrlLoader('test/html/imports')});
      const expectedEntrypointsToDeps = new Map([
        [entrypoint, new Set([entrypoint, fragmentA, shell, util])],
        [fragmentA, new Set([fragmentA, util])],
        [fragmentB, new Set([fragmentB, util])],
        [shell, new Set([shell, fragmentA, util])],
      ]);
      const index = await buildDepsIndex(
          [entrypoint, fragmentA, fragmentB, shell], analyzer);
      chai.assert.deepEqual(
          serializeMap(index.entrypointToDeps),
          serializeMap(expectedEntrypointsToDeps));
    });
  });
});
