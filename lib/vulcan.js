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

var fs = require('fs');
var path = require('path');
var uglify = require('uglify-js');
var url = require('url');
var whacko = require('whacko');

var constants = require('./constants.js');
var optparser = require('./optparser.js');
var pathresolver = require('./pathresolver');
var utils = require('./utils');
var setTextContent = utils.setTextContent;
var getTextContent = utils.getTextContent;
var searchAll = utils.searchAll;

var read = {};
var options = {};

// validate options with boolean return
function setOptions(optHash, callback) {
  optparser.processOptions(optHash, function(err, o) {
    if (err) {
      return callback(err);
    }
    options = o;
    callback();
  });
}

function exclude(regexes, href) {
  return regexes.some(function(r) {
    return r.test(href);
  });
}

function excludeImport(href) {
  return exclude(options.excludes.imports, href);
}

function excludeScript(href) {
  return exclude(options.excludes.scripts, href);
}

function excludeStyle(href) {
  return exclude(options.excludes.styles, href);
}

function readFile(file) {
  var content = fs.readFileSync(file, 'utf8');
  return content.replace(/^\uFEFF/, '');
}

// inline relative linked stylesheets into <style> tags
function inlineSheets($, inputPath, outputPath) {
  searchAll($, 'link[rel="stylesheet"]').each(function() {
    var el = $(this);
    var href = el.attr('href');
    if (href && !excludeStyle(href)) {

      var rel = href;
      var inputPath = path.dirname(options.input);
      if (constants.ABS_URL.test(rel)) {
          var abs = path.resolve(inputPath, path.join(options.abspath, rel));
          rel = path.relative(options.outputDir, abs);
      }

      var filepath = path.resolve(options.outputDir, rel);
      // fix up paths in the stylesheet to be relative to the location of the style
      var content = pathresolver.rewriteURL(path.dirname(filepath), outputPath, readFile(filepath));
      var styleEl = whacko('<style>' + content + '</style>');
      // clone attributes
      styleEl.attr(el.attr());
      // don't set href or rel on the <style>
      styleEl.attr('href', null);
      styleEl.attr('rel', null);
      el.replaceWith(whacko.html(styleEl));
    }
  });
}

function inlineScripts($, dir) {
  searchAll($, constants.JS_SRC).each(function() {
    var el = $(this);
    var src = el.attr('src');
    if (src && !excludeScript(src)) {

      var rel = src;
      var inputPath = path.dirname(options.input);
      if (constants.ABS_URL.test(rel)) {
          var abs = path.resolve(inputPath, path.join(options.abspath, rel));
          rel = path.relative(options.outputDir, abs);
      }

      var filepath = path.resolve(dir, rel);
      var content = readFile(filepath);
      // NOTE: reusing UglifyJS's inline script printer (not exported from OutputStream :/)
      content = content.replace(/<\x2fscript([>\/\t\n\f\r ])/gi, "<\\/script$1");
      el.replaceWith('<script>' + content + '</script>');
    }
  });
}

function concat(filename) {
  if (!read[filename]) {
    read[filename] = true;
    var $ = whacko.load(readFile(filename));
    var dir = path.dirname(filename);
    pathresolver.resolvePaths($, dir, options.outputDir, options.abspath);
    processImports($);
    inlineSheets($, dir, options.outputDir);
    return $;
  } else if (options.verbose) {
    console.log('Dependency deduplicated');
  }
}

function processImports($, mainDoc) {
  var bodyContent = [];
  searchAll($, constants.IMPORTS).each(function() {
    var el = $(this);
    var href = el.attr('href');
    if (!excludeImport(href)) {
      var rel = href;
      var inputPath = path.dirname(options.input);
      if (constants.ABS_URL.test(rel)) {
        var abs = path.resolve(inputPath, path.join(options.abspath, rel));
        rel = path.relative(options.outputDir, abs);
      }
      var $$ = concat(path.resolve(options.outputDir, rel));
      if (!$$) {
        // remove import link
        el.remove();
        return;
      }
      // append import document head to main document head
      el.replaceWith($$('head').html());
      var bodyHTML = $$('body').html();
      // keep the ordering of the import body in main document, before main document's body
      bodyContent.push(bodyHTML);
    } else if (!options.keepExcludes) {
      // if the path is excluded for being absolute, then the import link must remain
      var absexclude = options.abspath ? constants.REMOTE_ABS_URL : constants.ABS_URL;
      if (!absexclude.test(href)) {
        el.remove();
      }
    }
  });
  // prepend the import document body contents to the main document, in order
  var content = bodyContent.join('\n');
  // hide import body content in the main document
  if (mainDoc && content) {
    content = '<div hidden>' + content + '</div>';
  }
  $('body').prepend(content);
}

function findScriptLocation($) {
  var pos = $('body').last();
  if (!pos.length) {
    pos = $.root();
  }
  return pos;
}

function isCommentOrEmptyTextNode(node) {
  if (node.type === 'comment'){
    return true;
  } else if (node.type === 'text') {
    // return true if the node is only whitespace
    return !((/\S/).test(node.data));
  }
}

