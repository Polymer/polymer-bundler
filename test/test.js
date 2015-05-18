/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */
// jshint node: true
var assert = require('assert');
var path = require('path');

var dom5 = require('dom5');

function parse(text) {
  return dom5.parse(text);
}
function serialize(ast) {
  return dom5.serialize(ast);
}

assert.AssertionError.prototype.showDiff = true;

suite('constants', function() {
  var constants = require('../lib/constants.js');

  suite('URLs', function() {

    test('absolute urls', function() {
      var abs = constants.ABS_URL;

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
      var url = constants.URL;

      assert('url(foo.html)'.match(url), 'naked');
      assert('url(\'foo.html\')'.match(url), 'single quote');
      assert('url("foo.html")'.match(url), 'double quote');
    });

    test('Template URLs', function() {
      var tmpl = constants.URL_TEMPLATE;

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
  var pathresolver = require('../lib/pathresolver.js');
  var inputPath = '/foo/bar/my-element/index.html';
  var outputPath = '/foo/bar/index.html';

  setup(function() {
    pathresolver.setOptions({});
  });


  test('Rewrite URLs', function() {
    var css = [
      'x-element {',
      '  background-image: url(foo.jpg);',
      '}',
      'x-bar {',
      '  background-image: url(data:xxxxx);',
      '}',
      'x-quuz {',
      '  background-image: url(\'https://foo.bar/baz.jpg\');',
      '}',
    ].join('\n');

    var expected = [
      'x-element {',
      '  background-image: url("my-element/foo.jpg");',
      '}',
      'x-bar {',
      '  background-image: url("data:xxxxx");',
      '}',
      'x-quuz {',
      '  background-image: url("https://foo.bar/baz.jpg");',
      '}',
    ].join('\n');

    var actual = pathresolver.rewriteURL(inputPath, outputPath, css);
    assert.equal(actual, expected);
  });

  function testPath(val, expected, msg) {
    var actual = pathresolver.rewriteRelPath(inputPath, outputPath, val);
    assert.equal(actual, expected, msg);
  }

  test('Rewrite Paths', function() {
    testPath('biz.jpg', 'my-element/biz.jpg', 'local');
    testPath('http://foo/biz.jpg', 'http://foo/biz.jpg', 'remote');
    testPath('#foo', '#foo', 'hash');
  });

  test('Rewrite Paths with absolute paths', function() {
    pathresolver.setOptions({
      abspath: true
    });
    testPath('biz.jpg', '/foo/bar/my-element/biz.jpg', 'local');
    testPath('http://foo/biz.jpg', 'http://foo/biz.jpg', 'local');
    testPath('#foo', '#foo', 'hash');
  });

  test('Resolve Paths', function() {
    var html = [
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

    var expected = [
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

    var ast = parse(html);
    pathresolver.resolvePaths(ast, inputPath, outputPath);

    var actual = serialize(ast);
    assert.equal(actual, expected, 'relative');
  });

  test('Resolve Paths with <base>', function() {
    var htmlBase = [
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

    var expectedBase = [
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

    var ast = parse(htmlBase);
    pathresolver.acid(ast, inputPath);
    pathresolver.resolvePaths(ast, inputPath, outputPath);

    var actual = serialize(ast);
    assert.equal(actual, expectedBase, 'base');
  });

  test('Leave Templated Urls', function() {
    var base = [
      '<html><head></head><body>',
      '<a href="{{foo}}"></a>',
      '<img src="[[bar]]">',
      '</body></html>'
    ].join('\n');

    var ast = parse(base);
    pathresolver.resolvePaths(ast, inputPath, outputPath);

    var actual = serialize(ast);
    assert.equal(actual, base, 'templated urls');
  });

});

suite('Vulcan', function() {
  var vulcan = require('../lib/vulcan.js');
  var inputPath = path.resolve('test/html/default.html');

  var preds = dom5.predicates;
  var hyd = require('hydrolysis');
  var doc;

  function process(inputPath, cb, vulcanizeOptions) {
    var options = vulcanizeOptions || {};
    vulcan.setOptions(options);
    vulcan.process(inputPath, function(err, content) {
      if (err) {
        return cb(err);
      }
      doc = dom5.parse(content);
      cb(null, doc);
    });
  }

  suite('Default Options', function() {
    test('imports removed', function(done) {
      var imports = preds.AND(
        preds.hasTagName('link'),
        preds.hasAttrValue('rel', 'import'),
        preds.hasAttr('href'),
        preds.NOT(preds.hasAttrValue('type', 'css'))
      );
      process(inputPath, function(err, doc) {
        if (err) {
          return done(err);
        }
        assert.equal(dom5.queryAll(doc, imports).length, 0);
        done();
      });
    });

    test('imports were deduplicated', function() {
      process(inputPath, function(err, doc) {
        if (err) {
          return done(err);
        }
        assert.equal(dom5.queryAll(doc, preds.hasTagName('dom-module')).length, 1);
        done();
      });
    });

    test('svg is nested correctly', function(done) {
      process(inputPath, function(err, doc) {
        if (err) {
          return done(err);
        }
        var svg = dom5.query(doc, preds.hasTagName('svg'));
        assert.equal(svg.childNodes.filter(dom5.isElement).length, 6);
        done();
      });
    });

    test('import bodies are in one hidden div', function(done) {
      var hiddenDiv = preds.AND(
        preds.hasTagName('div'),
        preds.hasAttr('hidden'),
        preds.hasAttr('by-vulcanize')
      );

      process(inputPath, function(err, doc) {
        if (err) {
          return done(err);
        }
        assert.equal(dom5.queryAll(doc, hiddenDiv).length, 1);
        done();
      });
    });

    test('dom-modules have assetpath', function(done) {
      var assetpath = preds.AND(
        preds.hasTagName('dom-module'),
        preds.hasAttrValue('assetpath', 'imports/')
      );
      process(inputPath, function(err, doc) {
        if (err) {
          return done(err);
        }
        assert.ok(dom5.query(doc, assetpath), 'assetpath set');
        done();
      });
    });

    test('output file is forced utf-8', function() {
      var meta = preds.AND(
        preds.hasTagName('meta'),
        preds.hasAttrValue('charset', 'UTF-8')
      );
      process(inputPath, function(err, doc) {
        if (err) {
          return done(err);
        }
        assert.ok(dom5.query(doc, meta));
        done();
      });
    });

    test('Handle <base> tag', function(done) {
      var span = preds.AND(
        preds.hasTagName('span'),
        preds.hasAttrValue('href', 'imports/hello')
      );
      var a = preds.AND(
        preds.hasTagName('a'),
        preds.hasAttrValue('href', 'imports/sub-base/sub-base.html')
      );
      process('test/html/base.html', function(err, doc) {
        if (err) {
          return done(err);
        }
        var spanHref = dom5.query(doc, span);
        assert.ok(spanHref);
        var anchorRef = dom5.query(doc, a);
        assert.ok(a);
        done();
      });
    });

    test('Imports in <body> are handled correctly', function(done) {
      var importMatcher = preds.AND(
        preds.hasTagName('link'),
        preds.hasAttrValue('rel', 'import')
      );

      var headMatcher = preds.hasTagName('head');
      var bodyMatcher = preds.hasTagName('body');

      var headExpected = preds.hasTagName('script');
      var bodyExpected = preds.hasTagName('div');

      process('test/html/import-in-body.html', function(err, doc) {
        if (err) {
          return done(err);
        }
        var imports = dom5.queryAll(doc, importMatcher);
        assert.equal(imports.length, 0);
        var head = dom5.query(doc, headMatcher);
        var body = dom5.query(doc, bodyMatcher);
        var headActual = dom5.query(doc, headExpected).parentNode;
        var bodyActual = dom5.query(doc, bodyExpected).parentNode;
        assert.equal(head, headActual);
        assert.equal(body, bodyActual);
        done();
      });
    });

    test('Old Polymer is detected and warns', function(done) {
      var constants = require('../lib/constants');
      var input = 'test/html/old-polymer.html';
      process(input, function(err, doc) {
        if (err) {
          try {
            // check err message
            assert.equal(err.message, constants.OLD_POLYMER + ' File: ' + input);
            done();
          } catch(e) {
            done(e);
          }
        } else {
          done(new Error('should have thrown'));
        }
      });
    });

    test('Paths for import bodies are resolved correctly', function(done) {
      var anchorMatcher = preds.hasTagName('a');
      var input = 'test/html/multiple-imports.html';
      process(input, function(err, doc) {
        if (err) {
          return done(err);
        }
        var anchor = dom5.query(doc, anchorMatcher);
        var href = dom5.getAttribute(anchor, 'href');
        assert.equal(href, 'imports/target.html');
        done();
      });
    });
  });

  suite('Absolue Paths', function() {
    test('Output with Absolute paths with abspath', function(done) {
      var root = path.resolve(inputPath, '../..');
      var target = '/html/default.html';
      var options = {
        abspath: root
      };
      var domModule = preds.AND(
        preds.hasTagName('dom-module'),
        preds.hasAttrValue('assetpath', '/html/imports/')
      );
      var stylesheet = preds.AND(
        preds.hasTagName('link'),
        preds.hasAttrValue('rel', 'import'),
        preds.hasAttrValue('type', 'css'),
        preds.hasAttrValue('href', '/html/imports/simple-style.css')
      );
      var callback = function(err, doc) {
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

  suite('Excludes', function() {

    var excluded = preds.AND(
      preds.hasTagName('link'),
      preds.hasAttrValue('rel', 'import'),
      preds.hasAttrValue('href', 'imports/simple-import.html')
    );

    var excludes =["simple-import.html"];

    test('Excluded imports are not inlined', function(done) {
      var options = {
        excludes: excludes
      };

      var callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        var imports = dom5.queryAll(doc, excluded);
        assert.equal(imports.length, 1);
        done();
      };
      process(inputPath, callback, options);
    });

    test('Excluded imports with "Strip Excludes" are removed', function(done) {
      var options = {
        stripExcludes: excludes
      };

      var callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        var imports = dom5.queryAll(doc, excluded);
        assert.equal(imports.length, 0);
        done();
      };
      process(inputPath, callback, options);
    });

    test('Excluded comments are removed', function(done) {
      var options = {
        stripComments: true
      };
      var callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        var comments = dom5.nodeWalkAll(doc, dom5.isCommentNode);
        assert.equal(comments.length, 1);
        done();
      };
      process(inputPath, callback, options);
    });
  });

  suite('Inline Scripts', function() {
    var options = {
      inlineScripts: true
    };
    var matchers = require('../lib/matchers');

    test('All scripts are inlined', function(done) {
      var callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        var scripts = dom5.queryAll(doc, matchers.JS_SRC);
        assert.equal(scripts.length, 0);
        done();
      };
      process(inputPath, callback, options);
    });

    test('External scripts are kept', function(done) {
      var callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        var scripts = dom5.queryAll(doc, matchers.JS_SRC);
        assert.equal(scripts.length, 1);
        done();
      };
      process('test/html/external-script.html', callback, options);
    });
  });

  suite('Inline CSS', function() {
    var options = {
      inlineCss: true
    };
    var matchers = require('../lib/matchers');
    test('All styles are inlined', function(done) {
      var callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        var links = dom5.queryAll(doc, matchers.POLY_CSS_LINK);
        assert.equal(links.length, 0);
        done();
      };
      process(inputPath, callback, options);
    });

    test('Inlined styles have proper paths', function(done) {
      var callback = function(err, doc) {
        if (err) {
          return done(err);
        }
        var style = dom5.query(doc, matchers.CSS);
        assert(style);
        var content = dom5.getTextContent(style);
        assert(content.search('imports/foo.jpg') > -1, 'path adjusted');
        done();
      };
      process('test/html/inline-styles.html', callback, options);
    });
  });
});
