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
import * as parse5 from 'parse5';
import * as mkdirp from 'mkdirp';
import * as pathLib from 'path';
import {Bundler} from '../bundler';
import {DocumentCollection} from '../document-collection';
import {UrlString} from '../url-utils';
import {generateShellMergeStrategy} from '../bundle-manifest';

console.warn('polymer-bundler is currently in alpha! Use at your own risk!');

const pathArgument = '[underline]{path}';

const optionDefinitions = [
  {name: 'help', type: Boolean, alias: 'h', description: 'Print this message'},
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
        'URL to exclude from inlining. Use multiple times to exclude multiple files and folders. HTML tags referencing excluded URLs are preserved.'
  },
  {
    name: 'strip-comments',
    type: Boolean,
    description:
        'Strips all HTML comments not containing an @license from the document'
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
  },
  {
    name: 'sourcemaps',
    type: Boolean,
    defaultOption: false,
    description: 'Create and process sourcemaps for scripts.'
  }
];

const usage = [
  {header: 'Usage', content: ['polymer-bundler [options...] <in-html>']},
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
        example: 'polymer-bundler --inline-scripts target.html'
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
  console.log('polymer-bundler:', pkg.version);
}

if (options.version) {
  printVersion();
  process.exit(0);
}

if (options.help || !entrypoints) {
  printHelp();
  process.exit(0);
}

options.excludes = options.exclude || [];
options.stripComments = options['strip-comments'];
options.implicitStrip = !options['no-implicit-strip'];
options.inlineScripts = options['inline-scripts'];
options.inlineCss = options['inline-css'];

if (options.shell) {
  options.strategy = generateShellMergeStrategy(options.shell, 2);
}

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

(async () => {
  const bundler = new Bundler(options);
  let bundles: DocumentCollection;
  try {
    const shell = options.shell;
    if (shell) {
      if (entrypoints.indexOf(shell) === -1) {
        throw new Error('Shell must be provided as `in-html`');
      }
    }
    const manifest = await bundler.generateManifest(entrypoints);
    bundles = await bundler.bundle(manifest);
  } catch (err) {
    console.log(err);
    return;
  }
  if (bundles.size > 1) {
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
