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
import {assert} from 'chai';
import {mindent, undent} from './test-utils';

suite('test-utils', () => {

  suite('mindent', () => {

    test('returns the minimum indentation in a string', () => {
      assert.equal(mindent('  x'), 2);
      assert.equal(mindent(`
          x
        y <-- 8 characters indented
            z
      `), 8);
    });
  });

  suite('undent', () => {

    test('removes the minimum indentation from a string', () => {
      assert.deepEqual(undent('  x'), 'x');
      assert.deepEqual(undent(`
          x
        y
            z
      `), '\n  x\ny\n    z\n');
    });
  });
});
