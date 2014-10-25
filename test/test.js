// jshint node: true
var assert = require('assert');
var path = require('path');

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
      assert(abs.test('//foo.com'), 'protocol-free');
      assert(abs.test('/components/'), '/');
      assert(!abs.test('../foo/bar.html'), '../');
      assert(!abs.test('bar.html'), 'sibling dependency');
    });

    test('remote absolute urls', function() {
      var rabs = constants.REMOTE_ABS_URL;

      assert(rabs.test('http://foo.com'), 'http');
      assert(rabs.test('https://foo.com'), 'https');
      assert(rabs.test('//foo.com'), 'protocol-free');
      assert(!rabs.test('../foo/bar.html'), '../');
      assert(!rabs.test('bar.html'), 'sibling dependency');
      assert(!rabs.test('/components/'), '/');
    });

    test('CSS URLs', function() {
      var url = constants.URL;

      assert('url(foo.html)'.match(url), 'naked');
      assert('url(\'foo.html\')'.match(url), 'single quote');
      assert('url("foo.html")'.match(url), 'double quote');
    });

  });

  suite('Path Resolver', function() {
    var pathresolver = require('../lib/pathresolver.js');
    var inputPath = '/foo/bar/my-element';
    var outputPath = '/foo/bar';

    test('rewrite URLs', function() {
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
        var actual = pathresolver.rewriteRelPath(inputPath, outputPath, val, abs);
        assert.equal(actual, expected, msg);
      }

      testPath('biz.jpg', 'my-element/biz.jpg', null, 'local');
      testPath('http://foo/biz.jpg', 'http://foo/biz.jpg', null, 'remote');
      testPath('biz.jpg', 'bar/my-element/biz.jpg', '/foo/', 'build path');
    });

    test('Resolve Paths', function() {
      var html = [
        '<link rel="import" href="../polymer/polymer.html">',
        '<link rel="stylesheet" href="my-element.css">',
        '<polymer-element name="my-element">',
        '<template>',
        '<style>:host { background-image: url(background.svg); }</style>',
        '<script>Polymer()</script>',
        '</template>',
        '</polymer-element>'
      ].join('\n');

      var expected = [
        '<html><head><link rel="import" href="polymer/polymer.html">',
        '<link rel="stylesheet" href="my-element/my-element.css">',
        '</head><body><polymer-element name="my-element" assetpath="my-element/">',
        '<template>',
        '<style>:host { background-image: url("my-element/background.svg"); }</style>',
        '<script>Polymer()</script>',
        '</template>',
        '</polymer-element></body></html>'
      ].join('\n');

      var expected2 = [
        '<html><head><link rel="import" href="/bar/polymer/polymer.html">',
        '<link rel="stylesheet" href="/bar/my-element/my-element.css">',
        '</head><body><polymer-element name="my-element" assetpath="/bar/my-element/">',
        '<template>',
        '<style>:host { background-image: url("/bar/my-element/background.svg"); }</style>',
        '<script>Polymer()</script>',
        '</template>',
        '</polymer-element></body></html>'
      ].join('\n');

      var actual;
      var whacko = require('whacko');
      var $ = whacko.load(html);

      pathresolver.resolvePaths($, inputPath, outputPath);

      actual = $.html();
      assert.equal(actual, expected, 'relative');

      $ = whacko.load(html);

      pathresolver.resolvePaths($, inputPath, outputPath, '/foo');

      actual = $.html();
      assert.equal(actual, expected2, 'absolute');
    });

  });

  suite('Utils', function() {
    var utils = require('../lib/utils.js');

    test('Polymer Invocation', function() {
      var polymer = constants.POLYMER_INVOCATION;

      function test(invocation, expected, msg) {
        var matches = polymer.exec(invocation);
        assert(matches, 'polymer invocation found');
        var replacement = utils.processPolymerInvocation('core-input', matches);
        var actual = invocation.replace(matches[0], replacement);
        assert.strictEqual(actual, expected, msg);
      }

      test('Polymer(\'core-input\', {})', 'Polymer(\'core-input\', {})', 'full');
      test('Polymer(\'core-input\')', 'Polymer(\'core-input\')', 'name-only');
      test('Polymer()', 'Polymer(\'core-input\')', 'none');
      test('Polymer({})', 'Polymer(\'core-input\',{})', 'object-only');
      test('Polymer(p)', 'Polymer(\'core-input\',p)', 'indirect');

    });

  });
});
