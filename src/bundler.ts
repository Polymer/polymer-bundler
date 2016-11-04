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
import * as path from 'path';
import * as urlLib from 'url';
const pathPosix = path.posix;
import * as dom5 from 'dom5';
import encodeString from './third_party/UglifyJS2/encode-string';

import * as parse5 from 'parse5';
import {ASTNode} from 'parse5';
import {Analyzer, Options as AnalyzerOptions} from 'polymer-analyzer';
import {Document, ScannedDocument} from 'polymer-analyzer/lib/model/document';
import {Import} from 'polymer-analyzer/lib/model/import';
import {ParsedHtmlDocument} from 'polymer-analyzer/lib/html/html-document';
import {FSUrlLoader} from 'polymer-analyzer/lib/url-loader/fs-url-loader';
import constants from './constants';
import * as astUtils from './ast-utils';
import * as matchers from './matchers';
import * as urlUtils from './url-utils';
import {Bundle, BundleStrategy, AssignedBundle, generateBundles, BundleUrlMapper, BundleManifest, sharedBundleUrlMapper, generateSharedDepsMergeStrategy} from './bundle-manifest';
import {BundledDocument, DocumentCollection} from './document-collection';
import {buildDepsIndex} from './deps-index';
import {UrlString} from './url-utils';

// TODO(usergenic): Document every one of these options.
export interface Options {
  // When provided, relative paths will be converted to absolute paths where
  // `basePath` is the root url.  This path is equal to the folder of the
  // bundled url document of the analyzer.
  //
  // TODO(usergenic): If multiple `bundle()` calls are made `basePath` can
  // produce incompatile absolute paths if the same `basePath` is used for
  // `bundle()` targets in different folders.  Possible solutions include
  // removing basePath behavior altogether or supplementing it with a `rootPath`
  // or other hint to fix the top-level folder.
  basePath?: string;

  addedImports?: string[];

  // The instance of the Polymer Analyzer which has completed analysis
  analyzer?: Analyzer;

  // URLs of files that should not be inlined.
  excludes?: string[];

  // *DANGEROUS*! Avoid stripping imports of the transitive dependencies of
  // excluded imports (i.e. where listed in `excludes` option or where contained
  // in a folder/descendant of the `excludes` array.)  May result in duplicate
  // javascript inlining.
  noImplicitStrip?: boolean;

  // When true, inline external CSS file contents into <style> tags in the
  // output document.
  inlineCss?: boolean;

  // When true, inline external Javascript file contents into <script> tags in
  // the output document.
  inlineScripts?: boolean;

  // TODO(usergenic): Not-Yet-Implemented- document when supported.
  inputUrl?: string;

  // Remove of all comments (except those containing '@license') when true.
  stripComments?: boolean;

  // Paths of files that should not be inlined and which should have all links
  // removed.
  stripExcludes?: string[];
}

class Bundler {
  basePath?: string;
  addedImports: string[];
  analyzer: Analyzer;
  enableCssInlining: boolean;
  enableScriptInlining: boolean;
  excludes: string[];
  implicitStrip: boolean;
  inputUrl: string;
  stripComments: boolean;
  stripExcludes: string[];

  constructor(options?: Options) {
    const opts = options ? options : {};
    this.analyzer = opts.analyzer ?
        opts.analyzer :
        new Analyzer({urlLoader: new FSUrlLoader()});

    // implicitStrip should be true by default
    this.implicitStrip = !Boolean(opts.noImplicitStrip);

    this.basePath = opts.basePath;

    this.addedImports =
        Array.isArray(opts.addedImports) ? opts.addedImports : [];
    this.excludes = Array.isArray(opts.excludes) ? opts.excludes : [];
    this.stripComments = Boolean(opts.stripComments);
    this.enableCssInlining = Boolean(opts.inlineCss);
    this.enableScriptInlining = Boolean(opts.inlineScripts);
    this.inputUrl =
        String(opts.inputUrl) === opts.inputUrl ? opts.inputUrl : '';
  }


