/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

var fs = require('fs');
var path = require('path');

var ABS_URL = require('./contants.js').ABS_URL;
var DEFAULT = 'vulcanized.html';

// validate options with boolean return
function processOptions(optHash, callback) {
  excludes = {
    imports: [ABS_URL],
    scripts: [ABS_URL],
    styles: [ABS_URL]
  };

  var options = {
    csp: '',
    input: '',
    excludes: excludes,
    output: '',
    outputDir: ''
  };

  if (!optHash.input) {
    return callback('No input file given!');
  }

  options.input = optHash.input;

  if (optHash.excludes) {
    var e = optHash.excludes;
    try {
      if (e.imports) {
        e.imports.forEach(function(r) {
          excludes.imports.push(new RegExp(r));
        });
      }
      if (e.scripts) {
        e.scripts.forEach(function(r) {
          excludes.scripts.push(new RegExp(r));
        });
      }
      if (e.styles) {
        e.styles.forEach(function(r) {
          excludes.styles.push(new RegExp(r));
        });
      }
    } catch(_) {
      return callback('Malformed import exclude config');
    }
  }

  if (!optHash.output) {
    options.output = path.resolve(path.dirname(optHash.input), DEFAULT);
    options.outputDir = path.dirname(options.output);
  } else {
    options.output = optHash.output;
  }

  if (optHash.csp) {
    options.csp = options.output.replace(/\.html$/, '.js');
  }

  callback(null, options);
}

exports.processOptions = processOptions;
