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
var url = require('url');
var dom5 = require('dom5');
var matchers = require('./matchers');
var constants = require('./constants');

var Options;

function isTemplatedUrl(href) {
  return href.search(constants.URL_TEMPLATE) >= 0;
}

function resolvePaths(importDoc, importUrl, mainDocUrl) {
  // rewrite URLs in element attributes
  var nodes = dom5.queryAll(importDoc, matchers.urlAttrs);
  var attrValue;
  for (var i = 0, node; i < nodes.length; i++) {
    node = nodes[i];
    for (var j = 0, attr; j < constants.URL_ATTR.length; j++) {
      attr = constants.URL_ATTR[j];
      attrValue = dom5.getAttribute(node, attr);
      if (attrValue && !isTemplatedUrl(attrValue)) {
        var relUrl;
        if (attr === 'style') {
          relUrl = rewriteURL(importUrl, mainDocUrl, attrValue);
        } else {
          relUrl = rewriteRelPath(importUrl, mainDocUrl, attrValue);
          if (attr === 'assetpath' && relUrl.slice(-1) != '/') {
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
    styleText = rewriteURL(importUrl, mainDocUrl, styleText);
    dom5.setTextContent(node, styleText);
  }
  // add assetpath to dom-modules in importDoc
  var domModules = dom5.queryAll(importDoc, matchers.domModule);
  for (i = 0, node; i < domModules.length; i++) {
    node = domModules[i];
    var assetPathUrl = rewriteRelPath(importUrl, mainDocUrl, '');
    assetPathUrl = path.dirname(assetPathUrl) + '/';
    dom5.setAttribute(node, 'assetpath', assetPathUrl);
  }
}

function isAbsoluteUrl(href) {
  return constants.ABS_URL.test(href);
}

function rewriteRelPath(importUrl, mainDocUrl, relUrl) {
  if (isAbsoluteUrl(relUrl)) {
    return relUrl;
  }
  var absUrl = url.resolve(importUrl, relUrl);
  if (Options.abspath) {
    return url.resolve('/', absUrl);
  }
  var parsedFrom = url.parse(mainDocUrl);
  var parsedTo = url.parse(absUrl);
  if (parsedFrom.protocol === parsedTo.protocol && parsedFrom.host === parsedTo.host) {
    var pathname = path.relative(path.dirname(parsedFrom.pathname), parsedTo.pathname);
    return url.format({
      pathname: pathname,
      search: parsedTo.search,
      hash: parsedTo.hash
    });
  }
  return absUrl;
}

function rewriteURL(importUrl, mainDocUrl, cssText) {
  return cssText.replace(constants.URL, function(match) {
    var path = match.replace(/["']/g, "").slice(4, -1);
    path = rewriteRelPath(importUrl, mainDocUrl, path);
    return 'url("' + path + '")';
  });
}

// remove effects of <base>
function acid(doc, docUrl) {
  var base = dom5.query(doc, matchers.base);
  if (base) {
    dom5.remove(base);
    var baseUrl = dom5.getAttribute(base, 'href') + '/.index.html';
    var docBaseUrl = url.resolve(docUrl, baseUrl);
    resolvePaths(doc, docBaseUrl, docUrl);
  }
}

exports.setOptions = function(opts) {
  Options = {
    abspath: Boolean(opts.abspath)
  };
};

exports.acid = acid;
exports.resolvePaths = resolvePaths;
exports.rewriteRelPath = rewriteRelPath;
exports.rewriteURL = rewriteURL;
