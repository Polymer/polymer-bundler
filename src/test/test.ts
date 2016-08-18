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

import PathResolver from '../pathresolver';
import constants from '../constants';
import Bundler from '../bundler';

function parse(text) {
  return dom5.parse(text);
}
function serialize(ast) {
  return dom5.serialize(ast);
}

chai.config.showDiff = true;

const assert = chai.assert;

suite('constants', function() {

  suite('URLs', function() {

    test('absolute urls', function() {
      const abs = constants.ABS_URL;

      assert(abs.test('data:charset=utf8,'), 'data urls');
      assert(abs.test('http://foo.com'), 'http');
      assert(abs.test('https://foo.com'), 'https');
      assert(abs.test('mailto:foo@bar.com'), 'mailto');
      assert(abs.test('tel:+49123123456'), 'phonecall');
      // jshint -W107
      assert(abs.test('javascript:;'), 'javascript');
      // jshint +W107
      assert(abs.test('sms:1-123-123456'), 'sms');
      assert(abs.test('chrome-search:'), 'chrome search');
      assert(abs.test('about:blank'), 'about');
      assert(abs.test('wss://'), 'web socket');
      assert(abs.test('b2:'), 'custom protocol');
      assert(abs.test('//foo.com'), 'protocol-free');
      assert(abs.test('/components/'), '/');
      assert(abs.test('#foo'), 'hash url');
      assert(!abs.test('../foo/bar.html'), '../');
      assert(!abs.test('bar.html'), 'sibling dependency');
    });

    test('CSS URLs', function() {
      const url = constants.URL;

      assert('url(foo.html)'.match(url), 'naked');
      assert('url(\'foo.html\')'.match(url), 'single quote');
      assert('url("foo.html")'.match(url), 'double quote');
    });

    test('Template URLs', function() {
      const tmpl = constants.URL_TEMPLATE;

      assert('foo{{bar}}'.match(tmpl), 'curly postfix');
      assert('{{foo}}bar'.match(tmpl), 'curly prefix');
      assert('foo{{bar}}baz'.match(tmpl), 'curly infix');
      assert('{{}}'.match(tmpl), 'empty curly');
      assert('foo[[bar]]'.match(tmpl), 'square postfix');
      assert('[[foo]]bar'.match(tmpl), 'square prefix');
      assert('foo[[bar]]baz'.match(tmpl), 'square infix');
      assert('[[]]'.match(tmpl), 'empty square');
    });
  });
});

