var fs = require('fs');
var path = require('path');
var cheerio = require('cheerio');
var nopt = require('nopt');

var options = nopt(
  {
    'output': path,
    'input': [path, Array],
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
  console.error('No input files given');
  process.exit(1);
}

if (!options.output) {
  console.warn('Default output to output.html' + (options.csp ? ' and output.js' : ''));
  options.output = path.resolve('output.html');
}

var outputDir = path.dirname(options.output);

var IMPORTS = 'link[rel="import"][href]';
var ELEMENTS = 'polymer-element';
var URL_ATTR = ['href', 'src', 'action', 'style'];
var URL_ATTR_SEL = '[' + URL_ATTR.join('],[') + ']';
var ABS_URL = /(^data:)|(^http[s]?:)|(^\/)/;
var URL = /url\([^)]*\)/g;
var URL_TEMPLATE = '{{.*}}';

function resolvePaths($, input, output) {
  var assetPath = path.relative(output, input);
  // resolve attributes
  $(URL_ATTR_SEL).each(function() {
    var val;
    URL_ATTR.forEach(function(a) {
      if (val = this.attr(a)) {
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
  return path.relative(outputPath, abs);
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

function extractImports($, dir) {
  var hrefs = $(IMPORTS).map(function(){ return this.attr('href') });
  return hrefs.map(function(h) { return path.resolve(dir, h) });
}

function concat(filename) {
  if (!read[filename]) {
    read[filename] = true;
    var $ = readDocument(filename);
    var dir = path.dirname(filename);
    processImports(extractImports($, dir));
    $(IMPORTS).remove();
    resolvePaths($, dir, outputDir);
    buffer.push($.html());
  } else {
    if (options.verbose) {
      console.log('Dependency deduplicated');
    }
  }
}

function processImports(imports) {
  if (imports.length > 0) {
    if (options.verbose) {
      console.log('Dependencies:', imports);
    }
    imports.forEach(concat);
  }
}

var monkeyPatch = function(proto, element) {
  // monkey patch addResolvePath to use assetpath attribute
  var assetPath = element.getAttribute('assetpath');
  var url = HTMLImports.getDocumentUrl(element.ownerDocument) || '';
  if (url) {
    var parts = url.split('/');
    parts.pop();
    if (assetPath) {
      parts.push(assetPath);
    }
    parts.push('');
    url = parts.join('/');
  }
  proto.resolvePath = function(path) {
    return url + path;
  };
};

var buffer = [
  '<script>Polymer.addResolvePath = ' + monkeyPatch + ';</script>'
];
var read = {};

options.input.forEach(function(i) {
  var $ = readDocument(i);
  var dir = path.dirname(i);
  processImports(extractImports($, dir));
});

var output = buffer.join('\n');

// strip scripts into a separate file
if (options.csp) {
  if (options.verbose) {
    console.log('Separating scripts into separate file');
  }
  var scripts = [];
  var $ = cheerio.load(output);
  $('script').each(function() {
    var src;
    if (src = this.attr('src')) {
      // external script
      scripts.push(fs.readFileSync(src, 'utf8'));
    } else {
      // inline script
      scripts.push(this.text());
    }
  }).remove();
  output = $.html();
  // join scripts with ';' to prevent breakages due to EOF semicolon insertion
  fs.writeFileSync(options.output.replace('html', 'js'), scripts.join(';\n'), 'utf8');
}

fs.writeFileSync(options.output, output, 'utf8');
