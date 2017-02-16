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

    test('Handles relative paths', () => {
      assert.equal(
          urlUtils.stripUrlFileSearchAndHash('relative/path/to/file'),
          'relative/path/to/');
    });
  });

  suite('Rewrite imported relative paths', () => {

    const importDocPath = '/foo/bar/my-element/index.html';
    const mainDocPath = '/foo/bar/index.html';

    function testRewrite(val: string, expected: string, msg?: string) {
      const actual =
          urlUtils.rewriteImportedRelPath(importDocPath, mainDocPath, val);
      assert.equal(actual, expected, msg);
    }

    test('Rewrite Paths', () => {
      testRewrite('biz.jpg', 'my-element/biz.jpg', 'local');
      testRewrite('http://foo/biz.jpg', 'http://foo/biz.jpg', 'remote');
      testRewrite('#foo', '#foo', 'hash');
    });

    test('Rewrite Paths with absolute paths', () => {
      testRewrite('biz.jpg', 'my-element/biz.jpg', 'local');
      testRewrite('http://foo/biz.jpg', 'http://foo/biz.jpg', 'local');
      testRewrite('#foo', '#foo', 'hash');
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

    // TODO(usergenic): Update resolveUrl to interpret scheme-less URLs the
    // same way browsers do, where '//' prefix implies preserved scheme and
    // the first path segment is actually the host.
    test.skip('Scheme-less URLs should be interpreted as browsers do', () => {
      assert.equal(urlUtils.relativeUrl('//a/b', '/c/d'), 'c/d');
      assert.equal(urlUtils.relativeUrl('/a/b', '//c/d'), '//c/d');
    });
  });
});
