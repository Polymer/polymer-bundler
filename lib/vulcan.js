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

var Promise = global.Promise || require('es6-promise');

var Options;

function isDuplicateImport(importMeta) {
  return !Boolean(importMeta.href);
}

function reparent(newParent) {
  return function(node) {
    node.parentNode = newParent;
  };
}

function isExcludedImport(importMeta) {
  if (!Options.excludes) {
    return false;
  }
  var href = importMeta.href;
  return Options.excludes.some(function(r) {
    return r.test(href);
  });
}

function replaceWith(parent, node, replacements) {
  var idx = parent.childNodes.indexOf(node);
  parent.childNodes = parent.childNodes.slice(0, idx).
    concat(replacements, parent.childNodes.slice(idx + 1));
}

// when removing imports, remove the newline after it as well
function removeImportAndNewline(importNode) {
  var parent = importNode.parentNode;
  var nextIdx = parent.childNodes.indexOf(importNode) + 1;
  var next = parent.childNodes[nextIdx];
  if (next && dom5.isTextNode(next)) {
    var content = dom5.getTextContent(next);
    // remove next node if it is blank text
    if (!/\S/.test(content)) {
      dom5.remove(next);
    }
  }
  dom5.remove(importNode);
}

function flatten(tree, bodyFragment) {
  var doc = tree.html.ast;
  var imports = tree.imports;
  var head = dom5.query(doc, matchers.head);
  var body = dom5.query(doc, matchers.body);
  var importNodes = tree.html.import;
  pathResolver.acid(doc, tree.href);
  if (imports) {
    for (var i = 0, im; i < imports.length; i++) {
      im = imports[i];
      if (isDuplicateImport(im)) {
        removeImportAndNewline(importNodes[i]);
        continue;
      }
      if (isExcludedImport(im)) {
        if (Options.stripExcludes) {
          removeImportAndNewline(importNodes[i]);
        }
        continue;
      }
      var importDoc = flatten(im, bodyFragment);
      // rewrite urls
      pathResolver.resolvePaths(importDoc, im.href, tree.href);
      var importHead = dom5.query(importDoc, matchers.head);
      var importBody = dom5.query(importDoc, matchers.body);
      // merge head and body tags for imports into main document
      var importHeadChildren = importHead.childNodes;
      var importBodyChildren = importBody.childNodes;
      importHeadChildren.forEach(reparent(head));
      // replace link in head with head elements from import
      replaceWith(head, importNodes[i], importHeadChildren);
      // adjust previous import body urls
      pathResolver.resolvePaths(bodyFragment, im.href, tree.href);
      // defer body children to be inlined in-order
      if (importBodyChildren.length) {
        importBodyChildren.forEach(reparent(bodyFragment));
        bodyFragment.childNodes = bodyFragment.childNodes.concat(importBodyChildren);
      }
    }
  }
  return doc;
}

function setOptions(opts) {
  pathResolver.setOptions(opts);
  Options = opts;
  if (!Options.loader) {
    var loader = new hyd.Loader();
    var fsOptions = {};
    if (Options.abspath) {
      fsOptions.root = path.resolve(Options.abspath);
      fsOptions.basePath = '/';
    }
    loader.addResolver(new hyd.FSResolver(fsOptions));
    if (Options.excludes) {
      Options.excludes.forEach(function(r) {
        loader.addResolver(new hyd.NoopResolver(r));
      });
    }
    Options.loader = loader;
  }
}

function prepend(parent, node) {
  if (parent.childNodes.length) {
    dom5.insertBefore(parent, parent.childNodes[0], node);
  } else {
    dom5.append(parent, node);
  }
}

// inline scripts into document, returns a promise resolving to document.
function inlineScripts(doc, href) {
  var URL = require('url');
  var scripts = dom5.queryAll(doc, matchers.JS_SRC);
  var scriptPromises = scripts.map(function(script) {
    var src = dom5.getAttribute(script, 'src');
    var uri = URL.resolve(href, src);
    // let the loader handle the requests
    return Options.loader.request(uri).then(function(content) {
      dom5.removeAttribute(script, 'src');
      dom5.setTextContent(script, content);
    });
  });
  // When all scripts are read, return the document
  return Promise.all(scriptPromises).then(function(){ return doc; });
}

function _process(target, cb) {
  var analyzer = new hyd.Analyzer(true, Options.loader);
  var chain = analyzer.metadataTree(target).then(function(tree) {
    // hide bodies of imports from rendering
    var bodyFragment = dom5.constructors.element('div');
    dom5.setAttribute(bodyFragment, 'hidden', '');
    dom5.setAttribute(bodyFragment, 'by-vulcanize', '');
    var flatDoc = flatten(tree, bodyFragment);
    var body = dom5.query(flatDoc, matchers.body);
    if (bodyFragment.childNodes.length) {
      prepend(body, bodyFragment);
    }
    // make sure there's a <meta charset> in the page to force UTF-8
    var meta = dom5.query(flatDoc, matchers.meta);
    if (!meta) {
      meta = dom5.constructors.element('meta');
      dom5.setAttribute(meta, 'charset', 'UTF-8');
      var head = dom5.query(flatDoc, matchers.head);
      prepend(head, meta);
    }
    return flatDoc;
  });
  if (Options.inlineScripts) {
    chain = chain.then(function(doc) {
      return inlineScripts(doc, target);
    });
  }
  chain.then(function(flatDoc) {
    cb(null, dom5.serialize(flatDoc));
  }).catch(cb);
}

function process(target, cb) {
  if (!Options) {
    setOptions({});
  }
  if (Options.abspath) {
    target = path.resolve('/', target);
  }
  _process(target, cb);
}

module.exports = {
  setOptions: setOptions,
  process: process
};
