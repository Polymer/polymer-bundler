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

import * as urlUtils from '../url-utils';


const assert = chai.assert;


suite('URL Utils', () => {

  suite('stripUrlFileSearchAndHash', () => {

    test('Strips "man.html" basename off url', () => {
      assert.equal(
          urlUtils.stripUrlFileSearchAndHash('shark://alligator/man.html'),
          'shark://alligator/');
    });

    test('Strips "file.html" basename off url', () => {
      assert.equal(
          urlUtils.stripUrlFileSearchAndHash(
              'https://example.com/path/to/file.html'),
          'https://example.com/path/to/');
    });

    test('Strips "something?a=b&c=d" basename and search off url', () => {
      assert.equal(
          urlUtils.stripUrlFileSearchAndHash(
              'https://example.com/path/to/something?a=b&c=d'),
          'https://example.com/path/to/');
    });

    test('Strips "#some-hash-value" off url', () => {
      assert.equal(
          urlUtils.stripUrlFileSearchAndHash(
              'https://example.com/path/#some-hash-value'),
          'https://example.com/path/');
    });

    test('Handles relative paths', () => {
      assert.equal(
          urlUtils.stripUrlFileSearchAndHash('relative/path/to/file'),
          'relative/path/to/');
    });
  });

  suite('Rewrite imported relative paths', () => {

    function testRewrite(
        href: string,
        oldBaseUrl: string,
        newBaseUrl: string,
        expected: string,
        msg?: string) {
      const actual = urlUtils.rewriteHrefBaseUrl(href, oldBaseUrl, newBaseUrl);
      assert.equal(actual, expected, msg);
    }

    test('Some URL forms are not rewritten', () => {
      const importBase = '/could/be/anything/local/import.html';
      const mainBase = '/foo/bar/index.html';
      testRewrite('#foo', importBase, mainBase, '#foo', 'just a hash');
      testRewrite(
          'http://foo/biz.jpg',
          importBase,
          mainBase,
          'http://foo/biz.jpg',
          'remote urls');
      testRewrite(
          '/a/b/c/', importBase, mainBase, '/a/b/c/', 'local absolute href');
    });

    test('Rewrite Paths when base url pathnames are absolute paths', () => {
      const importBase = '/foo/bar/my-element/index.html';
      const mainBase = '/foo/bar/index.html';
      testRewrite(
          'biz.jpg', importBase, mainBase, 'my-element/biz.jpg', 'relative');
      testRewrite('/biz.jpg', importBase, mainBase, '/biz.jpg', 'absolute');
    });

    test('Rewrite paths when base url pathnames have no leading slash', () => {
      testRewrite(
          '/foo.html', 'bar.html', 'index.html', '/foo.html', 'href has ^/');
      testRewrite(
          'foo.html', '/bar.html', 'index.html', 'foo.html', 'only new has ^/');
      testRewrite(
          'foo.html', 'bar.html', '/index.html', 'foo.html', 'only old has ^/');
      testRewrite(
          'foo.html', 'bar.html', 'index.html', 'foo.html', 'neither has ^/');
    });

    test('Rewrite paths even when they are outside package root', () => {
      testRewrite(
          '../../foo.html',
          'bar.html',
          'index.html',
          '../../foo.html',
          'neither has ^/');
    });

    test('Rewrite paths when new base url has trailing slash', () => {
      testRewrite('pic.png', 'foo/bar/baz.html', 'foo/', 'bar/pic.png');
    });
  });

  suite('Relative URL calculations', () => {

    test('Basic relative paths', () => {
      assert.equal(urlUtils.relativeUrl('/', '/'), '');
      assert.equal(urlUtils.relativeUrl('/', '/a'), 'a');
      assert.equal(urlUtils.relativeUrl('/a', '/b'), 'b');
      assert.equal(urlUtils.relativeUrl('/a/b', '/c'), '../c');
      assert.equal(urlUtils.relativeUrl('/a/b', '/a/c'), 'c');
      assert.equal(urlUtils.relativeUrl('/a/b', '/a/c/d'), 'c/d');
      assert.equal(urlUtils.relativeUrl('/a/b/c/d', '/a/b/c/d'), 'd');
    });

    test('Trailing slash relevance', () => {
      assert.equal(urlUtils.relativeUrl('/a', '/b/'), 'b/');
      assert.equal(urlUtils.relativeUrl('/a/', '/b'), '../b');
      assert.equal(urlUtils.relativeUrl('/a/', '/b/'), '../b/');
      assert.equal(urlUtils.relativeUrl('/a/', '/a/b/c'), 'b/c');
      assert.equal(urlUtils.relativeUrl('/a/b/c/', '/a/d/'), '../../d/');
    });

    test('Matching shared relative URL properties', () => {
      assert.equal(urlUtils.relativeUrl('//a/b', '//a/c'), 'c');
      assert.equal(urlUtils.relativeUrl('p://a/b/', 'p://a/c/'), '../c/');
    });

    test('Mismatched schemes and hosts', () => {
      assert.equal(urlUtils.relativeUrl('p://a/b/', 'p2://a/c/'), 'p2://a/c/');
      assert.equal(urlUtils.relativeUrl('p://h/a/', 'p://i/b/'), 'p://i/b/');
      assert.equal(urlUtils.relativeUrl('p://h:1/a/', 'p://h/b/'), 'p://h/b/');
    });

    test('URLs with queries', () => {
      assert.equal(urlUtils.relativeUrl('/a/?q=1', '/a/'), '');
      assert.equal(urlUtils.relativeUrl('/a/', '/a/?q=1'), '?q=1');
      assert.equal(
          urlUtils.relativeUrl('p://a:8080/b?q=x#1', 'p://a:8080/b?q=x#1'),
          'b?q=x#1');
    });

    test('Ignore unshared relative URL properties', () => {
      assert.equal(urlUtils.relativeUrl('/a?q=x', '/b'), 'b');
      assert.equal(urlUtils.relativeUrl('/a/b/c?q=x', '/a/d?q=y'), '../d?q=y');
      assert.equal(
          urlUtils.relativeUrl('p://h/a/?q=x#1', 'p://h/b/?q=y#2'),
          '../b/?q=y#2');
    });

    test('Scheme-less URLs should be interpreted as browsers do', () => {
      assert.equal(urlUtils.relativeUrl('//a/b', '/c/d'), 'c/d');
      assert.equal(urlUtils.relativeUrl('/a/b', '//c/d'), '//c/d');
    });
  });
});
