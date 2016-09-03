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
import {ASTNode, CommentNode} from 'parse5';
import {Analyzer, Options as AnalyzerOptions} from 'polymer-analyzer';
import {Document, ScannedDocument, Import} from 'polymer-analyzer/lib/ast/ast';
import {UrlLoader} from 'polymer-analyzer/lib/url-loader/url-loader';
import {FSUrlLoader} from 'polymer-analyzer/lib/url-loader/fs-url-loader';
import constants from './constants';
import * as matchers from './matchers';
import PathResolver from './pathresolver';
import * as ast from './ast-utils';


// TODO(usergenic): Document every one of these options.
export interface Options {
  abspath?: string;
  addedImports?: string[];
  analyzer?: Analyzer;

  // URLs of files that should not be inlined.
  excludes?: string[];
  implicitStrip?: boolean;
  inlineCss?: boolean;
  inlineScripts?: boolean;
  inputUrl?: string;
  redirects?: string[];

  // Remove of all comments (except those containing '@license') when true.
  stripComments?: boolean;

  // Paths of files that should not be inlined and which should have all links
  // removed.
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
  inlineScript(
      docUrl: string, externalScript: ASTNode,
      importMap: Map<string, Import|null>) {
    const rawUrl: string = dom5.getAttribute(externalScript, 'src')!;
    const resolvedUrl = url.resolve(docUrl, rawUrl);
    const script = importMap.get(resolvedUrl);

    if (!script || !script.document) {
      return;
    }

    // Second argument 'true' tells encodeString to escape <script> tags.
    const scriptContent =
        encodeString(script.document.parsedDocument.contents, true);
    dom5.removeAttribute(externalScript, 'src');
    dom5.setTextContent(externalScript, scriptContent);
  }

  /**
   * Inline external stylesheets <link type="text/css" href="*">
   */
  // async inlineCss(documentUrl: string, externalStylesheet: ASTNode):
  //     Promise<void> {
  //   const rawUrl: string = dom5.getAttribute(externalStylesheet, 'href')!;
  //   const resolved = url.resolve(documentUrl, rawUrl);
  //   const backingStylesheet: ScannedDocument =
  //       await this.analyzer._scanResolved(resolved);
  //   const stylesheetContent = backingStylesheet.document.contents;
  //   dom5.removeAttribute(externalStylesheet, 'href');
  //   dom5.setTextContent(externalStylesheet, stylesheetContent);
  // }

  /**
   * Inline external HTML files <link type="import" href="*">
   * TODO(usergenic): Refactor method to simplify and encapsulate case handling
   *     for hidden div adjacency etc.
   */
  inlineHtmlImport(
      docUrl: string, htmlImport: ASTNode,
      importMap: Map<string, Import|null>) {
    const rawUrl: string = dom5.getAttribute(htmlImport, 'href')!;
    const resolvedUrl: string = url.resolve(docUrl, rawUrl);

    const imprt = importMap.get(resolvedUrl);
    if (imprt) {
      // Is there a better way to get what we want other than using
      // parseFragment?
      const importDoc =  // dom5.cloneNode(
                         // dom5.query(imprt.document.parsedDocument.ast,
                         // matchers.body)!);
          dom5.parseFragment(imprt.document.parsedDocument.contents);
      importMap.set(resolvedUrl, null);
      this.pathResolver.resolvePaths(importDoc, resolvedUrl, docUrl);

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
        ast.prepend(importParent, htmlImport);
      } else if (!matchers.inHiddenDiv(htmlImport)) {
        const hiddenDiv = this.getHiddenNode();
        dom5.replace(htmlImport, hiddenDiv);
        dom5.append(hiddenDiv, htmlImport);
        importParent = hiddenDiv;
      } else {
        importParent = htmlImport.parentNode!;
      }

      dom5.queryAll(importDoc, matchers.htmlImport).forEach((nestedImport) => {
        this.inlineHtmlImport(docUrl, nestedImport, importMap);
      });

      ast.insertAllBefore(importParent, htmlImport, importDoc.childNodes!);
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

  /**
   * Given a URL to an entry-point html document, produce a single document
   * with HTML imports, external stylesheets and external scripts inlined,
   * according to the options for this Bundler.
   */
  async bundle(url: string): Promise<ASTNode> {
    const analyzedRoot = await this.analyzer.analyzeRoot(url);

    // Map keyed by url to the import source and which has either the Import
    // feature as a value indicating the inlining of the Import has not yet
    // occurred or a value of null indicating that <link> tags referencing it
    // should be removed from the document.
    const importMap: Map<string, Import|null> = new Map();
    analyzedRoot.getByKind('import').forEach((i) => importMap.set(i.url, i));
    this.excludes.forEach((u) => {
      if (importMap.has(u)) {
        importMap.delete(u);
      }
    });
    this.stripExcludes.forEach((u) => importMap.set(u, null));

    // We must clone the AST from the document, since we will be modifying it.
    const newDocument = dom5.cloneNode(analyzedRoot.parsedDocument.ast);

    const head: ASTNode = dom5.query(newDocument, matchers.head)!;
    const body: ASTNode = dom5.query(newDocument, matchers.body)!;
    // Create a hidden div to target.
    const hiddenDiv = this.getHiddenNode();
    const elementInHead = dom5.predicates.parentMatches(matchers.head);

    // Move htmlImports out of head into a hiddenDiv in body
    const htmlImports = dom5.queryAll(newDocument, matchers.htmlImport);
    htmlImports.forEach((htmlImport) => {
      if (elementInHead(htmlImport)) {
        if (!hiddenDiv.parentNode) {
          ast.prepend(body, hiddenDiv);
        }
        // TODO(usergenic): This function needs a better name.
        ast.moveRemainderToTarget(htmlImport, hiddenDiv);
      }
    });

    // Inline all HTML Imports.  (The inlineHtmlImport method will discern how
    // to handle them based on the state of the importMap.)
    htmlImports.forEach((htmlImport: ASTNode) => {
      this.inlineHtmlImport(url, htmlImport, importMap);
    });

    if (this.enableScriptInlining) {
      dom5.queryAll(newDocument, matchers.externalJavascript)
          .forEach((externalScript: ASTNode) => {
            this.inlineScript(url, externalScript, importMap);
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
