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
import {ASTNode, CommentNode} from 'parse5';
import {Analyzer, Options as AnalyzerOptions} from 'polymer-analyzer';
import {Document, ScannedDocument} from 'polymer-analyzer/lib/model/document';
import {Import} from 'polymer-analyzer/lib/model/import';
import {ParsedHtmlDocument} from 'polymer-analyzer/lib/html/html-document';
import {FSUrlLoader} from 'polymer-analyzer/lib/url-loader/fs-url-loader';
import constants from './constants';
import * as astUtils from './ast-utils';
import * as matchers from './matchers';
import * as urlUtils from './url-utils';
import {BundleStrategy} from './bundle-manifest';
import DocumentCollection from './document-collection';
import {buildDepsIndex} from './deps-index';

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
    this.stripExcludes =
        Array.isArray(opts.stripExcludes) ? opts.stripExcludes : [];
    this.stripComments = Boolean(opts.stripComments);
    this.enableCssInlining = Boolean(opts.inlineCss);
    this.enableScriptInlining = Boolean(opts.inlineScripts);
    this.inputUrl =
        String(opts.inputUrl) === opts.inputUrl ? opts.inputUrl : '';
  }

  isExcludedHref(url: string): boolean {
    if (constants.EXTERNAL_URL.test(url)) {
      return true;
    }
    if (!this.excludes) {
      return false;
    }
    return this.excludes.some(r => url.search(r) >= 0);
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
  inlineScript(
      docUrl: string,
      externalScript: ASTNode,
      importMap: Map<string, Import|null>): ASTNode|undefined {
    const rawUrl: string = dom5.getAttribute(externalScript, 'src')!;
    const resolvedUrl = urlLib.resolve(docUrl, rawUrl);
    const script = importMap.get(resolvedUrl);

    if (!script || !script.document) {
      return;
    }

    // Second argument 'true' tells encodeString to escape <script> tags.
    const scriptContent =
        encodeString(script.document.parsedDocument.contents, true);
    dom5.removeAttribute(externalScript, 'src');
    dom5.setTextContent(externalScript, scriptContent);

    return externalScript;
  }

  /**
   * Inline a stylesheet (either from deprecated polymer-style css import `<link
   * rel="import" type="css">` import or regular external stylesheet link
   * `<link rel="stylesheet">`.
   */
  inlineStylesheet(
      docUrl: string,
      cssLink: ASTNode,
      importMap: Map<string, Import|null>): ASTNode|undefined {
    const stylesheetUrl: string = dom5.getAttribute(cssLink, 'href')!;
    const resolvedStylesheetUrl = urlLib.resolve(docUrl, stylesheetUrl);
    const stylesheetImport = importMap.get(resolvedStylesheetUrl);

    if (!stylesheetImport || !stylesheetImport.document) {
      return;
    }

    const media = dom5.getAttribute(cssLink, 'media');
    const stylesheetContent = stylesheetImport.document.parsedDocument.contents;
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
  inlineHtmlImport(
      docUrl: string,
      htmlImport: ASTNode,
      importMap: Map<string, Import|null>) {
    const rawUrl: string = dom5.getAttribute(htmlImport, 'href')!;
    const resolvedUrl: string = urlLib.resolve(docUrl, rawUrl);

    const analyzedImport = importMap.get(resolvedUrl);
    if (analyzedImport) {
      // If the document wasn't loaded for the import during analysis, we can't
      // inline it.
      if (!analyzedImport.document) {
        // TODO(usergenic): What should the behavior be when we don't have the
        // document to inline available in the analyzer?
        return;
      }

      // Is there a better way to get what we want other than using
      // parseFragment?
      const importDoc =
          dom5.parseFragment(analyzedImport.document.parsedDocument.contents);
      importMap.set(resolvedUrl, null);
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

      dom5.queryAll(importDoc, matchers.htmlImport).forEach((nestedImport) => {
        this.inlineHtmlImport(docUrl, nestedImport, importMap);
      });

      astUtils.insertAllBefore(importParent, htmlImport, importDoc.childNodes!);
    }

    // If we've just inlined it or otherwise have seen it before, we can remove
    // the <link> tag.
    if (importMap.get(resolvedUrl) === null) {
      dom5.remove(htmlImport);
    }

    // If we've never seen this import before, lets put it on the map as null so
    // we will deduplicate if we encounter it again.
    if (!importMap.has(resolvedUrl)) {
      importMap.set(resolvedUrl, null);
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
    const styleNodes = dom5.queryAll(importDoc, matchers.styleMatcher);
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
   * Given Multiple urls, produces a sharded build by applying the provided
   * strategy.
   */
  async bundle(bundles: string[], strategy?: BundleStrategy):
      Promise<DocumentCollection> {
    if (!this.analyzer) {
      throw new Error('No analyzer provided.');
    }
    const doc = await this._bundleDocument(
        bundles[0], this.excludes, this.stripExcludes);
    const collection = new Map<string, ASTNode>();
    collection.set(bundles[0], doc);
    return collection;
  }

  private async _bundleDocument(
      url: string,
      excludes: string[],
      stripExcludes: string[]): Promise<ASTNode> {
    const analyzedRoot = await this.analyzer.analyzeRoot(url);

    // Map keyed by url to the import source and which has either the Import
    // feature as a value indicating the inlining of the Import has not yet
    // occurred or a value of null indicating that <link> tags referencing it
    // should be removed from the document.
    const importMap: Map<string, Import|null> = new Map();
    analyzedRoot.getByKind('import').forEach((i) => importMap.set(i.url, i));
    importMap.forEach((_, u) => {
      if (this.isStripExcludedHref(u)) {
        importMap.set(u, null);
      } else if (this.isExcludedHref(u)) {
        importMap.delete(u);
      }
    });

    // We must clone the AST from the document, since we will be modifying it.
    const newDocument = dom5.parse(analyzedRoot.parsedDocument.contents);

    const head: ASTNode = dom5.query(newDocument, matchers.head)!;
    const body: ASTNode = dom5.query(newDocument, matchers.body)!;
    // Create a hidden div to target.
    const hiddenDiv = this.createHiddenContainerNode();
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

    // Inline all HTML Imports.  (The inlineHtmlImport method will discern how
    // to handle them based on the state of the importMap.)
    htmlImports.forEach((htmlImport: ASTNode) => {
      this.inlineHtmlImport(url, htmlImport, importMap);
    });

    if (this.enableScriptInlining) {
      const scriptImports =
          dom5.queryAll(newDocument, matchers.externalJavascript);
      scriptImports.forEach((externalScript: ASTNode) => {
        this.inlineScript(url, externalScript, importMap);
      });
    }

    if (this.enableCssInlining) {
      const cssImports = dom5.queryAll(newDocument, matchers.stylesheetImport);
      cssImports.forEach((cssLink: ASTNode) => {
        let style = this.inlineStylesheet(url, cssLink, importMap);
        if (style) {
          this.moveDomModuleStyleIntoTemplate(style);
        }
      });
      const cssLinks = dom5.queryAll(newDocument, matchers.externalStyle);
      cssLinks.forEach((cssLink: ASTNode) => {
        this.inlineStylesheet(url, cssLink, importMap);
      });
    }

    if (this.stripComments) {
      const comments: Map<string, CommentNode> = new Map();
      dom5.nodeWalkAll(newDocument, dom5.isCommentNode)
          .forEach((comment: CommentNode) => {
            comments.set(comment.data, comment);
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
    // TODO(garlicnation): inline CSS

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
