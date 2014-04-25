/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

var path = require('path');
var constants = require('./constants.js');
var utils = require('./utils.js');
var setTextContent = utils.setTextContent;
var getTextContent = utils.getTextContent;

function resolvePaths($, input, output) {
  var assetPath = path.relative(output, input);
  // make sure assetpath is a folder, but not root!
  if (assetPath) {
    assetPath = assetPath.split(path.sep).join('/') + '/';
  }
  // resolve attributes
  $(constants.URL_ATTR_SEL).each(function() {
    var el = $(this);
    constants.URL_ATTR.forEach(function(a) {
      var val = el.attr(a);
      if (val) {
        if (val.search(constants.URL_TEMPLATE) < 0) {
          if (a === 'style') {
            el.attr(a, rewriteURL(input, output, val));
          } else {
            el.attr(a, rewriteRelPath(input, output, val));
          }
        }
      }
    });
  });
  $(constants.CSS).each(function() {
    var el = $(this);
    var text = rewriteURL(input, output, getTextContent(el));
    setTextContent(el, text);
  });
  $(constants.ELEMENTS).each(function() {
    $(this).attr('assetpath', assetPath);
  });
}

function rewriteRelPath(inputPath, outputPath, rel) {
  if (constants.ABS_URL.test(rel)) {
    return rel;
  }
  var abs = path.resolve(inputPath, rel);
  var relPath = path.relative(outputPath, abs);
  return relPath.split(path.sep).join('/');
}

function rewriteURL(inputPath, outputPath, cssText) {
  return cssText.replace(constants.URL, function(match) {
    var path = match.replace(/["']/g, "").slice(4, -1);
    path = rewriteRelPath(inputPath, outputPath, path);
    return 'url(' + path + ')';
  });
}

exports.resolvePaths = resolvePaths;
exports.rewriteRelPath = rewriteRelPath;
exports.rewriteURL = rewriteURL;
