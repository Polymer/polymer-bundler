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
var url = require('url');
var pathPosix = path.posix || require('path-posix');
var hyd = require('hydrolysis');
var dom5 = require('dom5');
var CommentMap = require('./comment-map');
var constants = require('./constants');
var matchers = require('./matchers');
var PathResolver = require('./pathresolver');

var Promise = global.Promise || require('es6-promise').Promise;

/**
 * This is the copy of vulcanize we keep to simulate the setOptions api.
 *
 * TODO(garlicnation): deprecate and remove setOptions API in favor of constructor.
 */
var singleton;

function buildLoader(abspath, excludes) {
  var loader = new hyd.Loader();
  var fsOptions = {};
  if (abspath) {
    fsOptions.root = path.resolve(abspath);
    fsOptions.basePath = '/';
  }
  loader.addResolver(new hyd.FSResolver(fsOptions));
  // build null HTTPS? resolver to skip external scripts
  loader.addResolver(new hyd.NoopResolver(constants.EXTERNAL_URL));
  if (excludes) {
    excludes.forEach(function(r) {
      loader.addResolver(new hyd.NoopResolver(r));
    });
  }
  return loader;
}

var Vulcan = function Vulcan(opts) {
    // implicitStrip should be true by default
  this.implicitStrip = opts.implicitStrip === undefined ? true : Boolean(opts.implicitStrip);
  this.abspath = (String(opts.abspath) === opts.abspath && String(opts.abspath).trim() !== '') ? path.resolve(opts.abspath) : '';
  this.pathResolver = new PathResolver(this.abspath);
  this.addedImports = Array.isArray(opts.addedImports) ? opts.addedImports : [];
  this.excludes = Array.isArray(opts.excludes) ? opts.excludes : [];
  this.stripExcludes = Array.isArray(opts.stripExcludes) ? opts.stripExcludes : [];
  this.stripComments = Boolean(opts.stripComments);
  this.enableCssInlining = Boolean(opts.inlineCss);
  this.enableSvgInlining = Boolean(opts.inlineSvg);
  this.enableScriptInlining = Boolean(opts.inlineScripts);
  this.inputUrl = String(opts.inputUrl) === opts.inputUrl ? opts.inputUrl : '';
  if (!opts.loader) {
    this.loader = buildLoader(this.abspath, this.excludes);
  } else {
    this.loader = opts.loader;
  }
};

