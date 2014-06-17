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
var utils = require('./utils');
var setTextContent = utils.setTextContent;
var getTextContent = utils.getTextContent;

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

function mimeTypeForExtension(ext) {
  if (ext === 'svg') {
    return 'image/svg+xml';
  } else {
    return 'image/' + ext;
  }
}

function exclude(regexes, href) {
  return regexes.some(function(r) {
    return r.test(href);
  });
}

function skipImport(el) {
  return typeof el.attr('skip-vulcanization') !== 'undefined';
}

function skipImage(el, href) {
  return skipImport(el) || href.slice(0, 4) === 'data';
}

function excludeImport(el, href) {
  return skipImport(el) || exclude(options.excludes.imports, href);
}

function excludeScript(el, href) {
  return skipImport(el) || exclude(options.excludes.scripts, href);
}

function excludeStyle(el, href) {
  return skipImport(el) || exclude(options.excludes.styles, href);
}

function readFile(file) {
  var content = fs.readFileSync(file, 'utf8');
  return content.replace(/^\uFEFF/, '');
}

function inlineImages($, inputPath, outputPath, callback) {
  var waterfall = [];
  //each image inlined as a data url
  $(constants.IMG).each(function() {
    var el = $(this);
    var href = el.attr('src');
    if (href && !skipImage(el, href)) {
      var filepath = path.resolve(options.outputDir, href);
      waterfall.push(function(callback) {
        fs.exists(filepath, function(exists){
          if (exists) {
            fs.readFile(filepath, 'base64', function(err, imageContent){
              el.attr('src',
                      'data:' +
                      mimeTypeForExtension(path.extname(filepath).slice(1)) +
                      ';base64,' +
                      imageContent);
              callback(err);
            });
          } else {
            callback();
          }
        });
      });
    }
  });
  async.waterfall(waterfall, function(e) {
    callback(e);
  });
}

function inlineSheets($, inputPath, outputPath, callback) {
  var waterfall = [];
  //start stage to the waterfall, turns this into proper number
  //of parameters for our (filepath, content) chain
  waterfall.push(function(callback) {
    callback(undefined, undefined, undefined);
  });
  //multiple possible stylesheets, each building up a processing waterfall
  //only calling back when there is an error -- or all are complete
  $(constants.STYLESHEET).each(function() {
    var el = $(this);
    var href = el.attr('href');
    if (href && !excludeStyle(el, href)) {
      var filepath = path.resolve(options.outputDir, href);
      // fix up paths in the stylesheet to be relative to the location of the style
      var content = pathresolver.rewriteURL(path.dirname(filepath), outputPath, readFile(filepath));
      //each element in a sense resets the content, ignoring any preprocessor
      //output
      waterfall.push(function(_, __, callback) {
        callback(undefined, filepath, content);
      });
      //set up a processing waterfall with the preprocessors at the head
      options.preprocess.forEach(function(preprocessor) {
        waterfall.push(function(filepath, content, callback){
          preprocessor(filepath, content, callback);
        });
      });
      //replace the processed content into the document
      waterfall.push(function(filepath, content, callback) {
        var styleDoc = cheerio.load('<style>' + content + '</style>');
        // clone attributes
        styleDoc('style').attr(el.attr());
        // don't set href or rel on the <style>
        styleDoc('style').attr('href', null);
        styleDoc('style').attr('rel', null);
        el.replaceWith(styleDoc.html());
        callback(undefined, filepath, content);
      });
      //at this point, we are all done with one sheet element
    }
  });
  async.waterfall(waterfall, function(e) {
    callback(e);
  });
}

