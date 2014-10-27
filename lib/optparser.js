/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

var fs = require('fs');
var path = require('path');

var CONSTANTS = require('./constants.js');
var ABS_URL = CONSTANTS.ABS_URL;
var REMOTE_ABS_URL = CONSTANTS.REMOTE_ABS_URL;
var DEFAULT = 'vulcanized.html';

// validate options with boolean return
function processOptions(options, callback) {
  var config = {};
  var excludes = {
    imports: [],
    scripts: [],
    styles: []
  };

  options = options || Object.create(null);

  if (options.config) {
    var configBlob;
    try {
      // TODO(dfreedm): Make this async
      configBlob = fs.readFileSync(options.config, 'utf8');
    } catch(e) {
      return callback('Config file not found!');
    }
    try {
      config = JSON.parse(configBlob);
    } catch(e) {
      return callback('Malformed config JSON!');
    }
  }

  options.input = options.input || config.input;
  if (!options.input) {
    return callback('No input file given!');
  }

  options.excludes = options.excludes || config.excludes;
  if (options.excludes) {
    var e = options.excludes;
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

  options.output = options.output || config.output;
  if (!options.output) {
    options.output = path.resolve(path.dirname(options.input), DEFAULT);
  }
  options.outputDir = path.dirname(options.output);

  options.csp = options.csp || config.csp;
  if (options.csp) {
    options.csp = options.output.replace(/\.html$/, '.js');
  }

  options.abspath = options.abspath || config.abspath;
  if (options.abspath) {
    options.abspath = path.resolve(options.abspath);
    excludes.imports.push(REMOTE_ABS_URL);
    excludes.scripts.push(REMOTE_ABS_URL);
    excludes.styles.push(REMOTE_ABS_URL);
  } else {
    excludes.imports.push(ABS_URL);
    excludes.scripts.push(ABS_URL);
    excludes.styles.push(ABS_URL);
  }

  options.excludes = excludes;

  callback(null, options);
}

exports.processOptions = processOptions;
