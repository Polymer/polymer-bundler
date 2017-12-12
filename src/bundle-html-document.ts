/**
 * @license
 * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
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

import * as clone from 'clone';
import * as dom5 from 'dom5';
import * as parse5 from 'parse5';
import {ASTNode, serialize, treeAdapters} from 'parse5';
import {Document, ResolvedUrl} from 'polymer-analyzer';
import * as rollup from 'rollup';
import * as urlLib from 'url';

import {getAnalysisDocument} from './analyzer-utils';
import * as astUtils from './ast-utils';
import {obscureDynamicImports, restoreDynamicImports} from './bundle-js-module';
import {AssignedBundle, BundleManifest} from './bundle-manifest';
import {Bundler} from './bundler';
import * as importUtils from './import-utils';
import * as matchers from './matchers';
import {updateSourcemapLocations} from './source-map';
import * as urlUtils from './url-utils';
// TODO(usergenic): Get rid of UrlString in favor of the new polymer-analyzer
// branded url types.
import {UrlString} from './url-utils';

const polymerBundlerScheme = 'polymer-bundler://root/';
const polymerBundlerInlineScheme = 'polymer-bundler-inline://root/';

function regexpEscape(pattern: string): string {
  return pattern.replace(/([/^$.+()[\]])/g, '\\$1');
}

/**
 * Produces a document containing the content of all of the bundle's files.
 * If the bundle's url resolves to an existing html file, that file will be
 * used as the basis for the generated document.
 */
export async function bundleHtmlDocument(
    bundler: Bundler,
    docBundle: AssignedBundle,
    bundleManifest: BundleManifest): Promise<{code: string}> {
  let document = await prepareHtmlBundleDocument(bundler, docBundle);
  const ast = clone(document.parsedDocument.ast);
  dom5.removeFakeRootElements(ast);
  injectHtmlImportsForBundle(document, ast, docBundle, bundleManifest);
  importUtils.rewriteAstToEmulateBaseTag(
      ast, document.url, bundler.rewriteUrlsInTemplates);

  // Re-analyzing the document using the updated ast to refresh the scanned
  // imports, since we may now have appended some that were not initially
  // present.
  document = await bundler.analyzeContents(document.url, serialize(ast));

  // The following set of operations manipulate the ast directly, so
  await inlineHtmlImports(bundler, document, ast, docBundle, bundleManifest);

  if (bundler.enableScriptInlining) {
    await inlineModuleScripts(
        bundler, document, ast, docBundle, bundleManifest, bundler.excludes);
    await inlineScripts(bundler, document, ast, docBundle, bundler.excludes);
  }
  if (bundler.enableCssInlining) {
    await inlineStylesheetLinks(
        bundler,
        document,
        ast,
        docBundle,
        bundler.excludes,
        bundler.rewriteUrlsInTemplates);
    await inlineStylesheetImports(
        bundler,
        document,
        ast,
        docBundle,
        bundler.excludes,
        bundler.rewriteUrlsInTemplates);
  }

  if (bundler.stripComments) {
    astUtils.stripComments(ast);
  }

  removeEmptyHiddenDivs(ast);

  if (bundler.sourcemaps) {
    return {code: parse5.serialize(updateSourcemapLocations(document, ast))};
  } else {
    return {code: parse5.serialize(ast)};
  }
}


/**
 * Set the hidden div at the appropriate location within the document.  The
 * goal is to place the hidden div at the same place as the first html
 * import.  However, the div can't be placed in the `<head>` of the document
 * so if first import is found in the head, we prepend the div to the body.
 * If there is no body, we'll just attach the hidden div to the document at
 * the end.
 */
function attachHiddenDiv(ast: ASTNode, hiddenDiv: ASTNode) {
  const firstHtmlImport = dom5.query(ast, matchers.eagerHtmlImport);
  const body = dom5.query(ast, matchers.body);
  if (body) {
    if (firstHtmlImport &&
        dom5.predicates.parentMatches(matchers.body)(firstHtmlImport)) {
      astUtils.insertAfter(firstHtmlImport, hiddenDiv);
    } else {
      astUtils.prepend(body, hiddenDiv);
    }
  } else {
    dom5.append(ast, hiddenDiv);
  }
}

