
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
import {Analyzer, FSUrlLoader, PackageRelativeUrl, PackageUrlResolver, ResolvedUrl} from 'polymer-analyzer';

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

    let analyzer: Analyzer;
    function resolve(url: string) {
      return analyzer.resolveUrl(url as PackageRelativeUrl)! ||
          url as ResolvedUrl;
    }

    test('with 3 endpoints', async () => {
      analyzer = new Analyzer({
        urlResolver: new PackageUrlResolver({
          packageDir: 'test/html/shards/polymer_style_project',
        }),
        urlLoader: new FSUrlLoader('test/html/shards/polymer_style_project'),
      });
      const common = resolve('common.html');
      const dep1 = resolve('dep1.html');
      const dep2 = resolve('dep2.html');
      const endpoint1 = resolve('endpoint1.html');
      const endpoint2 = resolve('endpoint2.html');
      const expectedEntrypointsToDeps = new Map([
        [common, new Set([common])],
        [endpoint1, new Set([common, dep1, endpoint1])],
        [endpoint2, new Set([common, dep2, endpoint1, endpoint2, dep1])],
      ]);
      const index =
          await buildDepsIndex([common, endpoint1, endpoint2], analyzer);
      chai.assert.deepEqual(
          serializeMap(index), serializeMap(expectedEntrypointsToDeps));
    });

    // Deps index currently treats lazy imports as eager imports.
    test('with lazy imports', async () => {
      analyzer = new Analyzer({
        urlResolver: new PackageUrlResolver({
          packageDir: 'test/html/imports',
        }),
        urlLoader: new FSUrlLoader('test/html/imports')
      });
      const entrypoint = resolve('lazy-imports.html');
      const lazyImport1 = resolve('lazy-imports/lazy-import-1.html');
      const lazyImport2 = resolve('lazy-imports/lazy-import-2.html');
      const lazyImport3 = resolve('lazy-imports/subfolder/lazy-import-3.html');
      const shared1 = resolve('lazy-imports/shared-eager-import-1.html');
      const shared2 = resolve('lazy-imports/shared-eager-import-2.html');
      const shared3 =
          resolve('lazy-imports/shared-eager-and-lazy-import-1.html');
      const eager1 = resolve('lazy-imports/subfolder/eager-import-1.html');
      const eager2 = resolve('lazy-imports/subfolder/eager-import-2.html');
      const deeply1 = resolve('lazy-imports/deeply-lazy-import-1.html');
      const deeply2 =
          resolve('lazy-imports/deeply-lazy-imports-eager-import-1.html');
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
          serializeMap(index), serializeMap(expectedEntrypointsToDeps));
    });

    test('when an entrypoint imports an entrypoint', async () => {
      analyzer = new Analyzer({
        urlResolver: new PackageUrlResolver({
          packageDir: 'test/html/imports',
        }),
        urlLoader: new FSUrlLoader('test/html/imports')
      });
      const entrypoint = resolve('eagerly-importing-a-fragment.html');
      const fragmentA = resolve('importing-fragments/fragment-a.html');
      const fragmentB = resolve('importing-fragments/fragment-b.html');
      const util = resolve('importing-fragments/shared-util.html');
      const shell = resolve('importing-fragments/shell.html');
      const expectedEntrypointsToDeps = new Map([
        [entrypoint, new Set([entrypoint, shell])],
        [fragmentA, new Set([fragmentA, util])],
        [fragmentB, new Set([fragmentB, util])],
        [shell, new Set([shell])],
      ]);
      const index = await buildDepsIndex(
          [entrypoint, fragmentA, fragmentB, shell], analyzer);
      chai.assert.deepEqual(
          serializeMap(index), serializeMap(expectedEntrypointsToDeps));
    });

    test('when external html script type module imports', async () => {
      analyzer = new Analyzer({
        urlResolver: new PackageUrlResolver({
          packageDir: 'test/html/imports/es6-modules',
        }),
        urlLoader: new FSUrlLoader('test/html/imports/es6-modules')
      });
      const entrypoint = resolve('multiple-external-modules.html');
      const module1 = entrypoint + '>external-module:1:abc.js';
      const module2 = entrypoint + '>external-module:2:abc.js';
      const module3 = entrypoint + '>external-module:3:def.js';
      const abc = resolve('abc.js');
      const def = resolve('def.js');
      const xyz = resolve('xyz.js');
      const upcase = resolve('upcase.js');
      const index = await buildDepsIndex([entrypoint], analyzer);
      const expectedEntrypointsToDeps = new Map([
        [entrypoint, new Set([entrypoint])],
        [module1, new Set([abc, upcase])],
        [module2, new Set([abc, upcase])],
        [module3, new Set([def, xyz, upcase])],
      ]);
      chai.assert.deepEqual(
          serializeMap(index), serializeMap(expectedEntrypointsToDeps));
    });

    test('when inline html script type module imports', async () => {
      analyzer = new Analyzer({
        urlResolver: new PackageUrlResolver({
          packageDir: 'test/html/imports/es6-modules',
        }),
        urlLoader: new FSUrlLoader('test/html/imports/es6-modules')
      });
      const entrypoint = resolve('multiple-inline-modules.html');
      const module1 = entrypoint + '>inline-module:1';
      const module2 = entrypoint + '>inline-module:2';
      const module3 = entrypoint + '>inline-module:3';
      const abc = resolve('abc.js');
      const def = resolve('def.js');
      const xyz = resolve('xyz.js');
      const upcase = resolve('upcase.js');
      const index = await buildDepsIndex([entrypoint], analyzer);
      const expectedEntrypointsToDeps = new Map([
        [entrypoint, new Set([entrypoint])],
        [module1, new Set([abc, upcase])],
        [module2, new Set([abc, xyz, upcase])],
        [module3, new Set([def, xyz, upcase])],
      ]);
      chai.assert.deepEqual(
          serializeMap(index), serializeMap(expectedEntrypointsToDeps));
    });
  });
});
