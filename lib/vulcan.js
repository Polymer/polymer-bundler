/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

// jshint node: true
'use strict';

var path = require('path');
var hyd = require('hydrolysis');
var dom5 = require('dom5');
var constants = require('./constants');
var matchers = require('./matchers');
var pathResolver = require('./pathresolver');

function isUniqueImport(importNode) {
  return Boolean(importNode.href);
}

function reparent(newParent) {
  return function(node) {
    node.parentNode = newParent;
  };
}

function remove(node) {
  var parent = node.parentNode;
  if (parent) {
    var idx = parent.childNodes.indexOf(node);
    if (idx > -1) {
      parent.childNodes.splice(idx, 1);
    }
  }
}

function flatten(tree) {
  var doc = tree.html.ast;
  var imports = tree.imports;
  var head = dom5.query(doc, matchers.head);
  var body = dom5.query(doc, matchers.body);
  var importNodes = tree.html.import;
  var importDoc, importHead, importBody, importHeadChildren, importBodyChildren;
  if (imports) {
    for (var i = 0, im; i < imports.length; i++) {
      im = imports[i];
      if (!isUniqueImport(im)) {
        remove(importNodes[i]);
        continue;
      }
      importDoc = flatten(im);
      // rewrite urls
      pathResolver.resolvePaths(importDoc, im.href, tree.href);
      importHead = dom5.query(importDoc, matchers.head);
      importBody = dom5.query(importDoc, matchers.body);
      // merge head and body tags for imports into main document
      importHeadChildren = importHead.childNodes;
      importBodyChildren = importBody.childNodes;
      var hideDiv = dom5.constructors.element('div');
      dom5.setAttribute(hideDiv, 'hidden', '');
      hideDiv.childNodes = importBodyChildren;
      importHeadChildren.forEach(reparent(head));
      importBodyChildren.forEach(reparent(hideDiv));
      hideDiv.childNodes = importBodyChildren;
      // replace import node with importHeadChildren
      var idx = head.childNodes.indexOf(importNodes[i]);
      head.childNodes = head.childNodes.slice(0, idx).concat(importHeadChildren, head.childNodes.slice(idx + 1));
      // prepend import body to document body
      if (importBodyChildren.length) {
        body.childNodes.unshift(hideDiv);
      }
    }
  }
  return doc;
}

function process(target, outDir, loader, cb) {
  var resolvedTarget = path.resolve(target);
  var a = new hyd.Analyzer(true, loader);
  a.metadataTree(target).then(function(tree) {
    var flatDoc = flatten(tree);
    var dir = path.dirname(path.resolve(target));
    // rewrite to be local to current working directory
    if (dir !== outDir) {
      pathResolver.resolvePaths(flatDoc, target, path.resolve(outDir, 'foo.html'));
    }
    var serializer = new (require('parse5').Serializer)();
    var out = serializer.serialize(flatDoc);
    cb(null, out);
  }).catch(cb);
}

module.exports = {
  process: process
};