/**
 * Creates a hidden container <div> to which inlined content will be
 * appended.
 */
function createHiddenDiv(): ASTNode {
  const hidden = dom5.constructors.element('div');
  dom5.setAttribute(hidden, 'hidden', '');
  dom5.setAttribute(hidden, 'by-polymer-bundler', '');
  return hidden;
}

/**
 * Append a `<link rel="import" ...>` node to `node` with a value of
 * `url` for the "href" attribute.
 */
function createHtmlImport(url: UrlString): ASTNode {
  const link = dom5.constructors.element('link');
  dom5.setAttribute(link, 'rel', 'import');
  dom5.setAttribute(link, 'href', url);
  return link;
}

/**
 * Given a document, search for the hidden div, if it isn't found, then
 * create it.  After creating it, attach it to the desired location.
 * Then return it.
 */
function findOrCreateHiddenDiv(ast: ASTNode): ASTNode {
  const hiddenDiv = dom5.query(ast, matchers.hiddenDiv) || createHiddenDiv();
  if (!hiddenDiv.parentNode) {
    attachHiddenDiv(ast, hiddenDiv);
  }
  return hiddenDiv;
}

/**
 * Add HTML Import elements for each file in the bundle.  Efforts are
 * made to ensure that imports are injected prior to any eager imports
 * of other bundles which are known to depend on them, to preserve
 * expectations of evaluation order.
 */
function injectHtmlImportsForBundle(
    document: Document,
    ast: ASTNode,
    bundle: AssignedBundle,
    bundleManifest: BundleManifest) {
  // Gather all the document's direct html imports.  We want the direct
  // (not transitive) imports only here, because we'll be using their
  // AST nodes as targets to prepended injected imports to.
  const existingImports = [
    ...document.getFeatures(
        {kind: 'html-import', noLazyImports: true, imported: false})
  ].filter((i) => !i.lazy);
  const existingImportDependencies =
      new Map(<[ResolvedUrl, ResolvedUrl[]][]>existingImports.map(
          (existingImport) => [existingImport.document.url, [
            ...existingImport.document.getFeatures(
                {kind: 'html-import', imported: true, noLazyImports: true})
          ].filter((i) => !i.lazy).map((feature) => feature.document.url)]));

  // Every file in the bundle is a candidate for injection into
  // the document.
  for (const importUrl of bundle.bundle.files) {
    // If the file isn't html, it will be brought in by other means.
    if (!importUrl.endsWith('.html')) {
      continue;
    }

    // We don't want to inject the bundle into itself.
    if (bundle.url === importUrl) {
      continue;
    }

    // If there is an existing import in the document that matches the
    // import URL already, we don't need to inject one.
    if (existingImports.find((e) => e.document.url === importUrl)) {
      continue;
    }

    // We are looking for the earliest eager import of an html document
    // which has a dependency on the html import we want to inject.
    let prependTarget = undefined;

    // We are only concerned with imports that are not of files in this
    // bundle.
    for (const existingImport of existingImports.filter(
             (e) => !bundle.bundle.files.has(e.document.url))) {
      // If the existing import has a dependency on the import we are
      // about to inject, it may be our new target.
      if (existingImportDependencies.get(existingImport.document.url)!.indexOf(
              importUrl as ResolvedUrl) !== -1) {
        const newPrependTarget = dom5.query(
            ast, (node) => astUtils.sameNode(node, existingImport.astNode));

        // IF we don't have a target already or if the old target comes
        // after the new one in the source code, the new one will
        // replace the old one.
        if (newPrependTarget &&
            (!prependTarget ||
             astUtils.inSourceOrder(newPrependTarget, prependTarget))) {
          prependTarget = newPrependTarget;
        }
      }
    }

    // Inject the new html import into the document.
    const relativeImportUrl = urlUtils.relativeUrl(bundle.url, importUrl);
    const newHtmlImport = createHtmlImport(relativeImportUrl);
    if (prependTarget) {
      dom5.insertBefore(
          prependTarget.parentNode!, prependTarget, newHtmlImport);
    } else {
      const hiddenDiv = findOrCreateHiddenDiv(ast);
      dom5.append(hiddenDiv.parentNode!, newHtmlImport);
    }
  }
}

