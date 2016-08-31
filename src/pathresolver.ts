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

// jshint node:true
'use strict';

import * as path from 'path';
import * as url from 'url';
import * as dom5 from 'dom5';
import * as matchers from './matchers';
import {ASTNode} from 'parse5';
import constants from './constants';

const pathPosix = path.posix;

class PathResolver {
  constructor(public abspath?: boolean) {
  }

  isTemplatedUrl(href: string): boolean {
    return href.search(constants.URL_TEMPLATE) >= 0;
  }

  resolvePaths(importDoc: ASTNode, importUrl: string, mainDocUrl: string) {
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
    const styleNodes = dom5.queryAll(importDoc, matchers.styleMatcher);
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

  isAbsoluteUrl(href: string): boolean {
    return constants.ABS_URL.test(href);
  }

  rewriteRelPath(importUrl: string, mainDocUrl: string, relUrl: string):
      string {
    if (this.isAbsoluteUrl(relUrl)) {
      return relUrl;
    }
    const absUrl = url.resolve(importUrl, relUrl);
    if (this.abspath) {
      return url.resolve('/', absUrl);
    }
    const parsedFrom = url.parse(mainDocUrl);
    const parsedTo = url.parse(absUrl);
    if (parsedFrom.protocol === parsedTo.protocol &&
        parsedFrom.host === parsedTo.host) {
      const pathname = pathPosix.relative(
          pathPosix.dirname(parsedFrom.pathname), parsedTo.pathname);
      return url.format(
          {pathname: pathname, search: parsedTo.search, hash: parsedTo.hash});
    }
    return absUrl;
  }

  rewriteURL(importUrl: string, mainDocUrl: string, cssText: string): string {
    return cssText.replace(constants.URL, match => {
      let path = match.replace(/["']/g, '').slice(4, -1);
      path = this.rewriteRelPath(importUrl, mainDocUrl, path);
      return 'url("' + path + '")';
    });
  }

  pathToUrl(filePath: string): string {
    const absolutePath = path.resolve(filePath);
    if (process.platform === 'win32') {
      // encode C:\foo\ as C:/foo/
      return absolutePath.split('\\').join('/');
    } else {
      return absolutePath;
    }
  }

  urlToPath(uri: string): string {
    const parsed = url.parse(uri);
    if (process.platform === 'win32') {
      return parsed.protocol + parsed.pathname.split('/').join('\\');
    } else {
      return (parsed.protocol || '') + parsed.pathname;
    }
  }
}

export default PathResolver;
