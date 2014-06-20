/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

var async = require('async');
var cheerio = require('cheerio');
var fs = require('fs');
var path = require('path');
var url = require('url');

var constants = require('./constants');
var pathresolver = require('./pathresolver');

var read = {};

function exclude (regexes, href) {
  return regexes.some(function(r) {
    return r.test(href);
  });
}

function excludeImport (options, href) {
  return exclude(options.excludes.imports, href);
}

function excludeScript (options, href) {
  return exclude(options.excludes.scripts, href);
}

function excludeStyle (options, href) {
  return exclude(options.excludes.styles, href);
}

function replaceZeroWidthNoBreakSpace (s) {
  return s.replace(/^\uFEFF/, '');
}

function readFile(file) {
  var content = fs.readFileSync(file, 'utf8');
  return replaceZeroWidthNoBreakSpace(content);
}

function readDocument(filename) {
  return cheerio.load(readFile(filename));
}

function concat (options, filename) {
  if (!read[filename]) {
    read[filename] = true;
    var $ = readDocument(filename);
    var dir = path.dirname(filename);
    pathresolver.resolvePaths($, dir, options.outputDir);
    processImports(options, $);
    return $.html();
  } else {
    if (options.verbose) {
      console.log('Dependency deduplicated');
    }
  }
}

function processImports (options, $) {
  $(constants.IMPORTS).each(function() {
    var el = $(this);
    var href = el.attr('href');
    if (!excludeImport(options, href)) {
      el.replaceWith(concat(options, path.resolve(options.outputDir, href)));
    }
  });
}

function findScriptLocation ($) {
  var pos = $('body').last();
  if (!pos.length) {
    pos = $.root();
  }
  return pos;
}

function handleMainDocument (options) {
  // reset shared buffers
  read = {};
  var $ = cheerio.load(replaceZeroWidthNoBreakSpace(options.file.contents.toString()));
  var dir = path.dirname(options.file.path);

  pathresolver.resolvePaths($, dir, options.outputDir);
  processImports(options, $, dir);
  deduplicateImports(options, $);

  return $.html();
}

function deduplicateImports (options, $) {
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