/**
 * Replace html import links in the document with the contents of the
 * imported file, but only once per url.
 */
async function inlineHtmlImports(
    bundler: Bundler,
    document: Document,
    ast: ASTNode,
    bundle: AssignedBundle,
    bundleManifest: BundleManifest) {
  const stripImports = new Set<UrlString>(bundle.bundle.stripImports);
  const htmlImports = dom5.queryAll(ast, matchers.htmlImport);
  for (const htmlImport of htmlImports) {
    await importUtils.inlineHtmlImport(
        bundler.analyzer,
        document,
        htmlImport,
        stripImports,
        bundle,
        bundleManifest,
        bundler.sourcemaps,
        bundler.rewriteUrlsInTemplates,
        bundler.excludes);
  }
}

/**
 * Replace all external javascript tags (`<script src="...">`)
 * with `<script>` tags containing the file contents inlined.
 */
async function inlineScripts(
    bundler: Bundler,
    document: Document,
    ast: ASTNode,
    bundle: AssignedBundle,
    excludes: string[]):
    Promise<void> {
      const scriptImports = dom5.queryAll(ast, matchers.externalJavascript);
      for (const externalScript of scriptImports) {
        await importUtils.inlineScript(
            bundler.analyzer,
            document,
            externalScript,
            bundle,
            bundler.sourcemaps,
            excludes);
      }
    }

/**
 * Replace all polymer stylesheet imports (`<link rel="import"
 * type="css">`) with `<style>` tags containing the file contents, with
 * internal URLs relatively transposed as necessary.
 */
async function inlineStylesheetImports(
    bundler: Bundler,
    document: Document,
    ast: ASTNode,
    bundle: AssignedBundle,
    excludes: string[],
    rewriteUrlsInTemplates: boolean) {
  const cssImports = dom5.queryAll(ast, matchers.stylesheetImport);
  let lastInlined: (ASTNode|undefined);

  for (const cssLink of cssImports) {
    const style = await importUtils.inlineStylesheet(
        bundler.analyzer,
        document,
        cssLink,
        bundle,
        excludes,
        rewriteUrlsInTemplates);
    if (style) {
      moveDomModuleStyleIntoTemplate(style, lastInlined);
      lastInlined = style;
    }
  }
}

/**
 * Replace all external stylesheet references, in `<link
 * rel="stylesheet">` tags with `<style>` tags containing file contents,
 * with internal URLs relatively transposed as necessary.
 */
async function inlineStylesheetLinks(
    bundler: Bundler,
    document: Document,
    ast: ASTNode,
    bundle: AssignedBundle,
    excludes?: string[],
    rewriteUrlsInTemplates?: boolean) {
  const cssLinks = dom5.queryAll(
      ast, matchers.externalStyle, undefined, dom5.childNodesIncludeTemplate);
  for (const cssLink of cssLinks) {
    await importUtils.inlineStylesheet(
        bundler.analyzer,
        document,
        cssLink,
        bundle,
        excludes,
        rewriteUrlsInTemplates);
  }
}

function isRollupResolvedUrl(url: string) {
  return url.startsWith(polymerBundlerInlineScheme) ||
      url.startsWith(polymerBundlerScheme);
}

/**
 * Creates a single `<script type="module">` tag containing a rollup of all the
 * module scripts on the page, both inline and external.
 */