  /**
   * Return the URL this import should point to in the given bundle.
   *
   * If the URL is part of the bundle, this method returns `true`.
   *
   * If the URL is part of another bundle, this method returns the url of that
   * bundle.
   *
   * If the URL isn't part of a bundle, this method returns `false`
   */
  resolveBundleUrl(
      url: string,
      bundle: AssignedBundle,
      manifest: BundleManifest): boolean|string {
    const targetBundle = manifest.getBundleForFile(url);
    if (!targetBundle || !targetBundle.url) {
      return false;
    }
    if (targetBundle.url !== bundle.url) {
      const relative = urlUtils.relativeUrl(bundle.url, targetBundle.url);
      if (!relative) {
        throw new Error('Unable to compute relative url to bundle');
      }
      return relative;
    }
    return true;
  }

  isStripExcludedHref(url: string): boolean {
    if (!this.stripExcludes) {
      return false;
    }
    return this.stripExcludes.some(r => url.search(r) >= 0);
  }

  isBlankTextNode(node: ASTNode): boolean {
    return node && dom5.isTextNode(node) &&
        !/\S/.test(dom5.getTextContent(node));
  }

  removeElementAndNewline(node: ASTNode, replacement?: ASTNode) {
    // when removing nodes, remove the newline after it as well
    const siblings = node.parentNode!.childNodes!;
    const nextIdx = siblings.indexOf(node) + 1;
    const next = siblings[nextIdx];
    // remove next node if it is blank text
    if (this.isBlankTextNode(next)) {
      dom5.remove(next);
    }
    if (replacement) {
      dom5.replace(node, replacement);
    } else {
      dom5.remove(node);
    }
  }

  isLicenseComment(node: ASTNode): boolean {
    if (dom5.isCommentNode(node)) {
      return dom5.getTextContent(node).indexOf('@license') > -1;
    }
    return false;
  }

  /**
   * Creates a hidden container <div> to which inlined content will be
   * appended.
   */
  createHiddenContainerNode(): ASTNode {
    const hidden = dom5.constructors.element('div');
    dom5.setAttribute(hidden, 'hidden', '');
    dom5.setAttribute(hidden, 'by-vulcanize', '');
    return hidden;
  }

  /**
   * Inline external scripts <script src="*">
   */
  async inlineScript(docUrl: string, externalScript: ASTNode):
      Promise<ASTNode|undefined> {
    const rawUrl: string = dom5.getAttribute(externalScript, 'src')!;
    const resolvedUrl = urlLib.resolve(docUrl, rawUrl);
    let script: Document|null = null;
    try {
      script = await this.analyzer.analyze(resolvedUrl);
    } catch (err) {
      // If a script doesn't load, skip inlining.
      // TODO(garlicnation): use a "canLoad" api on analyzer.
    }

    if (!script) {
      return;
    }

    // Second argument 'true' tells encodeString to escape <script> tags.
    const scriptContent = encodeString(script.parsedDocument.contents, true);
    dom5.removeAttribute(externalScript, 'src');
    dom5.setTextContent(externalScript, scriptContent);

    return externalScript;
  }

  /**
   * Inline a stylesheet (either from deprecated polymer-style css import `<link
   * rel="import" type="css">` import or regular external stylesheet link
   * `<link rel="stylesheet">`.
   */
  async inlineStylesheet(docUrl: string, cssLink: ASTNode):
      Promise<ASTNode|undefined> {
    const stylesheetUrl: string = dom5.getAttribute(cssLink, 'href')!;
    const resolvedStylesheetUrl = urlLib.resolve(docUrl, stylesheetUrl);
    let stylesheetImport: Document|null = null;
    try {
      stylesheetImport = await this.analyzer.analyze(resolvedStylesheetUrl);
    } catch (err) {
      // Pass here since there's no canLoad api from the analyzer.
    }

    if (!stylesheetImport) {
      return;
    }

    const media = dom5.getAttribute(cssLink, 'media');
    const stylesheetContent = stylesheetImport.parsedDocument.contents;
    const resolvedStylesheetContent = this.rewriteImportedStyleTextUrls(
        resolvedStylesheetUrl, docUrl, stylesheetContent);
    const styleNode = dom5.constructors.element('style');

    if (media) {
      dom5.setAttribute(styleNode, 'media', media);
    }

    dom5.replace(cssLink, styleNode);
    dom5.setTextContent(styleNode, resolvedStylesheetContent);
    return styleNode;
  }

