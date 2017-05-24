/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
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
import {Analyzer, FSUrlLoader} from 'polymer-analyzer';
import {MappingItem, RawSourceMap, SourceMapConsumer} from 'source-map';

import {Bundler} from '../bundler';
import {Options as BundlerOptions} from '../bundler';
import {
  getExistingSourcemap,
  createJsIdentitySourcemap,
  offsetSourceMap} from '../source-map';

chai.config.showDiff = true;

const assert = chai.assert;
const matchers = require('../matchers');

suite('Bundler', () => {
  let bundler: Bundler;

  async function bundle(inputPath: string, opts?: BundlerOptions):
      Promise<parse5.ASTNode> {
        // Don't modify options directly because test-isolation problems occur.
        const bundlerOpts = Object.assign({}, opts || {});
        if (!bundlerOpts.analyzer) {
          bundlerOpts.analyzer = new Analyzer(
              {urlLoader: new FSUrlLoader(path.dirname(inputPath))});
          inputPath = path.basename(inputPath);
        }
        bundler = new Bundler(bundlerOpts);
        const manifest = await bundler.generateManifest([inputPath]);
        const {documents} = await bundler.bundle(manifest);
        return documents.get(inputPath)!.ast;
      }

  function getLine(original: string, lineNum: number) {
    const lines = original.split('\n');
    return lines[lineNum - 1];
  }

  async function testMapping(
      sourcemap: RawSourceMap, html: string, name: string) {
    const consumer = new SourceMapConsumer(sourcemap!);
    let foundMapping = false;
    const mappings: MappingItem[] = [];
    consumer.eachMapping(mapping => mappings.push(mapping));
    for (let j = 0; j < mappings.length; j++) {
      if (mappings[j].name === name) {
        foundMapping = true;
        const generatedLine = getLine(html, mappings[j].generatedLine);
        assert(generatedLine, 'generated line not found');
        assert.equal(
            mappings[j].generatedColumn,
            generatedLine!.indexOf(name),
            'generated column');

        const originalContents = await urlLoader.load(mappings[j].source);
        const originalLine =
            getLine(originalContents, mappings[j].originalLine);
        assert(originalLine, 'original line not found');
        assert.equal(
            mappings[j].originalColumn,
            originalLine!.indexOf(name),
            'original column');
      }
    }
  }

  const basePath = 'test/html/sourcemaps';
  const urlLoader = new FSUrlLoader(basePath);
  const analyzer = new Analyzer({urlLoader: urlLoader});

  suite('Sourcemaps', () => {

    test('inline maps are compiled correctly', async () => {
      const doc = await bundle(
          'inline.html',
          {inlineScripts: true, sourcemaps: true, analyzer: analyzer});
      assert(doc);
      const compiledHtml = parse5.serialize(doc);
      const inlineScripts = dom5.queryAll(doc, matchers.inlineJavascript);
      assert.equal(inlineScripts.length, 3);

      for (let i = 0; i < inlineScripts.length; i++) {
        if (i === 5) {
          continue;
        }

        const sourcemap = await getExistingSourcemap(
            analyzer, 'inline.html', dom5.getTextContent(inlineScripts[i]));

        assert(sourcemap, 'scripts found');
        await testMapping(sourcemap!, compiledHtml, 'console');
      }
    });

    test('external map files are compiled correctly', async () => {
      const doc = await bundle(
          'external.html',
          {inlineScripts: true, sourcemaps: true, analyzer: analyzer});
      assert(doc);
      const compiledHtml = parse5.serialize(doc);
      const inlineScripts = dom5.queryAll(doc, matchers.inlineJavascript);
      assert.equal(inlineScripts.length, 2);

      for (let i = 0; i < inlineScripts.length; i++) {
        const sourcemap = await getExistingSourcemap(
            analyzer, 'external.html', dom5.getTextContent(inlineScripts[i]));

        assert(sourcemap, 'scripts found');
        await testMapping(sourcemap!, compiledHtml, 'console');
      }
    });

    test('mix of inline and external maps are compiled correctly', async () => {
      const doc = await bundle(
          'combined.html',
          {inlineScripts: true, sourcemaps: true, analyzer: analyzer});
      assert(doc);
      const compiledHtml = parse5.serialize(doc);
      const inlineScripts = dom5.queryAll(doc, matchers.inlineJavascript);
      assert.equal(inlineScripts.length, 6);

      for (let i = 0; i < inlineScripts.length; i++) {
        const sourcemap = await getExistingSourcemap(
            analyzer, 'combined.html', dom5.getTextContent(inlineScripts[i]));

        assert(sourcemap, 'scripts found');
        await testMapping(sourcemap!, compiledHtml, 'console');
      }
    });

    test('invalid maps are compiled correctly', async () => {
      const doc = await bundle(
          'invalid.html',
          {inlineScripts: true, sourcemaps: true, analyzer: analyzer});
      assert(doc);
      const compiledHtml = parse5.serialize(doc);
      const inlineScripts = dom5.queryAll(doc, matchers.inlineJavascript);
      assert.equal(inlineScripts.length, 2);

      for (let i = 0; i < inlineScripts.length; i++) {
        const sourcemap = await getExistingSourcemap(
            analyzer, 'invalid.html', dom5.getTextContent(inlineScripts[i]));

        assert(sourcemap, 'scripts found');
        await testMapping(sourcemap!, compiledHtml, 'console');
      }
    });

    test('sourcesContent is generated for new sourcemaps', () => {
      const sourcemap = createJsIdentitySourcemap(
          'foo', 'console.log(\'Hello world\');', 0, 0);
      assert(sourcemap.sourcesContent, 'sourcesContent found');
      assert.lengthOf(sourcemap.sourcesContent!, 1, 'sourcesContent length');
      assert.equal(sourcemap.sourcesContent![0], 'console.log(\'Hello world\');',
        'sourcesContent value');
    });

    test('sourcesContent is preserved for existing sourcemaps', () => {
      const sourcemap = createJsIdentitySourcemap(
        'foo', 'console.log(\'Hello world\');', 0, 0);
      const offsetSourcemap = offsetSourceMap(
        sourcemap, 1, 0);
      assert(offsetSourcemap.sourcesContent, 'sourcesContent found');
      assert.lengthOf(offsetSourcemap.sourcesContent!, 1, 'sourcesContent length');
      assert.equal(offsetSourcemap.sourcesContent![0], 'console.log(\'Hello world\');',
        'sourcesContent value');
    });
  });
});