async function inlineModuleScripts(
    bundler: Bundler,
    document: Document,
    ast: ASTNode,
    bundle: AssignedBundle,
    bundleManifest: BundleManifest,
    excludes?: string[]) {
  // All module scripts.
  const moduleScripts = dom5.queryAll(
      ast,
      dom5.predicates.AND(
          dom5.predicates.hasTagName('script'),
          dom5.predicates.hasAttrValue('type', 'module')));
  if (moduleScripts.length === 0) {
    return;
  }
  const inlineScriptContents: string[] = [];
  let bundleSource: string[] = [];
  for (const moduleScript of moduleScripts) {
    const src = dom5.getAttribute(moduleScript, 'src');
    if (src) {
      bundleSource.push(`import ${JSON.stringify(src)};`);
    } else {
      bundleSource.push(`import ${
                                  JSON.stringify(
                                      polymerBundlerInlineScheme +
                                      inlineScriptContents.length)
                                };`);
      inlineScriptContents.push(dom5.getTextContent(ast));
    }
  }
  inlineScriptContents.push(bundleSource.join('\n'));
  // We have to compose the `external` array here because the id value yielded
  // to the external function has no importer context making that form totally
  // useless. *shakes fist*
  let external: string[] = [];
  bundleManifest.bundles.forEach((b, url) => {
    if (url !== bundle.url) {
      external.push(
          ...[...b.files, url].map((u) => `${polymerBundlerScheme}${u}`));
    }
  });
  // Should this analysis exclude perhaps the bundle file itself...?
  const analysis = await bundler.analyzer.analyze([...bundle.bundle.files]);
  const rollupBundle = await rollup.rollup({
    input: `${polymerBundlerInlineScheme + (inlineScriptContents.length - 1)}`,
    external,
    plugins: [{
      resolveId: (importee: string, importer: string | undefined) => {
        if (importer && !isRollupResolvedUrl(importee) &&
            urlUtils.isRelativePath(importee)) {
          if (importer.startsWith(polymerBundlerInlineScheme)) {
            importer = bundle.url;
          }
          importee = urlLib.resolve(importer, importee);
        }
        if (!isRollupResolvedUrl(importee)) {
          importee = `${polymerBundlerScheme}${importee}`;
        }
        return importee;
      },
      load: (id: string) => {
        if (!isRollupResolvedUrl(id)) {
          throw new Error(`Unable to load unresolved id ${id}`);
        }
        if (id.startsWith(polymerBundlerScheme)) {
          const url = id.slice(polymerBundlerScheme.length);
          if (bundle.bundle.files.has(url)) {
            let code =
                (analysis.getDocument(url) as Document).parsedDocument.contents;
            code = obscureDynamicImports(bundle.url, url, code);
            return code;
          }
        }
        if (id.startsWith(polymerBundlerInlineScheme)) {
          const index =
              parseInt(id.slice(polymerBundlerInlineScheme.length), 10);
          let code = inlineScriptContents[index];
          code = obscureDynamicImports(bundle.url, bundle.url, code);
          return code;
        }
      }
    }]
  });
  let {code} = await rollupBundle.generate(
      {sourcemap: true, sourcemapFile: bundle.url + '.map', format: 'es'});
  code = restoreDynamicImports(bundle.url, code);
  code = code.replace(
      new RegExp(`${regexpEscape(polymerBundlerScheme)}[^'"]+`, 'g'),
      (m) => urlUtils.relativeUrl(
          bundle.url, m.slice(polymerBundlerScheme.length), true));
  // Remove all module scripts.
  moduleScripts.forEach((m) => dom5.remove(m));
  const newScript =
      parse5.parseFragment(`<script type="module">${code}</script>`);
  const body = dom5.query(ast, dom5.predicates.hasTagName('body')) || ast;
  dom5.append(body, newScript);
}

/**
 * Old Polymer supported `<style>` tag in `<dom-module>` but outside of
 * `<template>`.  This is also where the deprecated Polymer CSS import
 * tag
 * `<link rel="import" type="css">` would generate inline `<style>`.
 * Migrates these `<style>` tags into available `<template>` of the
 * `<dom-module>`.  Will create a `<template>` container if not present.
 *
 * TODO(usergenic): Why is this in bundler... shouldn't this be some
 * kind of polyup or pre-bundle operation?
 */
