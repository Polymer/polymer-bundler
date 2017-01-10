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

var path = require('path');
// use path.posix on Node > 0.12+, path-posix on 0.10
var pathPosix = path.posix || require('path-posix');
var url = require('url');
var dom5 = require('dom5');
var matchers = require('./matchers');
var constants = require('./constants');

var PathResolver = function PathResolver(abspath) {
  if (abspath) {
    this.abspath = abspath;
  }
};

PathResolver.prototype = {
  isTemplatedUrl: function isTemplatedUrl(href) {
    return href.search(constants.URL_TEMPLATE) >= 0;
  },

  /**
   *
   * The final goal of resolvePaths is to rewrite resource paths given in attributes (e.g. assetpath, src, ...)
   * such that they give a relative path from the root document to the intended resources. This ensures that
   * the resources can be successfully resolved when the code is vulcanized in to one document at the level of the
   * root document URL.
   *
   * This method works in conjunction with the Vulcan::flatten() method that is recursively flattening the
   * dependency tree, starting in the root document, in to one vulcanized document.
   *
   * Documents are often imported at multiple places. To ensure that each path value of an attribute is only
   * resolved once, an '<attr>-resolved' flagging attribute is added to each node for which the path value of <attr>
   * has been resolved.
   *
   * These resolved flag attributes can be removed from a document using PathResolver::removeResolvedFlagAttributes(doc)
   *
   *
   * @param importDoc   A document imported in the document at mainDocUrl
   * @param importUrl   The URL of the imported document
   * @param mainDocUrl  The URL of the document in which importDoc is imported
   * @param rootDocUrl  The URL of the root document
   *
   *
   */
  resolvePaths: function resolvePaths(importDoc, importUrl, mainDocUrl, rootDocUrl) {
    if (!rootDocUrl) {
      rootDocUrl = mainDocUrl;
    }
    // rewrite URLs in element attributes
    var nodes = dom5.queryAll(importDoc, matchers.urlAttrs);
    var attrValue;
    var hasValue;
    var relUrl;
    var attrPathResolved;
    for (var i = 0, node; i < nodes.length; i++) {
      node = nodes[i];

      for (var j = 0, attr; j < constants.URL_ATTR.length; j++) {
        attr = constants.URL_ATTR[j];
        attrValue = dom5.getAttribute(node, attr);
        hasValue = attrValue && !this.isTemplatedUrl(attrValue);

        // attrPathResolved = dom5.getAttribute(node, attr+'-resolved') == "yes";

        if (hasValue) {

          if (attr === 'style') {
            relUrl = this.rewriteURL(importUrl, rootDocUrl, attrValue);
          } else {
            relUrl = this.rewriteRelPath(importUrl, rootDocUrl, attrValue);

            if ((attr === 'assetpath') && relUrl.length > 0 && relUrl.slice(-1) !== '/') {
              relUrl += '/';
            }
          }

          dom5.setAttribute(node, attr, relUrl);
        }
      }
    }

    // rewrite URLs in stylesheets
    var styleNodes = dom5.queryAll(importDoc, matchers.CSS);
    for (i = 0, node; i < styleNodes.length; i++) {
       node = styleNodes[i];
       var styleText = dom5.getTextContent(node);
       styleText = this.rewriteURL(importUrl, mainDocUrl, styleText);
       dom5.setTextContent(node, styleText);
    }

    // add assetpath to dom-modules in importDoc
    var domModules = dom5.queryAll(importDoc, matchers.domModule);
    for (i = 0, node; i < domModules.length; i++) {
      node = domModules[i];

      var assetPathUrl = this.rewriteRelPath(importUrl, mainDocUrl, '');
      assetPathUrl = pathPosix.dirname(assetPathUrl) + '/';
      dom5.setAttribute(node, 'assetpath', assetPathUrl);
    }

  },

  removeResolvedFlagAttributes : function(doc) {
    var nodes = dom5.queryAll(doc, matchers.urlAttrs);

    for (var i = 0, node; i < nodes.length; i++) {
      node = nodes[i];

      for (var j = 0, attr; j < constants.URL_ATTR.length; j++) {
        attr = constants.URL_ATTR[j];

        dom5.removeAttribute(node, attr + '-resolved');
      }
    }
    
  },

  isAbsoluteUrl: function isAbsoluteUrl(href) {
    return constants.ABS_URL.test(href);
  },

  rewriteRelPath: function rewriteRelPath(importUrl, mainDocUrl, relUrl) {
    if (this.isAbsoluteUrl(relUrl)) {
      return relUrl;
    }
    var absUrl = url.resolve(importUrl, relUrl);
    if (this.abspath) {
      return url.resolve('/', absUrl);
    }
    var parsedFrom = url.parse(mainDocUrl);
    var parsedTo = url.parse(absUrl);
    if (parsedFrom.protocol === parsedTo.protocol && parsedFrom.host === parsedTo.host) {
      var pathname = pathPosix.relative(pathPosix.dirname(parsedFrom.pathname), parsedTo.pathname);
      return url.format({
        pathname: pathname,
        search: parsedTo.search,
        hash: parsedTo.hash
      });
    }
    return absUrl;
  },

  rewriteURL: function rewriteURL(importUrl, mainDocUrl, cssText) {
    return cssText.replace(constants.URL, function(match) {
      var path = match.replace(/["']/g, "").slice(4, -1);
      path = this.rewriteRelPath(importUrl, mainDocUrl, path);
      return 'url("' + path + '")';
    }.bind(this));
  },

  // remove effects of <base>
  acid: function acid(doc, docUrl) {
    var base = dom5.query(doc, matchers.base);
    if (base) {
      var baseUrl = dom5.getAttribute(base, 'href');
      var baseTarget = dom5.getAttribute(base, 'target');
      dom5.remove(base);
      if (baseUrl) {
        if (baseUrl.slice(-1) === '/') {
          baseUrl = baseUrl.slice(0, -1);
        }
        var docBaseUrl = url.resolve(docUrl, baseUrl + '/.index.html');
        this.resolvePaths(doc, docBaseUrl, docUrl);
      }
      if (baseTarget) {
        var elementsNeedTarget = dom5.queryAll(doc, matchers.targetMatcher);
        elementsNeedTarget.forEach(function(el) {
          dom5.setAttribute(el, 'target', baseTarget);
        });
      }
    }
  },

  pathToUrl: function pathToUrl(filePath) {
    var absolutePath = path.resolve(filePath);
    if (process.platform === 'win32') {
      // encode C:\foo\ as C:/foo/
      return absolutePath.split('\\').join('/');
    } else {
      return absolutePath;
    }
  },
  urlToPath: function urlToPath(uri) {
    var parsed = url.parse(uri);
    if (process.platform === 'win32') {
      return parsed.protocol + parsed.pathname.split('/').join('\\');
    } else {
      return (parsed.protocol || '') + parsed.pathname;
    }
  }
};

module.exports = PathResolver;