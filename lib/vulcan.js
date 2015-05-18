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
var CommentMap = require('./comment-map');
var constants = require('./constants');
var matchers = require('./matchers');
var pathResolver = require('./pathresolver');

var Promise = global.Promise || require('es6-promise').Promise;

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
  return isExcludedHref(importMeta.href);
}

function isExcludedHref(href) {
  if (!Options.excludes) {
    return false;
  }
  return Options.excludes.some(function(r) {
    return href.search(r) >= 0;
  });
}

function isStrippedImport(importMeta) {
  if (!Options.stripExcludes) {
    return false;
  }
  var href = importMeta.href;
  return Options.stripExcludes.some(function(r) {
    return r == href;
  });
}

function isBlankTextNode(node) {
  return node && dom5.isTextNode(node) && !/\S/.test(dom5.getTextContent(node));
}

function hasOldPolymer(doc) {
  return Boolean(dom5.query(doc, matchers.polymerElement));
}

function replaceWith(head, node, replacements) {
  replacements.forEach(reparent(head));
  var idx = head.childNodes.indexOf(node);
  if (idx >= 0) {
    var til = idx + 1;
    var next = head.childNodes[til];
    // remove newline text node as well
    if (isBlankTextNode(next)) {
      til++;
    }
    head.childNodes = head.childNodes.slice(0, idx).
      concat(replacements, head.childNodes.slice(til));
  } else {
    removeImportAndNewline(node);
    head.childNodes = head.childNodes.concat(replacements);
  }
}

// when removing imports, remove the newline after it as well
function removeImportAndNewline(importNode) {
  var parent = importNode.parentNode;
  var nextIdx = parent.childNodes.indexOf(importNode) + 1;
  var next = parent.childNodes[nextIdx];
  // remove next node if it is blank text
  if (isBlankTextNode(next)) {
    dom5.remove(next);
  }
  dom5.remove(importNode);
}

function flatten(tree, bodyFragment, mainDocUrl) {
  var doc = tree.html.ast;
  var imports = tree.imports;
  var head = dom5.query(doc, matchers.head);
  var body = dom5.query(doc, matchers.body);
  var importNodes = tree.html.import;
  // early check for old polymer versions
  if (hasOldPolymer(doc)) {
    throw new Error(constants.OLD_POLYMER + ' File: ' + tree.href);
  }
  pathResolver.acid(doc, tree.href);
  if (imports) {
    for (var i = 0, im; i < imports.length; i++) {
      im = imports[i];
      if (isDuplicateImport(im)) {
        removeImportAndNewline(importNodes[i]);
        continue;
      }
      if (isExcludedImport(im)) {
        continue;
      }
      if (isStrippedImport(im)) {
        removeImportAndNewline(importNodes[i]);
        continue;
      }
      var importDoc = flatten(im, bodyFragment, mainDocUrl);
      // rewrite urls
      pathResolver.resolvePaths(importDoc, im.href, tree.href);
      var importHead = dom5.query(importDoc, matchers.head);
      var importBody = dom5.query(importDoc, matchers.body);
      // merge head and body tags for imports into main document
      var importHeadChildren = importHead.childNodes;
      var importBodyChildren = importBody.childNodes;
      // replace link in head with head elements from import
      replaceWith(head, importNodes[i], importHeadChildren);
      // defer body children to be inlined in-order
      if (importBodyChildren.length) {
        // adjust body urls to main document
        pathResolver.resolvePaths(importBody, tree.href, mainDocUrl);
        importBodyChildren.forEach(reparent(bodyFragment));
        bodyFragment.childNodes = bodyFragment.childNodes.concat(importBodyChildren);
      }
    }
  }
  // Deduplicate comments
  var comments = new CommentMap();
  dom5.nodeWalkAll(doc, dom5.isCommentNode).forEach(function(comment) {
    comments.set(comment.data, comment);
    dom5.remove(comment);
  });
  comments.keys().forEach(function (commentData) {
    if (Options.stripComments && commentData.indexOf("@license") == -1) {
      return;
    }
    prepend(head, comments.get(commentData));
  });
  return doc;
}

