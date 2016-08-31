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

'use strict';

import * as path from 'path';
import * as url from 'url';
const pathPosix = path.posix;
import * as dom5 from 'dom5';
import encodeString from './third_party/UglifyJS2/encode-string';

import * as parse5 from 'parse5';
import {ASTNode} from 'parse5';
import {Analyzer, Options as AnalyzerOptions} from 'polymer-analyzer';
import {Document, ScannedDocument} from 'polymer-analyzer/lib/ast/ast';
import {UrlLoader} from 'polymer-analyzer/lib/url-loader/url-loader';
import {FSUrlLoader} from 'polymer-analyzer/lib/url-loader/fs-url-loader';

import constants from './constants';
import * as matchers from './matchers';
import PathResolver from './pathresolver';
import * as ASTUtils from './ast-utils';


export interface Options {
  abspath?: string;
  addedImports?: string[];
  analyzer?: Analyzer;
  excludes?: string[];
  implicitStrip?: boolean;
  inlineCss?: boolean;
  inlineScripts?: boolean;
  inputUrl?: string;
  redirects?: string[];
  stripComments?: boolean;
  stripExcludes?: string[];
}


class Bundler {
  abspath?: string;
  addedImports: string[];
  analyzer: Analyzer;
  enableCssInlining: boolean;
  enableScriptInlining: boolean;
  excludes: string[];
  implicitStrip: boolean;
  inputUrl: string;
  pathResolver: PathResolver;
  redirects: string[];
  stripComments: boolean;
  stripExcludes: string[];

  constructor(opts: Options) {
    this.analyzer = opts.analyzer!;
    // implicitStrip should be true by default
    this.implicitStrip =
        opts.implicitStrip === undefined ? true : Boolean(opts.implicitStrip);
    this.abspath = (String(opts.abspath) === opts.abspath &&
                    String(opts.abspath).trim() !== '') ?
        path.resolve(opts.abspath) :
        undefined;
    this.pathResolver = new PathResolver(Boolean(this.abspath));
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
    this.redirects = Array.isArray(opts.redirects) ? opts.redirects : [];
  }

