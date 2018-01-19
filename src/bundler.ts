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
import * as clone from 'clone';
import * as dom5 from 'dom5';
import * as parse5 from 'parse5';
import {ASTNode, serialize, treeAdapters} from 'parse5';
import {Analyzer, Document, FileRelativeUrl, FSUrlLoader, InMemoryOverlayUrlLoader, ResolvedUrl} from 'polymer-analyzer';

import {getAnalysisDocument} from './analyzer-utils';
import * as astUtils from './ast-utils';
import * as bundleManifestLib from './bundle-manifest';
import {AssignedBundle, Bundle, BundleManifest, BundleStrategy, BundleUrlMapper} from './bundle-manifest';
import * as depsIndexLib from './deps-index';
import {BundledDocument, DocumentCollection} from './document-collection';
import * as importUtils from './import-utils';
import * as matchers from './matchers';
import {updateSourcemapLocations} from './source-map';
import {resolvePath} from './url-utils';

export * from './bundle-manifest';

// TODO(usergenic): Add plylog
export interface Options {
  // The instance of the Polymer Analyzer which has completed analysis
  analyzer?: Analyzer;

  // URLs of files and/or folders that should not be inlined. HTML tags
  // referencing excluded URLs are preserved.'
  excludes?: ResolvedUrl[];

  // When true, inline external CSS file contents into <style> tags in the
  // output document.
  inlineCss?: boolean;

  // When true, inline external Javascript file contents into <script> tags in
  // the output document.
  inlineScripts?: boolean;

  // Rewrite element attributes inside of templates to adjust URLs in inlined
  // html imports.
  rewriteUrlsInTemplates?: boolean;

  // Create identity source maps for inline scripts
  sourcemaps?: boolean;

  // Remove of all comments (except those containing '@license') when true.
  stripComments?: boolean;

  // Bundle strategy used to construct the output bundles.
  strategy?: BundleStrategy;

  // Bundle URL mapper function that produces URLs for the generated bundles.
  urlMapper?: BundleUrlMapper;
}

export interface BundleResult {
  documents: DocumentCollection;
  manifest: BundleManifest;
}

export class Bundler {
  analyzer: Analyzer;
  enableCssInlining: boolean;
  enableScriptInlining: boolean;
  excludes: ResolvedUrl[];
  rewriteUrlsInTemplates: boolean;
  sourcemaps: boolean;
  stripComments: boolean;
  strategy: BundleStrategy;
  urlMapper: BundleUrlMapper;

  private _overlayUrlLoader: InMemoryOverlayUrlLoader;

  constructor(options?: Options) {
    const opts = options ? options : {};

    // In order for the bundler to use a given analyzer, we'll have to fork it
    // so we can provide our own overlayUrlLoader which falls back to the
    // analyzer's load method.
    if (opts.analyzer) {
      const analyzer = opts.analyzer;
      this._overlayUrlLoader = new InMemoryOverlayUrlLoader(analyzer);
      this.analyzer = analyzer._fork({urlLoader: this._overlayUrlLoader});
    } else {
      this._overlayUrlLoader =
          new InMemoryOverlayUrlLoader(new FSUrlLoader(resolvePath('.')));
      this.analyzer = new Analyzer({urlLoader: this._overlayUrlLoader});
    }

    this.excludes = Array.isArray(opts.excludes) ? opts.excludes : [];
    this.stripComments = Boolean(opts.stripComments);
    this.enableCssInlining =
        opts.inlineCss === undefined ? true : opts.inlineCss;
    this.enableScriptInlining =
        opts.inlineScripts === undefined ? true : opts.inlineScripts;
    this.rewriteUrlsInTemplates = Boolean(opts.rewriteUrlsInTemplates);
    this.sourcemaps = Boolean(opts.sourcemaps);
    this.strategy =
        opts.strategy || bundleManifestLib.generateSharedDepsMergeStrategy();
    this.urlMapper = opts.urlMapper ||
        bundleManifestLib.generateCountingSharedBundleUrlMapper(
            this.analyzer.resolveUrl('shared_bundle_')!);
  }

  /**
   * Given a manifest describing the bundles, produce a collection of bundled
   * documents with HTML imports, external stylesheets and external scripts
   * inlined according to the options for this Bundler.
   *
   * @param manifest - The manifest that describes the bundles to be produced.
   */
  async bundle(manifest: BundleManifest): Promise<BundleResult> {
    const documents: DocumentCollection =
        new Map<ResolvedUrl, BundledDocument>();
    manifest = manifest.fork();

    for (const bundleEntry of manifest.bundles) {
      const bundleUrl = bundleEntry[0];
      const bundle = {url: bundleUrl, bundle: bundleEntry[1]};
      const bundledAst = await this._bundleDocument(bundle, manifest);
      documents.set(bundleUrl, {
        ast: bundledAst,
        content: this._ensureTrailingNewline(parse5.serialize(bundledAst)),
        files: Array.from(bundle.bundle.files)
      });
    }

    return {manifest, documents};
  }

