#!/usr/bin/env node
/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */
import * as commandLineArgs from 'command-line-args';
import * as fs from 'fs';
import Bundler from '../bundler';

var help = [
  'vulcanize: Reduce an HTML file and its dependent HTML Imports into one file',
  '',
  'Usage:',
  '  vulcanize <html file>',
  '',
  'Options:',
  '  -h|--help: print this message',
  '  -v|--version: print version number',
  '  -p <arg>|--abspath <arg>: use <arg> as the "webserver root", make all adjusted urls absolute',
  '  --inline-scripts: Inline external scripts',
  '  --inline-css: Inline external stylesheets',
  '  --add-import <path>: Add this import to the target HTML before vulcanizing. Can be used multiple times.',
  '  --exclude <path>: exclude a subpath from root. Use multiple times to exclude multiple paths. Tags to excluded paths are kept.',
  '  --strip-exclude: Exclude a subpath and strip the link that includes it.',
  '  --strip-comments: Strips all HTML comments not containing an @license from the document',
  '  --redirect <uri>|<path>: Takes an argument in the form of URI|PATH where url is a URI composed of a protocol, hostname, and path and PATH is a local filesystem path to replace the matched URI part with. Multiple redirects may be specified; the earliest ones have the highest priority.',
  '  --no-implicit-strip: DANGEROUS! Avoid stripping imports of the transitive dependencies of imports specified with `--exclude`. May result in duplicate javascript inlining.',
  '  --out-html <path>: If specified, output will be written to <path> instead of stdout.',
  'Examples:',
  '  The command',
  '',
  '    vulcanize target.html',
  '',
  '  will inline the HTML Imports of `target.html` and print the resulting HTML to standard output.',
  '',
  '  The command',
  '',
  '    vulcanize target.html > build.html',
  '',
  '  will inline the HTML Imports of `target.html` and print the result to build.html.',
  '',
  '  The command',
  '',
  '    vulcanize -p "path/to/target/" /target.html',
  '',
  '  will inline the HTML Imports of `target.html`, treat `path/to/target/` as the webroot of target.html, and make all urls absolute to the provided webroot.',
  '',
  '  The command',
  '',
  '    vulcanize --exclude "path/to/target/subpath/" --exclude "path/to/target/subpath2/" target.html',
  '',
  '  will inline the HTML Imports of `target.html` that are not in the directory `path/to/target/subpath` nor `path/to/target/subpath2`.',
  '',
  '  If the `--strip-excludes` flag is used, the HTML Import `<link>` tags that point to resources in `path/totarget/subpath` and `path/to/target/subpath2/` will also be removed.',
  '',
  '  The command',
  '',
  '    vulcanize --inline-scripts target.html',
  '',
  '  will inline scripts in `target.html` as well as HTML Imports. Exclude flags will apply to both Imports and Scripts.'
].join('\n');

const optionDefinitions = [
    {name: 'help', type: Boolean, alias: 'h'},
    {name: 'version', type: Boolean, alias: 'v'},
    {name: 'abspath', type: String, alias: 'p'},
    {name: 'exclude', type: String, multiple: true},
    {name: 'redirect', type: String, multiple: true},
    {name: 'add-import', type: String, multiple: true},
    {name: 'strip-exclude', type: String, multiple: true},
    {name: 'strip-comments', type: Boolean},
    {name: 'no-implicit-strip', type: Boolean},
    {name: 'inline-scripts', type: Boolean},
    {name: 'inline-css', type: Boolean},
    {name: 'out-html', type: String},
  ];

const options = commandLineArgs(optionDefinitions);
console.log(options);

var target = args.argv.remain[0];

function printHelp() {
  console.log(help);
}

var pkg = require('../package.json');
function printVersion() {
  console.log('vulcanize:', pkg.version);
}

if (args.version) {
  printVersion();
  process.exit(0);
}

if (args.help || !target) {
  printHelp();
  process.exit(0);
}

// escape a regex string and return a new RegExp
function stringToRegExp(str) {
  return new RegExp(str.replace(/[-\/\\*+?.()|[\]{}]/g, '\\$&'));
}

args.addedImports = args['add-import'] || [];
args.excludes = args.exclude || [];
args.redirects = args.redirect || [];
args.stripExcludes = args['strip-exclude'] || [];
args.stripComments = args['strip-comments'];
args.implicitStrip = !args['no-implicit-strip'];
args.inlineScripts = args['inline-scripts'];
args.inlineCss = args['inline-css'];

(new vulcan(args)).process(target, function(err, content) {
  if (err) {
    process.stderr.write(require('util').inspect(err));
    process.exit(1);
  }
  if (args['out-html']) {
      var fd = fs.openSync(args['out-html'], 'w');
      fs.writeSync(fd, content + "\n");
      fs.closeSync(fd);
  } else {
    process.stdout.write(content);
  }
});
