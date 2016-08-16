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

import constants from './constants';
import * as matchers from './matchers';
import PathResolver from './pathresolver';
import * as parse5 from 'parse5';
import {Analyzer, Options as AnalyzerOptions} from 'polymer-analyzer';
import {UrlLoader} from 'polymer-analyzer/lib/url-loader/url-loader';
import {FSUrlLoader} from 'polymer-analyzer/lib/url-loader/fs-url-loader';

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
      urlLoader: new FSUrlLoader(opts.root),

    };
  }
  implicitStrip: Boolean;
  abspath;
  pathResolver;
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

  async bundle(url: string): Promise<parse5.ASTNode> {
    var analyzer = new Analyzer({
      urlLoader: this.loader
    });
    analyzer.analyzeRoot(url);
    // TODO(garlicnation): resolve <base> tags.
    // TODO(garlicnation): deduplicate imports
    // TODO(garlicnation): Ignore stripped imports
    // TODO(garlicnation): preserve excluded imports
    // TODO(garlicnation): find transitive dependencies of specified excluded files.
    // TODO(garlicnation): ignore <link> in <template>
    // TODO(garlicnation): deduplicate license comments
    // TODO(garlicnation): optionally strip non-license comments
    // TODO(garlicnation): inline CSS
    // TODO(garlicnation): inline javascript
    // TODO(garlicnation): resolve paths.
    // TODO(garlicnation): reparent <link> and subsequent nodes to <body>
    // TODO(garlicnation): hide imports in main document, unless already hidden}
    // TODO(garlicnation): Support addedImports
  }

}

export default Bundler;
