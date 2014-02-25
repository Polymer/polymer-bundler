/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

var async = require('async');
var cheerio = require('cheerio');
var constants = require('./constants.js');
var path = require('path');
var pathresolver = require('./pathresolver');

function Importer(excludes, options) {
  this.excludes = excludes;
  this.options = options;
  this.read = {};
}

Importer.prototype = {
  readDocument: function(file, cb) {
    fs.readFile(file, 'utf8', function(err, content) {
      if (err) {
        return cb(err, null);
      }
      cb(null, cheerio.load(content));
    });
  },
  load: function(file, cb) {
    if (this.read[file]) {
      return cb(null, cheerio.load(''));
    }
    this.read[file] = true;
    this.readDocument(file, cb);
  },
  concat: function(file, cb) {
    var self = this;
    async.waterfall([
      async.apply(self.load, file),
      async.apply(self.processImports, file),
    ]);
  },
  processImports: function($, file, cb) {
    var self = this;
    var dir = path.dirname(file);
    var flatten = [];
    $(constants.IMPORTS).each(function() {
      var href = this.attr('href');
      if (self.excludeImport(href)) {
        // rewrite href to be deduplicated later
        this.attr('href', pathresolver.rewriteRelPath(prefix, options.outputDir, href));
      } else {
        flatten.push(this);
      }
    });
    async.eachLimit(flatten, 10, function(item, callback) {
    }, cb);
  }
};

exports.Importer = Importer;
