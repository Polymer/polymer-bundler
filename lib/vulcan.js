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
var uglify = require('uglify-js');
var url = require('url');

var constants = require('./constants.js');
var optparser = require('./optparser.js');
var pathresolver = require('./pathresolver');

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
  return exclude(excludes.imports, href);
}

function excludeScript(href) {
  return exclude(excludes.scripts, href);
}

function excludeStyle(href) {
  return exclude(excludes.styles, href);
}

// directly update the textnode child of <style>
// equivalent to <style>.textContent
function setTextContent(node, text) {
  node[0].children[0].data = text;
}

function readFile(file) {
  var content = fs.readFileSync(file, 'utf8');
  return content.replace(/^\uFEFF/, '');
}

// inline relative linked stylesheets into <style> tags
function inlineSheets($, inputPath, outputPath) {
  $('link[rel="stylesheet"]').each(function() {
    var href = this.attr('href');
    if (href && !excludeStyle(href)) {
      var filepath = path.resolve(inputPath, href);
      // fix up paths in the stylesheet to be relative to the location of the style
      var content = pathresolver.rewriteURL(path.dirname(filepath), inputPath, readFile(filepath));
      var styleDoc = cheerio.load('<style>' + content + '</style>');
      // clone attributes
      styleDoc('style').attr(this.attr());
      // don't set href or rel on the <style>
      styleDoc('style').attr('href', null);
      styleDoc('style').attr('rel', null);
      this.replaceWith(styleDoc.html());
    }
  });
}

function inlineScripts($, dir) {
  $(constants.JS_SRC).each(function() {
    var src = this.attr('src');
    if (src && !excludeScript(src)) {
      var filepath = path.resolve(dir, src);
      var content = readFile(filepath);
      this.replaceWith('<script>' + content + '</script>');
    }
  });
}

function readDocument(filename) {
  return cheerio.load(readFile(filename));
}

function concat(filename) {
  if (!read[filename]) {
    read[filename] = true;
    var $ = readDocument(filename);
    var dir = path.dirname(filename);
    processImports($, dir);
    inlineSheets($, dir, options.outputDir);
    pathresolver.resolvePaths($, dir, options.outputDir);
    return $.html();
  } else {
    if (options.verbose) {
      console.log('Dependency deduplicated');
    }
  }
}

function processImports($, prefix) {
  $(constants.IMPORTS).each(function() {
    var href = this.attr('href');
    if (excludeImport(href)) {
      // rewrite href to be deduplicated later
      this.attr('href', pathresolver.rewriteRelPath(prefix, options.outputDir, href));
    } else {
      this.replaceWith(concat(path.resolve(prefix, href)));
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
  $.root().contents().filter(isCommentOrEmptyTextNode).remove();
  $('head').contents().filter(isCommentOrEmptyTextNode).remove();
  $('body').contents().filter(isCommentOrEmptyTextNode).remove();
  $(constants.JS).each(function() {
    if (!this.attr('src')) {
      var content = this.html();
      var ast = uglify.parse(content);
      this.replaceWith('<script>' + ast.print_to_string() + '</script>');
    }
  });
  $(constants.CSS).each(function() {
    setTextContent(this, new cleancss().minify(this.text()));
  });
}

function handleMainDocument() {
  // reset shared buffers
  imports_before_polymer = [];
  read = {};
  var $ = readDocument(options.input);
  var dir = path.dirname(options.input);
  processImports($, dir);
  if (options.inline) {
    inlineSheets($, dir, options.outputDir);
  }
  pathresolver.resolvePaths($, dir, options.outputDir);

  // strip scripts into a separate file
  if (options.csp) {
    if (options.verbose) {
      console.log('Separating scripts into separate file');
    }
    var scripts = [];
    var scripts_after_polymer = [];

    var fn = function() {
      var src = this.attr('src');
      if (src) {
        // external script
        if (excludeScript(src)) {
          // put an absolute path script after polymer.js in main document
          scripts_after_polymer.push(this.toString());
        } else {
          scripts.push(readFile(path.resolve(options.outputDir, src)));
        }
      } else {
        // inline script
        scripts.push(this.text());
      }
    };

    // CSPify main page
    $(constants.JS).each(fn).remove();

    // join scripts with ';' to prevent breakages due to EOF semicolon insertion
    var script_name = path.basename(options.output, '.html') + '.js';
    fs.writeFileSync(path.resolve(options.outputDir, script_name), scripts.join(';' + EOL), 'utf8');
    scripts_after_polymer.push('<script src="' + script_name + '"></script>');
    findScriptLocation($).append(EOL + scripts_after_polymer.join(EOL) + EOL);
  }

  deduplicateImports($);
  if (!options.csp && options.inline) {
    inlineScripts($, options.outputDir);
  }
  if (options.strip) {
    removeCommentsAndWhitespace($);
  }
  var outhtml = $.html();
  fs.writeFileSync(options.output, outhtml, 'utf8');
}

function deduplicateImports($) {
  var imports = {};
  $(constants.IMPORTS).each(function() {
    var href = this.attr('href');
    // TODO(dfreedm): allow a user defined base url?
    var abs = url.resolve('http://', href);
    if (!imports[abs]) {
      imports[abs] = true;
    } else {
      if(options.verbose) {
        console.log('Import Dependency deduplicated');
      }
      this.remove();
    }
  });
}

exports.processDocument = handleMainDocument;
exports.setOptions = setOptions;
