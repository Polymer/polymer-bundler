/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

// jshint node:true
'use strict';

import path from 'path';
// use path.posix on Node > 0.12+, path-posix on 0.10
const pathPosix = path.posix || require('path-posix');
import url from 'url';
import dom5 from 'dom5';
import matchers from './matchers';
import constants from './constants';

class PathResolver {
  constructor(abspath) {
    if (abspath) {
      this.abspath = abspath;
    }
  }

  isTemplatedUrl(href) {
    return href.search(constants.URL_TEMPLATE) >= 0;
  }

  resolvePaths(importDoc, importUrl, mainDocUrl) {
    // rewrite URLs in element attributes
    const nodes = dom5.queryAll(importDoc, matchers.urlAttrs);
    let attrValue;
    for (let i = 0, node; i < nodes.length; i++) {
      node = nodes[i];
      for (let j = 0, attr; j < constants.URL_ATTR.length; j++) {
        attr = constants.URL_ATTR[j];
        attrValue = dom5.getAttribute(node, attr);
        if (attrValue && !this.isTemplatedUrl(attrValue)) {
          let relUrl;
          if (attr === 'style') {
            relUrl = this.rewriteURL(importUrl, mainDocUrl, attrValue);
          } else {
            relUrl = this.rewriteRelPath(importUrl, mainDocUrl, attrValue);
            if (attr === 'assetpath' && relUrl.slice(-1) !== '/') {
              relUrl += '/';
            }
          }
          dom5.setAttribute(node, attr, relUrl);
        }
      }
    }
    // rewrite URLs in stylesheets
    const styleNodes = dom5.queryAll(importDoc, matchers.CSS);
    for (let i = 0, node; i < styleNodes.length; i++) {
      node = styleNodes[i];
      let styleText = dom5.getTextContent(node);
      styleText = this.rewriteURL(importUrl, mainDocUrl, styleText);
      dom5.setTextContent(node, styleText);
    }
    // add assetpath to dom-modules in importDoc
    const domModules = dom5.queryAll(importDoc, matchers.domModule);
    for (let i = 0, node; i < domModules.length; i++) {
      node = domModules[i];
      let assetPathUrl = this.rewriteRelPath(importUrl, mainDocUrl, '');
      assetPathUrl = pathPosix.dirname(assetPathUrl) + '/';
      dom5.setAttribute(node, 'assetpath', assetPathUrl);
    }
  }

  isAbsoluteUrl(href) {
    return constants.ABS_URL.test(href);
  }

  rewriteRelPath(importUrl, mainDocUrl, relUrl) {
    if (this.isAbsoluteUrl(relUrl)) {
      return relUrl;
    }
    const absUrl = url.resolve(importUrl, relUrl);
    if (this.abspath) {
      return url.resolve('/', absUrl);
    }
    const parsedFrom = url.parse(mainDocUrl);
    const parsedTo = url.parse(absUrl);
    if (parsedFrom.protocol === parsedTo.protocol && parsedFrom.host === parsedTo.host) {
      const pathname = pathPosix.relative(pathPosix.dirname(parsedFrom.pathname), parsedTo.pathname);
      return url.format({
        pathname: pathname,
        search: parsedTo.search,
        hash: parsedTo.hash
      });
    }
    return absUrl;
  }

  rewriteURL(importUrl, mainDocUrl, cssText) {
    return cssText.replace(constants.URL, match => {
      let path = match.replace(/["']/g, "").slice(4, -1);
      path = this.rewriteRelPath(importUrl, mainDocUrl, path);
      return 'url("' + path + '")';
    });
  }

  // remove effects of <base>
  acid(doc, docUrl) {
    const base = dom5.query(doc, matchers.base);
    if (base) {
      let baseUrl = dom5.getAttribute(base, 'href');
      const baseTarget = dom5.getAttribute(base, 'target');
      dom5.remove(base);
      if (baseUrl) {
        if (baseUrl.slice(-1) === '/') {
          baseUrl = baseUrl.slice(0, -1);
        }
        const docBaseUrl = url.resolve(docUrl, baseUrl + '/.index.html');
        this.resolvePaths(doc, docBaseUrl, docUrl);
      }
      if (baseTarget) {
        const elementsNeedTarget = dom5.queryAll(doc, matchers.targetMatcher);
        elementsNeedTarget.forEach(el => {
          dom5.setAttribute(el, 'target', baseTarget);
        });
      }
    }
  }

  pathToUrl(filePath) {
    const absolutePath = path.resolve(filePath);
    if (process.platform === 'win32') {
      // encode C:\foo\ as C:/foo/
      return absolutePath.split('\\').join('/');
    } else {
      return absolutePath;
    }
  }

  urlToPath(uri) {
    const parsed = url.parse(uri);
    if (process.platform === 'win32') {
      return parsed.protocol + parsed.pathname.split('/').join('\\');
    } else {
      return (parsed.protocol || '') + parsed.pathname;
    }
  }
}

export default PathResolver;
