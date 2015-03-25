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

function resolvePaths(importDoc, importUrl, mainDocUrl) {
  // rewrite URLs in element attributes
  var nodes = dom5.queryAll(importDoc, matchers.urlAttrs);
  var attrValue;
  for (var i = 0, node; i < nodes.length; i++) {
    node = nodes[i];
    for (var j = 0, attr; j < constants.URL_ATTR.length; j++) {
      attr = constants.URL_ATTR[j];
      attrValue = dom5.getAttribute(node, attr);
      if (attrValue && attrValue.search(constants.URL_TEMPLATE) < 0) {
        var relUrl;
        if (attr !== 'style') {
          relUrl = rewriteRelPath(importUrl, mainDocUrl, attrValue);
          if (attr === 'assetpath') {
            relUrl += '/';
          }
        } else {
          relUrl = rewriteURL(importUrl, mainDocUrl, attrValue);
        }
        dom5.setAttribute(node, attr, relUrl);
      }
    }
  }
  // rewrite URLs in stylesheets
  var styleNodes = dom5.queryAll(importDoc, matchers.CSS);
  for (i = 0, node; i < styleNodes.length; i++) {
    node = styleNodes[i];
    var styleText = '';
    if (!node.childNodes.length) {
      return;
    } else if (node.childNodes.length === 1) {
      styleText = node.childNodes[0].value;
    } else {
      styleText = node.childNodes.map(function(tn) { return tn.value; }).join('\n');
      node.childNodes.length = 1;
    }
    styleText = rewriteURL(importUrl, mainDocUrl, styleText);
    node.childNodes[0].value = styleText;
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

function rewriteRelPath(importUrl, mainDocUrl, relUrl) {
    var absUrl = url.resolve(importUrl, relUrl);
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
    return relUrl;
}

function rewriteURL(importUrl, mainDocUrl, cssText) {
  return cssText.replace(constants.URL, function(match) {
    var path = match.replace(/["']/g, "").slice(4, -1);
    path = rewriteRelPath(importUrl, mainDocUrl, path);
    return 'url("' + path + '")';
  });
}

exports.resolvePaths = resolvePaths;
exports.rewriteRelPath = rewriteRelPath;
exports.rewriteURL = rewriteURL;
