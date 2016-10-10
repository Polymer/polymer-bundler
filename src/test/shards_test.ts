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

import {BundleStrategy, BundleUrlMapper, generateSharedDepsMergeStrategy, uniqueEntrypointUrlMapper} from '../bundle-manifest';
import Bundler from '../bundler';
import {Options as BundlerOptions} from '../bundler';
import constants from '../constants';
import DocumentCollection from '../document-collection';

chai.config.showDiff = true;

const assert = chai.assert;
const matchers = require('../matchers');
const preds = dom5.predicates;

const domModulePredicate = (id: string) => {
  return preds.AND(
      preds.hasAttrValue('id', id), preds.hasTagName('dom-module'));
};

suite('Bundler', () => {
  let bundler: Bundler;
  const common = 'test/html/shards/shop_style_project/common.html';
  const entrypoint1 = 'test/html/shards/shop_style_project/entrypoint1.html';
  const entrypoint2 = 'test/html/shards/shop_style_project/entrypoint2.html';

  let doc: parse5.ASTNode;

  function bundleMultiple(
      inputPath: string[],
      strategy: BundleStrategy,
      mapper: BundleUrlMapper,
      opts?: BundlerOptions): Promise<DocumentCollection> {
    const bundlerOpts = opts || {};
    if (!bundlerOpts.analyzer) {
      bundlerOpts.analyzer = new Analyzer({urlLoader: new FSUrlLoader()});
    }
    bundler = new Bundler(bundlerOpts);
    return bundler.bundle(inputPath, strategy, mapper);
  }

  function assertContainsAndExcludes(
      doc: parse5.ASTNode,
      contains: dom5.Predicate[],
      excludes: dom5.Predicate[]) {
    for (let test of contains) {
      const found = dom5.queryAll(doc, test);
      assert.equal(found.length, 1);
    }
    for (let test of excludes) {
      const found = dom5.queryAll(doc, test);
      assert.equal(found.length, 0);
    }
  }

  suite('Sharded builds', () => {
    test('with 3 entrypoints, all deps are in their places', () => {
      const imports = preds.AND(
          preds.hasTagName('link'),
          preds.hasAttrValue('rel', 'import'),
          preds.hasAttr('href'),
          preds.NOT(preds.hasAttrValue('type', 'css')));
      const strategy = generateSharedDepsMergeStrategy(2);
      const mapper = uniqueEntrypointUrlMapper;
      return bundleMultiple(
                 [common, entrypoint1, entrypoint2], strategy, mapper)
          .then((docs) => {
            assert.equal(docs.size, 3);
            const commonDoc: parse5.ASTNode = docs.get(common)!;
            assert.isDefined(commonDoc);
            const entrypoint1Doc = docs.get(entrypoint1)!;
            assert.isDefined(entrypoint1Doc);
            const entrypoint2Doc = docs.get(entrypoint2)!;
            assert.isDefined(entrypoint2Doc);
            console.log('Serialized doc: ', parse5.serialize(entrypoint1Doc));

            const commonModule = domModulePredicate('common-module');
            const elOne = domModulePredicate('el-one');
            const elTwo = domModulePredicate('el-two');
            const depOne = domModulePredicate('el-dep1');
            const depTwo = domModulePredicate('el-dep2');
            // Check that all the dom modules are in their expected shards
            // console.log(commonDoc);
            assertContainsAndExcludes(
                commonDoc, [commonModule, depOne], [elOne, elTwo, depTwo]);
            assertContainsAndExcludes(
                entrypoint1Doc, [elOne], [commonModule, elTwo, depOne, depTwo]);
            assertContainsAndExcludes(
                entrypoint2Doc, [elTwo, depTwo], [commonModule, elOne, depOne]);
          });
    });
  });
});
