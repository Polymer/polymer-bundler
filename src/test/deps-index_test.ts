
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
import {resolvedUrl as r} from './test-utils';

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
      const common = r`common.html`;
      const dep1 = r`dep1.html`;
      const dep2 = r`dep2.html`;
      const endpoint1 = r`endpoint1.html`;
      const endpoint2 = r`endpoint2.html`;
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
      const entrypoint = r`lazy-imports.html`;
      const lazyImport1 = r`lazy-imports/lazy-import-1.html`;
      const lazyImport2 = r`lazy-imports/lazy-import-2.html`;
      const lazyImport3 = r`lazy-imports/subfolder/lazy-import-3.html`;
      const shared1 = r`lazy-imports/shared-eager-import-1.html`;
      const shared2 = r`lazy-imports/shared-eager-import-2.html`;
      const shared3 = r`lazy-imports/shared-eager-and-lazy-import-1.html`;
      const eager1 = r`lazy-imports/subfolder/eager-import-1.html`;
      const eager2 = r`lazy-imports/subfolder/eager-import-2.html`;
      const deeply1 = r`lazy-imports/deeply-lazy-import-1.html`;
      const deeply2 = r`lazy-imports/deeply-lazy-imports-eager-import-1.html`;
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
      const entrypoint = r`eagerly-importing-a-fragment.html`;
      const fragmentA = r`importing-fragments/fragment-a.html`;
      const fragmentB = r`importing-fragments/fragment-a.html`;
      const util = r`importing-fragments/shared-util.html`;
      const shell = r`importing-fragments/shell.html`;
      const analyzer =
          new Analyzer({urlLoader: new FSUrlLoader('test/html/imports')});
      const expectedEntrypointsToDeps = new Map([
        [entrypoint, new Set([entrypoint, shell])],
        [fragmentA, new Set([fragmentA, util])],
        [fragmentB, new Set([fragmentB, util])],
        [shell, new Set([shell])],
      ]);
      const index = await buildDepsIndex(
          [entrypoint, fragmentA, fragmentB, shell], analyzer);
      chai.assert.deepEqual(
          serializeMap(index.entrypointToDeps),
          serializeMap(expectedEntrypointsToDeps));
    });

    suite('JavaScript modules', () => {

      test('html document with base href and js module', async () => {
        const documentWithBaseHref = r`document-base.html`;
        const moduleA = r`module-a.js`;
        const analyzer =
            new Analyzer({urlLoader: new FSUrlLoader('test/html/modules')});
        const expectedEntrypointsToDeps = new Map(
            [[documentWithBaseHref, new Set([documentWithBaseHref, moduleA])]]);
        const index = await buildDepsIndex([documentWithBaseHref], analyzer);
        chai.assert.deepEqual(
            serializeMap(index.entrypointToDeps),
            serializeMap(expectedEntrypointsToDeps));
      });

      test('single entrypoint, 2 modules with a shared module', async () => {
        const entrypoint = r`scripts-type-module.html`;
        const moduleA = r`imports/module-a.js`;
        const moduleB = r`imports/module-b.js`;
        const sharedModule = r`imports/shared-module.js`;
        const analyzer =
            new Analyzer({urlLoader: new FSUrlLoader('test/html')});
        const expectedEntrypointsToDeps = new Map([
          [entrypoint, new Set([entrypoint, moduleA, moduleB, sharedModule])],
          [moduleA, new Set([moduleA, sharedModule])],
          [moduleB, new Set([moduleB, sharedModule])],
          [sharedModule, new Set([sharedModule])],
        ]);
        const index = await buildDepsIndex(
            [entrypoint, moduleA, moduleB, sharedModule], analyzer);
        chai.assert.deepEqual(
            serializeMap(index.entrypointToDeps),
            serializeMap(expectedEntrypointsToDeps));
      });

      test('only module type scripts are bundle files', async () => {
        const entrypoint = r`modules/animals/animal-index.html`;
        const coolKitties = r`modules/animals/cool-kitties.html`;
        const sharkTime = r`modules/animals/shark-time.html`;

        const cat = r`modules/animals/cat.js`;
        const dog = r`modules/animals/dog.js`;
        const fish = r`modules/animals/aquatic-js/fish.js`;
        const invertebrate = r`modules/animals/invertebrate.js`;
        const lazyDog = r`modules/animals/lazy-dog.js`;
        const mammal = r`modules/animals/mammal.js`;
        const sharedImport = r`modules/shared-import.html`;
        const shark = r`modules/animals/aquatic-js/shark.js`;
        const snail = r`modules/animals/snail.js`;
        const vertebrate = r`modules/animals/vertebrate.js`;

        const externalScript = r`imports/external-script.html`;

        const analyzer =
            new Analyzer({urlLoader: new FSUrlLoader('test/html')});
        const expectedEntrypointsToDeps = new Map([
          [
            entrypoint,
            new Set([
              entrypoint,
              externalScript,
              invertebrate,
              lazyDog,
              snail,
            ])
          ],
          [
            coolKitties,
            new Set([coolKitties, cat, mammal, sharedImport, vertebrate])
          ],
          [dog, new Set([dog, mammal, vertebrate])],
          [
            sharkTime,
            new Set([sharkTime, fish, sharedImport, shark, vertebrate])
          ],
        ]);
        const index = await buildDepsIndex([entrypoint], analyzer);
        chai.assert.deepEqual(
            serializeMap(index.entrypointToDeps),
            serializeMap(expectedEntrypointsToDeps));
      });
    });
  });
});
