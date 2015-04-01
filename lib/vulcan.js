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

function flatten(tree, bodyContents) {
  var doc = tree.html.ast;
  var imports = tree.imports;
  var head = dom5.query(doc, matchers.head);
  var body = dom5.query(doc, matchers.body);
  var importNodes = tree.html.import;
  if (imports) {
    for (var i = 0, im; i < imports.length; i++) {
      im = imports[i];
      if (!isUniqueImport(im)) {
        dom5.remove(importNodes[i]);
        continue;
      }
      var importDoc = flatten(im, bodyContents);
      // rewrite urls
      pathResolver.resolvePaths(importDoc, im.href, tree.href);
      var importHead = dom5.query(importDoc, matchers.head);
      var importBody = dom5.query(importDoc, matchers.body);
      // merge head and body tags for imports into main document
      var importHeadChildren = importHead.childNodes;
      var importBodyChildren = importBody.childNodes;
      importHeadChildren.forEach(reparent(head));
      // replace link in head with head elements from import
      var idx = head.childNodes.indexOf(importNodes[i]);
      head.childNodes = head.childNodes.slice(0, idx).concat(importHeadChildren, head.childNodes.slice(idx + 1));
      // defer body children to be inlined in-order
      if (importBodyChildren.length) {
        bodyContents.push(importBodyChildren);
      }
    }
  }
  return doc;
}

function process(target, loader, cb) {
  var analyzer = new hyd.Analyzer(true, loader);
  analyzer.metadataTree(target).then(function(tree) {
    // rewrite urls in main doc to remove <base>
    var bodyContents = [];
    var flatDoc = flatten(tree, bodyContents);
    var body = dom5.query(flatDoc, matchers.body);
    var reduced = bodyContents.reduce(function(a, b) {
      return a.concat(b);
    }, []);
    if (reduced.length) {
      // hide bodies of imports from rendering
      var hiddenDiv = dom5.constructors.element('div');
      dom5.setAttribute(hiddenDiv, 'hidden', '');
      dom5.setAttribute(hiddenDiv, 'by-vulcanize', '');
      reduced.forEach(reparent(hiddenDiv));
      hiddenDiv.childNodes = reduced;
      dom5.insertBefore(body, body.childNodes[0], hiddenDiv);
    }
    // make sure there's a <meta charset> in the page to force UTF-8
    var meta = dom5.query(flatDoc, matchers.meta);
    if (!meta) {
      meta = dom5.constructors.element('meta');
      dom5.setAttribute(meta, 'charset', 'UTF-8');
      var head = dom5.query(flatDoc, matchers.head);
      dom5.insertBefore(head, head.childNodes[0], meta);
    }
    var out = dom5.serialize(flatDoc);
    cb(null, out);
  }).catch(cb);
}

module.exports = {
  process: process
};