  /**
   * Inline external HTML files <link type="import" href="*">
   * TODO(usergenic): Refactor method to simplify and encapsulate case handling
   *     for hidden div adjacency etc.
   */
  async inlineHtmlImport(
      docUrl: string,
      htmlImport: ASTNode,
      reachedImports: Set<string>,
      bundle: AssignedBundle,
      manifest: BundleManifest) {
    const rawUrl: string = dom5.getAttribute(htmlImport, 'href')!;
    const resolvedUrl: string = urlLib.resolve(docUrl, rawUrl);
    const bundleUrl = manifest.bundleUrlForFile.get(resolvedUrl);
    if (!bundleUrl) {
      if (reachedImports.has(resolvedUrl)) {
        dom5.remove(htmlImport);
        return;
      } else {
        reachedImports.add(resolvedUrl);
      }
      return;
    }

    if (bundleUrl !== bundle.url) {
      if (reachedImports.has(bundleUrl)) {
        dom5.remove(htmlImport);
        return;
      }
      const relative = urlUtils.relativeUrl(docUrl, bundleUrl) || bundleUrl;
      dom5.setAttribute(htmlImport, 'href', relative);
      reachedImports.add(bundleUrl);
      return;
    }

    if (!reachedImports.has(resolvedUrl)) {
      const analyzedImport = await this.analyzer.analyze(resolvedUrl);
      // If the document wasn't loaded for the import during analysis, we can't
      // inline it.
      if (!analyzedImport) {
        // TODO(usergenic): What should the behavior be when we don't have the
        // document to inline available in the analyzer?
        throw new Error(`Unable to analyze ${resolvedUrl}`);
      }
      // Is there a better way to get what we want other than using
      // parseFragment?
      const importDoc =
          parse5.parseFragment(analyzedImport.parsedDocument.contents);
      reachedImports.add(resolvedUrl);
      this.rewriteImportedUrls(importDoc, resolvedUrl, docUrl);

      let importParent: ASTNode;
      // TODO(usergenic): remove the remove() call when PolymerLabs/dom5#35 is
      // fixed
      if (matchers.afterHiddenDiv(htmlImport)) {
        importParent = dom5.nodeWalkPrior(htmlImport, matchers.hiddenDiv)!;
        dom5.remove(htmlImport);
        dom5.append(importParent, htmlImport);
      } else if (matchers.beforeHiddenDiv(htmlImport)) {
        const index = htmlImport.parentNode!.childNodes!.indexOf(htmlImport);
        importParent = htmlImport.parentNode!.childNodes![index + 1];
        dom5.remove(htmlImport);
        astUtils.prepend(importParent, htmlImport);
      } else if (!matchers.inHiddenDiv(htmlImport)) {
        const hiddenDiv = this.createHiddenContainerNode();
        dom5.replace(htmlImport, hiddenDiv);
        dom5.append(hiddenDiv, htmlImport);
        importParent = hiddenDiv;
      } else {
        importParent = htmlImport.parentNode!;
      }

      /**
       * Find the list of imports, then move the imports to the parent doc, then
       * inline them.
       *
       * Finding them first saves on deduplication, moving them before inlining
       * them
       * allows the hidden div to always be found.
       */
      const nestedImports = dom5.queryAll(importDoc, matchers.htmlImport);
      astUtils.insertAllBefore(importParent, htmlImport, importDoc.childNodes!);

      for (const nestedImport of nestedImports) {
        await this.inlineHtmlImport(
            docUrl, nestedImport, reachedImports, bundle, manifest);
      }
    }

    if (reachedImports.has(resolvedUrl)) {
      dom5.remove(htmlImport);
    } else {
      // If we've never seen this import before, lets add it to the set so we
      // will deduplicate if we encounter it again.
      reachedImports.add(resolvedUrl);
    }
  }

