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
import * as parse5 from 'parse5';
import * as mkdirp from 'mkdirp';
import * as pathLib from 'path';
import Bundler from '../bundler';
import {Analyzer} from 'polymer-analyzer';
import {FSUrlLoader} from 'polymer-analyzer/lib/url-loader/fs-url-loader';
import {DocumentCollection} from '../document-collection';
import {UrlString} from '../url-utils';
import {BundleStrategy, generateShellMergeStrategy} from '../bundle-manifest';

console.warn('polymer-bundler is currently in alpha! Use at your own risk!');

const pathArgument = '[underline]{path}';

const optionDefinitions = [
  {name: 'help', type: Boolean, alias: 'h', description: 'Print this message'},
  {
    name: 'abspath',
    type: String,
    alias: 'p',
    description: `specify ${pathArgument} as the "webserver root", ` +
        `make all adjusted urls absolute`,
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
    description:
        'Strips all HTML comments not containing an @license from the document'
  },
  {
    name: 'no-implicit-strip',
    type: Boolean,
    description:
        'DANGEROUS! Avoid stripping imports of the transitive dependencies of imports specified with `--exclude`. May result in duplicate javascript inlining.'
  },
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
    description: `If specified, output will be written to ${pathArgument}` +
        ' instead of stdout.',
    typeLabel: `${pathArgument}`
  },
  {
    name: 'manifest-out',
    type: String,
    description: `If specified, the bundle manifest will be written to` +
        `${pathArgument}`,
    typeLabel: `${pathArgument}`
  },
  {
    name: 'shell',
    type: String,
    description: `If specified, shared dependencies will be inlined into` +
        `${pathArgument}`,
    typeLabel: `${pathArgument}`,
  },
  {
    name: 'out-dir',
    type: String,
    description: 'If specified, all output files will be written to ' +
        `${pathArgument}.`,
    typeLabel: `${pathArgument}`
  },
  {
    name: 'in-html',
    type: String,
    defaultOption: true,
    multiple: true,
    description:
        'Input HTML. If not specified, will be the last command line argument.'
  }
];

const usage = [
  {header: 'Usage', content: ['vulcanize [options...] <in-html>']},
  {header: 'Options', optionList: optionDefinitions},
  {
    header: 'Examples',
    content: [
      {
        desc:
            'Inline the HTML Imports of \`target.html\` and print the resulting HTML to standard output.',
        example: 'polymer-bundler target.html'
      },
      {
        desc:
            'Inline the HTML Imports of \`target.html\`, treat \`path/to/target/\` as the webroot of target.html, and make all urls absolute to the provided webroot.',
        example: 'polymer-bundler -p "path/to/target/" /target.html'
      },
      {
        desc:
            'Inline the HTML Imports of \`target.html\` that are not in the directory \`path/to/target/subpath\` nor \`path/to/target/subpath2\`.',
        example:
            'polymer-bundler --exclude "path/to/target/subpath/" --exclude "path/to/target/subpath2/" target.html'
      },
      {
        desc:
            'Inline scripts in \`target.html\` as well as HTML Imports. Exclude flags will apply to both Imports and Scripts.',
        example: 'vulcanize --inline-scripts target.html'
      },
    ]
  },
];

const options = commandLineArgs(optionDefinitions);

const entrypoints: UrlString[] = options['in-html'];

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

if (options.help || !entrypoints) {
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
options.analyzer = new Analyzer({urlLoader: new FSUrlLoader()});

interface JsonManifest {
  [entrypoint: string]: UrlString[];
}

function documentCollectionToManifestJson(documents: DocumentCollection):
    JsonManifest {
  const manifest: JsonManifest = {};
  for (const document of documents) {
    const url = document[0];
    const files = document[1].files;
    manifest[url] = Array.from(files);
  }
  return manifest;
}

(async() => {
  const bundler = new Bundler(options);
  let bundles: DocumentCollection;
  try {
    const shell = options.shell;
    let strategy: BundleStrategy|undefined;
    if (shell) {
      if (entrypoints.indexOf(shell) === -1) {
        throw new Error('Shell must be provided as `in-html`');
      }
      strategy = generateShellMergeStrategy(shell, 2);
    }
    bundles = await bundler.bundle(entrypoints, strategy);
  } catch (err) {
    console.log(err);
    return;
  }
  if (bundles.size > 1 || options['out-dir']) {
    const outDir = options['out-dir'];
    if (!outDir) {
      throw new Error(
          'Must specify out-dir when bundling multiple entrypoints');
    }
    for (const bundle of bundles) {
      const url = bundle[0];
      const ast = bundle[1].ast;
      const out = pathLib.join(process.cwd(), outDir, url);
      const finalDir = pathLib.dirname(out);
      mkdirp.sync(finalDir);
      const serialized = parse5.serialize(ast);
      const fd = fs.openSync(out, 'w');
      fs.writeSync(fd, serialized + '\n');
      fs.closeSync(fd);
    }
    if (options['manifest-out']) {
      const manifestJson = documentCollectionToManifestJson(bundles);
      const fd = fs.openSync(options['manifest-out'], 'w');
      fs.writeSync(fd, JSON.stringify(manifestJson));
      fs.closeSync(fd);
    }
    return;
  }
  const doc = bundles.get(entrypoints[0]);
  if (!doc) {
    return;
  }
  const serialized = parse5.serialize(doc.ast);
  if (options['out-html']) {
    const fd = fs.openSync(options['out-html'], 'w');
    fs.writeSync(fd, serialized + '\n');
    fs.closeSync(fd);
  } else {
    process.stdout.write(serialized);
  }
})().catch((err) => {
  console.log(err.stack);
  process.stderr.write(require('util').inspect(err));
  process.exit(1);
});