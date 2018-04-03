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
import * as fs from 'fs';
import * as parse5 from 'parse5';
import {Analyzer, FsUrlLoader, FsUrlResolver} from 'polymer-analyzer';

import {Bundle, generateShellMergeStrategy} from '../bundle-manifest';
import {Bundler, Options as BundlerOptions} from '../bundler';
import {BundledDocument} from '../document-collection';
import * as matchers from '../matchers';
import {resolvePath} from '../url-utils';

chai.config.showDiff = true;

const assert = chai.assert;
const preds = dom5.predicates;

// TODO(usergenic): This suite is getting very big.  Please break up the file
// and/or reorganize the suites and tests to be easier to find and reason about.
suite('Bundler', () => {
  let documentBundle: Bundle;
  let analyzer: Analyzer|undefined;
  let bundler: Bundler|undefined;

  beforeEach(() => {
    analyzer = undefined;
    bundler = undefined;
  });

  function getAnalyzer(opts?: any): Analyzer {
    if (!analyzer) {
      if (!opts || !opts.urlResolver) {
        const urlResolver = new FsUrlResolver(resolvePath('test/html'), );
        opts = Object.assign({}, opts || {}, {urlResolver});
      }
      if (!opts || !opts.urlLoader) {
        const urlLoader = new FsUrlLoader(resolvePath('test/html'));
        opts = Object.assign({}, opts || {}, {urlLoader});
      }
      analyzer = new Analyzer(opts);
    }
    return analyzer;
  }

  function getBundler(opts?: any): Bundler {
    if (!bundler) {
      if (!opts || !opts.analyzer) {
        opts = Object.assign({}, opts || {}, {
          analyzer: getAnalyzer(),
        });
      }
      bundler = new Bundler(opts);
    }
    return bundler;
  }

  function resolve(url: string) {
    return getAnalyzer().resolveUrl(url)!;
  }

  const inputPath = 'default.html';

  async function bundle(inputPath: string, opts?: BundlerOptions):
      Promise<BundledDocument> {
        // Don't modify options directly because test-isolation problems occur.
        bundler = getBundler(opts);
        const resolvedInputPath = resolve(inputPath)!;
        const manifest = await bundler.generateManifest([resolvedInputPath]);
        const bundleResult = await bundler.bundle(manifest);
        const bundleForFile =
            bundleResult.manifest.getBundleForFile(resolvedInputPath);
        if (!bundleForFile) {
          throw new Error(`Unable to find bundle for ${resolvedInputPath}`);
        }
        documentBundle = bundleForFile.bundle;
        const {documents} = bundleResult;
        return documents.get(resolvedInputPath)!;
      }

  suite('Default Options', () => {
    test('URLs for inlined HTML imports are recorded in Bundle', async () => {
      await bundle(inputPath);
      assert.deepEqual([...documentBundle.inlinedHtmlImports], [
        resolve('imports/simple-import.html'),
        resolve('imports/another-simple-import.html'),
      ]);
    });

    test('imports removed', async () => {
      const imports = preds.AND(
          preds.hasTagName('link'),
          preds.hasAttrValue('rel', 'import'),
          preds.hasAttr('href'),
          preds.NOT(preds.hasAttrValue('type', 'css')));
      assert.equal(
          dom5.queryAll((await bundle(inputPath)).ast, imports).length, 0);
    });

    test('imports were deduplicated', async () => {
      assert.equal(
          dom5.queryAll(
                  (await bundle(inputPath)).ast,
                  preds.AND(
                      preds.hasAttrValue('id', 'my-element'),
                      preds.hasTagName('dom-module')))
              .length,
          1);
    });
  });

  suite('Applying strategy', () => {
    test('inlines css/scripts of html imports added by strategy', async () => {
      const bundler = new Bundler({
        inlineCss: true,
        inlineScripts: true,
        // This strategy adds a file not in the original document to the
        // bundle.
        strategy: (bundles: Bundle[]): Bundle[] => {
          bundles.forEach((b) => {
            b.files.add(resolve('imports/external-script.html'));
            b.files.add(resolve('imports/import-linked-style.html'));
          });
          return bundles;
        },
      });

      const manifest =
          await bundler.generateManifest([resolve('default.html')]);
      const {documents} = await bundler.bundle(manifest);
      const document = documents.get(resolve('default.html'))!;
      assert(document);

      // Look for the script referenced in the external-script.html source.
      const scriptTags =
          dom5.queryAll(document.ast!, preds.hasTagName('script'))!;
      assert.isAtLeast(scriptTags.length, 1);
      assert.include(
          dom5.getTextContent(scriptTags.pop()!),
          `console.log('imports/external.js');`);

      // Look for the css referenced in the import-linked-style.html source.
      const styleTags =
          dom5.queryAll(document.ast!, preds.hasTagName('style'))!;
      assert.isAtLeast(styleTags.length, 1);
      assert.include(
          dom5.getTextContent(styleTags.pop()!), `.from-import-linked-style {`);
    });

    test(
        'changes the href to another bundle if strategy moved it', async () => {
          const bundler = getBundler({
            // This strategy moves a file to a different bundle.
            strategy: (bundles: Bundle[]): Bundle[] => {
              return [
                new Bundle(
                    'html-fragment',
                    new Set([resolve('default.html')]),
                    new Set([resolve('default.html')])),
                new Bundle(
                    'html-fragment',
                    new Set(),  //
                    new Set([
                      resolve('imports/simple-import.html'),
                      resolve('imports/another-simple-import.html'),
                    ]))
              ];
            }
          });
          const manifest =
              await bundler.generateManifest([resolve('default.html')]);
          const {documents} = await bundler.bundle(manifest);
          const document = documents.get(resolve('default.html'))!;
          assert(document);

          // We've moved the 'imports/simple-import.html' into a shared bundle
          // so a link to import it now points to the shared bundle instead.
          const linkTag = dom5.query(
              document.ast!,
              preds.AND(
                  preds.hasTagName('link'),
                  preds.hasAttrValue('rel', 'import')))!;
          assert(linkTag);
          assert.equal(
              dom5.getAttribute(linkTag, 'href'), 'shared_bundle_1.html');

          const shared = documents.get(resolve('shared_bundle_1.html'))!;
          assert(shared);
          assert.isOk(dom5.query(
              shared.ast, dom5.predicates.hasAttrValue('id', 'my-element')));
        });

    test('bundle documents should not have tags added to them', async () => {
      const {ast} = await bundle('imports/simple-import.html');
      assert.isNull(dom5.query(
          ast,
          dom5.predicates.OR(
              dom5.predicates.hasTagName('html'),
              dom5.predicates.hasTagName('head'),
              dom5.predicates.hasTagName('body'))));
    });
  });

  suite('external dependencies', () => {
    test('html imports from bower_components are inlined', async () => {
      const {ast} = await bundle('external-dependencies.html');
      const div =
          dom5.query(ast, preds.hasAttrValue('id', 'external-dependency'));
      assert(div);
    });
  });

  test('svg is nested correctly', async () => {
    const opts = {inlineScripts: false, inlineCss: false};
    const svg = dom5.query(
                        (await bundle(inputPath, opts)).ast,
                        matchers.template)!['content']
                    .childNodes[1];
    assert.equal(svg.childNodes!.filter(dom5.isElement).length, 6);
  });

  test('import bodies are in one hidden div', async () => {
    assert.equal(
        dom5.queryAll((await bundle(inputPath)).ast, matchers.hiddenDiv).length,
        1);
  });

  test('lazy imports are not moved', async () => {
    const bundler = getBundler();
    const manifest =
        await bundler.generateManifest([resolve('imports/lazy-imports.html')]);
    const {documents} = await bundler.bundle(manifest);

    // The `lazy-imports.html` file has 2 imports in the head of the
    // document.  The first is eager and should be moved.  The remaining
    // one is lazy and should not be moved.
    const entrypointBundle =
        documents.get(resolve('imports/lazy-imports.html'))!.ast;
    const entrypointLazyImports = dom5.queryAll(
        entrypointBundle,
        preds.AND(preds.parentMatches(matchers.head), matchers.htmlImport));
    assert.equal(entrypointLazyImports.length, 1);
    assert.equal(dom5.getAttribute(entrypointLazyImports[0]!, 'group'), 'one');

    // The shared bundle has an inlined dom-module with an embedded
    // lazy-import via `shared-eager-import-2.html` that we are verifying
    // is preserved.
    const sharedBundle = documents.get(resolve('shared_bundle_1.html'))!.ast;
    const sharedLazyImports = dom5.queryAll(
        sharedBundle,
        preds.AND(
            preds.parentMatches(preds.hasTagName('dom-module')),
            preds.hasTagName('link'),
            preds.hasAttrValue('rel', 'lazy-import')));
    assert.equal(sharedLazyImports.length, 1);
    assert.equal(dom5.getAttribute(sharedLazyImports[0]!, 'group'), 'deeply');
  });

  test('dom-modules have assetpath', async () => {
    const assetpath = preds.AND(
        preds.hasTagName('dom-module'),
        preds.hasAttrValue('assetpath', 'imports/'));
    assert.ok(
        dom5.query((await bundle(inputPath)).ast, assetpath), 'assetpath set');
  });

  test('output file is forced utf-8', async () => {
    const meta = preds.AND(
        preds.hasTagName('meta'), preds.hasAttrValue('charset', 'UTF-8'));
    assert.ok(dom5.query((await bundle(inputPath)).ast, meta));
  });

  test('lazy imports are treated like entrypoints', async () => {
    const bundler = getBundler();
    const manifest =
        await bundler.generateManifest([resolve('imports/lazy-imports.html')]);
    const {documents} = await bundler.bundle(manifest);

    const lazyImports =
        documents.get(resolve('imports/lazy-imports.html'))!.content;

    assert.include(
        lazyImports,
        '<link rel="lazy-import" group="one" href="lazy-imports/lazy-import-1.html">',
        'lazy-imports.html should keep link to lazy-import-1.html');
    assert.include(
        lazyImports,
        '<link rel="lazy-import" group="two" href="lazy-imports/lazy-import-2.html">',
        'lazy-imports.html should keep link to lazy-import-2.html');

    const lazyImport1 =
        documents.get(resolve(
            'imports/lazy-imports/lazy-import-1.html'))!.content;

    assert.include(
        lazyImport1,
        '<link rel="import" href="../../shared_bundle_1.html">',
        'lazy-import-1.html should have a link to shared_bundle_1.html');
    assert.include(
        lazyImport1,
        '<link rel="lazy-import" href="shared-eager-and-lazy-import-1.html">',
        'lazy-import-1.html should keep link to lazy-import shared-eager-and-lazy-import-1.html');

    const lazyImport2 =
        documents.get(resolve(
            'imports/lazy-imports/lazy-import-2.html'))!.content;

    assert.include(
        lazyImport2,
        '<link rel="import" href="../../shared_bundle_1.html">',
        'lazy-import-2.html should have a link to shared_bundle_1.html');
    assert.include(
        lazyImport2,
        '<link rel="import" href="shared-eager-and-lazy-import-1.html">',
        'lazy-import-2.html should keep link to import shared-eager-and-lazy-import-1.html');

    const sharedEagerBundle =
        documents.get(resolve('shared_bundle_1.html'))!.content;
    assert.include(sharedEagerBundle, '<div id="shared-eager-import-2">');
  });

  test('lazy imports governed by dom-module assetpath', async () => {
    const bundler = getBundler({
      // We exclude this import so we can examine how the eager import URL
      // is modified in the bundled lazy-import-2.html document.
      excludes: [resolve('imports/lazy-imports/subfolder/eager-import-2.html')],
    });
    const manifest =
        await bundler.generateManifest([resolve('imports/lazy-imports.html')]);
    const {documents} = await bundler.bundle(manifest);

    const lazyImport2 =
        documents.get(resolve(
            'imports/lazy-imports/lazy-import-2.html'))!.content;

    assert.include(
        lazyImport2,
        '<dom-module id="eager-import-1" assetpath="subfolder/">',
        'lazy-import-2.html should have inlined subfolder/eager-import-1.html');
    assert.include(
        lazyImport2,
        '<link rel="lazy-import" href="lazy-import-3.html">',
        'The href of the lazy import link in the inlined dom-module should not be modified');
    assert.include(
        lazyImport2,
        '<link rel="import" href="subfolder/eager-import-2.html">',
        'The href of an eager import link inside a dom-module should still be modified');
  });

  test('Handle <base> tag', async () => {
    const span = preds.AND(
        preds.hasTagName('span'), preds.hasAttrValue('href', 'imports/hello'));
    const a = preds.AND(
        preds.hasTagName('a'),
        preds.hasAttrValue('href', 'imports/sub-base/sub-base.html'));
    const {ast: doc} = await bundle(resolve('base.html'));
    const spanHref = dom5.query(doc, span);
    assert.ok(spanHref);
    const anchorRef = dom5.query(doc, a);
    assert.ok(anchorRef);
  });

  test('Imports in <body> are handled correctly', async () => {
    const importMatcher = preds.AND(
        preds.hasTagName('link'), preds.hasAttrValue('rel', 'import'));

    const bodyContainerMatcher = preds.AND(
        preds.hasTagName('div'),
        preds.hasAttr('hidden'),
        preds.hasAttr('by-polymer-bundler'));

    const scriptExpected = preds.hasTagName('script');
    const divExpected = preds.AND(
        preds.hasTagName('div'), preds.hasAttrValue('id', 'imported'));

    const {ast: doc} = await bundle(resolve('import-in-body.html'));
    const imports = dom5.queryAll(doc, importMatcher);
    assert.equal(imports.length, 0);
    const bodyContainer = dom5.query(doc, bodyContainerMatcher)!;
    const scriptActual = dom5.query(doc, scriptExpected)!.parentNode!;
    const divActual = dom5.query(doc, divExpected)!.parentNode!;
    assert.equal(bodyContainer, scriptActual);
    assert.equal(bodyContainer, divActual);
  });

  test('Scripts are not inlined if specified', async () => {
    const scripts = dom5.queryAll(
        (await bundle(resolve('external.html'), {inlineScripts: false})).ast,
        matchers.externalNonModuleScript);
    assert.isAbove(scripts.length, 0, 'scripts were inlined');
    scripts.forEach(function(s) {
      assert.equal(dom5.getTextContent(s), '', 'script src should be empty');
    });
  });

  test('Paths for import bodies are resolved correctly', async () => {
    const anchorMatcher = preds.hasTagName('a');
    const input = resolve('multiple-imports.html');
    const anchor = dom5.query((await bundle(input)).ast, anchorMatcher)!;
    const href = dom5.getAttribute(anchor, 'href');
    assert.equal(href, 'imports/target.html');
  });

  test('Spaces in paths are handled correctly', async () => {
    const input = resolve('spaces.html');
    const spacesMatcher = preds.AND(
        preds.hasTagName('dom-module'),
        preds.hasAttrValue('id', 'space-element'));
    const module = dom5.query((await bundle(input)).ast, spacesMatcher);
    assert.ok(module);
  });

  suite('Script Ordering', () => {
    test('Imports and scripts are ordered correctly', async () => {
      const {ast: doc} =
          await bundle(resolve('order-test.html'), {inlineScripts: false});

      const expectedOrder = [
        'first-script',
        'second-import-first-script',
        'second-import-second-script',
        'first-import-first-script',
        'first-import-second-script',
        'second-script',
        'third-script'
      ];

      const expectedSrc = [
        'order/first-script.js',
        'order/second-import/first-script.js',
        'order/second-import/second-script.js',
        'order/first-import/first-script.js',
        'order/first-import/second-script.js',
        'order/second-script.js',
        'order/third-script.js'
      ];

      const scripts = dom5.queryAll(doc, matchers.nonModuleScript);
      const actualOrder: Array<string> = [], actualSrc: Array<string> = [];
      scripts.forEach(function(s) {
        actualOrder.push(dom5.getAttribute(s, 'id')!);
        actualSrc.push(dom5.getAttribute(s, 'src')!);
      });
      assert.deepEqual(actualOrder, expectedOrder, 'order is not as expected');
      assert.deepEqual(
          actualSrc, expectedSrc, 'srcs are not preserved correctly');
    });

    test('exhaustive script order testing', async () => {
      const {content: serialized} =
          await bundle('script-order/index.html', {inlineScripts: true});
      const beforeLoc = serialized.indexOf('window.BeforeJs');
      const afterLoc = serialized.indexOf('BeforeJs.value');
      assert.isBelow(beforeLoc, afterLoc);
    });

    test('Paths are correct when maintaining order', async () => {
      const {ast: doc} = await bundle('recursion/import.html');
      assert(doc);
      const scripts = dom5.queryAll(
          doc, preds.AND(preds.hasTagName('script'), preds.hasAttr('src')));
      for (const s of scripts) {
        const src = dom5.getAttribute(s, 'src')!;
        assert.equal(
            src.indexOf('../order'), 0, 'path should start with ../order');
      }
    });
  });

  suite('Absolute paths in URLs', () => {
    test('will be resolved by the analyzer', async () => {
      const options = {inlineCss: true, inlineScripts: true};
      const {content: html} = await bundle('absolute-paths.html', options);
      assert.include(html, '.absolute-paths-style');
      assert.include(html, 'hello from /absolute-paths/script.js');
    });
  });

  suite('Excludes', () => {
    test('Excluded imports are not inlined', async () => {
      const {ast: doc} = await bundle(inputPath, {
        excludes: [resolve('imports/simple-import.html')],
      });
      const imports = dom5.queryAll(
          doc,
          preds.AND(
              preds.hasTagName('link'),
              preds.hasAttrValue('rel', 'import'),
              preds.hasAttrValue('href', 'imports/simple-import.html')));
      assert.equal(imports.length, 1);
    });

    test('Excluded imports are not listed as missing', async () => {
      const bundler = getBundler({
        analyzer: analyzer,
        excludes: [
          resolve('this/does/not/exist.html'),
          resolve('this/does/not/exist.js'),
          resolve('this/does/not/exist.css'),
        ].map(resolve),
      });
      const manifest = await bundler.generateManifest([
        'absolute-paths.html',
      ].map(resolve));
      const result = await bundler.bundle(manifest);
      assert.deepEqual(
          [...result.manifest.bundles.get(resolve(
              'absolute-paths.html'))!.missingImports],
          []);
    });

    test('Excluded CSS file urls is not inlined', async () => {
      const {content} = await bundle('external.html', {
        excludes: [resolve('external/external.css')],
      });
      assert.include(content, 'href="external/external.css"');
    });

    test('Excluded CSS folder urls are not inlined', async () => {
      const {content} = await bundle('external.html', {
        excludes: [resolve('external')],
      });
      assert.include(content, 'href="external/external.css"');
    });

    test('Excluded Script file urls are not inlined', async () => {
      const {content} = await bundle('external.html', {
        excludes: [resolve('external/external.js')],
      });
      assert.include(content, 'src="external/external.js"');
    });

    test('Excluded Script folder urls are not inlined', async () => {
      const {content} = await bundle('external.html', {
        excludes: [resolve('external')],
      });
      assert.include(content, 'src="external/external.js"');
    });

    test('Excluded comments are removed', async () => {
      const options = {stripComments: true};
      const {ast: doc} = await bundle('comments.html', options);
      const comments = dom5.nodeWalkAll(
          doc, dom5.isCommentNode, undefined, dom5.childNodesIncludeTemplate);
      const commentsExpected = [
        '#important server-side include business',
        '# this could be a server-side include too',
        '@license common',
        '@license main',
        '@license import 1',
        '@license import 2'
      ];
      const commentsActual = comments.map((c) => dom5.getTextContent(c).trim());
      assert.deepEqual(commentsActual, commentsExpected);
    });

    test('Comments are kept by default', async () => {
      const options = {stripComments: false};
      const {ast: doc} = await bundle('comments.html', options);
      const comments = dom5.nodeWalkAll(doc, dom5.isCommentNode);

      // NOTE: Explicitly not trimming the expected comments to ensure we keep
      // the test fixtures with the same whitespace they currently have.
      const expectedComments = [
        '#important server-side include business ',
        '# this could be a server-side include too ',
        ' #this is not a server-side include ',
        ' @license common ',
        ' @license main ',
        '\n@license common\n',
        ' @license import 1 ',
        '\n  @license common\n  ',
        ' comment in import 1 ',
        ' @license import 2 ',
        ' comment in import 2 ',
        ' comment in main '
      ];
      const actualComments = comments.map((c) => dom5.getTextContent(c));
      assert.deepEqual(actualComments, expectedComments);
    });

    test('Folder can be excluded', async () => {
      const linkMatcher = preds.AND(
          preds.hasTagName('link'), preds.hasAttrValue('rel', 'import'));
      const options = {excludes: [resolve('imports/')]};
      const {ast: doc} = await bundle('default.html', options);
      const links = dom5.queryAll(doc, linkMatcher);
      // one duplicate import is removed.  default.html contains this
      // duplication:
      //     <link rel="import" href="imports/simple-import.html">
      //     <link rel="import" href="imports/simple-import.html">
      //     <link rel="import" href="imports/another-simple-import.html">
      assert.equal(links.length, 2);
      assert.equal(
          dom5.getAttribute(links[0]!, 'href'), 'imports/simple-import.html');
      assert.equal(
          dom5.getAttribute(links[1]!, 'href'),
          'imports/another-simple-import.html');
    });
  });

  suite('Inline Scripts', () => {
    const options = {inlineScripts: true};

    test('URLs for inlined scripts are recorded in Bundle', async () => {
      await bundle('external.html');
      assert.deepEqual(
          [...documentBundle.inlinedScripts],
          [resolve('external/external.js')]);
    });

    test('External script tags are replaced with inline scripts', async () => {
      const {ast: doc} = await bundle('external.html', options);
      const externalScripts =
          dom5.queryAll(doc, matchers.externalNonModuleScript);
      assert.equal(externalScripts.length, 0);
      const inlineScripts = dom5.queryAll(doc, matchers.inlineNonModuleScript);
      assert.equal(inlineScripts.length, 1);
    });

    test('Remote scripts are kept', async () => {
      const {ast: doc} = await bundle('scripts.html', options);
      const scripts = dom5.queryAll(doc, matchers.externalNonModuleScript);
      assert.equal(scripts.length, 1);
      assert.equal(
          dom5.getAttribute(scripts[0], 'src'),
          'https://ajax.googleapis.com/ajax/libs/jquery/2.1.3/jquery.min.js');
      assert.deepEqual([...documentBundle.inlinedScripts].sort(), [
        resolve('external/external.js'),
        resolve('imports/external.js'),
      ]);
    });

    test('Absolute paths are correct for excluded links', async () => {
      const target = 'absolute-paths/import.html';
      const options = {
        excludes: [resolve('absolute-paths/script.js')],
      };
      const {ast: doc} = await bundle(target, options);
      const scripts = dom5.queryAll(doc, matchers.externalNonModuleScript);
      assert.equal(scripts.length, 2);
      assert.deepEqual(
          dom5.getAttribute(scripts[0]!, 'src'), '/absolute-paths/script.js');

      // A missing script will not be inlined and the script tag will not
      // be removed.
      assert.deepEqual(
          dom5.getAttribute(scripts[1]!, 'src'), '/this/does/not/exist.js');
    });

    test('Escape inline <script>', async () => {
      const {ast: doc} = await bundle('xss.html', options);
      const script = dom5.query(doc, matchers.inlineNonModuleScript)!;
      assert.include(
          dom5.getTextContent(script),
          'var b = 0<\\/script><script>alert(\'XSS\'); //2;',
          'Inline <script> should be escaped');
    });

    test('Inlined Scripts are in the expected order', async () => {
      const {ast: doc} = await bundle('reordered/in.html', options);
      const scripts = dom5.queryAll(doc, matchers.inlineNonModuleScript)!;
      const contents = scripts.map((script) => dom5.getTextContent(script));
      assert.deepEqual(['"First"', '"Second"'], contents);
    });

    test('Firebase works inlined', async () => {
      const {ast: doc} = await bundle('firebase.html', {
        inlineScripts: true,
        analyzer: new Analyzer({urlLoader: new FsUrlLoader()}),
      });
      const scripts = dom5.queryAll(doc, matchers.inlineNonModuleScript)!;
      assert.equal(scripts.length, 1);
      const idx = dom5.getTextContent(scripts[0]).indexOf('</script>');
      assert(idx === -1, '/script found, should be escaped');
    });
  });

  suite('Inline CSS', () => {
    const options = {inlineCss: true};

    test('URLs for inlined styles are recorded in Bundle', async () => {
      await bundle(inputPath);
      assert.deepEqual([...documentBundle.inlinedStyles].sort(), [
        'imports/import-linked-style.css',
        'imports/regular-style.css',
        'imports/simple-style.css',
      ].map(resolve));
    });

    test('External links are replaced with inlined styles', async () => {
      const {ast: doc} = await bundle(inputPath, options);
      const links = dom5.queryAll(doc, matchers.stylesheetImport);
      const styles = dom5.queryAll(
          doc, matchers.styleMatcher, [], dom5.childNodesIncludeTemplate);
      assert.equal(links.length, 0);
      assert.equal(styles.length, 5);
      assert.match(dom5.getTextContent(styles[0]), /regular-style/);
      assert.match(dom5.getTextContent(styles[1]), /simple-style/);
      assert.match(dom5.getTextContent(styles[2]), /import-linked-style/);
      assert.match(dom5.getTextContent(styles[3]), /simple-style/);
      assert.match(dom5.getTextContent(styles[4]), /import-linked-style/);

      // Verify the inlined url() values in the stylesheet are not rewritten
      // to use the "imports/" prefix, since the stylesheet is inside a
      // `<dom-module>` with an assetpath that defines the base url as
      // "imports/".
      assert.match(
          dom5.getTextContent(styles[1]), /url\("assets\/platform\.png"\)/);
    });

    test('External style links in templates are inlined', async () => {
      const {ast: doc} =
          await bundle('external-in-template.html', {inlineCss: true});
      const externalStyles = dom5.queryAll(
          doc,
          matchers.externalStyle,
          undefined,
          dom5.childNodesIncludeTemplate);
      assert.equal(externalStyles.length, 0);

      // There were two links to external styles in the file, now there
      // should be two occurrences of inlined styles.  Note they are the
      // same external styles, so inlining should be happening for each
      // occurrence of the external style.
      const inlineStyles = dom5.queryAll(
          doc,
          matchers.styleMatcher,
          undefined,
          dom5.childNodesIncludeTemplate);
      assert.equal(inlineStyles.length, 2);
      assert.match(dom5.getTextContent(inlineStyles[0]), /content: 'external'/);
      assert.match(dom5.getTextContent(inlineStyles[1]), /content: 'external'/);
    });

    test('Inlined styles observe containing dom-module assetpath', async () => {
      const {ast: doc} =
          await bundle('style-rewriting.html', {inlineCss: true});
      const style = dom5.query(
          doc, matchers.styleMatcher, dom5.childNodesIncludeTemplate)!;
      assert.isNotNull(style);
      assert.match(dom5.getTextContent(style), /url\("styles\/unicorn.png"\)/);
    });

    test('Inlining ignores assetpath if rewriteUrlsInTemplates', async () => {
      const {ast: doc} = await bundle(
          'style-rewriting.html',
          {inlineCss: true, rewriteUrlsInTemplates: true});
      const style = dom5.query(
          doc, matchers.styleMatcher, dom5.childNodesIncludeTemplate)!;
      assert.isNotNull(style);
      assert.match(
          dom5.getTextContent(style),
          /url\("style-rewriting\/styles\/unicorn.png"\)/);
    });

    test('Inlined styles have proper paths', async () => {
      const {ast: doc} = await bundle('inline-styles.html', options);
      const styles = dom5.queryAll(
          doc, matchers.styleMatcher, [], dom5.childNodesIncludeTemplate);
      assert.equal(styles.length, 2);
      const content = dom5.getTextContent(styles[1]);
      assert(content.search('imports/foo.jpg') > -1, 'path adjusted');
      assert(content.search('@apply') > -1, '@apply kept');
    });

    test('Remote styles and media queries are preserved', async () => {
      const input = 'imports/remote-stylesheet.html';
      const {ast: doc} = await bundle(input, options);
      const links = dom5.queryAll(doc, matchers.externalStyle);
      assert.equal(links.length, 1);
      assert.match(
          dom5.getAttribute(links[0]!, 'href')!, /fonts.googleapis.com/);
      const styles = dom5.queryAll(doc, matchers.styleMatcher);
      assert.equal(styles.length, 1);
      assert.equal(dom5.getAttribute(styles[0], 'media'), '(min-width: 800px)');
    });

    test('Inlined Polymer styles are moved into the <template>', async () => {
      const {ast: doc} = await bundle('default.html', options);
      const domModule = dom5.query(doc, preds.hasTagName('dom-module'))!;
      assert(domModule);
      const template = dom5.query(domModule, matchers.template)!;
      assert(template);

      const styles = dom5.queryAll(
          template, matchers.styleMatcher, [], dom5.childNodesIncludeTemplate);
      assert.equal(styles.length, 2);
      assert.match(
          dom5.getTextContent(styles[0]), /simple-style/, 'simple-style.css');
      assert.match(
          dom5.getTextContent(styles[1]),
          /import-linked-style/,
          'import-linked-style.css');
    });

    test(
        'Inlined Polymer styles force dom-module to have template',
        async () => {
          const {ast: doc} = await bundle('inline-styles.html', options);
          const domModule = dom5.query(doc, preds.hasTagName('dom-module'))!;
          assert(domModule);
          const template = dom5.query(domModule, matchers.template)!;
          assert(template);
          const style = dom5.query(
              template, matchers.styleMatcher, dom5.childNodesIncludeTemplate);
          assert(style);
        });
  });

  suite('Regression Testing', () => {
    // Ensure this https://github.com/Polymer/polymer-bundler/issues/596 doesn't
    // happen again.
    test('Bundled file should not import itself', async () => {
      const {ast: doc} = await bundle('default.html', {
        inlineCss: true,
        analyzer: new Analyzer({urlLoader: new FsUrlLoader('.')}),
      });

      const link = dom5.query(
          doc,
          preds.AND(
              matchers.htmlImport, preds.hasAttrValue('href', 'default.html')));
      assert.isNull(link, `Found unexpected link to default.html (self)`);
    });

    test('Base tag emulation should not leak to other imports', async () => {
      const {ast: doc} = await bundle('base.html');
      const clickMe = dom5.query(doc, preds.hasTextValue('CLICK ME'));
      assert.ok(clickMe);

      // The base target from `test/html/imports/base.html` should apply to
      // the anchor tag in it.
      assert.equal(dom5.getAttribute(clickMe!, 'target'), 'foo-frame');

      const doNotClickMe =
          dom5.query(doc, preds.hasTextValue('DO NOT CLICK ME'));
      assert.ok(doNotClickMe);

      // The base target from `test/html/imports/base.html` should NOT apply
      // to the anchor tag in `test/html/imports/base-foo/sub-base.html`
      assert.isFalse(dom5.hasAttribute(doNotClickMe!, 'target'));
    });

    test('Complicated Ordering', async () => {
      // refer to
      // https://github.com/Polymer/polymer-bundler/tree/master/test/html/complicated/ordering.svg
      // for visual reference on the document structure for this example
      const {ast: doc} =
          await bundle('complicated/A.html', {inlineScripts: true});
      assert(doc);
      const expected = ['A1', 'C', 'E', 'B', 'D', 'A2'];
      const scripts = dom5.queryAll(doc, matchers.nonModuleScript);
      const contents = scripts.map(function(s) {
        return dom5.getTextContent(s).trim();
      });
      assert.deepEqual(contents, expected);
    });

    test('Assetpath rewriting', async () => {
      const {ast: doc} = await bundle(
          'path-rewriting/src/app-main/app-main.html',
          {analyzer: new Analyzer({urlLoader: new FsUrlLoader()})});
      assert(doc);
      const domModules = dom5.queryAll(doc, preds.hasTagName('dom-module'));
      const assetpaths = domModules.map(
          (domModule) =>
              [dom5.getAttribute(domModule, 'id'),
               dom5.getAttribute(domModule, 'assetpath')]);
      assert.deepEqual(assetpaths, [
        ['test-c', '../../bower_components/test-component/'],
        ['test-b', '../../bower_components/test-component/src/elements/'],
        ['test-a', '../../bower_components/test-component/'],

        // We don't need an assetpath on app-main because its not been
        // moved/inlined from another location.
        ['app-main', null]
      ]);
    });

    test('Bundler should not emit empty hidden divs', async () => {
      const {ast: doc} = await bundle('import-empty.html');
      assert(doc);
      assert.isNull(dom5.query(doc, matchers.hiddenDiv));
    });

    test('Entrypoint body content should not be wrapped', async () => {
      const {ast: doc} = await bundle('default.html');
      assert(doc);
      const myElement = dom5.query(doc, preds.hasTagName('my-element'));
      assert(myElement);
      assert(preds.NOT(preds.parentMatches(
          preds.hasAttr('by-polymer-bundler')))(<parse5.ASTNode>myElement));
    });

    test('eagerly importing a fragment', async () => {
      const bundler = getBundler({
        strategy: generateShellMergeStrategy(
            resolve('imports/importing-fragments/shell.html')!),
      });
      const manifest = await bundler.generateManifest([
        'imports/eagerly-importing-a-fragment.html',
        'imports/importing-fragments/fragment-a.html',
        'imports/importing-fragments/fragment-b.html',
        'imports/importing-fragments/shell.html',
      ].map(resolve));
      const result = await bundler.bundle(manifest);
      assert.equal(result.manifest.bundles.size, 4);
      const shell = parse5.serialize(
          result.documents
              .get(resolve('imports/importing-fragments/shell.html'))!.ast);
      const fragmentAAt = shell.indexOf('rel="import" href="fragment-a.html"');
      const shellAt = shell.indexOf(`console.log('shell.html')`);
      const sharedUtilAt = shell.indexOf(`console.log('shared-util.html')`);
      assert.isTrue(
          sharedUtilAt < fragmentAAt,
          'Inlined shared-util.html should come before fragment-a.html import');
      assert.isTrue(
          fragmentAAt < shellAt,
          'fragment-a.html import should come before script in shell.html');
    });

    test('Imports in templates should not inline', async () => {
      const {ast: doc} = await bundle('inside-template.html');
      const importMatcher = preds.AND(
          preds.hasTagName('link'),
          preds.hasAttrValue('rel', 'import'),
          preds.hasAttr('href'));
      const externalScriptMatcher = preds.AND(
          preds.hasTagName('script'),
          preds.hasAttrValue('src', 'external/external.js'));
      assert(doc);
      const imports = dom5.queryAll(
          doc, importMatcher, undefined, dom5.childNodesIncludeTemplate);
      assert.equal(imports.length, 1, 'import in template was inlined');
      const unexpectedScript = dom5.query(doc, externalScriptMatcher);
      assert.equal(
          unexpectedScript,
          null,
          'script in external.html should not be present');
    });

    test('Deprecated CSS imports should inline correctly', async () => {
      const {ast: doc} = await bundle('css-imports.html', {inlineCss: true});

      const styleA =
          fs.readFileSync('test/html/css-import/import-a.css', 'utf-8');
      const styleB =
          fs.readFileSync('test/html/css-import/import-b.css', 'utf-8');

      const elementA =
          dom5.query(doc, dom5.predicates.hasAttrValue('id', 'element-a'))!;
      assert(elementA, 'element-a not found.');
      assert.include(parse5.serialize(elementA), styleA);
      assert.notInclude(parse5.serialize(elementA), styleB);

      const elementB =
          dom5.query(doc, dom5.predicates.hasAttrValue('id', 'element-b'))!;
      assert(elementB, 'element-b not found.');
      assert.notInclude(parse5.serialize(elementB), styleA);
      assert.include(parse5.serialize(elementB), styleB);
    });
  });
});