  // TODO(usergenic): Migrate "Old Polymer" detection to polymer-analyzer with
  // deprecated feature scanners.
  oldPolymerCheck(analyzedRoot: Document) {
    analyzedRoot.getByKind('document').forEach((d) => {
      if (d.parsedDocument instanceof ParsedHtmlDocument &&
          dom5.query(d.parsedDocument.ast, matchers.polymerElement)) {
        throw new Error(
            constants.OLD_POLYMER + ' File: ' + d.parsedDocument.url);
      }
    });
  }

  rewriteImportedStyleTextUrls(
      importUrl: string,
      mainDocUrl: string,
      cssText: string): string {
    return cssText.replace(constants.URL, match => {
      let path = match.replace(/["']/g, '').slice(4, -1);
      path = urlUtils.rewriteImportedRelPath(
          this.basePath, importUrl, mainDocUrl, path);
      return 'url("' + path + '")';
    });
  }

  rewriteImportedUrls(
      importDoc: ASTNode,
      importUrl: string,
      mainDocUrl: string) {
    // rewrite URLs in element attributes
    const nodes = dom5.queryAll(importDoc, matchers.urlAttrs);
    let attrValue: string|null;
    for (let i = 0, node: ASTNode; i < nodes.length; i++) {
      node = nodes[i];
      for (let j = 0, attr: string; j < constants.URL_ATTR.length; j++) {
        attr = constants.URL_ATTR[j];
        attrValue = dom5.getAttribute(node, attr);
        if (attrValue && !urlUtils.isTemplatedUrl(attrValue)) {
          let relUrl: string;
          if (attr === 'style') {
            relUrl = this.rewriteImportedStyleTextUrls(
                importUrl, mainDocUrl, attrValue);
          } else {
            relUrl = urlUtils.rewriteImportedRelPath(
                this.basePath, importUrl, mainDocUrl, attrValue);
            if (attr === 'assetpath' && relUrl.slice(-1) !== '/') {
              relUrl += '/';
            }
          }
          dom5.setAttribute(node, attr, relUrl);
        }
      }
    }
    // rewrite URLs in stylesheets
    const styleNodes = astUtils.querySelectorAllWithTemplates(
        importDoc, matchers.styleMatcher);
    for (let i = 0, node: ASTNode; i < styleNodes.length; i++) {
      node = styleNodes[i];
      let styleText = dom5.getTextContent(node);
      styleText =
          this.rewriteImportedStyleTextUrls(importUrl, mainDocUrl, styleText);
      dom5.setTextContent(node, styleText);
    }
    // add assetpath to dom-modules in importDoc
    const domModules = dom5.queryAll(importDoc, matchers.domModule);
    for (let i = 0, node: ASTNode; i < domModules.length; i++) {
      node = domModules[i];
      let assetPathUrl = urlUtils.rewriteImportedRelPath(
          this.basePath, importUrl, mainDocUrl, '');
      assetPathUrl = pathPosix.dirname(assetPathUrl) + '/';
      dom5.setAttribute(node, 'assetpath', assetPathUrl);
    }
  }

  /**
   * Old Polymer supported `<style>` tag in `<dom-module>` but outside of
   * `<template>`.  This is also where the deprecated Polymer CSS import tag
   * `<link rel="import" type="css">` would generate inline `<style>`.
   * Migrates these `<style>` tags into available `<template>` of the
   * `<dom-module>`.  Will create a `<template>` container if not present.
   */
  moveDomModuleStyleIntoTemplate(style: ASTNode) {
    const domModule =
        dom5.nodeWalkAncestors(style, dom5.predicates.hasTagName('dom-module'));
    if (!domModule) {
      // TODO(usergenic): We *shouldn't* get here, but if we do, it's because
      // the analyzer messed up.
      return;
    }
    let template = dom5.query(domModule, matchers.template);
    if (!template) {
      template = dom5.constructors.element('template');
      dom5.append(domModule, template !);
    }
    dom5.remove(style);
    astUtils.prepend(template !, style);
  }

  /**
   * Given a URL to an entry-point html document, produce a single document
   * with HTML imports, external stylesheets and external scripts inlined,
   * according to the options for this Bundler.
   *
   * TODO: Given Multiple urls, produces a sharded build by applying the
   * provided
   * strategy.
   *
   * @param {Array<string>} entrypoints The list of entrypoints that will be
   *     analyzed for dependencies. The results of the analysis will be passed
   *     to the `strategy`. An array of length 1 will bypass the strategy and
   *     directly bundle the document.
   * @param {BundleStrategy} strategy The strategy used to construct the
   *     output bundles. See 'polymer-analyzer/lib/bundle-manifest' for
   *     examples. UNUSED.
   */
  async bundle(
      entrypoints: string[],
      strategy?: BundleStrategy,
      mapper?: BundleUrlMapper): Promise<DocumentCollection> {
    const bundledDocuments: DocumentCollection =
        new Map<string, BundledDocument>();
    if (entrypoints.length === 1) {
      const url = entrypoints[0];
      const depsIndex = await buildDepsIndex(entrypoints, this.analyzer);
      const bundles = generateBundles(depsIndex.entrypointToDeps);
      for (const exclude of this.excludes) {
        bundles[0].files.delete(exclude);
      }
      const manifest =
          new BundleManifest(bundles, () => new Map([[url, bundles[0]]]));
      const bundle = {
        url: url,
        bundle: bundles[0],
      };
      const doc = await this._bundleDocument(bundle, manifest);
      bundledDocuments.set(
          url, {ast: doc, files: Array.from(bundles[0].files)});
      return bundledDocuments;
    } else {
      const bundles = new Map<string, ASTNode>();
      if (!strategy) {
        strategy = generateSharedDepsMergeStrategy(2);
      }
      if (!mapper) {
        mapper = sharedBundleUrlMapper;
      }
      const index = await buildDepsIndex(entrypoints, this.analyzer);
      const basicBundles = generateBundles(index.entrypointToDeps);
      const bundlesAfterStrategy = strategy(basicBundles);
      const manifest = new BundleManifest(bundlesAfterStrategy, mapper);
      for (const bundleEntry of manifest.bundles) {
        const bundleUrl = bundleEntry[0];
        const bundle = {url: bundleUrl, bundle: bundleEntry[1]};
        const bundledAst =
            await this._bundleDocument(bundle, manifest, bundle.bundle.files);
        bundledDocuments.set(
            bundleUrl,
            {ast: bundledAst, files: Array.from(bundle.bundle.files)});
      }
      return bundledDocuments;
    }
  }

  /**
   * Append a <link rel="import" node to `node` with a value of `url` for
   * the "href" attribute.
   */
  private _appendImport(node: ASTNode, url: UrlString): ASTNode {
    const newNode = dom5.constructors.element('link');
    dom5.setAttribute(newNode, 'rel', 'import');
    dom5.setAttribute(newNode, 'href', url);
    dom5.append(node, newNode);
    return newNode;
  }

  private async _synthesizeBundleContents(
      bundle: AssignedBundle,
      reachedImports: Set<UrlString>) {
    const document = parse5.parse('');
    const body = dom5.query(document, matchers.body);
    if (!body) {
      throw new Error('Unexpected return from parse5.parse');
    }
    const hiddenDiv = this.createHiddenContainerNode();
    dom5.append(body, hiddenDiv);
    /**
     * Add HTML Import elements for each import known to be in the bundle,
     * in
     * case the import was moved into the bundle by the strategy.
     *
     * This will almost always yield duplicate imports that will get cleaned
     * up through deduplication.
     */
    for (const entrypointUrl of bundle.bundle.entrypoints) {
      if (bundle.bundle.files.has(entrypointUrl)) {
        const newUrl = urlUtils.relativeUrl(bundle.url, entrypointUrl);
        if (!newUrl) {
          continue;
        }
        this._appendImport(hiddenDiv, newUrl);
      }
    }

    /**
     * If there's only one entrypoint, get all of its DOM into the synthetic
     * import.
     */

    for (const importUrl of bundle.bundle.files) {
      const newUrl = urlUtils.relativeUrl(bundle.url, importUrl);
      if (!newUrl || bundle.bundle.entrypoints.has(newUrl)) {
        continue;
      }
      this._appendImport(hiddenDiv, newUrl);
    }
    return document;
  }

  private async _bundleDocument(
      bundle: AssignedBundle,
      bundleManifest: BundleManifest,
      bundleImports?: Set<string>): Promise<ASTNode> {
    const url = bundle.url + '.html';
    // Set tracking imports that have been reached.
    const inlinedImports: Set<UrlString> = new Set();
    const newDocument =
        await this._synthesizeBundleContents(bundle, inlinedImports);
    let analyzedRoot: any;
    try {
      analyzedRoot =
          await this.analyzer.analyze(url, parse5.serialize(newDocument));
    } catch (err) {
      throw new Error('Unable to analyze document!');
    }


    const head: ASTNode = dom5.query(newDocument, matchers.head)!;
    const body: ASTNode = dom5.query(newDocument, matchers.body)!;


    // Create a hidden div to target.
    const hiddenDiv = dom5.query(body, matchers.hiddenDiv);
    if (!hiddenDiv) {
      throw new Error('hiddenDiv not created in synthesized bundle');
    }
    const elementInHead = dom5.predicates.parentMatches(matchers.head);

    this.rewriteImportedUrls(newDocument, url, url);

    // Old Polymer versions are not supported, so warn user.
    this.oldPolymerCheck(analyzedRoot);

    // Move htmlImports out of head into a hiddenDiv in body
    const htmlImports = dom5.queryAll(newDocument, matchers.htmlImport);
    htmlImports.forEach((htmlImport) => {
      if (elementInHead(htmlImport)) {
        if (!hiddenDiv.parentNode) {
          astUtils.prepend(body, hiddenDiv);
        }
        astUtils.prependAll(hiddenDiv, astUtils.siblingsAfter(htmlImport));
        astUtils.prepend(hiddenDiv, htmlImport);
      }
    });

    const reachedImports = new Set<UrlString>();

    // Inline all HTML Imports, using "reachedImports" for deduplication.
    for (const htmlImport of htmlImports) {
      await this.inlineHtmlImport(
          url, htmlImport, reachedImports, bundle, bundleManifest);
    }

    if (this.enableScriptInlining) {
      const scriptImports =
          dom5.queryAll(newDocument, matchers.externalJavascript);
      for (const externalScript of scriptImports) {
        await this.inlineScript(url, externalScript);
      }
    }

    if (this.enableCssInlining) {
      const cssImports = dom5.queryAll(newDocument, matchers.stylesheetImport);
      for (const cssLink of cssImports) {
        const style = await this.inlineStylesheet(url, cssLink);
        if (style) {
          this.moveDomModuleStyleIntoTemplate(style);
        }
      }
      const cssLinks = dom5.queryAll(newDocument, matchers.externalStyle);
      for (const cssLink of cssLinks) {
        await this.inlineStylesheet(url, cssLink);
      }
    }

    if (this.stripComments) {
      const comments: Map<string, ASTNode> = new Map();
      dom5.nodeWalkAll(newDocument, dom5.isCommentNode)
          .forEach((comment: ASTNode) => {
            comments.set(comment.data || '', comment);
            dom5.remove(comment);
          });

      // Deduplicate license comments and move to head
      comments.forEach((comment) => {
        if (this.isLicenseComment(comment)) {
          // TODO(usergenic): add prepend to dom5
          if (head.childNodes && head.childNodes.length) {
            dom5.insertBefore(head, head.childNodes[0], comment);
          } else {
            dom5.append(head, comment);
          }
        }
      });
    }
    return newDocument;

    // LATER
    // TODO(garlicnation): resolve <base> tags.
    // TODO(garlicnation): find transitive dependencies of specified excluded
    // files.
    // TODO(garlicnation): ignore <link> in <template>
    // TODO(garlicnation): hide imports in main document, unless already hidden}
    // TODO(garlicnation): Support addedImports

    // SAVED FROM buildLoader COMMENTS
    // TODO(garlicnation): Add noopResolver for external urls.
    // TODO(garlicnation): Add redirectResolver for fakeprotocol:// urls
    // TODO(garlicnation): Add noopResolver for excluded urls.
  }
}

export default Bundler;
