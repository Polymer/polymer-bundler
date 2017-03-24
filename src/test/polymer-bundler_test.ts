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
import {execSync} from 'child_process';
// import * as dom5 from 'dom5';
// import * as parse5 from 'parse5';
import * as path from 'path';
// import {Analyzer, FSUrlLoader} from 'polymer-analyzer';

// import {Bundle} from '../bundle-manifest';
// import {Bundler} from '../bundler';
// import {Options as BundlerOptions} from '../bundler';

chai.config.showDiff = true;

const assert = chai.assert;
// const matchers = require('../matchers');
// const preds = dom5.predicates;

suite('polymer-bundler CLI', () => {

  test('uses the current working folder as loader root', async() => {
    const projectRoot = path.resolve(__dirname, '../../test/html');
    const cli = path.resolve(__dirname, '../bin/polymer-bundler.js');
    const stdout =
        execSync([
          `cd ${projectRoot}`,
          `node ${cli} absolute-paths.html --inline-scripts --inline-css`,
        ].join(' && '))
            .toString();
    assert.include(stdout, '.absolute-paths-style');
    assert.include(stdout, 'hello from /absolute-paths/script.js');
  });
});
