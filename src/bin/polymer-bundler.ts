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
import * as mkdirp from 'mkdirp';
import * as pathLib from 'path';
import {Bundler} from '../bundler';
import {Analyzer, FsUrlLoader, MultiUrlLoader, MultiUrlResolver, PackageRelativeUrl, FsUrlResolver, RedirectResolver, ResolvedUrl, UrlLoader, UrlResolver} from 'polymer-analyzer';
import {DocumentCollection} from '../document-collection';
import {generateShellMergeStrategy, BundleManifest} from '../bundle-manifest';
import {ensureTrailingSlash, getFileUrl, resolvePath} from '../url-utils';

const prefixArgument = '[underline]{prefix}';
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
    name: 'out-file',
    type: String,
    typeLabel: pathArgument,
    description: `If specified, output will be written to ${pathArgument}` +
        ' instead of stdout.'
  },
  {
    name: 'manifest-out',
    type: String,
    typeLabel: pathArgument,
    description: 'If specified, the bundle manifest will be written to ' +
        `${pathArgument}.`
  },
  {
    name: 'shell',
    type: String,
    typeLabel: pathArgument,
    description: 'If specified, shared dependencies will be inlined into ' +
        `${pathArgument}.`
  },
  {
    name: 'out-dir',
    type: String,
    typeLabel: pathArgument,
    description: 'If specified, all output files will be written to ' +
        `${pathArgument}.`
  },
  {
    name: 'in-file',
    type: String,
    typeLabel: pathArgument,
    defaultOption: true,
    multiple: true,
    description:
        'Input HTML (.html) and ES6 (.js) files. If not specified, will be ' +
        'the last command line argument.  Multiple input values allowable.'
  },
  {
    name: 'redirect',
    type: String,
    typeLabel: `${prefixArgument}|${pathArgument}`,
    multiple: true,
    description: `Routes URLs with arbitrary ${prefixArgument}, possibly ` +
        `including a protocol, hostname, and/or path prefix to a ` +
        `${pathArgument} on local filesystem.For example ` +
        `--redirect "myapp://|src" would route "myapp://main/home.html" to ` +
        `"./src/main/home.html".  Multiple redirects may be specified; the ` +
        `earliest ones have the highest priority.`
  },
  {
    name: 'rewrite-urls-in-templates',
    type: Boolean,
    description: 'Fix URLs found inside certain element attributes ' +
        '(`action`, `assetpath`, `href`, `src`, and`style`) inside ' +
        '`<template>` tags.'
  },
  {
    name: 'sourcemaps',
    type: Boolean,
    description: 'Create and process sourcemaps for scripts.'
  },
  {
    name: 'root',
    alias: 'r',
    type: String,
    typeLabel: pathArgument,
    description:
        'The root of the package/project being bundled.  Defaults to the ' +
        'current working folder.'
  },
  {
    name: 'module-resolution',
    description: 'Algorithm to use for resolving module specifiers in import ' +
        'and export statements when rewriting them to be web-compatible. ' +
        'Valid values are "none" and "node". "none" disables module specifier ' +
        'rewriting. "node" uses Node.js resolution to find modules.',
    type: String,
    typeLabel: '"node|none"',
    defaultValue: 'none',
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
            'Inline the HTML Imports of \`target.html\`, treat \`path/to/target/\` as the webroot of target.html, and make all URLs absolute to the provided webroot.',
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
      {
        desc: 'Route URLs starting with "myapp://" to folder "src/myapp".',
        example: 'polymer-bundler --redirect="myapp://|src/myapp" target.html'
      }
    ]
  },
];

const options = commandLineArgs(optionDefinitions);
const projectRoot = resolvePath(ensureTrailingSlash(options.root || '.'));

const entrypoints: PackageRelativeUrl[] = options['in-file'];

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
options.inlineScripts = Boolean(options['inline-scripts']);
options.inlineCss = Boolean(options['inline-css']);
options.rewriteUrlsInTemplates = Boolean(options['rewrite-urls-in-templates']);
options.moduleResolution = options['module-resolution'];

const {moduleResolution} = options;
const urlLoader = new FsUrlLoader(projectRoot);
const urlResolver = new FsUrlResolver(projectRoot);
const projectRootUrl = getFileUrl(projectRoot);

type Redirection = {
  prefix: ResolvedUrl; path: ResolvedUrl;
};

if (options.redirect) {
  const redirections: Redirection[] =
      options.redirect
          .map((redirect: string) => {
            const [prefix, path] = redirect.split('|');
            const resolvedPrefix = urlResolver.resolve(prefix as any);
            return {prefix: resolvedPrefix, path};
          })
          .filter((r: Redirection) => r.prefix && r.path);
  const resolvers: UrlResolver[] = redirections.map(
      (r: Redirection) =>
          new RedirectResolver(projectRootUrl, r.prefix, getFileUrl(r.path)));
  const loaders: UrlLoader[] = redirections.map(
      (r: Redirection) => new FsUrlLoader(resolvePath(r.path)));
  if (redirections.length > 0) {
    options.analyzer = new Analyzer({
      moduleResolution,
      urlResolver: new MultiUrlResolver([...resolvers, urlResolver]),
      urlLoader: new MultiUrlLoader([...loaders, urlLoader]),
    });
  }
}

if (!options.analyzer) {
  options.analyzer = new Analyzer({moduleResolution, urlResolver, urlLoader});
}

if (options.shell) {
  options.strategy =
      generateShellMergeStrategy(options.analyzer.resolveUrl(options.shell), 2);
}

(async () => {
  const bundler = new Bundler(options);

  let documents: DocumentCollection;
  let manifest: BundleManifest;
  try {
    const shell = options.shell;
    if (shell) {
      if (entrypoints.indexOf(shell) === -1) {
        entrypoints.push(shell);
      }
    }
    ({documents, manifest} = await bundler.bundle(
         await bundler.generateManifest(entrypoints.map((e) => {
           const resolvedUrl = bundler.analyzer.resolveUrl(e);
           if (!resolvedUrl) {
             throw new Error(`Unable to resolve URL for entrypoint ${e}`);
           }
           return resolvedUrl;
         }))));
  } catch (err) {
    console.log(err);
    return;
  }
  if (options['manifest-out']) {
    const manifestJson = manifest.toJson(bundler.analyzer.urlResolver);
    const fd = fs.openSync(options['manifest-out'], 'w');
    fs.writeSync(fd, JSON.stringify(manifestJson));
    fs.closeSync(fd);
  }
  const outDir = options['out-dir'];
  if (documents.size > 1 || outDir) {
    if (!outDir) {
      throw new Error(
          'Must specify out-dir when bundling multiple entrypoints');
    }
    for (const [url, document] of documents) {
      // When writing the output bundles to the filesystem, we need their paths
      // to be package relative, since the destination is different than their
      // original filesystem locations.
      const out =
          resolvePath(outDir, bundler.analyzer.urlResolver.relative(url));
      const finalDir = pathLib.dirname(out);
      mkdirp.sync(finalDir);
      const fd = fs.openSync(out, 'w');
      fs.writeSync(fd, document.content);
      fs.closeSync(fd);
    }
    return;
  }
  const doc = documents.get(bundler.analyzer.resolveUrl(entrypoints[0])!);
  if (!doc) {
    return;
  }
  if (options['out-file']) {
    const fd = fs.openSync(options['out-file'], 'w');
    fs.writeSync(fd, doc.content);
    fs.closeSync(fd);
  } else {
    process.stdout.write(doc.content);
  }
})().catch((err) => {
  console.log(err.stack);
  process.stderr.write(require('util').inspect(err));
  process.exit(1);
});
