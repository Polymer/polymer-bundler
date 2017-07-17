[![Build Status](https://travis-ci.org/Polymer/polymer-bundler.svg?branch=master)](https://travis-ci.org/Polymer/polymer-bundler)
[![NPM version](http://img.shields.io/npm/v/polymer-bundler.svg)](https://www.npmjs.com/package/polymer-bundler)

# Polymer Bundler

polymer-bundler is a library for packaging project assets for production to minimize network round-trips.


## Relationship to Polymer CLI

The [Polymer CLI](https://github.com/Polymer/polymer-cli) uses [polymer-build](https://github.com/Polymer/polymer-build), which uses polymer-bundler, so you can think of the CLI's build pre-configured polymer-build pipeline including polymer-bundler. Setting this up for you makes the CLI easy to use, but as a command-line wrapper its customization options are more limited. polymer-bundler allows you to completely customize your bundle strategy.

## Usage

Web pages that use multiple [HTML Imports](http://www.html5rocks.com/en/tutorials/webcomponents/imports/), external scripts, and stylesheets to load dependencies may end up making lots of network round-trips.  In many cases, this can lead to long initial load times and unnecessary bandwidth usage.  The polymer-bundler tool follows HTML Imports, external script and stylesheet references, inlining these external assets into "bundles", to be used in production.

In the future, technologies such as [HTTP/2](http://en.wikipedia.org/wiki/HTTP/2) and [Server Push](https://http2.github.io/faq/#whats-the-benefit-of-server-push) will likely obsolete the need for a tool like polymer-bundler for web deployment uses.


## Installation

`polymer-bundler` is available on npm. For maximium utility, `polymer-bundler` should be installed globally.

    npm install -g polymer-bundler

This will install `polymer-bundler` to `/usr/local/bin/polymer-bundler` (you may need `sudo`
for this step).

## Options
- `-h`|`--help`: Print this message
- `-v`|`--version`: Print version number
- `-r`|`--root`: The root of the package/project being bundled.  Defaults to the current working folder.
- `--exclude <path>`: Exclude a subpath from root. Use multiple times to exclude multiple paths. Tags (imports/scripts/etc) that reference an excluded path are left in-place, meaning the resources are not inlined. ex: `--exclude=elements/x-foo.html --exclude=elements/x-bar.html`
- `--inline-scripts`: External scripts will only be inlined if this flag is provided.
- `--inline-css`: External stylesheets will only be inlined if this flag is provided.
- `--manifest-out <path>`: If specified, the bundle manifest will be written out to `<path>`.
- `--redirect <prefix>|<path>`: Routes URLs with arbitrary `<prefix>`, possibly including a protocol, hostname, and/or path prefix to a `<path>` on local filesystem.  For example `--redirect "myapp://|src"` would route `myapp://main/home.html` to `./src/main/home.html`.  Multiple redirects may be specified; the earliest ones have the highest priority.
- `--rewrite-urls-in-templates`: Fix URLs found inside `<style>` tags and certain element attributes (`action`, `assetpath`, `href`, `src`, and `style`) when inside `<template>` tags.  This may be necessary to bundle some Polymer 1.x projects with components that ues relative image urls in their styles, as Polymer 1.x did not use the `assetpath` of `<dom-module>` to resolve urls in styles like Polymer 2.x does.
- `--shell`: Uses a bundling strategy which puts inlines shared dependencies into a specified html app "shell".
- `--strip-comments`: Strips all HTML comments from the document which do not contain an `@license`, or start with `<!--#` or `<!--!`.
- `--sourcemaps`: Honor (or create) sourcemaps for inline script tags.
- `--out-html <path>`: If specified, output will be written to <path> instead of stdout.
- `--out-dir <path>`: If specified, output will be written to <path>. Necessary if bundling multiple files.

## Usage
The command

    polymer-bundler target.html

will inline the HTML Imports of `target.html` and print the resulting HTML to standard output.

The command

    polymer-bundler target.html --rewrite-urls-in-templates

will inline the HTML Imports of `target.html` and rewrite relative urls encountered in style tags and element attributes to support Polymer 1.x projects which may rely on it.

The command

    polymer-bundler target.html > build.html

will inline the HTML Imports of `target.html` and print the result to `build.html`.

The command

    polymer-bundler -p "path/to/target/" /target.html

will inline the HTML Imports of `target.html`, treat `path/to/target/` as the webroot of target.html, and make all urls absolute to the provided webroot.

The command

    polymer-bundler --exclude "path/to/target/subpath/" --exclude "path/to/target/subpath2/" target.html

will inline the HTML Imports of `target.html` that are not in the directory `path/to/target/subpath` nor `path/to/target/subpath2`.

The command

    polymer-bundler --inline-scripts target.html

will inline scripts in `target.html` as well as HTML Imports. Exclude flags will apply to both Imports and Scripts.

The command

    polymer-bundler --inline-css target.html

will inline Polymerized stylesheets, `<link rel="import" type="css">`

The command

    polymer-bundler --strip-comments target.html

will remove HTML comments, except for those containing `@license` or starting with `<!--#` or `<!--!`.  License comments will be deduplicated.

The command

    polymer-bundler --redirect "myapp://|src" target.html

will route all URLs with prefix `myapp://` to the `src` folder.  So a url like `myapp://main/index.html` would actually resolve to a file in `./src/main/index.html` relative to the package root.

## Using polymer-bundler programmatically

polymer-bundler as a library has two exported function.

`polymer-bundler` constructor takes an object of options similar to the command line options:

- `analyzer`: An instance of `polymer-analyzer` which provides analysis of and access to files to bundle.  Bundler will create its own instance if this is not given.
- `excludes`: URLs to exclude from inlining. URLs may represent files or folders. HTML tags referencing excluded URLs are preserved.
- `sourcemaps`: Honor (or create) sourcemaps for inline scripts
- `inlineCss`: Will inline content of external stylesheets into the bundle html.  Defaults to `true`.
- `inlineScripts`: Inline content of external scripts into the bundled html.  Defaults to `true`.
- `rewriteUrlsInTemplates`: Fix URLs found inside `<style>` tags and certain element attributes (`action`, `assetpath`, `href`, `src`, and `style`) when inside `<template>` tags.  This may be necessary to bundle some Polymer 1.x projects with components that ues relative image urls in their styles, as Polymer 1.x did not use the `assetpath` of `<dom-module>` to resolve urls in styles like Polymer 2.x does.  Defaults to `false`.
- `sourcemaps`: Honor (or create) sourcemaps for inline scripts.  Defaults to `false`.
- `stripComments`: Remove all HTML comments, except for `@license`, which are merely de-duplicated, server-side include directives like `<!--# ... -->`, and other important comments of the form `<!--! ... -->`.  Defaults to `false`.
- `strategy`: A function that takes an array of bundles and returns an array of bundles.  There are a strategy factory functions available in [bundle-manifest](https://github.com/Polymer/polymer-bundler/blob/master/src/bundle-manifest.ts).
- `urlMapper`: A function that takes bundles and returns a Map of urls to bundles.  This determines the location of generated bundles.  There are url mapper factory functions available in [bundle-manifest](https://github.com/Polymer/polymer-bundler/blob/master/src/bundle-manifest.ts)

`.generateManifest()` takes a collection of entrypoint urls and promises a `BundleManifest` which describes all the bundles it will produce.

`.bundle()` takes a `BundleManifest` and returns a `Promise` for a `BundleResult`, which contains a map of the generated bundle html files and an updated manifest containing information on what imports were inlined for each `Bundle`.

A simple example:
```js
const parse5 = require('parse5');
const bundler = new require('polymer-bundler').Bundler();
bundler.generateManifest(['my-app.html']).then((manifest) => {
  bundler.bundle(manifest).then((result) => {
    console.log('<!-- BUNDLED VERSION OF my-app.html: -->');
    console.log(parse5.serialize(result.documents.get('my-app.html').ast));
  });
});
```

An example with a customized sharding strategy and output layout:
```js
const {Analyzer, FSUrlLoader} = require('polymer-analyzer');
const analyzer = new Analyzer({
  urlLoader: new FSUrlLoader(path.resolve('.'))
});

const {Bundler,
       generateSharedDepsMergeStrategy,
       generateCountingSharedBundleUrlMapper} = require('polymer-bundler');
const bundler = new Bundler({
  analyzer: analyzer,
  excludes: [],
  inlineScripts: true,
  inlineCss: true,
  rewriteUrlsInTemplates: false,
  stripComments: true,
  // Merge shared dependencies into a single bundle when
  // they have at least three dependents.
  strategy: generateSharedDepsMergeStrategy(3),
  // Shared bundles will be named:
  // `shared/bundle_1.html`, `shared/bundle_2.html`, etc...
  urlMapper: generateCountingSharedBundleUrlMapper('shared/bundle_')
});

// Provide the strategy and the url mapper to produce a
// manifest using custom behavior.
bundler.generateManifest(['item.html', 'cart.html']).then((manifest) => {
  bundler.bundle(manifest).then((result) => {
    // do stuff here with your BundleResult
  });
});
```

## Caveats

In order to inlining the contents of HTML Import documents into the bundle, `polymer-bundler` has to make a few compromises to preserve valid HTML structure, script execution and style rule order:

1. Contents of all HTML Import documents will be moved to `<body>`

1. Any scripts or styles, inline or linked, which occur after a `<link rel="import">` node in `<head>` will be moved to `<body>` after the contents of the HTML Import.
