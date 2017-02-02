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
import {Analyzer} from 'polymer-analyzer';
import {FSUrlLoader} from 'polymer-analyzer/lib/url-loader/fs-url-loader';

import {BundleStrategy, generateSharedDepsMergeStrategy, generateShellMergeStrategy} from '../bundle-manifest';
import {Bundler} from '../bundler';
import {Options as BundlerOptions} from '../bundler';
import {DocumentCollection} from '../document-collection';

chai.config.showDiff = true;

const assert = chai.assert;
const preds = dom5.predicates;

const domModulePredicate = (id: string) => {
  return preds.AND(
      preds.hasAttrValue('id', id), preds.hasTagName('dom-module'));
};

suite('Bundler', () => {
  let bundler: Bundler;
  const shell = 'test/html/shards/shop_style_project/shell.html';
  const common = 'test/html/shards/shop_style_project/common.html';
  const entrypoint1 = 'test/html/shards/shop_style_project/entrypoint1.html';
  const entrypoint2 = 'test/html/shards/shop_style_project/entrypoint2.html';

  function bundleMultiple(
      inputPath: string[], strategy: BundleStrategy, opts?: BundlerOptions):
      Promise<DocumentCollection> {
    const bundlerOpts = opts || {};
    if (!bundlerOpts.analyzer) {
      bundlerOpts.analyzer = new Analyzer({urlLoader: new FSUrlLoader()});
    }
    bundler = new Bundler(bundlerOpts);
    return bundler.bundle(inputPath, strategy);
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
      const strategy = generateSharedDepsMergeStrategy(2);
      return bundleMultiple([common, entrypoint1, entrypoint2], strategy)
          .then((docs) => {
            assert.equal(docs.size, 3);
            const commonDoc: parse5.ASTNode = docs.get(common)!.ast;
            assert.isDefined(commonDoc);
            const entrypoint1Doc = docs.get(entrypoint1)!;
            assert.isDefined(entrypoint1Doc);
            const entrypoint2Doc = docs.get(entrypoint2)!;
            assert.isDefined(entrypoint2Doc);
            const commonModule = domModulePredicate('common-module');
            const elOne = domModulePredicate('el-one');
            const elTwo = domModulePredicate('el-two');
            const depOne = domModulePredicate('el-dep1');
            const depTwo = domModulePredicate('el-dep2');

            // Check that all the dom modules are in their expected shards
            assertContainsAndExcludes(
                commonDoc, [commonModule, depOne], [elOne, elTwo, depTwo]);
            assertContainsAndExcludes(
                entrypoint1Doc.ast,
                [elOne],
                [commonModule, elTwo, depOne, depTwo]);
            assertContainsAndExcludes(
                entrypoint2Doc.ast,
                [elTwo, depTwo],
                [commonModule, elOne, depOne]);
          });
    });

    test('with 2 entrypoints and a shell, all deps are in their places', () => {
      const strategy = generateShellMergeStrategy(shell, 2);
      return bundleMultiple([shell, entrypoint1, entrypoint2], strategy)
          .then((docs) => {
            //      assert.equal(docs.size, 3);
            const shellDoc: parse5.ASTNode = docs.get(shell)!.ast;
            assert.isDefined(shellDoc);
            const entrypoint1Doc = docs.get(entrypoint1)!;
            assert.isDefined(entrypoint1Doc);
            const entrypoint2Doc = docs.get(entrypoint2)!;
            assert.isDefined(entrypoint2Doc);
            const shellDiv = dom5.predicates.hasAttrValue('id', 'shell');
            const commonModule = domModulePredicate('common-module');
            const elOne = domModulePredicate('el-one');
            const elTwo = domModulePredicate('el-two');
            const depOne = domModulePredicate('el-dep1');
            const depTwo = domModulePredicate('el-dep2');

            // Check that all the dom modules are in their expected shards
            assertContainsAndExcludes(
                shellDoc,
                [shellDiv, commonModule, depOne],
                [elOne, elTwo, depTwo]);
            assertContainsAndExcludes(
                entrypoint1Doc.ast,
                [elOne],
                [commonModule, elTwo, depOne, depTwo]);
            assertContainsAndExcludes(
                entrypoint2Doc.ast,
                [elTwo, depTwo],
                [commonModule, elOne, depOne]);
          });
    });
  });
});
