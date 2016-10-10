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
import Bundler from '../bundler';
import {Options as BundlerOptions} from '../bundler';
import constants from '../constants';

chai.config.showDiff = true;

const assert = chai.assert;
const matchers = require('../matchers');
const preds = dom5.predicates;

suite('Bundler', () => {
  let bundler: Bundler;
  const inputPath = 'test/html/default.html';

  let doc: parse5.ASTNode;

  function bundle(
      inputPath: string, opts?: BundlerOptions): Promise<parse5.ASTNode> {
    const bundlerOpts = opts || {};
    if (!bundlerOpts.analyzer) {
      bundlerOpts.analyzer = new Analyzer({urlLoader: new FSUrlLoader()});
    }
    bundler = new Bundler(bundlerOpts);
    return bundler.bundle([inputPath])
        .then((documents) => documents.get(inputPath));
  }

  suite('Default Options', () => {
    test('imports removed', () => {
      const imports = preds.AND(
          preds.hasTagName('link'),
          preds.hasAttrValue('rel', 'import'),
          preds.hasAttr('href'),
          preds.NOT(preds.hasAttrValue('type', 'css')));
      return bundle(inputPath).then((doc) => {
        assert.equal(dom5.queryAll(doc, imports).length, 0);
      });
    });

    test('imports were deduplicated', () => {
      return bundle(inputPath).then((doc) => {
        assert.equal(
            dom5.queryAll(doc, preds.hasTagName('dom-module')).length, 1);
      });
    });
  });

  test('svg is nested correctly', () => {
    return bundle(inputPath).then((doc) => {
      const svg = dom5.query(doc, preds.hasTagName('template'))!['content']
                      .childNodes[1];
      assert.equal(svg.childNodes!.filter(dom5.isElement).length, 6);
    });
  });

  test('import bodies are in one hidden div', () => {
    return bundle(inputPath).then((doc) => {
      assert.equal(dom5.queryAll(doc, matchers.hiddenDiv).length, 1);
    });
  });

  test('dom-modules have assetpath', () => {
    const assetpath = preds.AND(
        preds.hasTagName('dom-module'),
        preds.hasAttrValue('assetpath', 'imports/'));
    return bundle(inputPath).then((doc) => {
      assert.ok(dom5.query(doc, assetpath), 'assetpath set');
    });
  });

  test('output file is forced utf-8', () => {
    const meta = preds.AND(
        preds.hasTagName('meta'), preds.hasAttrValue('charset', 'UTF-8'));
    return bundle(inputPath).then((doc) => {
      assert.ok(dom5.query(doc, meta));
    });
  });

  test.skip('Handle <base> tag', () => {
    const span = preds.AND(
        preds.hasTagName('span'), preds.hasAttrValue('href', 'imports/hello'));
    const a = preds.AND(
        preds.hasTagName('a'),
        preds.hasAttrValue('href', 'imports/sub-base/sub-base.html'));
    return bundle('html/base.html').then((doc) => {
      const spanHref = dom5.query(doc, span);
      assert.ok(spanHref);
      const anchorRef = dom5.query(doc, a);
      assert.ok(anchorRef);
    });
  });

  test('Imports in <body> are handled correctly', () => {
    const importMatcher = preds.AND(
        preds.hasTagName('link'), preds.hasAttrValue('rel', 'import'));

    const bodyContainerMatcher = preds.AND(
        preds.hasTagName('div'),
        preds.hasAttr('hidden'),
        preds.hasAttr('by-vulcanize'));

    const scriptExpected = preds.hasTagName('script');
    const divExpected = preds.AND(
        preds.hasTagName('div'), preds.hasAttrValue('id', 'imported'));

    return bundle('test/html/import-in-body.html').then(function(doc) {
      const imports = dom5.queryAll(doc, importMatcher);
      assert.equal(imports.length, 0);
      const bodyContainer = dom5.query(doc, bodyContainerMatcher);
      const scriptActual = dom5.query(doc, scriptExpected)!.parentNode;
      const divActual = dom5.query(doc, divExpected)!.parentNode;
      assert.equal(bodyContainer, scriptActual);
      assert.equal(bodyContainer, divActual);
    });
  });

  test('Scripts are not inlined by default', () => {
    const externalJS = matchers.externalJavascript;

    return bundle('test/html/external.html').then((doc) => {
      const scripts = dom5.queryAll(doc, externalJS);
      assert.isAbove(scripts.length, 0, 'scripts were inlined');
      scripts.forEach(function(s) {
        assert.equal(dom5.getTextContent(s), '', 'script src should be empty');
      });
    });
  });

  test('Old Polymer is detected and warns', () => {

    return bundle('test/html/old-polymer.html')
        .then((doc) => {
          throw new Error('should have thrown');
        })
        .catch((err) => {
          assert.equal(
              err.message.toLowerCase(),
              (constants.OLD_POLYMER + ' File: test/html/old-polymer.html')
                  .toLowerCase());
        });
  });

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

      const bundler = new Bundler();
      const actual =
          bundler.rewriteImportedStyleTextUrls(importDocPath, mainDocPath, css);
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
      const bundler = new Bundler();
      bundler.rewriteImportedUrls(ast, importDocPath, mainDocPath);

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
      const bundler = new Bundler();
      bundler.rewriteImportedUrls(ast, importDocPath, mainDocPath);

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
      const bundler = new Bundler();
      bundler.rewriteImportedUrls(ast, importDocPath, mainDocPath);

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
      // pathRewriter.acid(ast, inputPath);
      const bundler = new Bundler();
      bundler.rewriteImportedUrls(ast, importDocPath, mainDocPath);

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
      const bundler = new Bundler();
      bundler.rewriteImportedUrls(ast, importDocPath, mainDocPath);

      const actual = parse5.serialize(ast);
      assert.equal(actual, base, 'templated urls');
    });
  });

  test('Paths for import bodies are resolved correctly', () => {
    const anchorMatcher = preds.hasTagName('a');
    const input = 'test/html/multiple-imports.html';
    return bundle(input).then((doc) => {
      const anchor = dom5.query(doc, anchorMatcher)!;
      const href = dom5.getAttribute(anchor, 'href');
      assert.equal(href, 'imports/target.html');
    });
  });

  test('Spaces in paths are handled correctly', () => {
    const input = 'test/html/spaces.html';
    const spacesMatcher = preds.AND(
        preds.hasTagName('dom-module'),
        preds.hasAttrValue('id', 'space-element'));
    return bundle(input).then((doc) => {
      const module = dom5.query(doc, spacesMatcher);
      assert.ok(module);
    });
  });

  suite('Script Ordering', () => {
    test('Imports and scripts are ordered correctly', () => {
      return bundle('test/html/order-test.html').then((doc) => {
        const expectedOrder = [
          'first-script',
          'second-import-first-script',
          'second-import-second-script',
          'first-import-first-script',
          'first-import-second-script',
          'second-script',
          'third-script'
        ];

        const expectedSrc = [
          'order/first-script.js',
          'order/second-import/first-script.js',
          'order/second-import/second-script.js',
          'order/first-import/first-script.js',
          'order/first-import/second-script.js',
          'order/second-script.js',
          'order/third-script.js'
        ];

        const scriptMatcher = preds.hasTagName('script');
        const scripts = dom5.queryAll(doc, scriptMatcher);
        const actualOrder: Array<string> = [], actualSrc: Array<string> = [];
        scripts.forEach(function(s) {
          actualOrder.push(dom5.getAttribute(s, 'id')!);
          actualSrc.push(dom5.getAttribute(s, 'src')!);
        });
        assert.deepEqual(
            actualOrder, expectedOrder, 'order is not as expected');
        assert.deepEqual(
            actualSrc, expectedSrc, 'srcs are not preserved correctly');
      });
    });

    test('exhaustive script order testing', () => {
      return bundle('test/html/scriptorder/index.html', {inlineScripts: true})
          .then((doc) => {
            assert(doc);
            const serialized = parse5.serialize(doc);
            const beforeLoc = serialized.indexOf('window.BeforeJs');
            const afterLoc = serialized.indexOf('BeforeJs.value');
            assert.isBelow(beforeLoc, afterLoc);
          });
    });

    test('Paths are correct when maintaining order', () => {
      return bundle('test/html/recursion/import.html').then((doc) => {
        assert(doc);
        const scripts = dom5.queryAll(
            doc, preds.AND(preds.hasTagName('script'), preds.hasAttr('src')));
        scripts.forEach(function(s) {
          const src = dom5.getAttribute(s, 'src')!;
          assert.equal(
              src.indexOf('../order'), 0, 'path should start with ../order');
        });
      });
    });
  });

  suite('Absolute Paths', () => {
    test('Output with Absolute paths with basePath', () => {
      const root = path.resolve(inputPath, '../..');
      const target = '/html/default.html';
      const analyzer = new Analyzer({urlLoader: new FSUrlLoader(root)});
      const options = {basePath: '/html/', analyzer: analyzer};
      const domModule = preds.AND(
          preds.hasTagName('dom-module'),
          preds.hasAttrValue('assetpath', '/html/imports/'));
      const stylesheet = preds.AND(
          preds.hasTagName('link'),
          preds.hasAttrValue('rel', 'import'),
          preds.hasAttrValue('type', 'css'),
          preds.hasAttrValue('href', '/html/imports/simple-style.css'));
      return bundle(target, options).then((doc) => {
        assert.ok(dom5.query(doc, domModule));
        assert.ok(dom5.query(doc, stylesheet));
      });
    });
  });

  suite('Redirect', () => {
    test('Redirected paths load properly', () => {
      const options = {
        redirects:
            ['chrome://imports/|test/html/imports/', 'biz://cool/|test/html']
      };
      return bundle('test/html/custom-protocol.html', options)
          .then((doc) => assert(doc));
    });

    // TODO(usergenic): Add tests here to demo common use case of alt domains.
  });

  suite('Excludes', () => {

    const htmlImport = preds.AND(
        preds.hasTagName('link'), preds.hasAttrValue('rel', 'import'));

    const excluded = preds.AND(
        preds.hasTagName('link'),
        preds.hasAttrValue('rel', 'import'),
        preds.hasAttrValue('href', 'imports/simple-import.html'));

    const excludes = ['test/html/imports/simple-import.html'];

    test('Excluded imports are not inlined', () => {
      const options = {excludes: excludes};

      return bundle(inputPath, options).then((doc) => {
        const imports = dom5.queryAll(doc, excluded);
        assert.equal(imports.length, 1);
      });
    });

    const cssFromExclude = preds.AND(
        preds.hasTagName('link'),
        preds.hasAttrValue('rel', 'import'),
        preds.hasAttrValue('type', 'css'));

    // TODO(ajo): Fix test with hydrolysis upgrades.
    test.skip(
        'Excluded imports are not inlined when behind a redirected URL.',
        () => {
          const options = {
            // TODO(usergenic): use non-redirected form of URL (?)
            excludes: ['test/html/imports/simple-import.html'],
            redirects: ['red://herring/at|test/html/imports']
          };
          return bundle(
                     path.resolve('test/html/custom-protocol-excluded.html'),
                     options)
              .then((doc) => {
                const imports = dom5.queryAll(doc, htmlImport);
                assert.equal(imports.length, 2);
                const badCss = dom5.queryAll(doc, cssFromExclude);
                assert.equal(badCss.length, 0);
              });
        });

    test('Excluded imports with "Strip Excludes" are removed', () => {
      const options = {stripExcludes: excludes};

      return bundle(inputPath, options).then((doc) => {
        const imports = dom5.queryAll(doc, excluded);
        assert.equal(imports.length, 0);
      });
    });

    test('Strip Excludes does not have to be exact', () => {
      const options = {stripExcludes: ['simple-import']};

      return bundle(inputPath, options).then((doc) => {
        const imports = dom5.queryAll(doc, excluded);
        assert.equal(imports.length, 0);
      });
    });

    test('Strip Excludes has more precedence than Excludes', () => {
      const options = {excludes: excludes, stripExcludes: excludes};

      return bundle(inputPath, options).then((doc) => {
        const imports = dom5.queryAll(doc, excluded);
        assert.equal(imports.length, 0);
      });
    });

    test('Excluded comments are removed', () => {
      const options = {stripComments: true};
      return bundle('test/html/comments.html', options).then((doc) => {
        const comments = dom5.nodeWalkAll(doc, dom5.isCommentNode);
        assert.equal(comments.length, 3);
        const commentsExpected =
            ['@license import 2', '@license import 1', '@license main'];
        const commentsActual = comments.map(function(c) {
          return dom5.getTextContent(c).trim();
        });
        assert.deepEqual(commentsExpected, commentsActual);
      });
    });

    test('Comments are kept by default', () => {
      const options = {stripComments: false};
      return bundle('test/html/comments.html', options).then((doc) => {
        const comments = dom5.nodeWalkAll(doc, dom5.isCommentNode);
        const expectedComments = [
          '@license main',
          '@license import 1',
          'comment in import 1',
          '@license import 2',
          'comment in import 2',
          'comment in main'
        ];
        const actualComments = comments.map(function(c) {
          return dom5.getTextContent(c).trim();
        });
        assert.deepEqual(expectedComments, actualComments);
      });
    });

    test('Folder can be excluded', () => {
      const linkMatcher = preds.hasTagName('link');
      const options = {excludes: ['test/html/imports/']};
      return bundle('test/html/default.html', options).then((doc) => {
        const links = dom5.queryAll(doc, linkMatcher);
        // one duplicate import is removed
        assert.equal(links.length, 2);
      });
    });
  });

  suite('Inline Scripts', () => {
    const options = {inlineScripts: true};

    test('All scripts are inlined', () => {
      return bundle('test/html/external.html', options).then((doc) => {
        const scripts = dom5.queryAll(doc, matchers.externalJavascript);
        assert.equal(scripts.length, 0);
      });
    });

    test('Remote scripts are kept', () => {
      return bundle('test/html/scripts.html', options).then((doc) => {
        const scripts = dom5.queryAll(doc, matchers.externalJavascript);
        assert.equal(scripts.length, 1);
        assert.equal(
            dom5.getAttribute(scripts[0], 'src'),
            'https://ajax.googleapis.com/ajax/libs/jquery/2.1.3/jquery.min.js');
      });
    });

    test.skip('Absolute paths are correct for excluded links', () => {
      const target = 'test/html/external.html';
      const options = {
        absPathPrefix: '/myapp/',
        inlineScripts: true,
        excludes: ['external/external.js']
      };
      return bundle(target, options).then((doc) => {
        const scripts = dom5.queryAll(doc, matchers.externalJavascript);
        assert.equal(scripts.length, 1);
        // TODO(usergenic): assert the src attribute is now
        // /myapp/external/external.js
        console.log(parse5.serialize(doc));
      });
    });

    test('Escape inline <script>', () => {
      return bundle('test/html/xss.html', options).then((doc) => {
        const script = dom5.query(doc, matchers.inlineJavascript)!;
        assert.include(
            dom5.getTextContent(script),
            'var b = 0<\\/script><script>alert(\'XSS\'); //2;',
            'Inline <script> should be escaped');
      });
    });

    test('Inlined Scripts are in the expected order', () => {
      return bundle('test/html/reordered/in.html', options).then((doc) => {
        const scripts = dom5.queryAll(doc, matchers.inlineJavascript)!;
        const contents = scripts.map(function(script) {
          return dom5.getTextContent(script);
        });
        assert.deepEqual(['"First"', '"Second"'], contents);
      });
    });

    test('Firebase works inlined', () => {
      return bundle('test/html/firebase.html', options).then((doc) => {
        const scripts = dom5.queryAll(doc, matchers.inlineJavascript)!;
        assert.equal(scripts.length, 1);
        const idx = dom5.getTextContent(scripts[0]).indexOf('</script>');
        assert(idx === -1, '/script found, should be escaped');
      });
    });
  });

  suite('Inline CSS', () => {
    const options = {inlineCss: true};

    test('All styles are inlined', () => {
      return bundle(inputPath, options).then((doc) => {
        const links = dom5.queryAll(doc, matchers.stylesheetImport);
        const styles = dom5.queryAll(doc, matchers.styleMatcher);
        assert.equal(links.length, 0);
        assert.equal(styles.length, 2);
      });
    });

    test('Inlined styles have proper paths', () => {
      return bundle('test/html/inline-styles.html', options).then((doc) => {
        const styles = dom5.queryAll(doc, matchers.styleMatcher);
        assert.equal(styles.length, 2);
        const content = dom5.getTextContent(styles[1]);
        assert(content.search('imports/foo.jpg') > -1, 'path adjusted');
        assert(content.search('@apply') > -1, '@apply kept');
      });
    });

    test(
        'Remote Scripts and Stylesheets are not removed and media queries are retained',
        () => {
          const input = 'test/html/imports/remote-stylesheet.html';
          return bundle(input, options).then((doc) => {
            const links = dom5.queryAll(doc, matchers.externalStyle);
            assert.equal(links.length, 1);
            const styles = dom5.queryAll(doc, matchers.styleMatcher);
            assert.equal(styles.length, 1);
            assert.equal(
                dom5.getAttribute(styles[0], 'media'), '(min-width: 800px)');
          });
        });

    test.skip('Absolute paths are correct', () => {
      const root = path.resolve(inputPath, '../..');
      const options = {absPathPrefix: root, inlineCss: true};
      return bundle('/test/html/default.html', options).then((doc) => {
        const links = dom5.queryAll(doc, matchers.ALL_CSS_LINK);
        assert.equal(links.length, 0);
      });
    });

    test('Inlined Polymer styles are moved into the <template>', () => {
      return bundle('test/html/default.html', options).then((doc) => {
        const domModule =
            dom5.query(doc, dom5.predicates.hasTagName('dom-module'))!;
        assert(domModule);
        const template =
            dom5.query(domModule, dom5.predicates.hasTagName('template'))!;
        assert(template);
        const style =
            dom5.queryAll(template.childNodes![0]!, matchers.styleMatcher);
        assert.equal(style.length, 1);
      });
    });

    test(
        'Inlined Polymer styles will force a dom-module to have a template',
        () => {
          return bundle('test/html/inline-styles.html', options).then((doc) => {
            const domModule =
                dom5.query(doc, dom5.predicates.hasTagName('dom-module'))!;
            assert(domModule);
            const template =
                dom5.query(domModule, dom5.predicates.hasTagName('template'))!;
            assert(template);
            const style =
                dom5.query(template.childNodes![0]!, matchers.styleMatcher);
            assert(style);
          });
        });
  });

  suite.skip('Add import', () => {
    const options = {addedImports: ['imports/comment-in-import.html']};
    test('added import is added to vulcanized doc', () => {
      return bundle('test/html/default.html', options).then((doc) => {
        assert(doc);
        const hasAddedImport =
            preds.hasAttrValue('href', 'imports/comment-in-import.html');
        assert.equal(dom5.queryAll(doc, hasAddedImport).length, 1);
      });
    });
  });

  // TODO(usergenic): These tests only prove that the `inputUrl` has precedence
  // over the filename presented to `bundle(path)`.  Do we want to continue to
  // support inputUrl?  Tese don't prove anything about the doc production
  // itself or how it is effected.  Needs resolution.
  suite('Input URL', () => {
    const options = {inputUrl: 'test/html/default.html'};

    test.skip('inputURL is used instead of argument to process', () => {
      return bundle('flibflabfloom!', options).then((doc) => {
        assert(doc);
      });
    });

    test.skip('gulp-vulcanize invocation with absPathPrefix', () => {
      const options = {
        abspath: path.resolve('test/html'),
        inputUrl: '/default.html'
      };

      return bundle(
                 'C:\\Users\\VulcanizeTester\\vulcanize\\test\\html\\default.html',
                 options)
          .then((doc) => assert(doc));
    });
  });

  suite('Regression Testing', () => {
    test('Complicated Ordering', () => {
      // refer to
      // https://github.com/Polymer/vulcanize/tree/master/test/html/complicated/ordering.svg
      // for visual reference on the document structure for this example
      return bundle('test/html/complicated/A.html', {inlineScripts: true})
          .then((doc) => {
            assert(doc);
            const expected = ['A1', 'C', 'E', 'B', 'D', 'A2'];
            const scripts = dom5.queryAll(doc, preds.hasTagName('script'));
            const contents = scripts.map(function(s) {
              return dom5.getTextContent(s).trim();
            });
            assert.deepEqual(contents, expected);
          });
    });

    test.skip('Imports in templates should not inline', () => {
      return bundle('test/html/inside-template.html').then((doc) => {
        const importMatcher = preds.AND(
            preds.hasTagName('link'),
            preds.hasAttrValue('rel', 'import'),
            preds.hasAttr('href'));
        const externalScriptMatcher = preds.AND(
            preds.hasTagName('script'),
            preds.hasAttrValue('src', 'external/external.js'));
        assert(doc);
        const imports = dom5.queryAll(doc, importMatcher);
        assert.equal(imports.length, 1, 'import in template was inlined');
        const unexpectedScript = dom5.query(doc, externalScriptMatcher);
        assert.equal(
            unexpectedScript,
            null,
            'script in external.html should not be present');
      });
    });
  });
});