suite('Path Resolver', function() {
  let pathresolver;
  const inputPath = '/foo/bar/my-element/index.html';
  const outputPath = '/foo/bar/index.html';

  setup(function() {
    pathresolver = new PathResolver();
  });


  test('Rewrite URLs', function() {
    const css = [
      'x-element {', '  background-image: url(foo.jpg);', '}', 'x-bar {',
      '  background-image: url(data:xxxxx);', '}', 'x-quuz {',
      '  background-image: url(\'https://foo.bar/baz.jpg\');', '}'
    ].join('\n');

    const expected = [
      'x-element {', '  background-image: url("my-element/foo.jpg");', '}',
      'x-bar {', '  background-image: url("data:xxxxx");', '}', 'x-quuz {',
      '  background-image: url("https://foo.bar/baz.jpg");', '}'
    ].join('\n');

    const actual = pathresolver.rewriteURL(inputPath, outputPath, css);
    assert.equal(actual, expected);
  });

  function testPath(val, expected, msg) {
    const actual = pathresolver.rewriteRelPath(inputPath, outputPath, val);
    assert.equal(actual, expected, msg);
  }

  test('Rewrite Paths', function() {
    testPath('biz.jpg', 'my-element/biz.jpg', 'local');
    testPath('http://foo/biz.jpg', 'http://foo/biz.jpg', 'remote');
    testPath('#foo', '#foo', 'hash');
  });

  test('Rewrite Paths with absolute paths', function() {
    pathresolver = new PathResolver(true);
    testPath('biz.jpg', '/foo/bar/my-element/biz.jpg', 'local');
    testPath('http://foo/biz.jpg', 'http://foo/biz.jpg', 'local');
    testPath('#foo', '#foo', 'hash');
  });

  test('Resolve Paths', function() {
    const html = [
      '<link rel="import" href="../polymer/polymer.html">',
      '<link rel="stylesheet" href="my-element.css">',
      '<dom-module id="my-element">', '<template>',
      '<style>:host { background-image: url(background.svg); }</style>',
      '<div style="position: absolute;"></div>', '</template>', '</dom-module>',
      '<script>Polymer({is: "my-element"})</script>'
    ].join('\n');

    const expected = [
      '<html><head><link rel="import" href="polymer/polymer.html">',
      '<link rel="stylesheet" href="my-element/my-element.css">',
      '</head><body><dom-module id="my-element" assetpath="my-element/">',
      '<template>',
      '<style>:host { background-image: url("my-element/background.svg"); }</style>',
      '<div style="position: absolute;"></div>', '</template>', '</dom-module>',
      '<script>Polymer({is: "my-element"})</script></body></html>'
    ].join('\n');

    const ast = parse(html);
    pathresolver.resolvePaths(ast, inputPath, outputPath);

    const actual = serialize(ast);
    assert.equal(actual, expected, 'relative');
  });

  test.skip('Resolve Paths with <base>', function() {
    const htmlBase = [
      '<base href="zork">',
      '<link rel="import" href="../polymer/polymer.html">',
      '<link rel="stylesheet" href="my-element.css">',
      '<dom-module id="my-element">', '<template>',
      '<style>:host { background-image: url(background.svg); }</style>',
      '</template>', '</dom-module>',
      '<script>Polymer({is: "my-element"})</script>'
    ].join('\n');

    const expectedBase = [
      '<html><head>',
      '<link rel="import" href="my-element/polymer/polymer.html">',
      '<link rel="stylesheet" href="my-element/zork/my-element.css">',
      '</head><body><dom-module id="my-element" assetpath="my-element/zork/">',
      '<template>',
      '<style>:host { background-image: url("my-element/zork/background.svg"); }</style>',
      '</template>', '</dom-module>',
      '<script>Polymer({is: "my-element"})</script></body></html>'
    ].join('\n');

    const ast = parse(htmlBase);
    pathresolver.acid(ast, inputPath);
    pathresolver.resolvePaths(ast, inputPath, outputPath);

    const actual = serialize(ast);
    assert.equal(actual, expectedBase, 'base');
  });

  test.skip('Resolve Paths with <base> having a trailing /', function() {
    const htmlBase = [
      '<base href="zork/">',
      '<link rel="import" href="../polymer/polymer.html">',
      '<link rel="stylesheet" href="my-element.css">',
      '<dom-module id="my-element">', '<template>',
      '<style>:host { background-image: url(background.svg); }</style>',
      '</template>', '</dom-module>',
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

    const ast = parse(htmlBase);
    pathresolver.acid(ast, inputPath);
    pathresolver.resolvePaths(ast, inputPath, outputPath);

    const actual = serialize(ast);
    assert.equal(actual, expectedBase, 'base');
  });

  test.skip('Resolve <base target>', function() {
    const htmlBase =
        ['<base target="_blank">', '<a href="foo.html">LINK</a>'].join('\n');

    const expectedBase = [
      '<html><head>',
      '</head><body><a href="my-element/foo.html" target="_blank">LINK</a></body></html>'
    ].join('\n');

    const ast = parse(htmlBase);
    pathresolver.acid(ast, inputPath);
    pathresolver.resolvePaths(ast, inputPath, outputPath);

    const actual = serialize(ast);
    assert.equal(actual, expectedBase, 'base target');
  });

  test('Leave Templated Urls', function() {
    const base = [
      '<html><head></head><body>', '<a href="{{foo}}"></a>',
      '<img src="[[bar]]">', '</body></html>'
    ].join('\n');

    const ast = parse(base);
    pathresolver.resolvePaths(ast, inputPath, outputPath);

    const actual = serialize(ast);
    assert.equal(actual, base, 'templated urls');
  });

});

suite('Vulcan', function() {
  let bundler: Bundler;
  const inputPath = 'test/html/default.html';

  const preds = dom5.predicates;
  let doc;

  function process(inputPath, done?: Function, bundlerOptions?: any):
      Promise<parse5.ASTNode> {
    const opts = bundlerOptions || {};
    bundler = new Bundler(opts);
    let promise = bundler.bundle(inputPath);
    if (done) {
      let err, doc;
      promise = promise.then((document) => {
        doc = document;
      }).catch((error) => {
        err = error;
      }).then(() => done(err, doc));
    }
    return promise;
  }

  suite('Default Options', function() {
    test('imports removed', function(done) {
      const imports = preds.AND(
          preds.hasTagName('link'), preds.hasAttrValue('rel', 'import'),
          preds.hasAttr('href'), preds.NOT(preds.hasAttrValue('type', 'css')));
      process(inputPath)
          .then((doc) => {
            assert.equal(dom5.queryAll(doc, imports).length, 0);
            done();
          })
          .catch((error) => {
            done(error);
          });
    });

    test('imports were deduplicated', function(done) {
      process(inputPath)
          .then((doc) => {
            assert.equal(
                dom5.queryAll(doc, preds.hasTagName('dom-module')).length, 1);
            done();
          })
          .catch((error) => {
            done(error);
          });
    });

    test('svg is nested correctly', function(done) {
      process(inputPath, function(err, doc) {
        if (err) {
          return done(err);
        }
        const svg = dom5.query(doc, preds.hasTagName('svg'));
        assert.equal(svg.childNodes.filter(dom5.isElement).length, 6);
        done();
      });
    });

    test.skip('import bodies are in one hidden div', function(done) {
      const hiddenDiv = preds.AND(
          preds.hasTagName('div'), preds.hasAttr('hidden'),
          preds.hasAttr('by-vulcanize'));

      process(inputPath, function(err, doc) {
        if (err) {
          return done(err);
        }
        assert.equal(dom5.queryAll(doc, hiddenDiv).length, 1);
        done();
      });
    });

    test('dom-modules have assetpath', function(done) {
      const assetpath = preds.AND(
          preds.hasTagName('dom-module'),
          preds.hasAttrValue('assetpath', 'imports/'));
      process(inputPath, function(err, doc) {
        if (err) {
          return done(err);
        }
        assert.ok(dom5.query(doc, assetpath), 'assetpath set');
        done();
      });
    });

    test('output file is forced utf-8', function(done) {
      const meta = preds.AND(
          preds.hasTagName('meta'), preds.hasAttrValue('charset', 'UTF-8'));
      process(inputPath, function(err, doc) {
        if (err) {
          return done(err);
        }
        assert.ok(dom5.query(doc, meta));
        done();
      });
    });

    test.skip('Handle <base> tag', function(done) {
      const span = preds.AND(
          preds.hasTagName('span'),
          preds.hasAttrValue('href', 'imports/hello'));
      const a = preds.AND(
          preds.hasTagName('a'),
          preds.hasAttrValue('href', 'imports/sub-base/sub-base.html'));
      process('test/html/base.html', function(err, doc) {
        if (err) {
          return done(err);
        }
        const spanHref = dom5.query(doc, span);
        assert.ok(spanHref);
        const anchorRef = dom5.query(doc, a);
        assert.ok(anchorRef);
        done();
      });
    });

    test('Imports in <body> are handled correctly', function(done) {
      const importMatcher = preds.AND(
          preds.hasTagName('link'), preds.hasAttrValue('rel', 'import'));

      const bodyContainerMatcher = preds.AND(
          preds.hasTagName('div'), preds.hasAttr('hidden'),
          preds.hasAttr('by-vulcanize'));

      const scriptExpected = preds.hasTagName('script');
      const divExpected = preds.AND(
          preds.hasTagName('div'), preds.hasAttrValue('id', 'imported'));

      process('test/html/import-in-body.html', function(err, doc) {
        if (err) {
          return done(err);
        }
        const imports = dom5.queryAll(doc, importMatcher);
        assert.equal(imports.length, 0);
        const bodyContainer = dom5.query(doc, bodyContainerMatcher);
        const scriptActual = dom5.query(doc, scriptExpected).parentNode;
        const divActual = dom5.query(doc, divExpected).parentNode;
        assert.equal(bodyContainer, scriptActual);
        assert.equal(bodyContainer, divActual);
        done();
      });
    });

    test('Scripts are not inlined by default', function(done) {
      const matchers = require('../matchers');
      const externalJS = matchers.JS_SRC;

      process('test/html/external.html', function(err, doc) {
        if (err) {
          done(err);
        }
        const scripts = dom5.queryAll(doc, externalJS);
        assert.isAbove(scripts.length, 0, 'scripts were inlined');
        scripts.forEach(function(s) {
          assert.equal(
              dom5.getTextContent(s), '', 'script src should be empty');
        });
        done();
      });
    });

    test('Old Polymer is detected and warns', function(done) {
      const constants = require('../constants');
      const input = path.resolve('test/html/old-polymer.html');
      process(input, function(err) {
        if (err) {
          try {
            // check err message
            assert.equal(
                err.message.toLowerCase(),
                (constants.OLD_POLYMER + ' File: ' + input).toLowerCase());
            done();
          } catch (e) {
            done(e);
          }
        } else {
          done(new Error('should have thrown'));
        }
      });
    });

    test('Paths for import bodies are resolved correctly', function(done) {
      const anchorMatcher = preds.hasTagName('a');
      const input = 'test/html/multiple-imports.html';
      process(input, function(err, doc) {
        if (err) {
          return done(err);
        }
        const anchor = dom5.query(doc, anchorMatcher);
        const href = dom5.getAttribute(anchor, 'href');
        assert.equal(href, 'imports/target.html');
        done();
      });
    });

    test('Spaces in paths are handled correctly', function(done) {
      const input = 'test/html/spaces.html';
      const spacesMatcher = preds.AND(
          preds.hasTagName('dom-module'),
          preds.hasAttrValue('id', 'space-element'));
      process(input, function(err, doc) {
        if (err) {
          return done(err);
        }
        const module = dom5.query(doc, spacesMatcher);
        assert.ok(module);
        done();
      });
    });

    test('Handle Wrong inputs', function(done) {
      const options = {
        inputUrl: true,
        stripExcludes: false,
        excludes: 'everything!',
        implicitStript: {},
        abspath: {}
      };

      process(inputPath, function(err, expectedDoc) {
        if (err) {
          return done(err);
        }
        const expected = dom5.serialize(expectedDoc);
        process(inputPath, function(err, actualDoc) {
          if (err) {
            return done(err);
          }
          const actual = dom5.serialize(actualDoc);
          assert.equal(expected, actual, 'bad inputs were corrected');
          done();
        }, options);
      });

    });
  });

  suite('Script Ordering', function() {
    test('Imports and scripts are ordered correctly', function(done) {
      const expectedOrder = [
        'first-script', 'second-import-first-script',
        'second-import-second-script', 'first-import-first-script',
        'first-import-second-script', 'second-script', 'third-script'
      ];

      const expectedSrc = [
        'order/first-script.js', 'order/second-import/first-script.js',
        'order/second-import/second-script.js',
        'order/first-import/first-script.js',
        'order/first-import/second-script.js', 'order/second-script.js',
        'order/third-script.js'
      ];

      const scriptMatcher = preds.hasTagName('script');

      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const scripts = dom5.queryAll(doc, scriptMatcher);
        const actualOrder = [], actualSrc = [];
        scripts.forEach(function(s) {
          actualOrder.push(dom5.getAttribute(s, 'id'));
          actualSrc.push(dom5.getAttribute(s, 'src'));
        });
        assert.deepEqual(
            actualOrder, expectedOrder, 'order is not as expected');
        assert.deepEqual(
            actualSrc, expectedSrc, 'srcs are not preserved correctly');
        done();
      };

      process('test/html/order-test.html', callback);
    });

    test('exhaustive script order testing', function(done) {
      process('test/html/scriptorder/index.html', function(err, doc) {
        if (err) {
          return done(err);
        }
        assert(doc);
        const serialized = dom5.serialize(doc);
        const beforeLoc = serialized.indexOf('window.BeforeJs');
        const afterLoc = serialized.indexOf('BeforeJs.value');
        assert.isBelow(beforeLoc, afterLoc);
        done();
      }, {inlineScripts: true});
    });

    test('Paths are correct when maintaining order', function(done) {
      process('test/html/recursion/import.html', function(err, doc) {
        if (err) {
          return done(err);
        }
        assert(doc);
        const scripts = dom5.queryAll(
            doc, preds.AND(preds.hasTagName('script'), preds.hasAttr('src')));
        scripts.forEach(function(s) {
          const src = dom5.getAttribute(s, 'src');
          assert.equal(
              src.indexOf('../order'), 0, 'path should start with ../order');
        });
        done();
      });
    });
  });

  suite('Absolute Paths', function() {
    test('Output with Absolute paths with abspath', function(done) {
      const root = path.resolve(inputPath, '../..');
      const target = '/html/default.html';
      const options = {abspath: root};
      const domModule = preds.AND(
          preds.hasTagName('dom-module'),
          preds.hasAttrValue('assetpath', '/html/imports/'));
      const stylesheet = preds.AND(
          preds.hasTagName('link'), preds.hasAttrValue('rel', 'import'),
          preds.hasAttrValue('type', 'css'),
          preds.hasAttrValue('href', '/html/imports/simple-style.css'));
      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        assert.ok(dom5.query(doc, domModule));
        assert.ok(dom5.query(doc, stylesheet));
        done();
      };
      process(target, callback, options);
    });
  });

  suite('Redirect', function() {
    test('Redirected paths load properly', function(done) {
      const options = {
        redirects:
            ['chrome://imports/|test/html/imports/', 'biz://cool/|test/html']
      };

      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        assert(doc);
        done();
      };
      process(
          path.resolve('test/html/custom-protocol.html'), callback, options);
    });
  });

  suite('Excludes', function() {

    const htmlImport = preds.AND(
        preds.hasTagName('link'), preds.hasAttrValue('rel', 'import'));

    const excluded = preds.AND(
        preds.hasTagName('link'), preds.hasAttrValue('rel', 'import'),
        preds.hasAttrValue('href', 'imports/simple-import.html'));

    const excludes = ['test/html/imports/simple-import.html'];

    test('Excluded imports are not inlined', function(done) {
      const options = {excludes: excludes};

      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const imports = dom5.queryAll(doc, excluded);
        assert.equal(imports.length, 1);
        done();
      };
      process(inputPath, callback, options);
    });

    const cssFromExclude = preds.AND(
        preds.hasTagName('link'), preds.hasAttrValue('rel', 'import'),
        preds.hasAttrValue('type', 'css'));

    // TODO(ajo): Fix test with hydrolysis upgrades.
    test.skip(
        'Excluded imports are not when behind a redirected URL.',
        function(done) {
          const options = {
            excludes: ['test/html/imports/simple-import.html'],
            redirects: ['red://herring/at|test/html/imports']
          };

          const callback = function(err, doc) {
            if (err) {
              return done(err);
            }
            const imports = dom5.queryAll(doc, htmlImport);
            assert.equal(imports.length, 2);
            const badCss = dom5.queryAll(doc, cssFromExclude);
            assert.equal(badCss.length, 0);
            done();
          };
          process(
              path.resolve('test/html/custom-protocol-excluded.html'), callback,
              options);
        });

    test('Excluded imports with "Strip Excludes" are removed', function(done) {
      const options = {stripExcludes: excludes};

      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const imports = dom5.queryAll(doc, excluded);
        assert.equal(imports.length, 0);
        done();
      };
      process(inputPath, callback, options);
    });

    test('Strip Excludes does not have to be exact', function(done) {
      const options = {stripExcludes: ['simple-import']};

      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const imports = dom5.queryAll(doc, excluded);
        assert.equal(imports.length, 0);
        done();
      };

      process(inputPath, callback, options);
    });

    test('Strip Excludes has more precedence than Excludes', function(done) {
      const options = {excludes: excludes, stripExcludes: excludes};

      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const imports = dom5.queryAll(doc, excluded);
        assert.equal(imports.length, 0);
        done();
      };

      process(inputPath, callback, options);
    });

    test('Excluded comments are removed', function(done) {
      const options = {stripComments: true};
      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const comments = dom5.nodeWalkAll(doc, dom5.isCommentNode);
        assert.equal(comments.length, 3);
        const commentsExpected =
            ['@license import 2', '@license import 1', '@license main'];
        const commentsActual = comments.map(function(c) {
          return dom5.getTextContent(c).trim();
        });
        assert.deepEqual(commentsExpected, commentsActual);
        done();
      };
      process('test/html/comments.html', callback, options);
    });

    test('Comments are kept by default', function(done) {
      const options = {stripComments: false};
      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const comments = dom5.nodeWalkAll(doc, dom5.isCommentNode);
        const expectedComments = [
          '@license main', '@license import 1', 'comment in import 1',
          '@license import 2', 'comment in import 2', 'comment in main'
        ];
        const actualComments = comments.map(function(c) {
          return dom5.getTextContent(c).trim();
        });
        assert.deepEqual(expectedComments, actualComments);
        done();
      };
      process('test/html/comments.html', callback, options);
    });

    test('Folder can be excluded', function(done) {
      const linkMatcher = preds.hasTagName('link');
      const options = {excludes: ['test/html/imports/']};
      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const links = dom5.queryAll(doc, linkMatcher);
        // one duplicate import is removed
        assert.equal(links.length, 2);
        done();
      };
      process('test/html/default.html', callback, options);
    });
  });

  suite('Inline Scripts', function() {
    const options = {inlineScripts: true};
    const matchers = require('../matchers');

    test('All scripts are inlined', function(done) {
      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const scripts = dom5.queryAll(doc, matchers.JS_SRC);
        assert.equal(scripts.length, 0);
        done();
      };
      process(inputPath, callback, options);
    });

    test('External scripts are kept', function(done) {
      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const scripts = dom5.queryAll(doc, matchers.JS_SRC);
        assert.equal(scripts.length, 1);
        done();
      };
      process('test/html/external-script.html', callback, options);
    });

    test('Absolute paths are correct', function(done) {
      const root = path.resolve(inputPath, '../..');
      const target = '/html/default.html';
      const options = {abspath: root, inlineScripts: true};
      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const scripts = dom5.queryAll(doc, matchers.JS_SRC);
        assert.equal(scripts.length, 0);
        done();
      };
      process(target, callback, options);
    });

    test('Escape inline <script>', function(done) {
      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const script = dom5.query(doc, matchers.JS_INLINE);
        assert.include(
            dom5.getTextContent(script),
            'var b = 0<\\/script><script>alert(\'XSS\'); //2;',
            'Inline <script> should be escaped');
        done();
      };
      process('test/html/xss.html', callback, options);
    });

    test('Inlined Scripts are in the expected order', function(done) {
      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const scripts = dom5.queryAll(doc, matchers.JS_INLINE);
        const contents = scripts.map(function(script) {
          return dom5.getTextContent(script);
        });
        assert.deepEqual(['"First"', '"Second"'], contents);
        done();
      };
      process('test/html/reordered/in.html', callback, options);
    });

    test('Firebase works inlined', function(done) {
      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const scripts = dom5.queryAll(doc, matchers.JS_INLINE);
        assert.equal(scripts.length, 1);
        const idx = dom5.getTextContent(scripts[0]).indexOf('</script>');
        assert(idx === -1, '/script found, should be escaped');
        done();
      };
      process('test/html/firebase.html', callback, options);
    });
  });

  suite('Inline CSS', function() {
    const options = {inlineCss: true};
    const matchers = require('../matchers');
    test('All styles are inlined', function(done) {
      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const links = dom5.queryAll(doc, matchers.ALL_CSS_LINK);
        assert.equal(links.length, 0);
        done();
      };
      process(inputPath, callback, options);
    });

    test('Inlined styles have proper paths', function(done) {
      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const styles = dom5.queryAll(doc, matchers.CSS);
        assert.equal(styles.length, 2);
        const content = dom5.getTextContent(styles[1]);
        assert(content.search('imports/foo.jpg') > -1, 'path adjusted');
        assert(content.search('@apply') > -1, '@apply kept');
        done();
      };
      process('test/html/inline-styles.html', callback, options);
    });

    test(
        'External Scripts and Stylesheets are not removed and media queries are retained',
        function(done) {
          const input = 'test/html/external-stylesheet.html';
          process(input, function(err, doc) {
            if (err) {
              return done(err);
            }
            const link = dom5.query(doc, matchers.CSS_LINK);
            assert(link);
            const styles = dom5.queryAll(doc, matchers.CSS);
            assert.equal(styles.length, 1);
            const content = dom5.getTextContent(styles[0]);
            assert(
                content.search(/@media \(min-width: 800px\) /g) > -1,
                'media query retained');
            done();
          }, options);
        });

    test('Absolute paths are correct', function(done) {
      const root = path.resolve(inputPath, '../..');
      const callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        const links = dom5.queryAll(doc, matchers.ALL_CSS_LINK);
        assert.equal(links.length, 0);
        done();
      };
      const options = {abspath: root, inlineCss: true};
      process('/html/default.html', callback, options);
    });

    test(
        'Inlined Polymer styles are moved into the <template>', function(done) {
          const callback = function(err, doc) {
            if (err) {
              return done(err);
            }
            const domModule =
                dom5.query(doc, dom5.predicates.hasTagName('dom-module'));
            assert(domModule);
            const template =
                dom5.query(domModule, dom5.predicates.hasTagName('template'));
            assert(template);
            const style = dom5.query(template.childNodes[0], matchers.CSS);
            assert(style);
            done();
          };
          process('test/html/default.html', callback, options);
        });

    test(
        'Inlined Polymer styles will force a dom-module to have a template',
        function(done) {
          const callback = function(err, doc) {
            if (err) {
              return done(err);
            }
            const domModule =
                dom5.query(doc, dom5.predicates.hasTagName('dom-module'));
            assert(domModule);
            const template =
                dom5.query(domModule, dom5.predicates.hasTagName('template'));
            assert(template);
            const style = dom5.query(template.childNodes[0], matchers.CSS);
            assert(style);
            done();
          };
          process('test/html/inline-styles.html', callback, options);
        });
  });

  suite('Add import', function() {
    const options = {addedImports: ['imports/comment-in-import.html']};
    test('added import is added to vulcanized doc', function(done) {
      process('test/html/default.html', function(err, doc) {
        if (err) {
          return done(err);
        }
        assert(doc);
        const hasAddedImport =
            preds.hasAttrValue('href', 'imports/comment-in-import.html');
        assert.equal(dom5.queryAll(doc, hasAddedImport).length, 1);
        done();
      }, options);
    });
  });


  suite('Input URL', function() {
    const options = {inputUrl: 'test/html/default.html'};

    test('inputURL is used instead of argument to process', function(done) {
      process('flibflabfloom!', function(err, doc) {
        if (err) {
          return done(err);
        }
        assert(doc);
        done();
      }, options);
    });

    test('gulp-vulcanize invocation with abspath', function(done) {
      const options = {
        abspath: path.resolve('test/html'),
        inputUrl: '/default.html'
      };

      process(
          'C:\\Users\\VulcanizeTester\\vulcanize\\test\\html\\default.html',
          function(err, doc) {
            if (err) {
              return done(err);
            }
            assert(doc);
            done();
          },
          options);
    });
  });

  suite('Regression Testing', function() {
    test('Complicated Ordering', function(done) {
      // refer to
      // https://github.com/Polymer/vulcanize/tree/master/test/html/complicated/ordering.svg
      // for visual reference on the document structure for this example
      process('test/html/complicated/A.html', function(err, doc) {
        if (err) {
          return done(err);
        }
        assert(doc);
        const expected = ['A1', 'C', 'E', 'B', 'D', 'A2'];
        const scripts = dom5.queryAll(doc, preds.hasTagName('script'));
        const contents = scripts.map(function(s) {
          return dom5.getTextContent(s).trim();
        });
        assert.deepEqual(contents, expected);
        done();
      }, {inlineScripts: true});
    });

    test('Imports in templates should not inline', function(done) {
      process('test/html/inside-template.html', function(err, doc) {
        const importMatcher = preds.AND(
            preds.hasTagName('link'), preds.hasAttrValue('rel', 'import'),
            preds.hasAttr('href'));
        const externalScriptMatcher = preds.AND(
            preds.hasTagName('script'),
            preds.hasAttrValue('src', 'external/external.js'));
        if (err) {
          return done(err);
        }
        assert(doc);
        const imports = dom5.queryAll(doc, importMatcher);
        assert.equal(imports.length, 1, 'import in template was inlined');
        const unexpectedScript = dom5.query(doc, externalScriptMatcher);
        assert.equal(
            unexpectedScript, null,
            'script in external.html should not be present');
        done();
      });
    });
  });
});