function moveDomModuleStyleIntoTemplate(style: ASTNode, refStyle?: ASTNode) {
  const domModule =
      dom5.nodeWalkAncestors(style, dom5.predicates.hasTagName('dom-module'));
  if (!domModule) {
    return;
  }
  let template = dom5.query(domModule, matchers.template);
  if (!template) {
    template = dom5.constructors.element('template')!;
    treeAdapters.default.setTemplateContent(
        template, dom5.constructors.fragment());
    astUtils.prepend(domModule, template);
  }
  astUtils.removeElementAndNewline(style);

  // Ignore the refStyle object if it is contained within a different
  // dom-module.
  if (refStyle &&
      !dom5.query(
          domModule, (n) => n === refStyle, dom5.childNodesIncludeTemplate)) {
    refStyle = undefined;
  }

  // keep ordering if previding with a reference style
  if (!refStyle) {
    astUtils.prepend(treeAdapters.default.getTemplateContent(template), style);
  } else {
    astUtils.insertAfter(refStyle, style);
  }
}

/**
 * When an HTML Import is encountered in the head of the document, it
 * needs to be moved into the hidden div and any subsequent
 * order-dependent imperatives (imports, styles, scripts) must also be
 * move into the hidden div.
 */
function moveOrderedImperativesFromHeadIntoHiddenDiv(ast: ASTNode) {
  const head = dom5.query(ast, matchers.head);
  if (!head) {
    return;
  }
  const firstHtmlImport = dom5.query(head, matchers.eagerHtmlImport);
  if (!firstHtmlImport) {
    return;
  }
  for (const node of [firstHtmlImport].concat(
           astUtils.siblingsAfter(firstHtmlImport))) {
    if (matchers.orderedImperative(node)) {
      astUtils.removeElementAndNewline(node);
      dom5.append(findOrCreateHiddenDiv(ast), node);
    }
  }
}

/**
 * Move any remaining htmlImports that are not inside the hidden div
 * already, into the hidden div.
 */
function moveUnhiddenHtmlImportsIntoHiddenDiv(ast: ASTNode) {
  const unhiddenHtmlImports = dom5.queryAll(
      ast,
      dom5.predicates.AND(
          matchers.eagerHtmlImport, dom5.predicates.NOT(matchers.inHiddenDiv)));
  for (const htmlImport of unhiddenHtmlImports) {
    astUtils.removeElementAndNewline(htmlImport);
    dom5.append(findOrCreateHiddenDiv(ast), htmlImport);
  }
}

/**
 * Generate a fresh document (ASTNode) to bundle contents into.
 * If we're building a bundle which is based on an existing file, we
 * should load that file and prepare it as the bundle document,
 * otherwise we'll create a clean/empty html document.
 */
async function prepareHtmlBundleDocument(
    bundler: Bundler, bundle: AssignedBundle):
    Promise<Document> {
      if (!bundle.bundle.files.has(bundle.url)) {
        return bundler.analyzeContents(bundle.url, '');
      }
      const analysis = await bundler.analyzer.analyze([bundle.url]);
      const document = getAnalysisDocument(analysis, bundle.url);
      const ast = clone(document.parsedDocument.ast);
      moveOrderedImperativesFromHeadIntoHiddenDiv(ast);
      moveUnhiddenHtmlImportsIntoHiddenDiv(ast);
      dom5.removeFakeRootElements(ast);
      return bundler.analyzeContents(document.url, serialize(ast));
    }

/**
 * Removes all empty hidden container divs from the AST.
 */
function removeEmptyHiddenDivs(ast: ASTNode) {
  for (const div of dom5.queryAll(ast, matchers.hiddenDiv)) {
    if (parse5.serialize(div).trim() === '') {
      dom5.remove(div);
    }
  }
}
