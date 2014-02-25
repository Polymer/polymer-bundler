/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

var path = require('path');
var constants = require('./constants.js');

// directly update the textnode child of <style>
// equivalent to <style>.textContent
function setTextContent(node, text) {
  node[0].children[0].data = text;
}

function resolvePaths($, input, output) {
  var assetPath = path.relative(output, input);
  // make sure assetpath is a folder, but not root!
  if (assetPath) {
    assetPath = assetPath.split(path.sep).join('/') + '/';
  }
  // resolve attributes
  $(constants.URL_ATTR_SEL).each(function() {
    constants.URL_ATTR.forEach(function(a) {
      var val = this.attr(a);
      if (val) {
        if (val.search(constants.URL_TEMPLATE) < 0) {
          if (a === 'style') {
            this.attr(a, rewriteURL(input, output, val));
          } else {
            this.attr(a, rewriteRelPath(input, output, val));
          }
        }
      }
    }, this);
  });
  $(constants.CSS).each(function() {
    var text = rewriteURL(input, output, this.text());
    setTextContent(this, text);
  });
  $(constants.ELEMENTS).each(function() {
    this.attr('assetpath', assetPath);
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
