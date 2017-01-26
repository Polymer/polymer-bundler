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

import {Bundler} from '../bundler';
import {Options as BundlerOptions} from '../bundler';
import constants from '../constants';
import * as importUtils from '../import-utils';

chai.config.showDiff = true;

const assert = chai.assert;
const matchers = require('../matchers');
const preds = dom5.predicates;

suite('import-utils', () => {
  suite('Path rewriting', () => {
    const importDocPath = '/foo/bar/my-element/index.html';
    const mainDocPath = '/foo/bar/index.html';

    test('Rewrite URLs', () => {
      const css = [
        'x-element {',
        '  background-image: url(foo.jpg);',
        '}',
        'x-bar {',
        '  background-image: url(data:xxxxx);',
        '}',
        'x-quuz {',
        '  background-image: url(\'https://foo.bar/baz.jpg\');',
        '}'
      ].join('\n');

      const expected = [
        'x-element {',
        '  background-image: url("my-element/foo.jpg");',
        '}',
        'x-bar {',
        '  background-image: url("data:xxxxx");',
        '}',
        'x-quuz {',
        '  background-image: url("https://foo.bar/baz.jpg");',
        '}'
      ].join('\n');

      const actual = importUtils.rewriteImportedStyleTextUrls(
          undefined, importDocPath, mainDocPath, css);
      assert.equal(actual, expected);
    });

    test('Resolve Paths', () => {
      const html = [
        '<link rel="import" href="../polymer/polymer.html">',
        '<link rel="stylesheet" href="my-element.css">',
        '<dom-module id="my-element">',
        '<template>',
        '<style>:host { background-image: url(background.svg); }</style>',
        '<div style="position: absolute;"></div>',
        '</template>',
        '</dom-module>',
        '<script>Polymer({is: "my-element"})</script>'
      ].join('\n');

      const expected = [
        '<html><head><link rel="import" href="polymer/polymer.html">',
        '<link rel="stylesheet" href="my-element/my-element.css">',
        '</head><body><dom-module id="my-element" assetpath="my-element/">',
        '<template>',
        '<style>:host { background-image: url("my-element/background.svg"); }</style>',
        '<div style="position: absolute;"></div>',
        '</template>',
        '</dom-module>',
        '<script>Polymer({is: "my-element"})</script></body></html>'
      ].join('\n');

      const ast = parse5.parse(html);
      importUtils.rewriteImportedUrls(
          undefined, ast, importDocPath, mainDocPath);

      const actual = parse5.serialize(ast);
      assert.equal(actual, expected, 'relative');
    });

    test.skip('Resolve Paths with <base>', () => {
      const htmlBase = [
        '<base href="zork">',
        '<link rel="import" href="../polymer/polymer.html">',
        '<link rel="stylesheet" href="my-element.css">',
        '<dom-module id="my-element">',
        '<template>',
        '<style>:host { background-image: url(background.svg); }</style>',
        '</template>',
        '</dom-module>',
        '<script>Polymer({is: "my-element"})</script>'
      ].join('\n');

      const expectedBase = [
        '<html><head>',
        '<link rel="import" href="my-element/polymer/polymer.html">',
        '<link rel="stylesheet" href="my-element/zork/my-element.css">',
        '</head><body><dom-module id="my-element" assetpath="my-element/zork/">',
        '<template>',
        '<style>:host { background-image: url("my-element/zork/background.svg"); }</style>',
        '</template>',
        '</dom-module>',
        '<script>Polymer({is: "my-element"})</script></body></html>'
      ].join('\n');

      const ast = parse5.parse(htmlBase);
      // pathRewriter.acid(ast, inputPath);
      importUtils.rewriteImportedUrls(
          undefined, ast, importDocPath, mainDocPath);

      const actual = parse5.serialize(ast);
      assert.equal(actual, expectedBase, 'base');
    });

    test.skip('Resolve Paths with <base> having a trailing /', () => {
      const htmlBase = [
        '<base href="zork/">',
        '<link rel="import" href="../polymer/polymer.html">',
        '<link rel="stylesheet" href="my-element.css">',
        '<dom-module id="my-element">',
        '<template>',
        '<style>:host { background-image: url(background.svg); }</style>',
        '</template>',
        '</dom-module>',
        '<script>Polymer({is: "my-element"})</script>'
      ].join('\n');

      const expectedBase = [
        `<html><head>
        <link rel="import" href="my-element/polymer/polymer.html">
        <link rel="stylesheet" href="my-element/zork/my-element.css">
        </head><body><dom-module id="my-element" assetpath="my-element/zork/">
        <template>
        <style>:host { background-image: url("my-element/zork/background.svg"); }</style>
        </template>
        </dom-module>
        <script>Polymer({is: "my-element"})</script></body></html>`
      ].join('\n');

      const ast = parse5.parse(htmlBase);
      // pathRewriter.acid(ast, inputPath);
      importUtils.rewriteImportedUrls(
          undefined, ast, importDocPath, mainDocPath);

      const actual = parse5.serialize(ast);
      assert.equal(actual, expectedBase, 'base');
    });

    test.skip('Resolve <base target>', () => {
      const htmlBase =
          ['<base target="_blank">', '<a href="foo.html">LINK</a>'].join('\n');

      const expectedBase = [
        '<html><head>',
        '</head><body><a href="my-element/foo.html" target="_blank">LINK</a></body></html>'
      ].join('\n');

      const ast = parse5.parse(htmlBase);
      importUtils.rewriteImportedUrls(
          undefined, ast, importDocPath, mainDocPath);

      const actual = parse5.serialize(ast);
      assert.equal(actual, expectedBase, 'base target');
    });

    test('Leave Templated URLs', () => {
      const base = [
        '<html><head></head><body>',
        '<a href="{{foo}}"></a>',
        '<img src="[[bar]]">',
        '</body></html>'
      ].join('\n');

      const ast = parse5.parse(base);
      importUtils.rewriteImportedUrls(
          undefined, ast, importDocPath, mainDocPath);

      const actual = parse5.serialize(ast);
      assert.equal(actual, base, 'templated urls');
    });
  });
});
