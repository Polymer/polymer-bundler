var fs = require('fs');
var path = require('path');
var cheerio = require('cheerio');
var nopt = require('nopt');
var EOL = require('os').EOL;
var IMPORTS = 'link[rel="import"][href]';
var ELEMENTS = 'polymer-element';
var URL_ATTR = ['href', 'src', 'action', 'style'];
var URL_ATTR_SEL = '[' + URL_ATTR.join('],[') + ']';
var ABS_URL = /(^data:)|(^http[s]?:)|(^\/)/;
var URL = /url\([^)]*\)/g;
var URL_TEMPLATE = '{{.*}}';
var POLYMER = 'script[src $= "polymer.js"], script[src $= "polymer.min.js"]';

var import_buffer = [];
var imports_before_polymer = [];
var read = {};

var options = nopt(
  {
    'output': path,
    'input': path,
    'verbose': Boolean,
    'csp': Boolean
  },
  {
    'o': ['--output'],
    'i': ['--input'],
    'v': ['--verbose']
  }
);

if (!options.input) {
  console.error('No input file given!');
  process.exit(1);
}

var DEFAULT_OUTPUT = 'vulcanized.html';
if (!options.output) {
  console.warn('Default output to vulcanized.html' + (options.csp ? ' and vulcanized.js' : '') + ' in the input directory.');
  options.output = path.resolve(path.dirname(options.input), DEFAULT_OUTPUT);
}

var outputDir = path.dirname(options.output);

function resolvePaths($, input, output) {
  var assetPath = path.relative(output, input);
  assetPath = assetPath.split(path.sep).join('/') + '/';
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
  // resolve style elements
  $('style').each(function() {
    var val = this.html();
    this.html(rewriteURL(input, output, val));
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
function inlineSheets($, dir) {
  $('link[rel="stylesheet"]').each(function() {
    var href = this.attr('href');
    if (href && !ABS_URL.test(href)) {
      var filepath = path.resolve(dir, href);
      // fix up paths in the stylesheet to be relative to this import
      var content = rewriteURL(path.dirname(filepath), dir, fs.readFileSync(filepath, 'utf8'));
      var styleDoc = cheerio.load('<style>' + content + '</style>');
      var polymerScope = this.attr('polymer-scope');
      if (polymerScope) {
        styleDoc('style').attr('polymer-scope', polymerScope);
      }
      this.replaceWith(styleDoc.html());
    }
  });
}

function concat(filename) {
  if (!read[filename]) {
    read[filename] = true;
    var $ = readDocument(filename);
    var dir = path.dirname(filename);
    processImports($, dir);
    inlineSheets($, dir);
    resolvePaths($, dir, outputDir);
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
    if (!ABS_URL.test(href)) {
      concat(path.resolve(prefix, href));
    } else {
      imports_before_polymer.push(this.html());
    }
  }).remove();
}

function findScriptLocation($) {
  var pos = $(POLYMER).last().parent();
  if (!pos.length) {
    pos = $('body');
  }
  if (!pos.length) {
    pos = $.root();
  }
  return pos;
}

function insertImport($, storedPosition, importText) {
  var pos = storedPosition;
  var operation = 'before';
  if (!pos.length) {
    // before polymer script in <head>
    pos = $('head ' + POLYMER).last();
  }
  if (!pos.length) {
    // at the bottom of head
    pos = $('head').last();
    operation = 'append';
  }
  if (!pos.length) {
    // at the bottom of <html>
    pos = $.root();
    operation = 'append';
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

function handleMainDocument() {
  var $ = readDocument(options.input);
  var dir = path.dirname(options.input);
  // find the position of the last import's nextSibling
  var import_pos = $(IMPORTS).last().next();
  processImports($, dir);
  var output = import_buffer.join(EOL);

  // strip scripts into a separate file
  if (options.csp) {
    if (options.verbose) {
      console.log('Separating scripts into separate file');
    }
    var scripts = [];
    var scripts_after_polymer = [];
    var tempoutput = cheerio.load(output);

    tempoutput('script').each(function() {
      var src = this.attr('src');
      if (src) {
        // external script
        if (!ABS_URL.test(src)) {
          scripts.push(fs.readFileSync(src, 'utf8'));
        } else {
          // put an absolute path script after polymer.js in main document
          scripts_after_polymer.push(this.html());
        }
      } else {
        // inline script
        scripts.push(this.text());
      }
    }).remove();
    output = tempoutput.html();
    // join scripts with ';' to prevent breakages due to EOF semicolon insertion
    var script_name = path.basename(options.output, '.html') + '.js';
    fs.writeFileSync(script_name, scripts.join(';' + EOL), 'utf8');
    scripts_after_polymer.push('<script src="' + script_name + '"></script>');
    findScriptLocation($).append(EOL + scripts_after_polymer.join(EOL) + EOL);
  }

  insertImport($, import_pos, imports_before_polymer.join(EOL) + EOL);
  insertInlinedImports($, output);
  fs.writeFileSync(options.output, $.html(), 'utf8');
}

handleMainDocument();