  /**
   * Generates a BundleManifest with all bundles defined, using entrypoints,
   * strategy and mapper.
   *
   * @param entrypoints - The list of entrypoints that will be analyzed for
   *     dependencies. The results of the analysis will be passed to the
   *     `strategy`.
   * @param strategy - The strategy used to construct the output bundles.
   *     See 'polymer-analyzer/src/bundle-manifest'.
   * @param mapper - A function that produces URLs for the generated bundles.
   *     See 'polymer-analyzer/src/bundle-manifest'.
   */
  async generateManifest(entrypoints: ResolvedUrl[]): Promise<BundleManifest> {
    const dependencyIndex =
        await depsIndexLib.buildDepsIndex(entrypoints, this.analyzer);
    let bundles =
        bundleManifestLib.generateBundles(dependencyIndex.entrypointToDeps);
    this._filterExcludesFromBundles(bundles);
    bundles = this.strategy(bundles);
    return new BundleManifest(bundles, this.urlMapper);
  }

  /**
   * Analyze a URL using the given contents in place of what would otherwise
   * have been loaded.
   */
  private async _analyzeContents(url: ResolvedUrl, contents: string):
      Promise<Document> {
    this._overlayUrlLoader.urlContentsMap.set(url, contents);
    await this.analyzer.filesChanged([url]);
    const analysis = await this.analyzer.analyze([url]);
    return getAnalysisDocument(analysis, url);
  }

