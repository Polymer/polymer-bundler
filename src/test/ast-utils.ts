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

import * as ast from '../ast-utils';
import * as matchers from '../matchers';


const assert = chai.assert;

const normalize = (html: string) => {
  const parsed = dom5.parse(html);
  dom5.normalize(parsed);
  return dom5.serialize(parsed);
};

suite('AST Utils', function() {

  test('prepend', () => {
    const orderedList =
        dom5.parseFragment(`<ol><li>1<li>2<li>3<li>4<li>5</ol>`);
    const ol = orderedList.childNodes![0]!;
    const li3 = ol.childNodes![2]!;
    ast.prepend(ol, li3);
    assert.equal(
        dom5.serialize(ol.parentNode),
        dom5.serialize(
            dom5.parseFragment(`<ol><li>3<li>1<li>2<li>4<li>5</ol>`)));
  });

  test('prependAll', () => {
    const orderedList =
        dom5.parseFragment(`<ol><li>1<li>2<li>3<li>4<li>5</ol>`);
    const ol = orderedList.childNodes![0]!;
    const li3 = ol.childNodes![2]!;
    const li5 = ol.childNodes![4]!;
    ast.prependAll(ol, [li3, li5]);
    assert.equal(
        dom5.serialize(ol.parentNode),
        dom5.serialize(
            dom5.parseFragment(`<ol><li>3<li>5<li>1<li>2<li>4</ol>`)));
  });

  test('siblingsAfter', () => {
    const orderedList =
        dom5.parseFragment(`<ol><li>1<li>2<li>3<li>4<li>5</ol>`);
    const li3 = orderedList.childNodes![0]!.childNodes![2]!;
    const after3 = ast.siblingsAfter(li3);
    assert.equal(after3.length, 2);
    assert.equal(dom5.serialize(after3[0]), '4');
    assert.equal(dom5.serialize(after3[1]), '5');
  });
});
