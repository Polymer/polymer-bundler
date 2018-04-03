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

import {ensureTrailingSlash, resolvePath} from '../url-utils';

chai.config.showDiff = true;

const assert = chai.assert;

suite('polymer-bundler CLI', () => {
  const getTempDir = () =>
      fs.mkdtempSync(resolvePath(ensureTrailingSlash(os.tmpdir())));
  const cliPath = resolvePath(__dirname, '../bin/polymer-bundler.js');

  test('uses the current working folder as loader root', async () => {
    const projectRoot = resolvePath('test/html');
    const stdout =
        execSync(
            `cd ${projectRoot} && ` +
            `node ${cliPath} --inline-scripts --inline-css absolute-paths.html`)
            .toString();
    assert.include(stdout, '.absolute-paths-style');
    assert.include(stdout, 'hello from /absolute-paths/script.js');
  });

  test('uses the --root value option as loader root', async () => {
    const stdout =
        execSync([
          `node ${
                  cliPath
                } --root test/html --inline-scripts --inline-css absolute-paths.html`,
        ].join(' && '))
            .toString();
    assert.include(stdout, '.absolute-paths-style');
    assert.include(stdout, 'hello from /absolute-paths/script.js');
  });

  test(
      'Does not inline if --inline-scripts or --inline-css are not set',
      async () => {
        const stdout = execSync([
                         `node ${cliPath} test/html/external.html`,
                       ].join(' && '))
                           .toString();
        assert.include(stdout, 'href="external/external.css"');
        assert.include(stdout, 'src="external/external.js"');
      });

  suite('--out-dir', () => {
    test('writes to the dir even for single bundle', async () => {
      const projectRoot = resolvePath(__dirname, '../../test/html');
      const tempdir = getTempDir();
      execSync(
          `cd ${projectRoot} && ` +
          `node ${cliPath} absolute-paths.html ` +
          `--out-dir ${tempdir}`)
          .toString();
      const html = fs.readFileSync(resolvePath(tempdir, 'absolute-paths.html'))
                       .toString();
      assert.notEqual(html, '');
    });

    test('a single in-html file with deep path stays deep', async () => {
      const projectRoot = resolvePath(__dirname, '../../test');
      const tempdir = getTempDir();
      execSync(
          `cd ${projectRoot} && ` +
          `node ${cliPath} html/default.html ` +
          `--out-dir ${tempdir}`)
          .toString();
      const html =
          fs.readFileSync(resolvePath(tempdir, 'html/default.html')).toString();
      assert.notEqual(html, '');
    });
  });

  suite('--manifest-out', () => {
    test('writes out the bundle manifest to given path', async () => {
      const projectRoot = resolvePath(__dirname, '../../test/html');
      const tempdir = getTempDir();
      const manifestPath = resolvePath(tempdir, 'bundle-manifest.json');
      execSync(
          `cd ${projectRoot} && ` +
          `node ${cliPath} --inline-scripts --inline-css absolute-paths.html ` +
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
        '_missing': [
          'this/does/not/exist.html',
          'this/does/not/exist.js',
          'this/does/not/exist.css',
        ]
      });
    });

    test('manifest includes all files including basis', async () => {
      const projectRoot = resolvePath(__dirname, '../../test/html/imports');
      const tempdir = getTempDir();
      const manifestPath = resolvePath(tempdir, 'bundle-manifest.json');
      execSync(
          `cd ${projectRoot} && ` +
          `node ${cliPath} --inline-scripts --inline-css ` +
          `--in-file eagerly-importing-a-fragment.html ` +
          `--in-file importing-fragments/fragment-a.html ` +
          `--in-file importing-fragments/fragment-b.html ` +
          `--shell importing-fragments/shell.html ` +
          `--out-dir ${tempdir}/bundled/ ` +
          `--manifest-out ${manifestPath}`)
          .toString();
      const manifestJson = fs.readFileSync(manifestPath).toString();
      const manifest = JSON.parse(manifestJson);
      assert.deepEqual(manifest, {
        'eagerly-importing-a-fragment.html': [
          'eagerly-importing-a-fragment.html',
        ],
        'importing-fragments/fragment-a.html': [
          'importing-fragments/fragment-a.html',
        ],
        'importing-fragments/fragment-b.html': [
          'importing-fragments/fragment-b.html',
        ],
        'importing-fragments/shell.html': [
          'importing-fragments/shared-util.html',
          'importing-fragments/shell.html',
        ],
      });
    });
  });

  suite('--redirect', () => {
    test('handles URLs with arbitrary protocols and hosts', async () => {
      const projectRoot =
          resolvePath(__dirname, '../../test/html')
              // Force forward-slashes so quoting works with Windows paths.
              .replace(/\\/g, '/');
      const tempdir = getTempDir();
      const manifestPath = resolvePath(tempdir, 'bundle-manifest.json');
      const stdout =
          execSync([
            `cd ${projectRoot}`,
            `node ${cliPath} myapp://app/index.html ` +
                `--redirect="myapp://app/|${projectRoot}/url-redirection/" ` +
                `--redirect="vendor://|${projectRoot}/bower_components/" ` +
                `--manifest-out ${manifestPath}`
          ].join(' && '))
              .toString();
      assert.include(stdout, 'This is an external dependency');
      assert.include(stdout, 'id="home-page"');
      assert.include(stdout, 'id="settings-page"');
      const manifestJson = fs.readFileSync(manifestPath).toString();
      const manifest = JSON.parse(manifestJson);
      assert.deepEqual(manifest, {
        'myapp://app/index.html': [
          'myapp://app/index.html',
          'myapp://app/home.html',
          'vendor://external-dependency/external-dependency.html',
          'myapp://app/settings.html'
        ],
      });
    });
  });
});
