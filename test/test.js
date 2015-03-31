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

suite('CommentMap', function() {
  var CommentMap = require('../lib/commentmap.js');

  suite('Normalize', function() {
    test('whitespace', function() {
      var c = new CommentMap();
      var s = [
        'Hi',
        'There'
      ].join('\n');
      var e = 'HiThere';

      assert.equal(c.normalize(s), e);
    });

    test('single comment', function() {
      var c = new CommentMap();
      var s = '// foo';
      var e = 'foo';

      assert.equal(c.normalize(s), e);
    });

    test('multiline comment', function() {
      var c = new CommentMap();
      var s = [
        '/**',
        ' * foo',
        ' */'
      ].join('\n');
      var e = 'foo';

      assert.equal(c.normalize(s), e);
    });
  });

  suite('Set and Has', function() {

    test('Plain', function() {
      var c = new CommentMap();
      var s = 'Test';

      c.set(s);
      assert.ok(c.has(s));
    });

    test('Strip Comments', function() {
      var c = new CommentMap();
      var m = '/** foo */';
      c.set(m);
      var s = '// foo';
      assert.ok(c.has(s));
    });

  });
});

suite('Path Resolver', function() {
  var pathresolver = require('../lib/pathresolver.js');
  var inputPath = '/foo/bar/my-element/index.html';
  var outputPath = '/foo/bar/index.html';

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

  test('Rewrite Paths', function() {
    function testPath(val, expected, abs, msg) {
      var actual = pathresolver.rewriteRelPath(inputPath, outputPath, val);
      assert.equal(actual, expected, msg);
    }

    testPath('biz.jpg', 'my-element/biz.jpg', null, 'local');
    testPath('http://foo/biz.jpg', 'http://foo/biz.jpg', null, 'remote');
    testPath('#foo', '#foo', null, 'hash');
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

  test.skip('Resolve Paths with <base>', function() {
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

suite.skip('Vulcan', function() {
 var vulcan = require('../lib/vulcan.js');
 var outputPath = path.resolve('test/html/actual.html');
 var inputPath = path.resolve('test/html/default.html');

 var loader;

 var hyd = require('hydrolysis');

 setup(function() {
   loader = new hyd.Loader();
   loader.addResolver(new hyd.FSResolver({}));
 });

 function process(input, cb) {
 }

 test('defaults', function(done) {

   process({input: inputPath, output: outputPath}, function(outputs) {
     assert.equal(Object.keys(outputs).length, 1);
     var vulcanized = outputs[outputPath];
     assert(vulcanized);
     var $ = require('whacko').load(vulcanized);
     assert.equal(searchAll($, 'body > div[hidden]').length, 1, 'only one div[hidden]');
     assert.equal(searchAll($, 'head > link[rel="import"]:not([href^="http://"])').length, 0, 'all relative imports removed');
     assert.equal(searchAll($, 'dom-module').length, 1, 'imports were deduplicated');
     assert.equal($('link', $('dom-module > template').get(0).children[0]).length, 0, 'external styles removed');
     assert.equal($('style', $('dom-module > template').get(0).children[0]).length, 1, 'styles inlined');
     assert.equal($('svg > *', $('dom-module > template').get(0).children[0]).length, 6, 'svg children propery nested');
     assert.equal(searchAll($, 'dom-module').attr('assetpath'), 'imports/', 'assetpath set');
     done();
   });
 });

 test.skip('exclude', function(done) {

   var i = 3;
   function reallyDone() {
     if (--i === 0) {
       done();
     }
   }

   process({input: inputPath, output: outputPath, excludes: {imports: ['simple-import']}}, function(outputs) {
     var vulcanized = outputs[outputPath];
     assert(vulcanized);
     var $ = require('whacko').load(vulcanized);
     assert.equal(searchAll($, 'head > link[href="imports/simple-import.html"]').length, 0, 'import excluded');
     assert.equal(searchAll($, 'head > link[rel="stylesheet"][href="imports/simple-style.css"]').length, 0, 'import content excluded');
     assert.equal(searchAll($, 'head > link[href="http://example.com/foo/bar.html"]').length, 1, 'external import is not excluded');
     reallyDone();
   });

   process({input: inputPath, output: outputPath, excludes: {styles: ['simple-style']}}, function(outputs) {
     var vulcanized = outputs[outputPath];
     assert(vulcanized);
     var $ = require('whacko').load(vulcanized);
     assert.equal(searchAll($, 'link[href="imports/simple-style.css"]').length, 1, 'style excluded');
     reallyDone();
   });

   process({input: inputPath, output: outputPath, excludes: {imports: ['simple-import']}, 'strip-excludes': false}, function(outputs) {
     var vulcanized = outputs[outputPath];
     assert(vulcanized);
     var $ = require('whacko').load(vulcanized);
     assert.equal(searchAll($, 'link[href="imports/simple-import.html"]').length, 1, 'excluded import not stripped');
     reallyDone();
   });
 });

 test.skip('Handle <base> tag', function(done) {
   var options = {input: 'test/html/base.html', output: outputPath};
   process(options, function(outputs) {
     var vulcanized = outputs[outputPath];
     assert(vulcanized);
     var $ = require('whacko').load(vulcanized);
     var spanHref = $('span').attr('href');
     assert.equal('imports/hello', spanHref, '<base> accounted for');
     var divHref = $('a').attr('href');
     assert.equal('imports/sub-base/sub-base.html', divHref);
     done();
   });
 });

});