Vulcan.prototype = {
  isDuplicateImport: function isDuplicateImport(importMeta) {
    return !Boolean(importMeta.href);
  },

  reparent: function reparent(newParent) {
    return function(node) {
      node.parentNode = newParent;
    };
  },

  isExcludedImport: function isExcludedImport(importMeta) {
    return this.isExcludedHref(importMeta.href);
  },

  isExcludedHref: function isExcludedHref(href) {
    if (constants.EXTERNAL_URL.test(href)) {
      return true;
    }
    if (!this.excludes) {
      return false;
    }
    return this.excludes.some(function(r) {
      return href.search(r) >= 0;
    });
  },

  isStrippedImport: function isStrippedImport(importMeta) {
    if (!this.stripExcludes.length) {
      return false;
    }
    var href = importMeta.href;
    return this.stripExcludes.some(function(r) {
      return r == href;
    });
  },

  isBlankTextNode: function isBlankTextNode(node) {
    return node && dom5.isTextNode(node) && !/\S/.test(dom5.getTextContent(node));
  },

  hasOldPolymer: function hasOldPolymer(doc) {
    return Boolean(dom5.query(doc, matchers.polymerElement));
  },

  replaceWith: function replaceWith(head, node, replacements) {
    replacements.forEach(this.reparent(head));
    var idx = head.childNodes.indexOf(node);
    if (idx >= 0) {
      var til = idx + 1;
      var next = head.childNodes[til];
      // remove newline text node as well
      if (this.isBlankTextNode(next)) {
        til++;
      }
      head.childNodes = head.childNodes.slice(0, idx).
        concat(replacements, head.childNodes.slice(til));
    } else {
      this.removeImportAndNewline(node);
      head.childNodes = head.childNodes.concat(replacements);
    }
  },

  // when removing imports, remove the newline after it as well
  removeImportAndNewline: function removeImportAndNewline(importNode) {
    var parent = importNode.parentNode;
    var nextIdx = parent.childNodes.indexOf(importNode) + 1;
    var next = parent.childNodes[nextIdx];
    // remove next node if it is blank text
    if (this.isBlankTextNode(next)) {
      dom5.remove(next);
    }
    dom5.remove(importNode);
  },

  flatten: function flatten(tree, bodyFragment, mainDocUrl) {
    var doc = tree.html.ast;
    var imports = tree.imports;
    var head = dom5.query(doc, matchers.head);
    var body = dom5.query(doc, matchers.body);
    var importNodes = tree.html.import;
    // early check for old polymer versions
    if (this.hasOldPolymer(doc)) {
      throw new Error(constants.OLD_POLYMER + ' File: ' + this.pathResolver.urlToPath(tree.href));
    }
    this.pathResolver.acid(doc, tree.href);
    if (imports) {
      for (var i = 0, im; i < imports.length; i++) {
        im = imports[i];
        if (this.isDuplicateImport(im)) {
          this.removeImportAndNewline(importNodes[i]);
          continue;
        }
        if (this.isExcludedImport(im)) {
          continue;
        }
        if (this.isStrippedImport(im)) {
          this.removeImportAndNewline(importNodes[i]);
          continue;
        }
        var importDoc = this.flatten(im, bodyFragment, mainDocUrl);
        // rewrite urls
        this.pathResolver.resolvePaths(importDoc, im.href, tree.href);
        var importHead = dom5.query(importDoc, matchers.head);
        var importBody = dom5.query(importDoc, matchers.body);
        // merge head and body tags for imports into main document
        var importHeadChildren = importHead.childNodes;
        var importBodyChildren = importBody.childNodes;
        // replace link in head with head elements from import
        this.replaceWith(head, importNodes[i], importHeadChildren);
        // defer body children to be inlined in-order
        if (importBodyChildren.length) {
          // adjust body urls to main document
          this.pathResolver.resolvePaths(importBody, tree.href, mainDocUrl);
          importBodyChildren.forEach(this.reparent(bodyFragment));
          bodyFragment.childNodes = bodyFragment.childNodes.concat(importBodyChildren);
        }
      }
    }
    if (this.stripComments) {
      var comments = new CommentMap();
      // remove all comments
      dom5.nodeWalkAll(doc, dom5.isCommentNode).forEach(function(comment) {
        comments.set(comment.data, comment);
        dom5.remove(comment);
      });
      // Deduplicate license comments
      comments.keys().forEach(function (commentData) {
        if (commentData.indexOf("@license") == -1) {
          return;
        }
        this.prepend(head, comments.get(commentData));
      }.bind(this));
    }
    return doc;
  },


  prepend: function prepend(parent, node) {
    if (parent.childNodes.length) {
      dom5.insertBefore(parent, parent.childNodes[0], node);
    } else {
      dom5.append(parent, node);
    }
  },

  // inline scripts into document, returns a promise resolving to document.
  inlineScripts: function inlineScripts(doc, href) {
    var scripts = dom5.queryAll(doc, matchers.JS_SRC);
    var scriptPromises = scripts.map(function(script) {
      var src = dom5.getAttribute(script, 'src');
      var uri = url.resolve(href, src);
      // let the loader handle the requests
      if (this.isExcludedHref(src)) {
        return Promise.resolve(true);
      }
      return this.loader.request(uri).then(function(content) {
        if (content) {
          dom5.removeAttribute(script, 'src');
          dom5.setTextContent(script, content);
        }
      });
    }.bind(this));
    // When all scripts are read, return the document
    return Promise.all(scriptPromises).then(function(){ return {doc: doc, href: href}; });
  },


  // inline stylesheets into document, returns a promise resolving to document.
  inlineCss: function inlineCss(doc, href) {
    var css_links = dom5.queryAll(doc, matchers.ALL_CSS_LINK);
    var cssPromises = css_links.map(function(link) {
      var tag = link;
      var src = dom5.getAttribute(tag, 'href');
      var media = dom5.getAttribute(tag, 'media');
      var uri = url.resolve(href, src);
      // let the loader handle the requests
      if (this.isExcludedHref(src)) {
        return Promise.resolve(true);
      }
      // let the loader handle the requests
      return this.loader.request(uri).then(function(content) {
        if (content) {
          content = this.pathResolver.rewriteURL(uri, href, content);
          if (media) {
            content = '@media ' + media + ' {' + content + '}'; 
          }
          var style = dom5.constructors.element('style');
          dom5.setTextContent(style, '\n' + content + '\n');
          dom5.replace(tag, style);
        }
      }.bind(this));
    }.bind(this));
    // When all style imports are read, return the document
    return Promise.all(cssPromises).then(function(){ return {doc: doc, href: href}; });
  },

  // inline svg into document, returns a promise resolving to document.
  inlineSvg: function inlineSvg(doc, href) {
    var svg_links = dom5.queryAll(doc, matchers.ALL_SVG_LINK);
    var svgPromises = svg_links.map(function (link) {
      var tag = link;
      var src = dom5.getAttribute(tag, 'href');
      var uri = url.resolve(href, src);
      // let the loader handle the requests
      if (this.isExcludedHref(src)) {
        return Promise.resolve(true);
      }
      // let the loader handle the requests
      return this.loader.request(uri).then(function (content) {
        if (content) {
          content = dom5.parseFragment(content);
          // svg may only have one root element, thus childNodes[0].
          dom5.replace(tag, content.childNodes[0]);
        }
      }.bind(this));
    }.bind(this));
    // When all svg imports are read, return the document
    return Promise.all(svgPromises).then(function () { return { doc: doc, href: href }; });
  },

  getImplicitExcludes: function getImplicitExcludes(excludes) {
    // Build a loader that doesn't have to stop at our excludes, since we need them.
    var loader = buildLoader(this.abspath, null);
    var analyzer = new hyd.Analyzer(true, loader);
    var analyzedExcludes = [];
    excludes.forEach(function(exclude) {
      if (exclude.match(/.js$/)) {
        return;
      }
      if (exclude.slice(-1) === '/') {
        return;
      }
      var depPromise = analyzer._getDependencies(exclude);
      depPromise.catch(function(err) {
        // include that this was an excluded url in the error message.
        err.message += '. Could not read dependencies for excluded URL: ' + exclude;
      });
      analyzedExcludes.push(depPromise);
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
  },

  _process: function _process(target, cb) {
    var chain = Promise.resolve(true);
    if (this.implicitStrip && this.excludes) {
      chain = this.getImplicitExcludes(this.excludes).then(function(implicitExcludes) {
        implicitExcludes.forEach(function(strippedExclude) {
          this.stripExcludes.push(strippedExclude);
        }.bind(this));
      }.bind(this));
    }
    var analyzer = new hyd.Analyzer(true, this.loader);
    chain = chain.then(function(){
      return analyzer.metadataTree(target);
    }).then(function(tree) {
      // hide bodies of imports from rendering
      var bodyFragment = dom5.constructors.element('div');
      dom5.setAttribute(bodyFragment, 'hidden', '');
      dom5.setAttribute(bodyFragment, 'by-vulcanize', '');
      var flatDoc = this.flatten(tree, bodyFragment, tree.href);
      var body = dom5.query(flatDoc, matchers.body);
      if (bodyFragment.childNodes.length) {
        this.prepend(body, bodyFragment);
      }
      // make sure there's a <meta charset> in the page to force UTF-8
      var meta = dom5.query(flatDoc, matchers.meta);
      var head = dom5.query(flatDoc, matchers.head);
      if (!meta) {
        meta = dom5.constructors.element('meta');
        dom5.setAttribute(meta, 'charset', 'UTF-8');
        this.prepend(head, meta);
      }
      for (var i = 0; i < this.addedImports.length; i++) {
        var newImport = dom5.constructors.element('link');
        dom5.setAttribute(newImport, 'rel', 'import');
        dom5.setAttribute(newImport, 'href', this.addedImports[i]);
        dom5.append(head, newImport);
      }
      return {doc: flatDoc, href: tree.href};
    }.bind(this));
    if (this.enableScriptInlining) {
      chain = chain.then(function(docObj) {
        return this.inlineScripts(docObj.doc, docObj.href);
      }.bind(this));
    }
    if (this.enableCssInlining) {
      chain = chain.then(function(docObj) {
        return this.inlineCss(docObj.doc, docObj.href);
      }.bind(this));
    }
    if (this.enableSvgInlining) {
      chain = chain.then(function (docObj) {
        return this.inlineSvg(docObj.doc, docObj.href);
      }.bind(this));
    }
    chain.then(function(docObj) {
      cb(null, dom5.serialize(docObj.doc));
    }).catch(cb);
  },

  process: function process(target, cb) {
    if (this.inputUrl) {
      this._process(this.inputUrl, cb);
    } else {
      if (this.abspath) {
        target = pathPosix.resolve('/', target);
      } else {
        target = this.pathResolver.pathToUrl(path.resolve(target));
      }
      this._process(target, cb);
    }
  }
};

Vulcan.process = function process(target, cb) {
  singleton.process(target, cb);
};

Vulcan.setOptions = function setOptions(opts) {
  singleton = new Vulcan(opts);
};

module.exports = Vulcan;
