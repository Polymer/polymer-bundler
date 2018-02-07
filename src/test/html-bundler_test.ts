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

import {AssignedBundle, BundleManifest} from '../bundle-manifest';
import {Bundler} from '../bundler';
import {HtmlBundler} from '../html-bundler';

import {parse} from '../parse5-utils';
import {getFileUrl} from '../url-utils';

chai.config.showDiff = true;

const assert = chai.assert;
const stripSpace = (html: string): string =>
    html.replace(/>\s+/g, '>').replace(/>/g, '>\n').trim();

suite('HtmlBundler', () => {

  const importDocUrl = getFileUrl('foo/bar/my-element/index.html');
  const mainDocUrl = getFileUrl('foo/bar/index.html');

  let bundler: Bundler;
  let htmlBundler: HtmlBundler;
  let manifest: BundleManifest;
  let bundle: AssignedBundle;

  beforeEach(async () => {
    bundler = new Bundler();
    await bundler.analyzeContents(mainDocUrl, '');
    manifest = await bundler.generateManifest([mainDocUrl]);
    bundle = manifest.getBundleForFile(mainDocUrl)!;
    htmlBundler = new HtmlBundler(bundler, bundle, manifest);
  });

  suite('Path rewriting', async () => {

    test('Rewrite URLs', async () => {

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

      const actual =
          htmlBundler['_rewriteCssTextBaseUrl'](css, importDocUrl, mainDocUrl);
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

        const ast = parse(html);
        bundler.rewriteUrlsInTemplates = false;
        htmlBundler['_rewriteAstBaseUrl'](ast, importDocUrl, mainDocUrl);

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

        const ast = parse(html);
        bundler.rewriteUrlsInTemplates = true;
        htmlBundler['_rewriteAstBaseUrl'](ast, importDocUrl, mainDocUrl);

        const actual = parse5.serialize(ast);
        assert.deepEqual(stripSpace(actual), stripSpace(expected), 'relative');
      });
    });

    test('Leave Templated URLs', () => {
      const base = `
        <a href="{{foo}}"></a>
        <img src="[[bar]]">
      `;

      const ast = parse(base);
      htmlBundler['_rewriteAstBaseUrl'](ast, importDocUrl, mainDocUrl);

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

      const ast = parse(htmlBase);
      htmlBundler['_rewriteAstToEmulateBaseTag'](
          ast, getFileUrl('the/doc/url'));

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

      const ast = parse(htmlBase);
      htmlBundler['_rewriteAstToEmulateBaseTag'](
          ast, getFileUrl('the/doc/url'));

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

      const ast = parse(htmlBase);
      htmlBundler['_rewriteAstToEmulateBaseTag'](
          ast, getFileUrl('the/doc/url'));

      const actual = parse5.serialize(ast);
      assert.deepEqual(
          stripSpace(actual), stripSpace(expectedBase), 'base target');
    });
  });
});
