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

/// <reference path="../node_modules/@types/node/index.d.ts" />
/// <reference path="../node_modules/@types/parse5/index.d.ts" />
'use strict';

import * as path from 'path';
import * as url from 'url';
const pathPosix = path.posix;
import * as dom5 from 'dom5';
import {encodeString} from './third_party/UglifyJS2/output';

import constants from './constants';
import matchers from './matchers';
import PathResolver from './pathresolver';
import {ASTNode} from 'parse5';
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
    if (opts.loader) {
      this.loader = opts.loader;
    } else {
      this.loader = buildLoader({
        abspath: this.abspath,
        fsResolver: this.fsResolver,
        excludes: this.excludes,
        redirects: this.redirects
      });
    }
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
  reparent(newParent) {
    return node => {
      node.parentNode = newParent;
    };
  }

  isExcludedImport(importMeta) {
    return this.isExcludedHref(importMeta.href);
  }

  isExcludedHref(href) {
    if (constants.EXTERNAL_URL.test(href)) {
      return true;
    }
    if (!this.excludes) {
      return false;
    }
    return this.excludes.some(r => href.search(r) >= 0);
  }

  isStrippedImport(importMeta) {
    if (!this.stripExcludes.length) {
      return false;
    }
    const href = importMeta.href;
    return this.stripExcludes.some(r => href.search(r) >= 0);
  }

  isBlankTextNode(node) {
    return node && dom5.isTextNode(node) &&
        !/\S/.test(dom5.getTextContent(node));
  }

  hasOldPolymer(doc) {
    return Boolean(dom5.query(doc, matchers.polymerElement));
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

  moveToBodyMatcher = dom5.predicates.AND(
      dom5.predicates.OR(
          dom5.predicates.hasTagName('script'),
          dom5.predicates.hasTagName('link')),
      dom5.predicates.NOT(matchers.polymerExternalStyle))

  ancestorWalk(node, target) {
    while (node) {
      if (node === target) {
        return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  isTemplated(node) {
    while (node) {
      if (dom5.isDocumentFragment(node)) {
        return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  flatten(tree, isMainDoc) {
    const doc = tree.html.ast;
    const imports = tree.imports;
    const head = dom5.query(doc, matchers.head);
    const body = dom5.query(doc, matchers.body);
    const importNodes = tree.html.import;
    // early check for old polymer versions
    if (this.hasOldPolymer(doc)) {
      throw new Error(
          constants.OLD_POLYMER + ' File: ' +
          this.pathResolver.urlToPath(tree.href));
    }
    this.fixFakeExternalScripts(doc);
    this.pathResolver.acid(doc, tree.href);
    let moveTarget;
    if (isMainDoc) {
      // hide bodies of imports from rendering in main document
      moveTarget = dom5.constructors.element('div');
      dom5.setAttribute(moveTarget, 'hidden', '');
      dom5.setAttribute(moveTarget, 'by-vulcanize', '');
    } else {
      moveTarget = dom5.constructors.fragment();
    }
    head.childNodes.filter(this.moveToBodyMatcher).forEach(function(n) {
      this.removeElementAndNewline(n);
      dom5.append(moveTarget, n);
    }, this);
    this.prepend(body, moveTarget);
    if (imports) {
      for (let i = 0, im, thisImport; i < imports.length; i++) {
        im = imports[i];
        thisImport = importNodes[i];
        // TODO(garlicnation): deduplicate imports
        // TODO(garlicnation): Ignore stripped imports
        // TODO(garlicnation): preserve excluded imports
        // TODO(garlicnation): ignore <link> in <template>
        // TODO(garlicnation): deduplicate license comments
        // TODO(garlicnation): resolve paths.
        // TODO(garlicnation): reparent <link> and subsequent nodes to <body>
        // hide imports in main document, unless already hidden
        if (isMainDoc && !this.ancestorWalk(thisImport, moveTarget)) {
          this.hide(thisImport);
        }
        this.removeElementAndNewline(thisImport, bodyFragment);
      }
    }
    // If hidden node is empty, remove it
    if (isMainDoc && moveTarget.childNodes.length === 0) {
      dom5.remove(moveTarget);
    }
    return doc;
  }

  hide(node) {
    const hidden = dom5.constructors.element('div');
    dom5.setAttribute(hidden, 'hidden', '');
    dom5.setAttribute(hidden, 'by-vulcanize', '');
    this.removeElementAndNewline(node, hidden);
    dom5.append(hidden, node);
  }

  prepend(parent, node) {
    if (parent.childNodes.length) {
      dom5.insertBefore(parent, parent.childNodes[0], node);
    } else {
      dom5.append(parent, node);
    }
  }

  fixFakeExternalScripts(doc) {
    const scripts = dom5.queryAll(doc, matchers.JS_INLINE);
    scripts.forEach(script => {
      if (script.__hydrolysisInlined) {
        dom5.setAttribute(script, 'src', script.__hydrolysisInlined);
        dom5.setTextContent(script, '');
      }
    });
  }

  // inline scripts into document, returns a promise resolving to document.
  inlineScripts(doc, href) {
    const scripts = dom5.queryAll(doc, matchers.JS_SRC);
    const scriptPromises = scripts.map(script => {
      const src = dom5.getAttribute(script, 'src');
      const uri = url.resolve(href, src);
      // let the loader handle the requests
      if (this.isExcludedHref(src)) {
        return Promise.resolve(true);
      }
      return this.loader.request(uri).then(content => {
        if (content) {
          content = encodeString(content);
          dom5.removeAttribute(script, 'src');
          dom5.setTextContent(script, content);
        }
      });
    });
    // When all scripts are read, return the document
    return Promise.all(scriptPromises).then(() => ({doc: doc, href: href}));
  }


  // inline scripts into document, returns a promise resolving to document.
  inlineCss(doc, href) {
    const css_links = dom5.queryAll(doc, matchers.ALL_CSS_LINK);
    const cssPromises = css_links.map(link => {
      const tag = link;
      const src = dom5.getAttribute(tag, 'href');
      const media = dom5.getAttribute(tag, 'media');
      const uri = url.resolve(href, src);
      const isPolymerExternalStyle = matchers.polymerExternalStyle(tag);

      // let the loader handle the requests
      if (this.isExcludedHref(src)) {
        return Promise.resolve(true);
      }
      // let the loader handle the requests
      return this.loader.request(uri).then(content => {
        if (content) {
          content = this.pathResolver.rewriteURL(uri, href, content);
          if (media) {
            content = '@media ' + media + ' {' + content + '}';
          }
          const style = dom5.constructors.element('style');
          dom5.setTextContent(style, '\n' + content + '\n');

          if (isPolymerExternalStyle) {
            // a polymer expternal style <link type="css" rel="import"> must be
            // in a <dom-module> to be processed
            const ownerDomModule = dom5.nodeWalkPrior(
                tag, dom5.predicates.hasTagName('dom-module'));
            if (ownerDomModule) {
              let domTemplate = dom5.query(
                  ownerDomModule, dom5.predicates.hasTagName('template'));
              if (!domTemplate) {
                // create a <template>, which has a fragment as childNodes[0]
                domTemplate = dom5.constructors.element('template');
                domTemplate.childNodes.push(dom5.constructors.fragment());
                dom5.append(ownerDomModule, domTemplate);
              }
              dom5.remove(tag);
              // put the style at the top of the dom-module's template
              this.prepend(domTemplate.childNodes[0], style);
            }
          } else {
            dom5.replace(tag, style);
          }
        }
      });
    });
    // When all style imports are read, return the document
    return Promise.all(cssPromises).then(() => ({doc: doc, href: href}));
  }

  getImplicitExcludes(excludes) {
    // Build a loader that doesn't have to stop at our excludes, since we need
    // them.
    const loader = buildLoader({
      abspath: this.abspath,
      fsResolver: this.fsResolver,
      redirects: this.redirects
    });
    const analyzer = new analyzer.Analyzer(true, loader);
    const analyzedExcludes = [];
    excludes.forEach(exclude => {
      if (exclude.match(/.js$/)) {
        return;
      }
      if (exclude.match(/.css$/)) {
        return;
      }
      if (exclude.slice(-1) === '/') {
        return;
      }
      const depPromise = analyzer._getDependencies(exclude);
      depPromise.catch(err => {
        // include that this was an excluded url in the error message.
        err.message +=
            '. Could not read dependencies for excluded URL: ' + exclude;
      });
      analyzedExcludes.push(depPromise);
    });
    return Promise.all(analyzedExcludes).then(strippedExcludes => {
      const dedupe = {};
      strippedExcludes.forEach(excludeList => {
        excludeList.forEach(exclude => {
          dedupe[exclude] = true;
        });
      });
      return Object.keys(dedupe);
    });
  }

  _process(target, cb) {
    let chain = Promise.resolve(true);
    if (this.implicitStrip && this.excludes) {
      chain = this.getImplicitExcludes(this.excludes).then(implicitExcludes => {
        implicitExcludes.forEach(strippedExclude => {
          this.stripExcludes.push(strippedExclude);
        });
      });
    }
    const analyzer = new analyzer.Analyzer(true, this.loader);
    chain = chain.then(() => analyzer.metadataTree(target)).then(tree => {
      const flatDoc = this.flatten(tree, true);
      // make sure there's a <meta charset> in the page to force UTF-8
      let meta = dom5.query(flatDoc, matchers.meta);
      const head = dom5.query(flatDoc, matchers.head);
      for (let i = 0; i < this.addedImports.length; i++) {
        const newImport = dom5.constructors.element('link');
        dom5.setAttribute(newImport, 'rel', 'import');
        dom5.setAttribute(newImport, 'href', this.addedImports[i]);
        this.prepend(head, newImport);
      }
      if (!meta) {
        meta = dom5.constructors.element('meta');
        dom5.setAttribute(meta, 'charset', 'UTF-8');
        this.prepend(head, meta);
      }
      return {doc: flatDoc, href: tree.href};
    });
    if (this.enableScriptInlining) {
      chain = chain.then(docObj => this.inlineScripts(docObj.doc, docObj.href));
    }
    if (this.enableCssInlining) {
      chain = chain.then(docObj => this.inlineCss(docObj.doc, docObj.href));
    }
    if (this.stripComments) {
      chain = chain.then(docObj => {
        const comments = new CommentMap();
        const doc = docObj.doc;
        const head = dom5.query(doc, matchers.head);
        // remove all comments
        dom5.nodeWalkAll(doc, dom5.isCommentNode).forEach(comment => {
          comments.set(comment.data, comment);
          dom5.remove(comment);
        });
        // Deduplicate license comments
        comments.keys().forEach(function(commentData) {
          if (commentData.indexOf('@license') == -1) {
            return;
          }
          this.prepend(head, comments.get(commentData));
        }, this);
        return docObj;
      });
    }
    chain
        .then(docObj => {
          cb(null, dom5.serialize(docObj.doc));
        })
        .catch(cb);
  }

  process(target, cb) {
    if (this.inputUrl) {
      this._process(this.inputUrl, cb);
    } else {
      if (this.abspath) {
        target = pathPosix.resolve('/', target);
      } else {
        target = this.pathResolver.pathToUrl(path.resolve(target));
      }
      this._process(target, cb);
    }
  }
}

export default Bundler;
