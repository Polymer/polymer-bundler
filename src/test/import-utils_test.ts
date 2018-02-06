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
import * as parse5 from 'parse5';
import {Analyzer, FSUrlLoader} from 'polymer-analyzer';

const rewire = require('rewire');
const astUtils = require('../ast-utils');
const importUtils = rewire('../import-utils');

chai.config.showDiff = true;

const assert = chai.assert;
const analyzer = new Analyzer({urlLoader: new FSUrlLoader()});
const stripSpace = (html: string): string =>
    html.replace(/>\s+/g, '>').replace(/>/g, '>\n').trim();

suite('import-utils', () => {
  suite('Path rewriting', () => {
    const importDocPath = '/foo/bar/my-element/index.html';
    const mainDocPath = '/foo/bar/index.html';

    test('Rewrite URLs', () => {
      const css = `
        x-element {
          background-image: url(foo.jpg);
        }
        x-bar {
          background-image: url(data:xxxxx);
        }
        x-quuz {
          background-image: url(\'https://foo.bar/baz.jpg\');
        }
      `;

      const expected = `
        x-element {
          background-image: url("my-element/foo.jpg");
        }
        x-bar {
          background-image: url("data:xxxxx");
        }
        x-quuz {
          background-image: url("https://foo.bar/baz.jpg");
        }
      `;

      const rewriteCssTextBaseUrl =
          importUtils.__get__('rewriteCssTextBaseUrl');
      const actual = rewriteCssTextBaseUrl(css, importDocPath, mainDocPath);
      assert.deepEqual(actual, expected);
    });

    suite('Resolve Paths', () => {

      test('excluding template elements', () => {
        const html = `
          <link rel="import" href="../polymer/polymer.html">
          <link rel="stylesheet" href="my-element.css">
          <dom-module id="my-element">
          <template>
          <img src="neato.gif">
          <style>:host { background-image: url(background.svg); }</style>
          <div style="background-image: url(background.svg)"></div>
          </template>
          <script>Polymer({is: "my-element"})</script>
          </dom-module>
          <template is="dom-bind">
          <style>.outside-dom-module { background-image: url(outside-dom-module.png); }</style>
          </template>
          <style>.outside-template { background-image: url(outside-template.png); }</style>
        `;

        const expected = `
          <link rel="import" href="polymer/polymer.html">
          <link rel="stylesheet" href="my-element/my-element.css">
          <dom-module id="my-element" assetpath="my-element/">
          <template>
          <img src="neato.gif">
          <style>:host { background-image: url(background.svg); }</style>
          <div style="background-image: url(background.svg)"></div>
          </template>
          <script>Polymer({is: "my-element"})</script>
          </dom-module>
          <template is="dom-bind">
          <style>.outside-dom-module { background-image: url(outside-dom-module.png); }</style>
          </template>
          <style>.outside-template { background-image: url("my-element/outside-template.png"); }</style>
        `;

        const ast = astUtils.parse(html);
        importUtils.rewriteAstBaseUrl(
            analyzer, ast, importDocPath, mainDocPath);

        const actual = parse5.serialize(ast);
        assert.deepEqual(stripSpace(actual), stripSpace(expected), 'relative');
      });

      test('including template elements (rewriteUrlsInTemplates=true)', () => {
        const html = `
          <link rel="import" href="../polymer/polymer.html">
          <link rel="stylesheet" href="my-element.css">
          <dom-module id="my-element">
          <template>
          <style>:host { background-image: url(background.svg); }</style>
          <div style="background-image: url(background.svg)"></div>
          </template>
          <script>Polymer({is: "my-element"})</script>
          </dom-module>
          <template is="dom-bind">
          <style>.something { background-image: url(something.png); }</style>
          </template>
          <style>.outside-template { background-image: url(outside-template.png); }</style>
        `;

        const expected = `
          <link rel="import" href="polymer/polymer.html">
          <link rel="stylesheet" href="my-element/my-element.css">
          <dom-module id="my-element" assetpath="my-element/">
          <template>
          <style>:host { background-image: url("my-element/background.svg"); }</style>
          <div style="background-image: url(&quot;my-element/background.svg&quot;)"></div>
          </template>
          <script>Polymer({is: "my-element"})</script>
          </dom-module>
          <template is="dom-bind">
          <style>.something { background-image: url("my-element/something.png"); }</style>
          </template>
          <style>.outside-template { background-image: url("my-element/outside-template.png"); }</style>
        `;

        const ast = astUtils.parse(html);
        importUtils.rewriteAstBaseUrl(
            analyzer, ast, importDocPath, mainDocPath, true);

        const actual = parse5.serialize(ast);
        assert.deepEqual(stripSpace(actual), stripSpace(expected), 'relative');
      });
    });

    test('Leave Templated URLs', () => {
      const base = `
        <a href="{{foo}}"></a>
        <img src="[[bar]]">
      `;

      const ast = astUtils.parse(base);
      importUtils.rewriteAstBaseUrl(analyzer, ast, importDocPath, mainDocPath);

      const actual = parse5.serialize(ast);
      assert.deepEqual(stripSpace(actual), stripSpace(base), 'templated urls');
    });
  });

  suite('Document <base> tag emulation', () => {

    // The trailing slash is meaningful.
    test('Resolve Paths with <base href> having a trailing /', () => {
      const htmlBase = `
        <base href="components/my-element/">
        <link rel="import" href="../polymer/polymer.html">
        <link rel="stylesheet" href="my-element.css">
        <dom-module id="my-element">
        <template>
        <style>:host { background-image: url(background.svg); }</style>
        <img src="bloop.gif">
        </template>
        </dom-module>
        <script>Polymer({is: "my-element"})</script>`;

      const expectedBase = `
        <link rel="import" href="components/polymer/polymer.html">
        <link rel="stylesheet" href="components/my-element/my-element.css">
        <dom-module id="my-element" assetpath="components/my-element/">
        <template>
        <style>:host { background-image: url(background.svg); }</style>
        <img src="bloop.gif">
        </template>
        </dom-module>
        <script>Polymer({is: "my-element"})</script>`;

      const ast = astUtils.parse(htmlBase);
      importUtils.rewriteAstToEmulateBaseTag(analyzer, ast, 'the/doc/url');

      const actual = parse5.serialize(ast);
      assert.deepEqual(stripSpace(actual), stripSpace(expectedBase), 'base');
    });

    // Old vulcanize did the wrong thing with base href that had no trailing
    // slash, so this proves the behavior of bundler is correct in this case.
    test('Resolve Paths with <base href> with no trailing slash', () => {
      const htmlBase = `
        <base href="components/my-element">
        <link rel="import" href="../polymer/polymer.html">
        <link rel="stylesheet" href="my-element.css">
        <dom-module id="my-element">
        <template>
        <style>:host { background-image: url(background.svg); }</style>
        <img src="bloop.gif">
        </template>
        </dom-module>
        <script>Polymer({is: "my-element"})</script>
      `;

      const expectedBase = `
        <link rel="import" href="polymer/polymer.html">
        <link rel="stylesheet" href="components/my-element.css">
        <dom-module id="my-element" assetpath="components/">
        <template>
        <style>:host { background-image: url(background.svg); }</style>
        <img src="bloop.gif">
        </template>
        </dom-module>
        <script>Polymer({is: "my-element"})</script>
      `;

      const ast = astUtils.parse(htmlBase);
      importUtils.rewriteAstToEmulateBaseTag(analyzer, ast, 'the/doc/url');

      const actual = parse5.serialize(ast);
      assert.deepEqual(stripSpace(actual), stripSpace(expectedBase), 'base');
    });

    test('Apply <base target> to all links and forms without target', () => {
      const htmlBase = `
        <base target="_blank">
        <a href="foo.html">LINK</a>
        <a href="bar.html" target="leavemealone">OTHERLINK</a>
        <form action="doit"></form>
        <form action="doitagain" target="leavemealone"></form>
        <div>Just a div.  I don't need a target</div>
      `;

      const expectedBase = `
        <a href="foo.html" target="_blank">LINK</a>
        <a href="bar.html" target="leavemealone">OTHERLINK</a>
        <form action="doit" target="_blank"></form>
        <form action="doitagain" target="leavemealone"></form>
        <div>Just a div.  I don't need a target</div>
      `;

      const ast = astUtils.parse(htmlBase);
      importUtils.rewriteAstToEmulateBaseTag(analyzer, ast, 'the/doc/url');

      const actual = parse5.serialize(ast);
      assert.deepEqual(
          stripSpace(actual), stripSpace(expectedBase), 'base target');
    });
  });
});
