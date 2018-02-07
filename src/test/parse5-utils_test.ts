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
import * as clone from 'clone';
import * as dom5 from 'dom5';
import * as parse5 from 'parse5';

import * as ast from '../parse5-utils';


const assert = chai.assert;

suite('AST Utils', function() {

  test('inSourceOrder', () => {
    const html = parse5.parseFragment(`
          <span>oh</span><span>hi</span>
          <span>good</span>
        <span>bye</span>
      `, {locationInfo: true});
    const spans = dom5.queryAll(html, dom5.predicates.hasTagName('span'));
    assert.isTrue(ast.inSourceOrder(spans[0], spans[1]), 'oh -> hi');
    assert.isTrue(ast.inSourceOrder(spans[0], spans[3]), 'oh -> bye');
    assert.isTrue(ast.inSourceOrder(spans[2], spans[3]), 'good -> bye');
    assert.isFalse(ast.inSourceOrder(spans[3], spans[1]), 'bye <- hi');
    assert.isFalse(ast.inSourceOrder(spans[1], spans[0]), 'hi <- oh');
  });

  test('isSameNode', () => {
    const html = parse5.parseFragment(
        `<div><h1>hi</h1><h1>h1</h1></div>`, {locationInfo: true});
    const h1_1 = html.childNodes![0]!.childNodes![0]!;
    const h1_2 = html.childNodes![0]!.childNodes![1]!;
    const h1_1_clone = clone(h1_1);
    assert.isFalse(h1_1 === h1_2);
    assert.isFalse(h1_1 === h1_1_clone);
    assert.isFalse(ast.isSameNode(h1_1, h1_2));
    assert.isTrue(ast.isSameNode(h1_1, h1_1_clone));
  });

  test('prepend', () => {
    const orderedList =
        parse5.parseFragment(`<ol><li>1<li>2<li>3<li>4<li>5</ol>`);
    const ol = orderedList.childNodes![0]!;
    const li3 = ol.childNodes![2]!;
    ast.prepend(ol, li3);
    assert.equal(
        parse5.serialize(ol.parentNode!),
        parse5.serialize(
            parse5.parseFragment(`<ol><li>3<li>1<li>2<li>4<li>5</ol>`)));
  });

  test('siblingsAfter', () => {
    const orderedList =
        parse5.parseFragment(`<ol><li>1<li>2<li>3<li>4<li>5</ol>`);
    const li3 = orderedList.childNodes![0]!.childNodes![2]!;
    const after3 = ast.siblingsAfter(li3);
    assert.equal(after3.length, 2);
    assert.equal(parse5.serialize(after3[0]), '4');
    assert.equal(parse5.serialize(after3[1]), '5');
  });

  test('stripComments', () => {
    const dom = parse5.parseFragment(`
      <!-- @license I'm a license. Keep me. -->
      <!--! I'm "important". Keep me. -->
      <!--#SSI-style directive. Keep me. -->
      <!--# SSI-style directive. Keep me. -->
      <!-- Just a comment. Remove me. -->
      <!--@Still just a comment. Remove me. -->
    `);
    ast.stripComments(dom);
    const html = parse5.serialize(dom);
    assert.include(html, `<!-- @license I'm a license. Keep me. -->`);
    assert.include(html, `<!--! I'm "important". Keep me. -->`);
    assert.include(html, `<!--#SSI-style directive. Keep me. -->`);
    assert.include(html, `<!--# SSI-style directive. Keep me. -->`);
    assert.notInclude(html, `<!-- Just a comment. Remove me. -->`);
    assert.notInclude(html, `<!--@Still just a comment. Remove me. -->`);
  });
});