  /**
   * Set the hidden div at the appropriate location within the document.  The
   * goal is to place the hidden div at the same place as the first html
   * import.  However, the div can't be placed in the `<head>` of the document
   * so if first import is found in the head, we prepend the div to the body.
   * If there is no body, we'll just attach the hidden div to the document at
   * the end.
   */
  private _attachHiddenDiv(ast: ASTNode, hiddenDiv: ASTNode) {
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
   * Produces a document containing the content of all of the bundle's files.
   * If the bundle's URL resolves to an existing html file, that file will be
   * used as the basis for the generated document.
   */
  private async _bundleDocument(
      docBundle: AssignedBundle,
      bundleManifest: BundleManifest): Promise<ASTNode> {
    let document = await this._prepareBundleDocument(docBundle);
    const ast = clone(document.parsedDocument.ast);
    dom5.removeFakeRootElements(ast);
    this._injectHtmlImportsForBundle(document, ast, docBundle, bundleManifest);
    importUtils.rewriteAstToEmulateBaseTag(
        this.analyzer, ast, document.url, this.rewriteUrlsInTemplates);

    // Re-analyzing the document using the updated ast to refresh the scanned
    // imports, since we may now have appended some that were not initially
    // present.
    document = await this._analyzeContents(document.url, serialize(ast));

    // The following set of operations manipulate the ast directly, so
    await this._inlineHtmlImports(document, ast, docBundle, bundleManifest);

    if (this.enableScriptInlining) {
      await this._inlineScripts(document, ast, docBundle, this.excludes);
    }
    if (this.enableCssInlining) {
      await this._inlineStylesheetLinks(
          document, ast, docBundle, this.excludes, this.rewriteUrlsInTemplates);
      await this._inlineStylesheetImports(
          document, ast, docBundle, this.excludes, this.rewriteUrlsInTemplates);
    }

    if (this.stripComments) {
      astUtils.stripComments(ast);
    }

    this._removeEmptyHiddenDivs(ast);

    if (this.sourcemaps) {
      return updateSourcemapLocations(document, ast);
    } else {
      return ast;
    }
  }

  /**
   * Creates a hidden container <div> to which inlined content will be
   * appended.
   */
  private _createHiddenDiv(): ASTNode {
    const hidden = dom5.constructors.element('div');
    dom5.setAttribute(hidden, 'hidden', '');
    dom5.setAttribute(hidden, 'by-polymer-bundler', '');
    return hidden;
  }

  /**
   * Append a `<link rel="import" ...>` node to `node` with a value of `url`
   * for the "href" attribute.
   */
  private _createHtmlImport(url: FileRelativeUrl|ResolvedUrl): ASTNode {
    const link = dom5.constructors.element('link');
    dom5.setAttribute(link, 'rel', 'import');
    dom5.setAttribute(link, 'href', url);
    return link;
  }

  /**
   * Append a newline if text doesn't already end with one.
   */
  private _ensureTrailingNewline(text: string): string {
    return text.endsWith('\n') ? text : text + '\n';
  }

  /**
   * Given an array of Bundles, remove all files from bundles which are in the
   * "excludes" set.  Remove any bundles which are left empty after excluded
   * files are removed.
   */
  private _filterExcludesFromBundles(bundles: Bundle[]) {
    // Remove excluded files from bundles.
    for (const bundle of bundles) {
      for (const exclude of this.excludes) {
        const resolvedExclude = this.analyzer.resolveUrl(exclude);
        if (!resolvedExclude) {
          continue;
        }
        bundle.files.delete(resolvedExclude);
        const excludeAsFolder = exclude.endsWith('/') ? exclude : exclude + '/';
        for (const file of bundle.files) {
          if (file.startsWith(excludeAsFolder)) {
            bundle.files.delete(file);
          }
        }
      }
    }

    let b = 0;
    while (b < bundles.length) {
      if (bundles[b].files.size < 0) {
        bundles.splice(b, 1);
        continue;
      }
      ++b;
    }
  }

  /**
   * Given a document, search for the hidden div, if it isn't found, then
   * create it.  After creating it, attach it to the desired location.  Then
   * return it.
   */
  private _findOrCreateHiddenDiv(ast: ASTNode): ASTNode {
    const hiddenDiv =
        dom5.query(ast, matchers.hiddenDiv) || this._createHiddenDiv();
    if (!hiddenDiv.parentNode) {
      this._attachHiddenDiv(ast, hiddenDiv);
    }
    return hiddenDiv;
  }

  /**
   * Add HTML Import elements for each file in the bundle.  Efforts are made to
   * ensure that imports are injected prior to any eager imports of other
   * bundles which are known to depend on them, to preserve expectations of
   * evaluation order.
   */
  private _injectHtmlImportsForBundle(
      document: Document,
      ast: ASTNode,
      bundle: AssignedBundle,
      bundleManifest: BundleManifest) {
    // Gather all the document's direct html imports.  We want the direct (not
    // transitive) imports only here, because we'll be using their AST nodes as
    // targets to prepended injected imports to.
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

    // Every file in the bundle is a candidate for injection into the document.
    for (const importUrl of bundle.bundle.files) {
      // We don't want to inject the bundle into itself.
      if (bundle.url === importUrl) {
        continue;
      }

      // If there is an existing import in the document that matches the import
      // URL already, we don't need to inject one.
      if (existingImports.find((e) => e.document.url === importUrl)) {
        continue;
      }

      // We are looking for the earliest eager import of an html document which
      // has a dependency on the html import we want to inject.
      let prependTarget = undefined;

      // We are only concerned with imports that are not of files in this
      // bundle.
      for (const existingImport of existingImports.filter(
               (e) => !bundle.bundle.files.has(e.document.url))) {
        // If the existing import has a dependency on the import we are about
        // to inject, it may be our new target.
        if (existingImportDependencies.get(existingImport.document.url)!
                .indexOf(importUrl) !== -1) {
          const newPrependTarget = dom5.query(
              ast, (node) => astUtils.sameNode(node, existingImport.astNode));

          // IF we don't have a target already or if the old target comes after
          // the new one in the source code, the new one will replace the old
          // one.
          if (newPrependTarget &&
              (!prependTarget ||
               astUtils.inSourceOrder(newPrependTarget, prependTarget))) {
            prependTarget = newPrependTarget;
          }
        }
      }

      // Inject the new html import into the document.
      const relativeImportUrl =
          this.analyzer.urlResolver.relative(bundle.url, importUrl);
      const newHtmlImport = this._createHtmlImport(relativeImportUrl);
      if (prependTarget) {
        dom5.insertBefore(
            prependTarget.parentNode!, prependTarget, newHtmlImport);
      } else {
        const hiddenDiv = this._findOrCreateHiddenDiv(ast);
        dom5.append(hiddenDiv.parentNode!, newHtmlImport);
      }
    }
  }

  /**
   * Replace html import links in the document with the contents of the
   * imported file, but only once per URL.
   */
  private async _inlineHtmlImports(
      document: Document,
      ast: ASTNode,
      bundle: AssignedBundle,
      bundleManifest: BundleManifest) {
    const stripImports = new Set<ResolvedUrl>(bundle.bundle.stripImports);
    const htmlImports = dom5.queryAll(ast, matchers.htmlImport);
    for (const htmlImport of htmlImports) {
      await importUtils.inlineHtmlImport(
          this.analyzer,
          document,
          htmlImport,
          stripImports,
          bundle,
          bundleManifest,
          this.sourcemaps,
          this.rewriteUrlsInTemplates,
          this.excludes);
    }
  }

  /**
   * Replace all external javascript tags (`<script src="...">`)
   * with `<script>` tags containing the file contents inlined.
   */
  private async _inlineScripts(
      document: Document,
      ast: ASTNode,
      bundle: AssignedBundle,
      excludes: string[]): Promise<void> {
    const scriptImports = dom5.queryAll(ast, matchers.externalJavascript);
    for (const externalScript of scriptImports) {
      await importUtils.inlineScript(
          this.analyzer,
          document,
          externalScript,
          bundle,
          this.sourcemaps,
          excludes);
    }
  }

  /**
   * Replace all polymer stylesheet imports (`<link rel="import" type="css">`)
   * with `<style>` tags containing the file contents, with internal URLs
   * relatively transposed as necessary.
   */
  private async _inlineStylesheetImports(
      document: Document,
      ast: ASTNode,
      bundle: AssignedBundle,
      excludes: string[],
      rewriteUrlsInTemplates: boolean) {
    const cssImports = dom5.queryAll(ast, matchers.stylesheetImport);
    let lastInlined: (ASTNode|undefined);

    for (const cssLink of cssImports) {
      const style = await importUtils.inlineStylesheet(
          this.analyzer,
          document,
          cssLink,
          bundle,
          excludes,
          rewriteUrlsInTemplates);
      if (style) {
        this._moveDomModuleStyleIntoTemplate(style, lastInlined);
        lastInlined = style;
      }
    }
  }

  /**
   * Replace all external stylesheet references, in `<link rel="stylesheet">`
   * tags with `<style>` tags containing file contents, with internal URLs
   * relatively transposed as necessary.
   */
  private async _inlineStylesheetLinks(
      document: Document,
      ast: ASTNode,
      bundle: AssignedBundle,
      excludes?: string[],
      rewriteUrlsInTemplates?: boolean) {
    const cssLinks = dom5.queryAll(
        ast, matchers.externalStyle, undefined, dom5.childNodesIncludeTemplate);
    for (const cssLink of cssLinks) {
      await importUtils.inlineStylesheet(
          this.analyzer,
          document,
          cssLink,
          bundle,
          excludes,
          rewriteUrlsInTemplates);
    }
  }

  /**
   * Old Polymer supported `<style>` tag in `<dom-module>` but outside of
   * `<template>`.  This is also where the deprecated Polymer CSS import tag
   * `<link rel="import" type="css">` would generate inline `<style>`.
   * Migrates these `<style>` tags into available `<template>` of the
   * `<dom-module>`.  Will create a `<template>` container if not present.
   *
   * TODO(usergenic): Why is this in bundler... shouldn't this be some kind of
   * polyup or pre-bundle operation?
   */
  private _moveDomModuleStyleIntoTemplate(style: ASTNode, refStyle?: ASTNode) {
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
      astUtils.prepend(
          treeAdapters.default.getTemplateContent(template), style);
    } else {
      astUtils.insertAfter(refStyle, style);
    }
  }

