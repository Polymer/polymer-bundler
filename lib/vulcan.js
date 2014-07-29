/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */
var cheerio = require('cheerio');
var cleancss = require('clean-css');
var fs = require('fs');
var path = require('path');
var uglify = require('uglify-js');
var url = require('url');

var constants = require('./constants.js');
var optparser = require('./optparser.js');
var pathresolver = require('./pathresolver');
var utils = require('./utils');
var setTextContent = utils.setTextContent;
var getTextContent = utils.getTextContent;

/**
 * The vulcaniser wraps a full processing environment.
 */
function Vulcanizer() {
  var read = {};
  var options = {};

  // validate options with boolean return
  this.setOptions = function setOptions(optHash, callback) {
    optparser.processOptions(optHash, function(err, o) {
      if (err) {
        return callback(err);
      }
      options = o;
      callback();
    });
  };

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
    $('link[rel="stylesheet"]').each(function() {
      var el = $(this);
      var href = el.attr('href');
      if (href && !excludeStyle(href)) {
        var filepath = path.resolve(options.outputDir, href);
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

  function inlineScripts($, dir) {
    $(constants.JS_SRC).each(function() {
      var el = $(this);
      var src = el.attr('src');
      if (src && !excludeScript(src)) {
        var filepath = path.resolve(dir, src);
        var content = readFile(filepath);
        // NOTE: reusing UglifyJS's inline script printer (not exported from OutputStream :/)
        content = content.replace(/<\x2fscript([>\/\t\n\f\r ])/gi, "<\\/script$1");
        el.replaceWith('<script>' + content + '</script>');
      }
    });
  }

  function interpret(filedata) {
    return cheerio.load(filedata);
  }

  function readDocument(filename) {
    return interpret(readFile(filename));
  }

  function concat(filename) {
    if (!read[filename]) {
      read[filename] = true;
      var $ = readDocument(filename);
      var dir = path.dirname(filename);
      pathresolver.resolvePaths($, dir, options.outputDir);
      processImports($);
      inlineSheets($, dir, options.outputDir);
      return $.html();
    } else {
      if (options.verbose) {
        console.log('Dependency deduplicated');
      }
    }
  }

  function processImports($, mainDoc) {
    $(constants.IMPORTS).each(function() {
      var el = $(this);
      var href = el.attr('href');
      if (!excludeImport(href)) {
        var importContent = concat(path.resolve(options.outputDir, href));
        // hide import content in the main document
        if (mainDoc) {
          importContent = '<div hidden>' + importContent + '</div>';
        }
        el.replaceWith(importContent);
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

  function compressJS(content, inline) {
    var ast = uglify.parse(content);
    return ast.print_to_string({inline_script: inline});
  }

  function removeCommentsAndWhitespace($) {
    $(constants.JS_INLINE).each(function() {
      var el = $(this);
      var content = getTextContent(el);
      setTextContent(el, compressJS(content, true));
    });
    $(constants.CSS).each(function() {
      var el = $(this);
      var content = getTextContent(el);
      setTextContent(el, new cleancss({noAdvanced: true}).minify(content));
    });
    $('head').contents().filter(isCommentOrEmptyTextNode).remove();
    $('body').contents().filter(isCommentOrEmptyTextNode).remove();
    $.root().contents().filter(isCommentOrEmptyTextNode).remove();
  }

  function deduplicateImports($) {
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

  /**
   * The function where everything happens.
   */
  this.handleMainDocument = function handleMainDocument(input, callback) {
    // reset shared buffers
    read = {};
    // do we have input data, or do we read from options.input file?
    if(typeof input === "function") {
      callback = input;
      input = false;
    }
    var $ = input ? interpret(input) : readDocument(options.input);
    var dir = input ? "." : path.dirname(options.input);
    pathresolver.resolvePaths($, dir, options.outputDir);
    processImports($, true);
    if (options.inline) {
      inlineSheets($, dir, options.outputDir);
    }

    if (options.inline) {
      inlineScripts($, options.outputDir);
    }

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
          setTextContent(el, content);
        }
      }
    });

    // strip noscript from elements, and instead inject explicit Polymer() invocation
    // script, so registration order is preserved
    $(constants.ELEMENTS_NOSCRIPT).each(function() {
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
      $(constants.JS_INLINE).each(function() {
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
      fs.writeFileSync(path.resolve(options.outputDir, scriptName), scriptContent, 'utf8');
      // insert out-of-lined script into document
      findScriptLocation($).append('<script src="' + scriptName + '"></script>');
    }
    deduplicateImports($);
    if (options.strip) {
      removeCommentsAndWhitespace($);
    }
    var outhtml = $.html();
    if (!options.stdio) {
      fs.writeFileSync(options.output, outhtml, 'utf8');
    }
    if (callback) {
      callback(false, outhtml);
    }
  };
};

/**
 * export a single function that allows vulcanization runs
 * based on the passed options object. If no options are
 * passed, then a default options object is used, with the
 * assumption that vulcanize is being called with input data,
 * rather than input-from-file data.
 */
exports.process = function() {
  if (arguments.length === 0) {
    return false;
  }

  // due to the creative mix of possible arguments, we do argument
  // parsing based on the input type. We can only do this because
  // the three possible arguments use mutually exclusive types.
  var args = Array.prototype.slice.call(arguments);
  var input, options, callback;
  args.forEach(function(v) {
    if (typeof v === "string") input = v;
    else if (typeof v === "object") options = v;
    else if (typeof v === "function") callback = v;
  });

  if (!input && !options) {
    if(callback) {
      return callback("Vulcanize cannot run without either string input, or an options.input value set.");
    }
    return false;
  }

  if (input && !callback) {
    throw new Error("Vulcanise.process cannot be called synchronously, a function(err,result) handle is required.");
  }

  options = options || {
    stdio: true,
    inline: true
  };

  if (input && options.input) {
    if(callback) {
      return callback("Vulcanize cannot run with both string input and an options.input value set.");
    }
    return false;
  }

  var vulcanizer = new Vulcanizer();
  vulcanizer.setOptions(options, function(err) {
    if(err) {
      return callback(err);
    }
    vulcanizer.handleMainDocument(input, callback);
  });

  return true;
};
