#!/usr/bin/env node
/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */
import * as commandLineArgs from 'command-line-args';
import * as commandLineUsage from 'command-line-usage';
import * as fs from 'fs';
import * as dom5 from 'dom5';
import Bundler from '../bundler';
import {Analyzer} from 'polymer-analyzer';
import {FSUrlLoader} from 'polymer-analyzer/lib/url-loader/fs-url-loader';

const pathArgument = '[underline]{path}';

const optionDefinitions = [
  {name: 'help', type: Boolean, alias: 'h', description: 'Print this message'},
  {
    name: 'abspath',
    type: String,
    alias: 'p',
    description: `specify ${pathArgument
                 } as the "webserver root", make all adjusted urls absolute`,
    typeLabel: `${pathArgument}`
  },
  {
    name: 'version',
    type: Boolean,
    alias: 'v',
    description: 'Print version number'
  },
  {
    name: 'exclude',
    type: String,
    multiple: true,
    description:
        'Exclude a subpath from root. Use multiple times to exclude multiple paths. Tags to excluded paths are kept'
  },
  {
    name: 'redirect',
    type: String,
    multiple: true,
    description:
        'Takes an argument in the form of URI|PATH where url is a URI composed of a protocol, hostname, and path and PATH is a local filesystem path to replace the matched URI part with. Multiple redirects may be specified; the earliest ones have the highest priority.'
  },
  {
    name: 'add-import',
    type: String,
    multiple: true,
    description:
        'Add this import to the target HTML before vulcanizing. Can be used multiple times',
    typeLabel: `${pathArgument}`
  },
  {
    name: 'strip-exclude',
    type: String,
    multiple: true,
    description: 'Exclude a subpath and strip the link that includes it',
    typeLabel: `${pathArgument}`
  },
  {
    name: 'strip-comments',
    type: Boolean,
    description: 'Strips all HTML comments not containing an @license from the document'
  },
  {
    name: 'no-implicit-strip',
    type: Boolean,
    description: 'DANGEROUS! Avoid stripping imports of the transitive dependencies of imports specified with `--exclude`. May result in duplicate javascript inlining.'},
  {
    name: 'inline-scripts',
    type: Boolean,
    description: 'Inline external scripts'
  },
  {
    name: 'inline-css',
    type: Boolean,
    description: 'Inline external stylesheets'
  },
  {
    name: 'out-html',
    type: String,
    description: `If specified, output will be written to ${pathArgument} instead of stdout.`,
    typeLabel: `${pathArgument}`
  },
  {name: 'in-html', type: String, defaultOption: true, description: 'Input HTML. If not specified, will be the last command line argument.'},
];

const usage = [
  {header: 'Usage', content: ['vulcanize [options...] <in-html>']},
  {header: 'Options', optionList: optionDefinitions},
  {header: 'Examples', content: `  The command
    vulcanize target.html
  will inline the HTML Imports of \`target.html\` and print the resulting HTML to standard output.

  The command
    vulcanize target.html > build.html
  will inline the HTML Imports of \`target.html\` and print the result to build.html.

  The command
    vulcanize -p "path/to/target/" /target.html
  will inline the HTML Imports of \`target.html\`, treat \`path/to/target/\` as the webroot of target.html, and make all urls absolute to the provided webroot.

  The command
    vulcanize --exclude "path/to/target/subpath/" --exclude "path/to/target/subpath2/" target.html
  will inline the HTML Imports of \`target.html\` that are not in the directory \`path/to/target/subpath\` nor \`path/to/target/subpath2\`.

  If the \`--strip-excludes\` flag is used, the HTML Import \`<link>\` tags that point to resources in \`path/totarget/subpath\` and \`path/to/target/subpath2/\` will also be removed.

  The command
    vulcanize --inline-scripts target.html
  will inline scripts in \`target.html\` as well as HTML Imports. Exclude flags will apply to both Imports and Scripts.
  `,
  raw: true}
];

    const options = commandLineArgs(optionDefinitions);
console.log(options);

const target = options['in-html'];

function printHelp() {
  console.log(commandLineUsage(usage));
}

const pkg = require('../../package.json');
function printVersion() {
  console.log('vulcanize:', pkg.version);
}

if (options.version) {
  printVersion();
  process.exit(0);
}

if (options.help || !target) {
  printHelp();
  process.exit(0);
}

// escape a regex string and return a new RegExp
function stringToRegExp(str: string) {
  return new RegExp(str.replace(/[-\/\\*+?.()|[\]{}]/g, '\\$&'));
}

options.addedImports = options['add-import'] || [];
options.excludes = options.exclude || [];
options.redirects = options.redirect || [];
options.stripExcludes = options['strip-exclude'] || [];
options.stripComments = options['strip-comments'];
options.implicitStrip = !options['no-implicit-strip'];
options.inlineScripts = options['inline-scripts'];
options.inlineCss = options['inline-css'];
console.log(options);
options.analyzer = new Analyzer({urlLoader: new FSUrlLoader()});

(new Bundler(options)).bundle(target).then((content) => {
  const doc = content.get(target);
  if (!doc) {
    return;
  }
  const serialized = dom5.serialize(doc);
  if (options['out-html']) {
    const fd = fs.openSync(options['out-html'], 'w');
    fs.writeSync(fd, serialized + '\n');
    fs.closeSync(fd);
  } else {
    process.stdout.write(serialized);
  }
}).catch((err) => {
  process.stderr.write(require('util').inspect(err));
  process.exit(1);
});
