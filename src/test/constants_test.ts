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
import constants from '../constants';

const assert = chai.assert;

suite('Constants', () => {

  suite('URLs', () => {

    test('absolute urls', () => {
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

    test('CSS URLs', () => {
      const url = constants.URL;

      assert('url(foo.html)'.match(url), 'naked');
      assert('url(\'foo.html\')'.match(url), 'single quote');
      assert('url("foo.html")'.match(url), 'double quote');
    });

    test('Template URLs', () => {
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