  isExcludedHref(href: string) {
    if (constants.EXTERNAL_URL.test(href)) {
      return true;
    }
    if (!this.excludes) {
      return false;
    }
    return this.excludes.some(r => href.search(r) >= 0);
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
   * TODO(usergenic): Give this a more intention-revealing name.
   */
  getHiddenNode(): ASTNode {
    const hidden = dom5.constructors.element('div');
    dom5.setAttribute(hidden, 'hidden', '');
    dom5.setAttribute(hidden, 'by-vulcanize', '');
    return hidden;
  }

  /**
   * Inline external scripts <script src="*">
   */
  async inlineScript(documentUrl: string, externalScript: ASTNode):
      Promise<void> {
    const rawUrl: string = dom5.getAttribute(externalScript, 'src')!;
    const resolved = url.resolve(documentUrl, rawUrl);
    const backingScript: ScannedDocument =
        await this.analyzer._scanResolved(resolved);
    const scriptContent = backingScript.document.contents;
    dom5.removeAttribute(externalScript, 'src');
    dom5.setTextContent(externalScript, scriptContent);
  }

  /**
   * Inline external stylesheets <link type="text/css" href="*">
   */
  async inlineCss(documentUrl: string, externalStylesheet: ASTNode):
      Promise<void> {
    const rawUrl: string = dom5.getAttribute(externalStylesheet, 'href')!;
    const resolved = url.resolve(documentUrl, rawUrl);
    const backingStylesheet: ScannedDocument =
        await this.analyzer._scanResolved(resolved);
    const stylesheetContent = backingStylesheet.document.contents;
    dom5.removeAttribute(externalStylesheet, 'href');
    dom5.setTextContent(externalStylesheet, stylesheetContent);
  }

  /**
   * Inline external HTML files <link type="import" href="*">
   * TODO(usergenic): Refactor method to simplify and encapsulate case handling
   *     for hidden div adjacency etc.
   */
  async inlineHtmlImport(
      documentUrl: string, htmlImport: ASTNode,
      inlined: Set<string>): Promise<void> {
    const rawUrl: string = dom5.getAttribute(htmlImport, 'href')!;
    const resolved = url.resolve(documentUrl, rawUrl);
    if (inlined.has(resolved)) {
      dom5.remove(htmlImport);
      return;
    }
    inlined.add(resolved);
    const backingDocument: ScannedDocument =
        await this.analyzer._scanResolved(resolved);
    const documentAst = dom5.parseFragment(backingDocument.document.contents);
    this.pathResolver.resolvePaths(documentAst, resolved, documentUrl);
    let importParent: ASTNode;
    if (matchers.afterHiddenDiv(htmlImport)) {
      importParent = dom5.nodeWalkPrior(htmlImport, matchers.hiddenDiv)!;
      dom5.remove(htmlImport);
      dom5.append(importParent, htmlImport);
    } else if (matchers.beforeHiddenDiv(htmlImport)) {
      const index = htmlImport.parentNode!.childNodes!.indexOf(htmlImport);
      importParent = htmlImport.parentNode!.childNodes![index + 1];
      dom5.remove(htmlImport);
      ASTUtils.prepend(importParent, htmlImport);
    } else if (!matchers.inHiddenDiv(htmlImport)) {
      const hiddenDiv = this.getHiddenNode();
      dom5.replace(htmlImport, hiddenDiv);
      dom5.append(hiddenDiv, htmlImport);
      importParent = hiddenDiv;
    } else {
      importParent = htmlImport.parentNode!;
    }

    ASTUtils.insertAllBefore(importParent, htmlImport, documentAst.childNodes!);
    dom5.remove(htmlImport);
  }

  /**
   * Given a URL to an entry-point html document, produce a single document
   * with HTML imports, external stylesheets and external scripts inlined,
   * according to the options for this Bundler.
   */
  async bundle(url: string): Promise<ASTNode> {
    const analyzedRoot = await this.analyzer.analyzeRoot(url);
    // TODO(usergenic): Don't re-parse this document if you already have an AST
    // in parsedDocument.  Try cloning or even building newDocument as analyzed
    // document is walked.
    const newDocument = dom5.parse(analyzedRoot.parsedDocument.contents);

    // Create a hidden div to target.
    const body: ASTNode = dom5.query(newDocument, matchers.body)!;
    const hiddenDiv = this.getHiddenNode();

    const getNextHtmlImport = () =>
        dom5.query(newDocument, matchers.htmlImport);
    const elementInHead = dom5.predicates.parentMatches(matchers.head);
    const inlinedHtmlImports = new Set<string>();

    let nextHtmlImport: ASTNode|null;
    while (nextHtmlImport = getNextHtmlImport()) {
      // If the import is in head, move all subsequent nodes to body.
      if (elementInHead(nextHtmlImport)) {
        // Put the hiddenDiv in the body the first time we need it.
        if (!hiddenDiv.parentNode) {
          ASTUtils.prepend(body, hiddenDiv);
        }
        // TODO(usergenic): This function needs a better name.
        ASTUtils.moveRemainderToTarget(nextHtmlImport, hiddenDiv);
        // nextHtmlImport has moved, but we should be able to continue.
        continue;
      }
      await this.inlineHtmlImport(url, nextHtmlImport, inlinedHtmlImports);
    }

    if (this.enableScriptInlining) {
      const getNextExternalScript = () =>
          dom5.query(newDocument, matchers.externalJavascript);
      let nextExternalScript: ASTNode|null;
      while (nextExternalScript = getNextExternalScript()) {
        await this.inlineScript(url, nextExternalScript);
      }
    }
    return newDocument;
    // TODO(garlicnation): inline HTML.
    // TODO(garlicnation): resolve paths.
    // TODO(garlicnation): inline CSS
    // TODO(garlicnation): inline javascript
    // TODO(garlicnation): reparent <link> and subsequent nodes to <body>

    // LATER
    // TODO(garlicnation): resolve <base> tags.
    // TODO(garlicnation): deduplicate imports
    // TODO(garlicnation): Ignore stripped imports
    // TODO(garlicnation): preserve excluded imports
    // TODO(garlicnation): find transitive dependencies of specified excluded
    // files.
    // TODO(garlicnation): ignore <link> in <template>
    // TODO(garlicnation): deduplicate license comments
    // TODO(garlicnation): optionally strip non-license comments
    // TODO(garlicnation): hide imports in main document, unless already hidden}
    // TODO(garlicnation): Support addedImports

    // SAVED FROM buildLoader COMMENTS
    // TODO(garlicnation): Add noopResolver for external urls.
    // TODO(garlicnation): Add redirectResolver for fakeprotocol:// urls
    // TODO(garlicnation): Add noopResolver for excluded urls.
  }
}

export default Bundler;
