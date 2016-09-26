
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
import * as dom5 from 'dom5';
import * as parse5 from 'parse5';
import * as path from 'path';
import {Analyzer} from 'polymer-analyzer';
import {FSUrlLoader} from 'polymer-analyzer/lib/url-loader/fs-url-loader';

import constants from '../constants';
import {buildDepsIndex} from '../deps-index';

chai.config.showDiff = true;

const assert = chai.assert;
const matchers = require('../matchers');
const preds = dom5.predicates;

const domModulePredicate = (id: string) => {
  return preds.AND(
      preds.hasAttrValue('id', id), preds.hasTagName('dom-module'));
};

suite('Bundler', () => {
  const common = 'test/html/shards/common.html';
  const dep1 = 'test/html/shards/dep1.html';
  const dep2 = 'test/html/shards/dep2.html';
  const endpoint1 = 'test/html/shards/endpoint1.html';
  const endpoint2 = 'test/html/shards/endpoint2.html';

  let doc: parse5.ASTNode;
  let analyzer: Analyzer;
  beforeEach(() => {
    analyzer = new Analyzer({urlLoader: new FSUrlLoader()});
  })

  suite('Deps index tests', () => {
    test(
        'with 3 endpoints, all deps are properly assigned to the index', () => {
          return buildDepsIndex([common, endpoint1, endpoint2], analyzer)
              .then((index) => {
                console.log(index);
                assert.equal(index.depsToFragments.get(common)!.size, 2);
                assert.equal(index.depsToFragments.get(dep1)!.size, 2);
                assert.equal(index.depsToFragments.get(dep2)!.size, 1);
                assert.equal(index.depsToFragments.get(endpoint1)!.size, 1);

                assert.equal(index.fragmentToDeps.get(common)!.size, 0);
                assert.equal(index.fragmentToDeps.get(endpoint1)!.size, 2);
                assert.equal(index.fragmentToDeps.get(endpoint2)!.size, 4);
              });
        });
  });
});
