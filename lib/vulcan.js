/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

var async = require('async');
var cheerio = require('cheerio');
var cleancss = require('clean-css');
var fs = require('fs');
var path = require('path');
var url = require('url');

var constants = require('./constants.js');
var pathresolver = require('./pathresolver');
var utils = require('./utils');
var setTextContent = utils.setTextContent;
var getTextContent = utils.getTextContent;

var read = {};

function exclude(regexes, href) {
  return regexes.some(function(r) {
    return r.test(href);
  });
}

function excludeImport(options, href) {
  return exclude(options.excludes.imports, href);
}

function excludeScript(options, href) {
  return exclude(options.excludes.scripts, href);
}

function excludeStyle(options, href) {
  return exclude(options.excludes.styles, href);
}

function readFile(file) {
  var content = fs.readFileSync(file, 'utf8');
  return content.replace(/^\uFEFF/, '');
}

// inline relative linked stylesheets into <style> tags
function inlineSheets(options, $, inputPath, outputPath) {
  $('link[rel="stylesheet"]').each(function() {
    var el = $(this);
    var href = el.attr('href');
    if (href && !excludeStyle(options, href)) {
      var filepath = path.resolve(outputPath, href);
      // fix up paths in the stylesheet to be relative to the location of the style
      var content = pathresolver.rewriteURL(path.dirname(filepath), outputPath, readFile(filepath));
      var styleDoc = cheerio.load('<style>' + content + '</style>');
      // clone attributes
      styleDoc('style').attr(el.attr());
      // don't set href or rel on the <style>
      styleDoc('style').attr('href', null);
      styleDoc('style').attr('rel', null);
      el.replaceWith(styleDoc.html());
    }
  });
}

function inlineScripts(options, $, dir) {
  $(constants.JS_SRC).each(function() {
    var el = $(this);
    var src = el.attr('src');
    if (src && !excludeScript(options, src)) {
      var filepath = path.resolve(dir, src);
      var content = readFile(filepath);
      // NOTE: reusing UglifyJS's inline script printer (not exported from OutputStream :/)
      content = content.replace(/<\x2fscript([>\/\t\n\f\r ])/gi, "<\\/script$1");
      el.replaceWith('<script>' + content + '</script>');
    }
  });
}

function readDocument(filename) {
  return cheerio.load(readFile(filename));
}

function concat(options, filename) {
  if (!read[filename]) {
    read[filename] = true;
    var $ = readDocument(filename);
    var dir = path.dirname(filename);
    pathresolver.resolvePaths($, dir, options.outputDir);
    processImports(options, $);
    inlineSheets(options, $, dir, options.outputDir);
    return $.html();
  } else {
    if (options.verbose) {
      console.log('Dependency deduplicated');
    }
  }
}

function processImports(options, $) {
  $(constants.IMPORTS).each(function() {
    var el = $(this);
    var href = el.attr('href');
    if (!excludeImport(options, href)) {
      el.replaceWith(concat(options, path.resolve(options.outputDir, href)));
    }
  });
}

function findScriptLocation($) {
  var pos = $('body').last();
  if (!pos.length) {
    pos = $.root();
  }
  return pos;
}

// arguments are (index, node), where index is unnecessary
function isCommentOrEmptyTextNode(_, node) {
  if (node.type === 'comment'){
    return true;
  } else if (node.type === 'text') {
    // return true if the node is only whitespace
    return !((/\S/).test(node.data));
  }
}

function removeCommentsAndWhitespace($) {
  $(constants.JS_INLINE).each(function() {
    var el = $(this);
    var content = getTextContent(el);
    setTextContent(el, content);
  });
  $(constants.CSS).each(function() {
    var el = $(this);
    var content = getTextContent(el);
    setTextContent(el, content);
  });
  $('head').contents().filter(isCommentOrEmptyTextNode).remove();
  $('body').contents().filter(isCommentOrEmptyTextNode).remove();
  $.root().contents().filter(isCommentOrEmptyTextNode).remove();
}

function handleMainDocument(options) {
  // reset shared buffers
  read = {};
  var $ = readDocument(options.input);
  var dir = path.dirname(options.input);
  pathresolver.resolvePaths($, dir, options.outputDir);
  processImports(options, $, dir);
  if (options.inline) {
    inlineSheets(options, $, dir, options.outputDir);
  }

  if (options.inline) {
    inlineScripts(options, $, options.outputDir);
  }

  // strip scripts into a separate file
  if (options.csp) {
    if (options.verbose) {
      console.log('Separating scripts into separate file');
    }

    // CSPify main page by removing inline scripts
    var scripts = [];
    $(constants.JS_INLINE).each(function() {
      var el = $(this);
      var content = getTextContent(el);
      // find ancestor polymer-element node
      var parentElement = el.closest('polymer-element').get(0);
      if (parentElement) {
        var match = constants.POLYMER_INVOCATION.exec(content);
        // skip Polymer() calls that have the tag name
        if (match && !match[1]) {
          // get element name
          var name = $(parentElement).attr('name');
          // build the named Polymer invocation
          var namedInvocation = 'Polymer(\'' + name + '\'' + (match[2] === '{' ? ',{' : ')');
          content = content.replace(match[0], namedInvocation);
          if (options.verbose) {
            console.log(match[0], '->', namedInvocation);
          }
        }
      }
      scripts.push(content);
      el.remove();
    });

    // join scripts with ';' to prevent breakages due to EOF semicolon insertion
    var scriptName;
    if (options.output) {
      scriptName = path.basename(options.output, '.html') + '.js';
    }
    else {
      scriptName = 'scripts.js';
    }
    var scriptContent = scripts.join(';' + constants.EOL);
    fs.writeFileSync(path.resolve(options.outputDir, scriptName), scriptContent, 'utf8');
    // insert out-of-lined script into document
    findScriptLocation($).append('<script src="' + scriptName + '"></script>');
  }

  deduplicateImports(options, $);

  if (options.strip) {
    removeCommentsAndWhitespace($);
  }
  var outhtml = $.html();

  if (options.output) {
    fs.writeFileSync(options.output, outhtml, 'utf8');
  }

  return outhtml;
}

function deduplicateImports(options, $) {
  var imports = {};
  $(constants.IMPORTS).each(function() {
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
