
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
  const common = 'test/html/shards/polymer_style_project/common.html';
  const dep1 = 'test/html/shards/polymer_style_project/dep1.html';
  const dep2 = 'test/html/shards/polymer_style_project/dep2.html';
  const endpoint1 = 'test/html/shards/polymer_style_project/endpoint1.html';
  const endpoint2 = 'test/html/shards/polymer_style_project/endpoint2.html';

  let analyzer: Analyzer;
  beforeEach(() => {
    analyzer = new Analyzer({urlLoader: new FSUrlLoader()});
  });

  const expectedEntrypointsToDeps = new Map([
    [common, new Set([common])],
    [endpoint1, new Set([common, dep1, endpoint1])],
    [endpoint2, new Set([common, dep2, endpoint1, endpoint2, dep1])],
  ]);

  const deepMapSetEqual =
      (actual: Map<string, Set<string>>,
       expected: Map<string, Set<string>>) => {
        // Check keys
        const actualEntries = Array.from(actual.entries());
        const expectedEntries = Array.from(expected.entries());
        // Iterate and check values
        const sortEntry = (a: any, b: any) => a[0].localeCompare(b[0]);
        actualEntries.sort(sortEntry);
        expectedEntries.sort(sortEntry);
        if (actualEntries.length !== expectedEntries.length) {
          throw new chai.AssertionError(
              `Expected ${expectedEntries.length} entries, ` +
              `got ${actualEntries.length} instead`);
        }

        for (let i = 0; i < actualEntries.length; i++) {
          const actualEntry = actualEntries[i];
          const expectedEntry = expectedEntries[i];
          if (actualEntry[0] !== expectedEntry[0]) {
            throw 'keys mismatched';
          }
          if (actualEntry[1].size !== expectedEntry[1].size) {
            throw new chai.AssertionError(
                `Wrong number of entries for key: ${actualEntry[0]}`);
          }
          for (const setEntry of actualEntry[1].values()) {
            if (!expectedEntry[1].has(setEntry)) {
              throw new chai.AssertionError(
                  `Found unexpected key: ${setEntry}`);
            }
          }
        }
      };

  suite('Deps index tests', () => {
    test(
        'with 3 endpoints, all deps are properly assigned to the index', () => {
          return buildDepsIndex([common, endpoint1, endpoint2], analyzer)
              .then((index) => {
                deepMapSetEqual(
                    index.entrypointToDeps, expectedEntrypointsToDeps);
              });
        });
  });
});
