/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

var fs = require('fs');
var path = require('path');
var url = require('url');
var cheerio = require('cheerio');
var cleancss = require('clean-css');
var uglify = require('uglify-js');

var EOL = require('os').EOL;
var ABS_URL = /(^data:)|(^http[s]?:)|(^\/)/;
var DEFAULT_OUTPUT = 'vulcanized.html';
var ELEMENTS = 'polymer-element';
var IMPORTS = 'link[rel="import"][href]';
var POLYFILLS = 'script[src $= "platform.js"]';
var URL = /url\([^)]*\)/g;
var URL_ATTR = ['href', 'src', 'action', 'style'];
var URL_ATTR_SEL = '[' + URL_ATTR.join('],[') + ']';
var URL_TEMPLATE = '{{.*}}';

var JS = 'script:not([type]), script[type="text/javascript"]';
var JS_SRC = JS.split(',').map(function(s){ return s + '[src]'; }).join(',');
var CSS = 'style:not([type]), style[type="text/css"]';

var excludes = {};

var import_buffer = [];
var imports_before_polymer = [];
var read = {};
var options = {};

// validate options with boolean return
function setOptions(optHash) {
  if (!optHash.input || !fs.existsSync(optHash.input)) {
    console.error('No input file given!');
    return;
  }

  excludes = {
    imports: [ABS_URL],
    scripts: [ABS_URL],
    styles: [ABS_URL]
  };

  if (optHash.excludes) {
    var e = optHash.excludes;
    if (e.imports && Array.isArray(e.imports)) {
      e.imports.forEach(function(r) {
        excludes.imports.push(new RegExp(r));
      });
    } else {
      console.error('Malformed import exclude config');
      return;
    }
  }

  if (!optHash.output) {
    console.warn('Default output to vulcanized.html' + (optHash.csp ? ' and vulcanized.js' : '') + ' in the input directory.');
    optHash.output = path.resolve(path.dirname(optHash.input), DEFAULT_OUTPUT);
  }

  optHash.outputDir = path.dirname(optHash.output);
  options = optHash;

  return true;
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

function resolvePaths($, input, output) {
  var assetPath = path.relative(output, input);
  // make sure assetpath is a folder, but not root!
  if (assetPath) {
    assetPath = assetPath.split(path.sep).join('/') + '/';
  }
  // resolve attributes
  $(URL_ATTR_SEL).each(function() {
    URL_ATTR.forEach(function(a) {
      var val = this.attr(a);
      if (val) {
        if (val.search(URL_TEMPLATE) < 0) {
          if (a === 'style') {
            this.attr(a, rewriteURL(input, output, val));
          } else {
            this.attr(a, rewriteRelPath(input, output, val));
          }
        }
      }
    }, this);
  });
  $(CSS).each(function() {
    var text = rewriteURL(input, output, this.text());
    setTextContent(this, text);
  });
  $(ELEMENTS).each(function() {
    this.attr('assetpath', assetPath);
  });
}

function rewriteRelPath(inputPath, outputPath, rel) {
  if (ABS_URL.test(rel)) {
    return rel;
  }
  var abs = path.resolve(inputPath, rel);
  var relPath = path.relative(outputPath, abs);
  return relPath.split(path.sep).join('/');
}

function rewriteURL(inputPath, outputPath, cssText) {
  return cssText.replace(URL, function(match) {
    var path = match.replace(/["']/g, "").slice(4, -1);
    path = rewriteRelPath(inputPath, outputPath, path);
    return 'url(' + path + ')';
  });
}

function readDocument(docname) {
  if (options.verbose) {
    console.log('Reading:', docname);
  }
  var content = fs.readFileSync(docname, 'utf8');
  return cheerio.load(content);
}

// inline relative linked stylesheets into <style> tags
function inlineSheets($, inputPath, outputPath) {
  $('link[rel="stylesheet"]').each(function() {
    var href = this.attr('href');
    if (href && !excludeStyle(href)) {
      var filepath = path.resolve(inputPath, href);
      // fix up paths in the stylesheet to be relative to the location of the style
      var content = rewriteURL(path.dirname(filepath), inputPath, fs.readFileSync(filepath, 'utf8'));
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
  $(JS_SRC).each(function() {
    var src = this.attr('src');
    if (src && !excludeScript(src)) {
      var filepath = path.resolve(dir, src);
      var content = fs.readFileSync(filepath, 'utf8');
      this.replaceWith('<script>' + content + '</script>');
    }
  });
}

function concat(filename) {
  if (!read[filename]) {
    read[filename] = true;
    var $ = readDocument(filename);
    var dir = path.dirname(filename);
    processImports($, dir);
    inlineSheets($, dir, options.outputDir);
    resolvePaths($, dir, options.outputDir);
    import_buffer.push($.html());
  } else {
    if (options.verbose) {
      console.log('Dependency deduplicated');
    }
  }
}

function processImports($, prefix) {
  $(IMPORTS).each(function() {
    var href = this.attr('href');
    if (excludeImport(href)) {
      // rewrite href to be deduplicated later
      this.attr('href', rewriteRelPath(prefix, options.outputDir, href));
      imports_before_polymer.push(this);
    } else {
      concat(path.resolve(prefix, href));
    }
  }).remove();
}

function findScriptLocation($) {
  var pos = $(POLYFILLS).last().parent();
  if (!pos.length) {
    pos = $('body').last();
  }
  if (!pos.length) {
    pos = $.root();
  }
  return pos;
}

function insertImport($, importText) {
  // before polymer script in <head>
  var pos = $('head ' + POLYFILLS).last();
  var operation = 'after';
  if (!pos.length) {
    // at the bottom of head
    pos = $('head').last();
    operation = 'append';
  }
  if (!pos.length) {
    // at the top of top document
    pos = $.root();
    operation = 'prepend';
  }
  pos[operation](importText);
}

function insertInlinedImports($, importText) {
  var pos = $('body').last();
  var operation = 'prepend';
  if (!pos.length) {
    pos = $.root();
  }
  pos[operation](importText);
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
  $(JS).each(function() {
    if (!this.attr('src')) {
      var content = this.html();
      var ast = uglify.parse(content);
      this.replaceWith('<script>' + ast.print_to_string() + '</script>');
    }
  });
  $(CSS).each(function() {
    setTextContent(this, new cleancss().minify(this.text()));
  });
}

function handleMainDocument() {
  // reset shared buffers
  import_buffer = [];
  imports_before_polymer = [];
  read = {};
  var $ = readDocument(options.input);
  var dir = path.dirname(options.input);
  processImports($, dir);
  if (options.inline) {
    inlineSheets($, dir, options.outputDir);
  }
  resolvePaths($, dir, options.outputDir);
  var output = import_buffer.join(EOL);

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
          scripts_after_polymer.push(this.html());
        } else {
          scripts.push(fs.readFileSync(path.resolve(options.outputDir, src), 'utf8'));
        }
      } else {
        // inline script
        scripts.push(this.text());
      }
    };

    // CSPify main page
    $(JS).each(fn).remove();

    // CSPify imports
    var tempoutput = cheerio.load(output);
    tempoutput(JS).each(fn).remove();
    output = tempoutput.html();

    // join scripts with ';' to prevent breakages due to EOF semicolon insertion
    var script_name = path.basename(options.output, '.html') + '.js';
    fs.writeFileSync(path.resolve(options.outputDir, script_name), scripts.join(';' + EOL), 'utf8');
    scripts_after_polymer.push('<script src="' + script_name + '"></script>');
    findScriptLocation($).append(EOL + scripts_after_polymer.join(EOL) + EOL);
  }

  imports_before_polymer = deduplicateImports(imports_before_polymer);
  insertImport($, imports_before_polymer.join(EOL) + EOL);
  insertInlinedImports($, output);
  if (!options.csp && options.inline) {
    inlineScripts($, options.outputDir);
  }
  if (options.strip) {
    removeCommentsAndWhitespace($);
  }
  var outhtml = $.html();
  fs.writeFileSync(options.output, outhtml, 'utf8');
}

function deduplicateImports(importArray) {
  var imports = {};
  return importArray.filter(function(im) {
    var href = im.attr('href');
    // TODO(dfreedm): allow a user defined base url?
    var abs = url.resolve('http://', href);
    if (!imports[abs]) {
      imports[abs] = true;
      return true;
    } else if(options.verbose) {
      console.log('Import Dependency deduplicated');
    }
  }).map(function(im) {
    return cheerio.html(im);
  });
}

exports.processDocument = handleMainDocument;
exports.setOptions = setOptions;
