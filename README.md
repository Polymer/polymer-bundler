[![NPM version](http://img.shields.io/npm/v/polymer-bundler.svg)](https://npmjs.org/package/polymer-bundler)
[![Build Status](http://img.shields.io/travis/Polymer/polymer-bundler.svg)](https://travis-ci.org/Polymer/polymer-bundler)

# polymer-bundler

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
- `-h`|`--help`: print this message
- `-v`|`--version`: print version number
- `--exclude <path>`: exclude a subpath from root. Use multiple times to exclude multiple paths. Tags (imports/scripts/etc) that reference an excluded path are left in-place, meaning the resources are not inlined. ex: `--exclude=elements/x-foo.html --exclude=elements/x-bar.html`
- `--inline-scripts`: Inline external scripts.
- `--inline-css`: Inline external stylesheets.
- `--shell`: Uses a bundling strategy which puts inlines shared dependencies into a specified html app "shell".
- `--strip-comments`: Strips all HTML comments not containing an @license from the document.
- `--sourcemaps`: Honor (or create) sourcemaps for inline script tags.
- `--out-html <path>`: If specified, output will be written to <path> instead of stdout.
- `--out-dir <path>`: If specified, output will be written to <path>. Necessary if bundling multiple files.

## Usage
The command

    polymer-bundler target.html

will inline the HTML Imports of `target.html` and print the resulting HTML to standard output.

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

will remove HTML comments, except for those that begin with `@license`.  License comments will be deduplicated.

## Using polymer-bundler programmatically

polymer-bundler as a library has two exported function.

`polymer-bundler` constructor takes an object of options similar to the command line options:

- `excludes`: An array of strings with regular expressions to exclude paths from being inlined.
- `inlineCss`: Inline external stylesheets.
- `inlineScripts`: Inline external scripts.
- `sourcemaps`: Honor (or create) sourcemaps for inline scripts
- `stripComments`: Remove non-license HTML comments.

`.generateManifest()` takes a collection of entrypoint urls and promises a `BundleManifest` which describes all the bundles it will produce.

`.bundle()` takes a `BundleManifest` and returns a promise to a `DocumentCollection` of the generated bundles.

Example:
```js
var analyzer = new require('polymer-analyzer')({
  urlLoader: new FSUrlLoader(path.resolve('.'))
});
var bundler = new require('polymer-bundler')({
  analyzer: analyzer,
  excludes: [],
  inlineScripts: true,
  inlineCss: true,
  stripComments: true
});
bundler.generateManifest([target]).then((manifest) => {
  bundler.bundle(manifest).then((bundles) => {
    /**
      * do stuff here
      */      
  });
});
```

## Caveats

Because HTML Imports changes the order of execution scripts can have, polymer-bundler has to make a few compromises to achieve that same script 
execution order.

1. Contents of all HTML Import documents will be moved to `<body>`

1. Any scripts or styles, inline or linked, which occur after a `<link rel="import">` node in `<head>` will be moved to `<body>` after the contents of the HTML Import.
