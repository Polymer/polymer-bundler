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

import {FileRelativeUrl, ResolvedUrl} from 'polymer-analyzer';
import * as urlUtils from '../url-utils';


const assert = chai.assert;


suite('URL Utils', () => {

  suite('stripUrlFileSearchAndHash', () => {

    test('Strips "man.html" basename off URL', () => {
      assert.equal(
          urlUtils.stripUrlFileSearchAndHash('shark://alligator/man.html'),
          'shark://alligator/');
    });

    test('Strips "file.html" basename off URL', () => {
      assert.equal(
          urlUtils.stripUrlFileSearchAndHash(
              'https://example.com/path/to/file.html'),
          'https://example.com/path/to/');
    });

    test('Strips "something?a=b&c=d" basename and search off URL', () => {
      assert.equal(
          urlUtils.stripUrlFileSearchAndHash(
              'https://example.com/path/to/something?a=b&c=d'),
          'https://example.com/path/to/');
    });

    test('Strips "#some-hash-value" off URL', () => {
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

    function rewrite(
        href: string, oldBaseUrl: string, newBaseUrl: string): string {
      return urlUtils.rewriteHrefBaseUrl(
          href as FileRelativeUrl,
          oldBaseUrl as ResolvedUrl,
          newBaseUrl as ResolvedUrl);
    }

    test('Some URL forms are not rewritten', () => {
      const importBase = '/could/be/anything/local/import.html';
      const mainBase = '/foo/bar/index.html';
      assert.equal(
          rewrite('#foo', importBase, mainBase), '#foo', 'just a hash');
      assert.equal(
          rewrite('http://foo/biz.jpg', importBase, mainBase),
          'http://foo/biz.jpg',
          'remote URLs');
      assert.equal(
          rewrite('/a/b/c/', importBase, mainBase),
          '/a/b/c/',
          'local absolute href');
    });

    test('Rewrite Paths when base URL pathnames are absolute paths', () => {
      const importBase = '/foo/bar/my-element/index.html';
      const mainBase = '/foo/bar/index.html';
      assert.equal(
          rewrite('biz.jpg', importBase, mainBase),
          'my-element/biz.jpg',
          'relative');
      assert.equal(
          rewrite('/biz.jpg', importBase, mainBase), '/biz.jpg', 'absolute');
    });

    test('Rewrite paths when base URL pathnames have no leading slash', () => {
      assert.equal(
          rewrite('/foo.html', 'bar.html', 'index.html'),
          '/foo.html',
          'href has ^/');
      assert.equal(
          rewrite('foo.html', '/bar.html', 'index.html'),
          'foo.html',
          'only new has ^/');
      assert.equal(
          rewrite('foo.html', 'bar.html', '/index.html'),
          'foo.html',
          'only old has ^/');
      assert.equal(
          rewrite('foo.html', 'bar.html', 'index.html'),
          'foo.html',
          'neither has ^/');
    });

    test('Rewrite paths even when they are outside package root', () => {
      assert.equal(
          rewrite('../../foo.html', 'bar.html', 'index.html'),
          '../../foo.html',
          'neither has ^/');
    });

    test('Rewrite paths when new base URL has trailing slash', () => {
      assert.equal(
          rewrite('pic.png', 'foo/bar/baz.html', 'foo/'), 'bar/pic.png');
    });
  });
});
