/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

var fs = require('fs');
var path = require('path');
var whacko = require('whacko');

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
  if (!options.input && !options.inputSrc) {
    return callback('No input file or source string given!');
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

  if (options.include) {
    options.include.forEach(function(i) {
      try {
        var incpath = path.resolve(process.cwd(), i);
        var $ = whacko.load(fs.readFileSync(incpath, 'utf8'));

        $('polymer-element').each(function() {
          // extract element filename using assetpath and element name
          var href = path.join(path.basename($(this).attr('assetpath')), $(this).attr('name') + '.html');
          if (excludes.imports.indexOf(href) === -1) {
            excludes.imports.push(new RegExp(href));
          }

          // check the included element exist on the path if verbose options on
          if (options.verbose) {
            // calculate a absolute path of element that was in the include file.
            var abspath = path.resolve(path.dirname(incpath), path.join($(this).attr('assetpath'), $(this).attr('name') + '.html'));

            // check the element file is exist.
            if (!fs.existsSync(abspath)) {
              throw new Error('Could not found included element:\n\t' + abspath);
            }
          }
        });
      } catch(e) {
        return callback(e.toString());
      }
    });
  }

  options.excludes = excludes;

  options.keepExcludes = options['strip-excludes'] === false || config['strip-excludes'] === false;

  callback(null, options);
}

exports.processOptions = processOptions;
