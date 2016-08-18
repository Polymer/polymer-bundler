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
import ASTUtils from './ast-utils';


function buildLoader(config: any) {
  const abspath: string = config.abspath;
  const excludes = config.excludes;
  const fsResolver = config.fsResolver;
  const redirects = config.redirects;
  let root = abspath && path.resolve(abspath) || process.cwd();
  let loader = new FSUrlLoader(root);
  // TODO(garlicnation): Add noopResolver for external urls.
  // TODO(garlicnation): Add redirectResolver for fakeprotocol:// urls
  // TODO(garlicnation): Add noopResolver for excluded urls.
  return loader;
}

class Bundler {
  constructor(opts: any) {
    // implicitStrip should be true by default
    this.implicitStrip =
        opts.implicitStrip === undefined ? true : Boolean(opts.implicitStrip);
    this.abspath = (String(opts.abspath) === opts.abspath &&
                    String(opts.abspath).trim() !== '') ?
        path.resolve(opts.abspath) :
        null;
    this.pathResolver = new PathResolver(this.abspath);
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
    this.fsResolver = opts.fsResolver;
    this.redirects = Array.isArray(opts.redirects) ? opts.redirects : [];
    this.opts = {
      urlLoader: new FSUrlLoader(opts.root || process.cwd()),
    };
  }
  implicitStrip: Boolean;
  abspath;
  pathResolver: PathResolver;
  addedImports;
  excludes;
  stripExcludes;
  stripComments;
  enableCssInlining;
  enableScriptInlining;
  inputUrl;
  fsResolver;
  redirects;
  loader;
  opts: AnalyzerOptions;

  isExcludedHref(href) {
    if (constants.EXTERNAL_URL.test(href)) {
      return true;
    }
    if (!this.excludes) {
      return false;
    }
    return this.excludes.some(r => href.search(r) >= 0);
  }

  isBlankTextNode(node) {
    return node && dom5.isTextNode(node) &&
        !/\S/.test(dom5.getTextContent(node));
  }

  removeElementAndNewline(node, replacement) {
    // when removing nodes, remove the newline after it as well
    const parent = node.parentNode;
    const nextIdx = parent.childNodes.indexOf(node) + 1;
    const next = parent.childNodes[nextIdx];
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

  isLicenseComment(node) {
    if (dom5.isCommentNode(node)) {
      return dom5.getTextContent(node).indexOf('@license') > -1;
    }
    return false;
  }

  hide(node) {
    const hidden = dom5.constructors.element('div');
    dom5.setAttribute(hidden, 'hidden', '');
    dom5.setAttribute(hidden, 'by-vulcanize', '');
    this.removeElementAndNewline(node, hidden);
    dom5.append(hidden, node);
  }

  /**
   * Replace htmlImport
   */
  async inlineImport(
      documentUrl: string, htmlImport: ASTNode, analyzer: Analyzer,
      inlined: Set<string>): Promise<void> {
    const rawUrl: string = dom5.getAttribute(htmlImport, 'href');
    const resolved = url.resolve(documentUrl, rawUrl);
    if (inlined.has(resolved)) {
      dom5.remove(htmlImport);
      return;
    }
    inlined.add(resolved);
    const backingDocument: ScannedDocument =
        await analyzer._analyzeResolved(resolved);
    const documentAst = dom5.parseFragment(backingDocument.document.contents);
    this.pathResolver.resolvePaths(documentAst, resolved, documentUrl);
    const importParent = htmlImport.parentNode;
    dom5.remove(htmlImport);
    ASTUtils.prependMultiple(importParent, documentAst.childNodes);
  }

  async bundle(url: string): Promise<ASTNode> {
    const analyzer: Analyzer = new Analyzer(this.opts);
    const analyzed: Document = await analyzer.analyzeRoot(url);
    const newDocument = dom5.parse(analyzed.parsedDocument.contents);
    const body = dom5.query(newDocument, matchers.body);
    const head = dom5.query(newDocument, matchers.head);
    const getNextImport = () => dom5.query(newDocument, matchers.htmlImport);
    const elementInHead = dom5.predicates.parentMatches(matchers.head);
    const inlinedImports = new Set<string>();
    let c = 1;
    for (let nextImport; nextImport = getNextImport();) {
      // If the import is in head, move all subsequent nodes to body.
      if (elementInHead(nextImport)) {
        // This function needs a better name.
        ASTUtils.moveRemainderToTarget(nextImport, body);
        // nextImport has moved, but we should be able to continue.
        continue;
      }
      await this.inlineImport(url, nextImport, analyzer, inlinedImports);
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
  }
}

export default Bundler;
