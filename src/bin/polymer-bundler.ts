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
import {Analyzer, FSUrlLoader, MultiUrlLoader, MultiUrlResolver, PackageRelativeUrl, PackageUrlResolver, RedirectResolver, ResolvedUrl, UrlLoader, UrlResolver} from 'polymer-analyzer';
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
    name: 'out-html',
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
    name: 'in-html',
    type: String,
    typeLabel: pathArgument,
    defaultOption: true,
    multiple: true,
    description:
        'Input HTML. If not specified, will be the last command line ' +
        'argument.  Multiple in-html arguments may be specified.'
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
const projectRootUrl = getFileUrl(projectRoot);

const entrypoints: PackageRelativeUrl[] = options['in-html'];

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

const fsUrlLoader = new FSUrlLoader(projectRoot);
const packageUrlResolver = new PackageUrlResolver({packageDir: projectRoot});

// getPackageRelativeUrl(url) reverses the resolved URL format into the original
// package relative URL format.  This is done primarily so that the generated
// manifest includes package relative URLs in the output instead of detailed
// local filesystem information which is present in resolved URLs.  This is
// defined here with a `let` because the redirect option will result in the
// function being wrapped with transformations for any redirect options.
let getPackageRelativeUrl: (r: ResolvedUrl) => PackageRelativeUrl =
    (resolvedUrl: ResolvedUrl): PackageRelativeUrl => {
      if (resolvedUrl.startsWith(projectRootUrl)) {
        return resolvedUrl.slice(projectRootUrl.length) as PackageRelativeUrl;
      }
      return resolvedUrl as any as PackageRelativeUrl;
    };

if (options.redirect) {
  type redirection = {prefix: string, path: string};
  const redirections: redirection[] =
      options.redirect
          .map((redirect: string) => {
            const [prefix, path] = redirect.split('|');
            return {prefix, path};
          })
          .filter((r: redirection) => r.prefix && r.path);
  const resolvers: UrlResolver[] = redirections.map(
      (r: redirection) => new RedirectResolver(
          packageUrlResolver.resolve(r.prefix as PackageRelativeUrl)!,
          r.prefix,
          getFileUrl(r.path)));

  // Wrap the getPackageRelativeUrl function for each redirection.  Because we
  // are wrapping the function, we iterate in reverse order to ensure the
  // redirect transformations are processed in the same order as they're given.
  // TODO(usergenic): Remove this whole getPackageRelativeUrl() function when
  // analyzer can reliably reverse a resolved URL into provide a package
  // relative URL when using MultiUrlResolver.
  redirections.reverse().forEach((r: redirection) => {
    const oldGetPackageRelativeUrl = getPackageRelativeUrl;
    const newGetPackageRelativeUrl =
        (resolvedUrl: ResolvedUrl): PackageRelativeUrl => {
          const redirectionPathUrl = getFileUrl(resolvePath(r.path));
          if (resolvedUrl.startsWith(redirectionPathUrl)) {
            return r.prefix + resolvedUrl.slice(redirectionPathUrl.length) as
                PackageRelativeUrl;
          }
          return oldGetPackageRelativeUrl(resolvedUrl);
        };
    getPackageRelativeUrl = newGetPackageRelativeUrl;
  });

  const loaders: UrlLoader[] = redirections.map(
      (r: redirection) => new FSUrlLoader(resolvePath(r.path)));
  if (redirections.length > 0) {
    options.analyzer = new Analyzer({
      urlResolver: new MultiUrlResolver([...resolvers, packageUrlResolver]),
      urlLoader: new MultiUrlLoader([...loaders, fsUrlLoader]),
    });
  }
}

if (!options.analyzer) {
  options.analyzer = new Analyzer({
    urlResolver: packageUrlResolver,
    urlLoader: fsUrlLoader,
  });
}

if (options.shell) {
  options.strategy =
      generateShellMergeStrategy(options.analyzer.resolveUrl(options.shell), 2);
}

interface JsonManifest {
  [entrypoint: string]: PackageRelativeUrl[];
}
(async () => {

  // Produces a bundle manifest object where all the URLs represented are
  // package relative.
  function bundleManifestToJson(manifest: BundleManifest): JsonManifest {
    const json: JsonManifest = {};
    const missingImports: Set<ResolvedUrl> = new Set();

    for (const [url, bundle] of manifest.bundles) {
      json[getPackageRelativeUrl(url)] =
          [...new Set([
            // `files` and `inlinedHtmlImports` will be partially
            // duplicative, but use of both ensures the basis document
            // for a file is included since there is no other specific
            // property that currently expresses it.
            ...bundle.files,
            ...bundle.inlinedHtmlImports,
            ...bundle.inlinedScripts,
            ...bundle.inlinedStyles
          ])].map(getPackageRelativeUrl);

      for (const missingImport of bundle.missingImports) {
        missingImports.add(missingImport);
      }
    }
    if (missingImports.size > 0) {
      json['_missing'] = [...missingImports].map(getPackageRelativeUrl);
    }
    return json;
  }

  const bundler = new Bundler(options);

  let documents: DocumentCollection;
  let manifest: BundleManifest;
  try {
    const shell = options.shell;
    if (shell) {
      if (entrypoints.indexOf(shell) === -1) {
        throw new Error('Shell must be provided as `in-html`');
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
    const manifestJson = bundleManifestToJson(manifest);
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
      const ast = document.ast;
      // When writing the output bundles to the filesystem, we need their paths
      // to be package relative, since the destination is different than their
      // original filesystem locations.
      const out = resolvePath(outDir, getPackageRelativeUrl(url));
      const finalDir = pathLib.dirname(out);
      mkdirp.sync(finalDir);
      const serialized = parse5.serialize(ast);
      const fd = fs.openSync(out, 'w');
      fs.writeSync(fd, serialized + '\n');
      fs.closeSync(fd);
    }
    return;
  }
  const doc = documents.get(bundler.analyzer.resolveUrl(entrypoints[0])!);
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