function inlineScripts($, dir, callback) {
  var waterfall = [];
  //start stage to the waterfall, turns this into proper number
  //of parameters for our (filepath, content) chain
  waterfall.push(function(callback) {
    callback(undefined, undefined, undefined);
  });
  $(constants.JS_SRC).each(function() {
    var el = $(this);
    var src = el.attr('src');
    if (src && !excludeScript(el, src)) {
      var filepath = path.resolve(dir, src);
      var content = readFile(filepath);
      //each element in a sense resets the content, ignoring any preprocessor
      //output
      waterfall.push(function(_, __, callback) {
        callback(undefined, filepath, content);
      });
      //set up a processing waterfall with the preprocessors at the head
      options.preprocess.forEach(function(preprocessor) {
        waterfall.push(function(filepath, content, callback){
          preprocessor(filepath, content, callback);
        });
      });
      //replace the processed content into the document
      waterfall.push(function(filepath, content, callback) {
        // NOTE: reusing UglifyJS's inline script printer (not exported from OutputStream :/)
        content = content.replace(/<\x2fscript([>\/\t\n\f\r ])/gi, "<\\/script$1");
        el.replaceWith('<script>' + content + '</script>');
        callback(undefined, filepath, content);
      });
    }
  });
  async.waterfall(waterfall, function(e) {
    callback(e);
  });
}

function readDocument(filename) {
  return cheerio.load(readFile(filename));
}

function concat(filename, callback) {
  var $ = readDocument(filename);
  //look for polymer elements, and in specific look for them to not be defined
  //before moving on
  $('polymer-element').each(function(){
    var polymer = $(this);
    var name = polymer.attr('name');
    if (read[name]) {
      polymer.replaceWith('');
    } else {
      read[name] = true;
    }
    console.log('found', name);
  });
  var dir = path.dirname(filename);
  pathresolver.resolvePaths($, dir, options.outputDir);
  async.waterfall([
    function(callback) {
      processImports($, callback);
    }
    ,
    function(callback) {
      inlineSheets($, dir, options.outputDir, callback);
    }
  ], function(e) {
    //deduplicate sub imports by content
    var content = $.html();
    if (read[content]) {
      console.log('deduplicating', filename);
      callback(e, '');
    } else {
      read[content] = true;
      callback(e, content);
    }
  });
}

function processImports($, callback) {
  waterfall = [];
  $(constants.IMPORTS).each(function() {
    var el = $(this);
    var href = el.attr('href');
    if (skipImport(el)) {
    } else if (excludeImport(el, href)) {
      el.replaceWith('');
    } else {
      waterfall.push(function(callback) {
        var filename = path.resolve(options.outputDir, href);
        concat(filename, function(e, content) {
          el.replaceWith(content);
          callback(e);
        });
      })
    }
  });
  async.waterfall(waterfall, callback);
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
  return ast.print_to_string({'inline_script': inline, 'beautify': true});
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

function separateForCSP($, dir){
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
  var scriptName = path.basename(options.output, '.html') + '.js';
  var scriptContent = scripts.join(';' + constants.EOL);
  if (options.strip) {
    scriptContent = compressJS(scriptContent, false);
  }
  fs.writeFileSync(path.resolve(options.outputDir, scriptName), scriptContent, 'utf8');
  // insert out-of-lined script into document
  findScriptLocation($).append('<script src="' + scriptName + '"></script>');
}

function writeDocument($) {
  deduplicateImports($);

  if (options.strip) {
    removeCommentsAndWhitespace($);
  }
  var outhtml = $.html();
  fs.writeFileSync(options.output, outhtml, 'utf8');
}

function handleMainDocument(callback) {
  // reset shared buffers
  read = {};
  var $ = readDocument(options.input);
  var dir = path.dirname(options.input);
  pathresolver.resolvePaths($, dir, options.outputDir);
  // now the asynchronous part of processing starts, allowing transformation
  // of the imported content
  async.waterfall([
    function(callback) {
      processImports($, callback);
    }
    ,
    function(callback) {
      if (options.inline) {
        inlineImages($, dir, options.outputDir, callback);
      } else {
        callback();
      }
    }
    ,
    function(callback) {
      if (options.inline) {
        inlineSheets($, dir, options.outputDir, callback);
      } else {
        callback();
      }
    }
    ,
    function(callback) {
      if (options.inline) {
        inlineScripts($, options.outputDir, callback);
      } else {
        callback();
      }
    }
    ,
    function(callback) {
      // strip scripts into a separate file
      if (options.csp) {
        separateForCSP($, dir);
      }
      writeDocument($);
      callback();
    }
  ], function(e){
    if (callback) {
      callback(e);
    } else {
      if (e) {
        console.error(e);
      }
    }
  });
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

exports.processDocument = handleMainDocument;
exports.setOptions = setOptions;
