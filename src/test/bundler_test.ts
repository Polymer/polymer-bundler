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
import * as parse5 from 'parse5';
import * as path from 'path';
import {Analyzer, FSUrlLoader} from 'polymer-analyzer';

import {Bundle} from '../bundle-manifest';
import {Bundler, Options as BundlerOptions} from '../bundler';

chai.config.showDiff = true;

const assert = chai.assert;
const matchers = require('../matchers');
const preds = dom5.predicates;

suite('Bundler', () => {
  let bundler: Bundler;
  const inputPath = 'test/html/default.html';

  async function bundle(inputPath: string, opts?: BundlerOptions):
      Promise<parse5.ASTNode> {
        // Don't modify options directly because test-isolation problems occur.
        const bundlerOpts = Object.assign({}, opts || {});
        if (!bundlerOpts.analyzer) {
          bundlerOpts.analyzer = new Analyzer(
              {urlLoader: new FSUrlLoader(path.dirname(inputPath))});
          inputPath = path.basename(inputPath);
        }
        bundler = new Bundler(bundlerOpts);
        const manifest = await bundler.generateManifest([inputPath]);
        const documents = await bundler.bundle(manifest);
        return documents.get(inputPath)!.ast;
      }

  suite('Default Options', () => {

    test('imports removed', async () => {
      const imports = preds.AND(
          preds.hasTagName('link'),
          preds.hasAttrValue('rel', 'import'),
          preds.hasAttr('href'),
          preds.NOT(preds.hasAttrValue('type', 'css')));
      assert.equal(dom5.queryAll(await bundle(inputPath), imports).length, 0);
    });

    test('imports were deduplicated', async () => {
      assert.equal(
          dom5.queryAll(await bundle(inputPath), preds.hasTagName('dom-module'))
              .length,
          1);
    });
  });

  suite('Applying strategy', () => {

    test('inlines css/scripts of html imports added by strategy', async () => {
      const bundler = new Bundler({inlineCss: true, inlineScripts: true});
      // This strategy adds a file not in the original document to the bundle.
      const strategy = (bundles: Bundle[]): Bundle[] => {
        bundles.forEach((b) => {
          b.files.add('test/html/imports/external-script.html');
          b.files.add('test/html/imports/import-linked-style.html');
        });
        return bundles;
      };
      const manifest =
          await bundler.generateManifest(['test/html/default.html'], strategy);
      const documents = await bundler.bundle(manifest);
      const document = documents.get('test/html/default.html')!;
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
          const bundler = new Bundler();
          // This strategy moves a file to a different bundle.
          const strategy = (bundles: Bundle[]): Bundle[] => {
            return [
              new Bundle(
                  new Set(['test/html/default.html']),
                  new Set(['test/html/default.html'])),
              new Bundle(
                  new Set(),  //
                  new Set(['test/html/imports/simple-import.html']))
            ];
          };
          const manifest = await bundler.generateManifest(
              ['test/html/default.html'], strategy);
          const documents = await bundler.bundle(manifest);
          const document = documents.get('test/html/default.html')!;
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
              dom5.getAttribute(linkTag, 'href'), '../../shared_bundle_1.html');

          const shared = documents.get('shared_bundle_1.html')!;
          assert(shared);
          assert.isOk(dom5.query(
              shared.ast, dom5.predicates.hasAttrValue('id', 'my-element')));
        });

    test('bundle documents should not have tags added to them', async () => {
      const ast = await bundle('test/html/imports/simple-import.html');
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
      const ast = await bundle('test/html/external-dependencies.html');
      const div =
          dom5.query(ast, preds.hasAttrValue('id', 'external-dependency'));
      assert(div);
    });
  });

  test('svg is nested correctly', async () => {
    const svg =
        dom5.query(await bundle(inputPath), matchers.template)!['content']
            .childNodes[1];
    assert.equal(svg.childNodes!.filter(dom5.isElement).length, 6);
  });

  test('import bodies are in one hidden div', async () => {
    assert.equal(
        dom5.queryAll(await bundle(inputPath), matchers.hiddenDiv).length, 1);
  });

  test('dom-modules have assetpath', async () => {
    const assetpath = preds.AND(
        preds.hasTagName('dom-module'),
        preds.hasAttrValue('assetpath', 'imports/'));
    assert.ok(dom5.query(await bundle(inputPath), assetpath), 'assetpath set');
  });

  test('output file is forced utf-8', async () => {
    const meta = preds.AND(
        preds.hasTagName('meta'), preds.hasAttrValue('charset', 'UTF-8'));
    assert.ok(dom5.query(await bundle(inputPath), meta));
  });

  test('Handle <base> tag', async () => {
    const span = preds.AND(
        preds.hasTagName('span'), preds.hasAttrValue('href', 'imports/hello'));
    const a = preds.AND(
        preds.hasTagName('a'),
        preds.hasAttrValue('href', 'imports/sub-base/sub-base.html'));
    const doc = await bundle('test/html/base.html');
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

    const doc = await bundle('test/html/import-in-body.html');
    const imports = dom5.queryAll(doc, importMatcher);
    assert.equal(imports.length, 0);
    const bodyContainer = dom5.query(doc, bodyContainerMatcher)!;
    const scriptActual = dom5.query(doc, scriptExpected)!.parentNode!;
    const divActual = dom5.query(doc, divExpected)!.parentNode!;
    assert.equal(bodyContainer, scriptActual);
    assert.equal(bodyContainer, divActual);
  });

  test('Scripts are not inlined by default', async () => {
    const scripts = dom5.queryAll(
        await bundle('test/html/external.html'), matchers.externalJavascript);
    assert.isAbove(scripts.length, 0, 'scripts were inlined');
    scripts.forEach(function(s) {
      assert.equal(dom5.getTextContent(s), '', 'script src should be empty');
    });
  });

  test('Paths for import bodies are resolved correctly', async () => {
    const anchorMatcher = preds.hasTagName('a');
    const input = 'test/html/multiple-imports.html';
    const anchor = dom5.query(await bundle(input), anchorMatcher)!;
    const href = dom5.getAttribute(anchor, 'href');
    assert.equal(href, 'imports/target.html');
  });

  test('Spaces in paths are handled correctly', async () => {
    const input = 'test/html/spaces.html';
    const spacesMatcher = preds.AND(
        preds.hasTagName('dom-module'),
        preds.hasAttrValue('id', 'space-element'));
    const module = dom5.query(await bundle(input), spacesMatcher);
    assert.ok(module);
  });

  suite('Script Ordering', () => {

    test('Imports and scripts are ordered correctly', async () => {
      const doc = await bundle('test/html/order-test.html');

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

      const scripts = dom5.queryAll(doc, matchers.jsMatcher);
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
      const doc = await bundle(
          'test/html/script-order/index.html', {inlineScripts: true});
      assert(doc);
      const serialized = parse5.serialize(doc);
      const beforeLoc = serialized.indexOf('window.BeforeJs');
      const afterLoc = serialized.indexOf('BeforeJs.value');
      assert.isBelow(beforeLoc, afterLoc);
    });

    test('Paths are correct when maintaining order', async () => {
      const doc = await bundle('test/html/recursion/import.html');
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

  suite('Redirect', () => {

    test('Redirected paths load properly', async () => {
      const options = {
        redirects:
            ['chrome://imports/|test/html/imports/', 'biz://cool/|test/html']
      };
      const doc = await bundle('test/html/custom-protocol.html', options);
      assert(doc);
    });

    // TODO(usergenic): Add tests here to demo common use case of alt domains.
  });

  suite('Absolute paths in URLs', () => {

    test('will be resolved by the analyzer', async () => {
      const options = {inlineCss: true, inlineScripts: true};
      const doc = await bundle('test/html/absolute-paths.html', options);
      const html = parse5.serialize(doc);
      assert.include(html, '.absolute-paths-style');
      assert.include(html, 'hello from /absolute-paths/script.js');
    });
  });

  suite('excludes', () => {

    const excluded = preds.AND(
        preds.hasTagName('link'),
        preds.hasAttrValue('rel', 'import'),
        preds.hasAttrValue('href', 'imports/simple-import.html'));

    const excludes = ['imports/simple-import.html'];

    test('Excluded imports are not inlined', async () => {
      const doc = await bundle(inputPath, {excludes: excludes});
      const imports = dom5.queryAll(doc, excluded);
      assert.equal(imports.length, 1);
    });

    const cssFromExclude = preds.AND(
        preds.hasTagName('link'),
        preds.hasAttrValue('rel', 'import'),
        preds.hasAttrValue('type', 'css'));

    test.skip(
        'Excluded imports are not inlined when behind a redirected URL.',
        async () => {
          const options = {
            // TODO(usergenic): use non-redirected form of URL (?)
            excludes: ['test/html/imports/simple-import.html'],
            redirects: ['red://herring/at|test/html/imports']
          };
          const doc = await bundle(
              path.resolve('test/html/custom-protocol-excluded.html'), options);
          const imports = dom5.queryAll(doc, htmlImport);
          assert.equal(imports.length, 2);
          const badCss = dom5.queryAll(doc, cssFromExclude);
          assert.equal(badCss.length, 0);
        });

    test.skip('Excluded CSS is not inlined', async () => {
      const doc = await bundle(
          inputPath, {inlineCss: true, excludes: ['imports/simple-style.css']});
      assert.include(parse5.serialize(doc), 'href="imports/simple-style.css"');
    });

    test('Excluded comments are removed', async () => {
      const options = {stripComments: true};
      const doc = await bundle('test/html/comments.html', options);
      const comments = dom5.nodeWalkAll(doc, dom5.isCommentNode);
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
      const doc = await bundle('test/html/comments.html', options);
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
      const options = {excludes: ['test/html/imports/']};
      const doc = await bundle('test/html/default.html', options);
      const links = dom5.queryAll(doc, linkMatcher);
      // one duplicate import is removed.  default.html contains this
      // duplication:
      //     <link rel="import" href="imports/simple-import.html">
      //     <link rel="import" href="imports/simple-import.html">
      assert.equal(links.length, 1);
    });
  });

  suite('Inline Scripts', () => {
    const options = {inlineScripts: true};

    test('All scripts are inlined', async () => {
      const doc = await bundle('test/html/external.html', options);
      const scripts = dom5.queryAll(doc, matchers.externalJavascript);
      assert.equal(scripts.length, 0);
    });

    test('Remote scripts are kept', async () => {
      const doc = await bundle('test/html/scripts.html', options);
      const scripts = dom5.queryAll(doc, matchers.externalJavascript);
      assert.equal(scripts.length, 1);
      assert.equal(
          dom5.getAttribute(scripts[0], 'src'),
          'https://ajax.googleapis.com/ajax/libs/jquery/2.1.3/jquery.min.js');
    });

    test.skip('Absolute paths are correct for excluded links', async () => {
      const target = 'test/html/external.html';
      const options = {
        absPathPrefix: '/myapp/',
        inlineScripts: true,
        excludes: ['external/external.js']
      };
      const doc = await bundle(target, options);
      const scripts = dom5.queryAll(doc, matchers.externalJavascript);
      assert.equal(scripts.length, 1);
      // TODO(usergenic): assert the src attribute is now
      // /myapp/external/external.js
    });

    test('Escape inline <script>', async () => {
      const doc = await bundle('test/html/xss.html', options);
      const script = dom5.query(doc, matchers.inlineJavascript)!;
      assert.include(
          dom5.getTextContent(script),
          'var b = 0<\\/script><script>alert(\'XSS\'); //2;',
          'Inline <script> should be escaped');
    });

    test('Inlined Scripts are in the expected order', async () => {
      const doc = await bundle('test/html/reordered/in.html', options);
      const scripts = dom5.queryAll(doc, matchers.inlineJavascript)!;
      const contents = scripts.map((script) => dom5.getTextContent(script));
      assert.deepEqual(['"First"', '"Second"'], contents);
    });

    test('Firebase works inlined', async () => {
      const doc = await bundle('test/html/firebase.html', {
        inlineScripts: true,
        analyzer: new Analyzer({urlLoader: new FSUrlLoader()}),
      });
      const scripts = dom5.queryAll(doc, matchers.inlineJavascript)!;
      assert.equal(scripts.length, 1);
      const idx = dom5.getTextContent(scripts[0]).indexOf('</script>');
      assert(idx === -1, '/script found, should be escaped');
    });
  });

  suite('Inline CSS', () => {

    const options = {inlineCss: true};

    test('All styles are inlined', async () => {
      const doc = await bundle(inputPath, options);
      const links = dom5.queryAll(doc, matchers.stylesheetImport);
      const styles = dom5.queryAll(
          doc, matchers.styleMatcher, [], dom5.childNodesIncludeTemplate);
      assert.equal(links.length, 0);
      assert.equal(styles.length, 2);
    });

    test('Inlined styles have proper paths', async () => {
      const doc = await bundle('test/html/inline-styles.html', options);
      const styles = dom5.queryAll(
          doc, matchers.styleMatcher, [], dom5.childNodesIncludeTemplate);
      assert.equal(styles.length, 2);
      const content = dom5.getTextContent(styles[1]);
      assert(content.search('imports/foo.jpg') > -1, 'path adjusted');
      assert(content.search('@apply') > -1, '@apply kept');
    });

    test('Remote styles and media queries are preserved', async () => {
      const input = 'test/html/imports/remote-stylesheet.html';
      const doc = await bundle(input, options);
      const links = dom5.queryAll(doc, matchers.externalStyle);
      assert.equal(links.length, 1);
      assert.match(
          dom5.getAttribute(links[0]!, 'href')!, /fonts.googleapis.com/);
      const styles = dom5.queryAll(doc, matchers.styleMatcher);
      assert.equal(styles.length, 1);
      assert.equal(dom5.getAttribute(styles[0], 'media'), '(min-width: 800px)');
    });

    test.skip('Absolute paths are correct', async () => {
      const root = path.resolve(inputPath, '../..');
      const options = {absPathPrefix: root, inlineCss: true};
      const doc = await bundle('/test/html/default.html', options);
      const links = dom5.queryAll(doc, matchers.ALL_CSS_LINK);
      assert.equal(links.length, 0);
    });

    test('Inlined Polymer styles are moved into the <template>', async () => {
      const doc = await bundle('test/html/default.html', options);
      const domModule = dom5.query(doc, preds.hasTagName('dom-module'))!;
      assert(domModule);
      const template = dom5.query(domModule, matchers.template)!;
      assert(template);

      const styles = dom5.queryAll(
          template, matchers.styleMatcher, [], dom5.childNodesIncludeTemplate);
      assert.equal(styles.length, 1);
    });

    test(
        'Inlined Polymer styles force dom-module to have template',
        async () => {
          const doc = await bundle('test/html/inline-styles.html', options);
          const domModule = dom5.query(doc, preds.hasTagName('dom-module'))!;
          assert(domModule);
          const template = dom5.query(domModule, matchers.template)!;
          assert(template);
          const style = dom5.query(
              template, matchers.styleMatcher, dom5.childNodesIncludeTemplate);
          assert(style);
        });
  });

  suite.skip('Add import', () => {
    const options = {addedImports: ['imports/comment-in-import.html']};
    test('added import is added to bundled doc', async () => {
      const doc = await bundle('test/html/default.html', options);
      assert(doc);
      const hasAddedImport =
          preds.hasAttrValue('href', 'imports/comment-in-import.html');
      assert.equal(dom5.queryAll(doc, hasAddedImport).length, 1);
    });
  });

  // TODO(usergenic): These tests only prove that the `inputUrl` has precedence
  // over the filename presented to `bundle(path)`.  Do we want to continue to
  // support inputUrl?  Tese don't prove anything about the doc production
  // itself or how it is effected.  Needs resolution.
  suite('Input URL', () => {

    const options = {inputUrl: 'test/html/default.html'};

    test.skip('inputURL is used instead of argument to process', async () => {
      const doc = await bundle('flibflabfloom!', options);
      assert(doc);
    });

    test.skip('gulp-vulcanize invocation with absPathPrefix', async () => {
      const options = {
        abspath: path.resolve('test/html'),
        inputUrl: '/default.html'
      };

      const doc = await bundle(
          'C:\\Users\\PolymerBundlerTester\\polymer-bundler\\test\\html\\default.html',
          options);
      assert(doc);
    });
  });

  suite('Regression Testing', () => {

    test('Base tag emulation should not leak to other imports', async () => {
      const doc = await bundle('test/html/base.html');
      const clickMe = dom5.query(doc, preds.hasTextValue('CLICK ME'));
      assert.ok(clickMe);

      // The base target from `test/html/imports/base.html` should apply to the
      // anchor tag in it.
      assert.equal(dom5.getAttribute(clickMe!, 'target'), 'foo-frame');

      const doNotClickMe =
          dom5.query(doc, preds.hasTextValue('DO NOT CLICK ME'));
      assert.ok(doNotClickMe);

      // The base target from `test/html/imports/base.html` should NOT apply to
      // the anchor tag in `test/html/imports/base-foo/sub-base.html`
      assert.isFalse(dom5.hasAttribute(doNotClickMe!, 'target'));
    });

    test('Complicated Ordering', async () => {
      // refer to
      // https://github.com/Polymer/polymer-bundler/tree/master/test/html/complicated/ordering.svg
      // for visual reference on the document structure for this example
      const doc =
          await bundle('test/html/complicated/A.html', {inlineScripts: true});
      assert(doc);
      const expected = ['A1', 'C', 'E', 'B', 'D', 'A2'];
      const scripts = dom5.queryAll(doc, matchers.jsMatcher);
      const contents = scripts.map(function(s) {
        return dom5.getTextContent(s).trim();
      });
      assert.deepEqual(contents, expected);
    });

    test('Assetpath rewriting', async () => {
      const doc = await bundle(
          'test/html/path-rewriting/src/app-main/app-main.html',
          {analyzer: new Analyzer({urlLoader: new FSUrlLoader()})});
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

    test('Entrypoint body content should not be wrapped', async () => {
      const doc = await bundle('test/html/default.html');
      assert(doc);
      const myElement = dom5.query(doc, preds.hasTagName('my-element'));
      assert(myElement);
      assert(preds.NOT(preds.parentMatches(
          preds.hasAttr('by-polymer-bundler')))(<parse5.ASTNode>myElement));
    });

    test.skip('Imports in templates should not inline', async () => {
      const doc = await bundle('test/html/inside-template.html');
      const importMatcher = preds.AND(
          preds.hasTagName('link'),
          preds.hasAttrValue('rel', 'import'),
          preds.hasAttr('href'));
      const externalScriptMatcher = preds.AND(
          preds.hasTagName('script'),
          preds.hasAttrValue('src', 'external/external.js'));
      assert(doc);
      const imports = dom5.queryAll(doc, importMatcher);
      assert.equal(imports.length, 1, 'import in template was inlined');
      const unexpectedScript = dom5.query(doc, externalScriptMatcher);
      assert.equal(
          unexpectedScript,
          null,
          'script in external.html should not be present');
    });
  });
});
