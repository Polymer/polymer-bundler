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
var path = require('path');
var url = require('url');
var constants = require('./constants.js');
var utils = require('./utils.js');

var setTextContent = utils.setTextContent;
var getTextContent = utils.getTextContent;
var searchAll = utils.searchAll;

function resolvePaths($, input, output, abspath) {
  // honor <base> tag
  var baseEl = $('base');
  var baseUrl = "";

  if (baseEl.length) {
    var baseHref = baseEl.attr('href');
    if (baseHref) {
      baseUrl = baseHref + '/';
    }
    baseEl.remove();
  }

  var assetPath;
  if (abspath) {
    assetPath = rebasePath(input, abspath);
  } else {
    assetPath = path.relative(output, input);
  }

  // make sure assetpath is a folder, but not root!
  if (assetPath) {
    assetPath = utils.unixPath(assetPath) + '/';
  }

  if (baseUrl) {
    // assetPath is backwards; the URL resolution is assetPath + baseUrl + input
    assetPath = url.resolve(assetPath, baseUrl);
  }

  // resolve attributes
  searchAll($, constants.URL_ATTR_SEL).each(function() {
    var el = $(this);
    constants.URL_ATTR.forEach(function(a) {
      var val = el.attr(a);
      if (val) {
        if (val.search(constants.URL_TEMPLATE) < 0) {
          if (a === 'style') {
            el.attr(a, rewriteURL(input, output, val, abspath, baseUrl));
          } else {
            el.attr(a, rewriteRelPath(input, output, val, abspath, baseUrl));
          }
        }
      }
    });
  });
  searchAll($, constants.CSS).each(function() {
    var el = $(this);
    var text = getTextContent(el);
    if (baseUrl) {
      // baseHref should be added to input path
      input = url.resolve(input + '/', baseHref);
    }
    text = rewriteURL(input, output, text, abspath);
    setTextContent(el, text);
  });
  searchAll($, constants.ELEMENTS).each(function() {
    $(this).attr('assetpath', assetPath);
  });
}

function rebasePath(absolutePath, baselinePath) {
  var absBase = new RegExp('^' + utils.escapeForRegExp(baselinePath));
  return absolutePath.replace(absBase, '');
}

function rewriteRelPath(inputPath, outputPath, rel, abspath, baseUrl) {
  if (constants.ABS_URL.test(rel)) {
    return rel;
  }

  if (baseUrl) {
    rel = url.resolve(baseUrl, rel);
  }

  var abs = path.resolve(inputPath, rel);

  if (abspath) {
    return utils.unixPath(rebasePath(abs, abspath));
  }

  var relPath = path.relative(outputPath, abs);
  return utils.unixPath(relPath);
}

function rewriteURL(inputPath, outputPath, cssText, abspath, baseUrl) {
  return cssText.replace(constants.URL, function(match) {
    var path = match.replace(/["']/g, "").slice(4, -1);
    path = rewriteRelPath(inputPath, outputPath, path, abspath, baseUrl);
    return 'url("' + path + '")';
  });
}

exports.resolvePaths = resolvePaths;
exports.rewriteRelPath = rewriteRelPath;
exports.rewriteURL = rewriteURL;