function compressJS(content, inline) {
  try {
    var ast = uglify.parse(content);
    return ast.print_to_string({inline_script: inline});
  } catch (e) {
    // return a useful error
    var js_err = new Error('Compress JS Error');
    js_err.detail = e.message + ' at line: ' + e.line + ' col: ' + e.col;
    js_err.content = content;
    js_err.toString = function() {
      return this.message + '\n' + this.detail + '\n' + this.content;
    };
    throw js_err;
  }
}

function compressCSS(content) {
  // remove newlines
  var out = content.replace(/[\r\n]/g, '');
  // remove css comments (/* ... */)
  out = out.replace(/\/\*(.+?)\*\//g, '');
  // remove duplicate whitespace
  out = out.replace(/\s{2,}/g, ' ');
  return out;
}

function removeCommentsAndWhitespace($) {
  function walk(node) {
    var content, c;
    if (!node) {
      return;
    } else if (isCommentOrEmptyTextNode(node)) {
      $(node).remove();
      return true;
    } else if (node.type == 'script') {
      // only run uglify on inline javascript scripts
      if (!node.attribs.src && (!node.attribs.type || node.attribs.type == "text/javascript")) {
        content = getTextContent(node);
        setTextContent(node, compressJS(content, true));
      }
    } else if (node.type == 'style') {
      content = getTextContent(node);
      setTextContent(node, compressCSS(content));
    } else if ((c = node.children)) {
      for (var i = 0; i < c.length; i++) {
        // since .remove() will modify this array, decrement `i` on successful comment removal
        if (walk(c[i])) {
          i--;
        }
      }
    }
  }

  // walk the whole AST from root
  walk($.root().get(0));
}

function writeFileSync(filename, data, eop) {
  if (!options.outputHandler) {
    fs.writeFileSync(filename, data, 'utf8');
  } else {
    options.outputHandler(filename, data, eop);
  }
}

function handleMainDocument() {
  // reset shared buffers
  read = {};
  var content = options.inputSrc ? options.inputSrc.toString() : readFile(options.input);
  var $ = whacko.load(content);
  var dir = path.dirname(options.input);
  pathresolver.resolvePaths($, dir, options.outputDir, options.abspath);
  processImports($, true);
  if (options.inline) {
    inlineSheets($, dir, options.outputDir);
  }

  if (options.inline) {
    inlineScripts($, options.outputDir);
  }

  searchAll($, constants.JS_INLINE).each(function() {
    var el = $(this);
    var content = getTextContent(el);
    // find ancestor polymer-element node
    var parentElement = el.closest('polymer-element').get(0);
    if (parentElement) {
      var match = constants.POLYMER_INVOCATION.exec(content);
      var elementName = $(parentElement).attr('name');
      if (match) {
        var invocation = utils.processPolymerInvocation(elementName, match);
        content = content.replace(match[0], invocation);
        setTextContent(el, content);
      }
    }
  });

  // strip noscript from elements, and instead inject explicit Polymer() invocation
  // script, so registration order is preserved
  searchAll($, constants.ELEMENTS_NOSCRIPT).each(function() {
    var el = $(this);
    var name = el.attr('name');
    if (options.verbose) {
      console.log('Injecting explicit Polymer invocation for noscript element "' + name + '"');
    }
    el.append('<script>Polymer(\'' + name + '\');</script>');
    el.attr('noscript', null);
  });

  // strip scripts into a separate file
  if (options.csp) {
    if (options.verbose) {
      console.log('Separating scripts into separate file');
    }

    // CSPify main page by removing inline scripts
    var scripts = [];
    searchAll($, constants.JS_INLINE).each(function() {
      var el = $(this);
      var content = getTextContent(el);
      scripts.push(content);
      el.remove();
    });

    // join scripts with ';' to prevent breakages due to EOF semicolon insertion
    var scriptName = path.basename(options.output, '.html') + '.js';
    var scriptContent = scripts.join(';' + constants.EOL);
    if (options.strip) {
      scriptContent = compressJS(scriptContent, false);
    }

    writeFileSync(path.resolve(options.outputDir, scriptName), scriptContent);
    // insert out-of-lined script into document
    findScriptLocation($).append('<script charset="utf-8" src="' + scriptName + '"></script>');
  }

  deduplicateImports($);

  if (options.strip) {
    removeCommentsAndWhitespace($);
  }

  writeFileSync(options.output, $.html(), true);
}

function deduplicateImports($) {
  var imports = {};
  searchAll($, constants.IMPORTS).each(function() {
    var el = $(this);
    var href = el.attr('href');
    // TODO(dfreedm): allow a user defined base url?
    var abs = url.resolve('http://', href);
    if (!imports[abs]) {
      imports[abs] = true;
    } else {
      if(options.verbose) {
        console.log('Import Dependency deduplicated');
      }
      el.remove();
    }
  });
}

exports.processDocument = handleMainDocument;
exports.setOptions = setOptions;
