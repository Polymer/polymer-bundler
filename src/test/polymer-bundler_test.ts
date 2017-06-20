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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

chai.config.showDiff = true;

const assert = chai.assert;

suite('polymer-bundler CLI', () => {

  const cliPath = path.resolve(__dirname, '../bin/polymer-bundler.js');

  test('uses the current working folder as loader root', async () => {
    const projectRoot = path.resolve(__dirname, '../../test/html');
    const stdout = execSync(
                       `cd ${projectRoot} && ` +
                       `node ${cliPath} absolute-paths.html`)
                       .toString();
    assert.include(stdout, '.absolute-paths-style');
    assert.include(stdout, 'hello from /absolute-paths/script.js');
  });

  test('uses the --root value option as loader root', async () => {
    const stdout = execSync([
                     `node ${cliPath} --root test/html absolute-paths.html`,
                   ].join(' && '))
                       .toString();
    assert.include(stdout, '.absolute-paths-style');
    assert.include(stdout, 'hello from /absolute-paths/script.js');
  });

  suite('--out-dir', () => {

    test('writes to the dir even for single bundle', async () => {
      const projectRoot = path.resolve(__dirname, '../../test/html');
      const tempdir = fs.mkdtempSync(path.join(os.tmpdir(), ' ').trim());
      execSync(
          `cd ${projectRoot} && ` +
          `node ${cliPath} absolute-paths.html ` +
          `--out-dir ${tempdir}`)
          .toString();
      const html =
          fs.readFileSync(path.join(tempdir, 'absolute-paths.html')).toString();
      assert.notEqual(html, '');
    });
  });

  suite('--manifest-out', () => {

    test('writes out the bundle manifest to given path', async () => {
      const projectRoot = path.resolve(__dirname, '../../test/html');
      const tempdir = fs.mkdtempSync(path.join(os.tmpdir(), ' ').trim());
      const manifestPath = path.join(tempdir, 'bundle-manifest.json');
      execSync(
          `cd ${projectRoot} && ` +
          `node ${cliPath} absolute-paths.html ` +
          `--manifest-out ${manifestPath}`)
          .toString();
      const manifestJson = fs.readFileSync(manifestPath).toString();
      const manifest = JSON.parse(manifestJson);
      assert.deepEqual(manifest, {
        'absolute-paths.html': [
          'absolute-paths.html',
          'absolute-paths/import.html',
          'absolute-paths/script.js',
          'absolute-paths/style.css',
        ],
      });
    });
  });

  suite('--redirect', () => {

    test('handles urls with arbitrary protocols and hosts', async () => {
      const projectRoot =
          path.resolve(__dirname, '../../test/html/url-redirection')
              // Force forward-slashes so quoting works with Windows paths.
              .replace(/\\/g, '/');
      const stdout =
          execSync([
            `cd ${projectRoot}`,
            `node ${cliPath} index.html ` +
                `--redirect="myapp://app/|${projectRoot}" ` +
                `--redirect="vendor://|${projectRoot}/../bower_components"`,
          ].join(' && '))
              .toString();
      assert.include(stdout, 'This is an external dependency');
      assert.include(stdout, 'id="home-page"');
      assert.include(stdout, 'id="settings-page"');
    });
  });
});
