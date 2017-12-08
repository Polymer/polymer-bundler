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
import * as babelGenerator from 'babel-generator';
import * as babel from 'babel-types';
import * as chai from 'chai';
import * as dom5 from 'dom5';
import * as parse5 from 'parse5';
import {Analyzer, FSUrlLoader} from 'polymer-analyzer';

import {generateSharedDepsMergeStrategy, generateShellMergeStrategy} from '../bundle-manifest';
import {Bundler, BundleResult} from '../bundler';
import {Options as BundlerOptions} from '../bundler';

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

  async function bundleMultiple(inputPath: string[], opts?: BundlerOptions):
      Promise<BundleResult> {
        const bundlerOpts = opts || {};
        if (!bundlerOpts.analyzer) {
          bundlerOpts.analyzer = new Analyzer({urlLoader: new FSUrlLoader()});
        }
        bundler = new Bundler(bundlerOpts);
        const manifest = await bundler.generateManifest(inputPath);
        return bundler.bundle(manifest);
      }

  function assertHtmlContainsAndExcludes(
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
    test('with 3 entrypoints, all deps are in their places', async () => {
      const {documents} = await bundleMultiple(
          [common, entrypoint1, entrypoint2],
          {strategy: generateSharedDepsMergeStrategy(2)});
      assert.equal(documents.size, 4);
      const commonDoc = documents.get(common)!.ast as parse5.ASTNode;
      assert.isDefined(commonDoc);
      const entrypoint1Doc = documents.get(entrypoint1)!.ast as parse5.ASTNode;
      assert.isDefined(entrypoint1Doc);
      const entrypoint2Doc = documents.get(entrypoint2)!.ast as parse5.ASTNode;
      assert.isDefined(entrypoint2Doc);
      const sharedDoc =
          documents.get('shared_bundle_1.html')!.ast as parse5.ASTNode;
      assert.isDefined(sharedDoc);
      const commonModule = domModulePredicate('common-module');
      const elOne = domModulePredicate('el-one');
      const elTwo = domModulePredicate('el-two');
      const depOne = domModulePredicate('el-dep1');
      const depTwo = domModulePredicate('el-dep2');

      // Check that all the dom modules are in their expected shards
      assertHtmlContainsAndExcludes(
          commonDoc, [commonModule], [elOne, elTwo, depOne, depTwo]);
      assertHtmlContainsAndExcludes(
          sharedDoc, [depOne], [elOne, elTwo, depTwo]);
      assertHtmlContainsAndExcludes(
          entrypoint1Doc, [elOne], [commonModule, elTwo, depOne, depTwo]);
      assertHtmlContainsAndExcludes(
          entrypoint2Doc, [elTwo, depTwo], [commonModule, elOne, depOne]);
    });

    test('with 2 entrypoints and shell, all deps in their places', async () => {
      const {documents} = await bundleMultiple(
          [shell, entrypoint1, entrypoint2],
          {strategy: generateShellMergeStrategy(shell, 2)});
      assert.equal(documents.size, 3);
      const shellDoc = documents.get(shell)!.ast as parse5.ASTNode;
      assert.isDefined(shellDoc);
      const entrypoint1Doc = documents.get(entrypoint1)!.ast as parse5.ASTNode;
      assert.isDefined(entrypoint1Doc);
      const entrypoint2Doc = documents.get(entrypoint2)!.ast as parse5.ASTNode;
      assert.isDefined(entrypoint2Doc);
      const shellDiv = dom5.predicates.hasAttrValue('id', 'shell');
      const shellImport = dom5.predicates.AND(
          dom5.predicates.hasTagName('link'),
          dom5.predicates.hasSpaceSeparatedAttrValue('rel', 'import'),
          dom5.predicates.hasAttrValue('href', 'shell.html'));
      const commonModule = domModulePredicate('common-module');
      const elOne = domModulePredicate('el-one');
      const elTwo = domModulePredicate('el-two');
      const depOne = domModulePredicate('el-dep1');
      const depTwo = domModulePredicate('el-dep2');

      // Check that all the dom modules are in their expected shards
      assertHtmlContainsAndExcludes(
          shellDoc, [shellDiv, commonModule, depOne], [elOne, elTwo, depTwo]);
      assertHtmlContainsAndExcludes(
          entrypoint1Doc,
          [elOne],
          [commonModule, elTwo, depOne, depTwo, shellImport]);
      assertHtmlContainsAndExcludes(
          entrypoint2Doc,
          [elTwo, depTwo],
          [commonModule, elOne, depOne, shellImport]);
    });

    test('with JavaScript modules, all deps in their places', async () => {
      const entrypoint = 'test/html/modules/animal-index.html';
      const coolKitties = 'test/html/modules/cool-kitties.html';
      const sharkTime = 'test/html/modules/shark-time.html';

      const {documents} =
          await bundleMultiple([entrypoint, coolKitties, sharkTime]);
      const sharedBundle2 =
          documents.get('shared_bundle_2.js')!.ast! as babel.Node;

      const dog = documents.get('test/html/modules/dog.js')!.ast! as babel.Node;

      // TODO(usergenic): Should bundler really be returning ASTs?  We should
      // probably just be returning the asset code.

      console.log('/* dog.js */\n---\n' + babelGenerator.default(dog).code);

      console.log(
          '/* shared_bundle_2.js */\n---\n' +
          babelGenerator.default(sharedBundle2).code);
    });
  });
});