function buildLoader(abspath, excludes) {
  var loader = new hyd.Loader();
  var fsOptions = {};
  if (abspath) {
    fsOptions.root = path.resolve(abspath);
    fsOptions.basePath = '/';
  }
  loader.addResolver(new hyd.FSResolver(fsOptions));
  // build null HTTPS? resolver to skip external scripts
  loader.addResolver(new hyd.NoopResolver(/^https?:\/\//));
  if (excludes) {
    excludes.forEach(function(r) {
      loader.addResolver(new hyd.NoopResolver(r));
    });
  }
  return loader;
}

function setOptions(opts) {
  pathResolver.setOptions(opts);
  Options = opts;
  if (!Options.loader) {
    Options.loader = buildLoader(Options.abspath, Options.excludes);
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
    if (isExcludedHref(src)) {
      return Promise.resolve(true);
    }
    return Options.loader.request(uri).then(function(content) {
      if (content) {
        dom5.removeAttribute(script, 'src');
        dom5.setTextContent(script, content);
      }
    });
  });
  // When all scripts are read, return the document
  return Promise.all(scriptPromises).then(function(){ return doc; });
}


// inline scripts into document, returns a promise resolving to document.
function inlineCss(doc, href) {
  var URL = require('url');
  var css_links = dom5.queryAll(doc, matchers.POLY_CSS_LINK);
  var cssPromises = css_links.map(function(link) {
    var tag = link;
    var src = dom5.getAttribute(tag, 'href');
    var uri = URL.resolve(href, src);
    // let the loader handle the requests
    return Options.loader.request(uri).then(function(content) {
      content = pathResolver.rewriteURL(uri, href, content);
      var style = dom5.constructors.element('style');
      dom5.setTextContent(style, '\n' + content + '\n');
      dom5.replace(tag, style);
    });
  });
  // When all style imports are read, return the document
  return Promise.all(cssPromises).then(function(){ return doc; });
}

function getImplicitExcludes(excludes) {
  // Build a loader that doesn't have to stop at our excludes, since we need them.
  var loader = buildLoader(Options.abspath, null);
  var analyzer = new hyd.Analyzer(true, loader);
  var analyzedExcludes = [];
  excludes.forEach(function(exclude) {
    analyzedExcludes.push(analyzer.dependencies(exclude));
  });
  return Promise.all(analyzedExcludes).then(function(strippedExcludes) {
    var dedupe = {};
    strippedExcludes.forEach(function(excludeList){
      excludeList.forEach(function(exclude) {
        dedupe[exclude] = true;
      });
    });
    return Object.keys(dedupe);
  });
}

function _process(target, cb) {
  var chain = Promise.resolve(true);
  if (Options.implicitStrip && Options.excludes) {
    if (!Options.stripExcludes) {
      Options.stripExcludes = [];
    }
    chain = getImplicitExcludes(Options.excludes).then(function(implicitExcludes) {
      implicitExcludes.forEach(function(strippedExclude) {
        Options.stripExcludes.push(strippedExclude);
      });
    });
  }
  var analyzer = new hyd.Analyzer(true, Options.loader);
  chain = chain.then(function(){
    return analyzer.metadataTree(target);
  }).then(function(tree) {
    // hide bodies of imports from rendering
    var bodyFragment = dom5.constructors.element('div');
    dom5.setAttribute(bodyFragment, 'hidden', '');
    dom5.setAttribute(bodyFragment, 'by-vulcanize', '');
    var flatDoc = flatten(tree, bodyFragment, tree.href);
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
  if (Options.inlineCss) {

    chain = chain.then(function(doc) {
      return inlineCss(doc, target);
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