  /**
   * When an HTML Import is encountered in the head of the document, it needs
   * to be moved into the hidden div and any subsequent order-dependent
   * imperatives (imports, styles, scripts) must also be move into the
   * hidden div.
   */
  private _moveOrderedImperativesFromHeadIntoHiddenDiv(ast: ASTNode) {
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
        dom5.append(this._findOrCreateHiddenDiv(ast), node);
      }
    }
  }

  /**
   * Move any remaining htmlImports that are not inside the hidden div
   * already, into the hidden div.
   */
  private _moveUnhiddenHtmlImportsIntoHiddenDiv(ast: ASTNode) {
    const unhiddenHtmlImports = dom5.queryAll(
        ast,
        dom5.predicates.AND(
            matchers.eagerHtmlImport,
            dom5.predicates.NOT(matchers.inHiddenDiv)));
    for (const htmlImport of unhiddenHtmlImports) {
      astUtils.removeElementAndNewline(htmlImport);
      dom5.append(this._findOrCreateHiddenDiv(ast), htmlImport);
    }
  }

  /**
   * Generate a fresh document (ASTNode) to bundle contents into.
   * If we're building a bundle which is based on an existing file, we
   * should load that file and prepare it as the bundle document, otherwise
   * we'll create a clean/empty html document.
   */
  private async _prepareBundleDocument(bundle: AssignedBundle):
      Promise<Document> {
    if (!bundle.bundle.files.has(bundle.url)) {
      return this._analyzeContents(bundle.url, '');
    }
    const analysis = await this.analyzer.analyze([bundle.url]);
    const document = getAnalysisDocument(analysis, bundle.url);
    const ast = clone(document.parsedDocument.ast);
    this._moveOrderedImperativesFromHeadIntoHiddenDiv(ast);
    this._moveUnhiddenHtmlImportsIntoHiddenDiv(ast);
    dom5.removeFakeRootElements(ast);
    return this._analyzeContents(document.url, serialize(ast));
  }

  /**
   * Removes all empty hidden container divs from the AST.
   */
  private _removeEmptyHiddenDivs(ast: ASTNode) {
    for (const div of dom5.queryAll(ast, matchers.hiddenDiv)) {
      if (parse5.serialize(div).trim() === '') {
        dom5.remove(div);
      }
    }
  }
}
