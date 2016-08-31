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

import * as AstUtils from '../ast-utils';


const assert = chai.assert;

const normalize = (html: string) => {
  const parsed = dom5.parse(html);
  dom5.normalize(parsed);
  return dom5.serialize(parsed);
};

suite('AST Utils', function() {
  test('moveRemainderToBody', () => {
    const needsMoving = dom5.parse(`<head>
    <link rel="stylesheet" href="b.css">
    <link rel="import" href="a.html"></head>
    <body>
    </body>`);
    const expected = `<head>
    <link rel="stylesheet" href="b.css">
    </head>
    <body><link rel="import" href="a.html">
    </body>`;
    const aLink = needsMoving.childNodes![0]!.childNodes![0]!.childNodes![3]!;
    const body = needsMoving.childNodes![0]!.childNodes![2]!;
    AstUtils.moveRemainderToTarget(aLink, body);
    dom5.normalize(needsMoving);
    assert.equal(dom5.serialize(needsMoving), normalize(expected));
  });
});
