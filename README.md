[![NPM version](http://img.shields.io/npm/v/polymer-bundler.svg)](https://npmjs.org/package/polymer-bundler)
[![Build Status](http://img.shields.io/travis/Polymer/polymer-bundler.svg)](https://travis-ci.org/Polymer/polymer-bundler)

# polymer-bundler

### Reduce an HTML file and its dependent HTML Imports into one file


Web pages that use multiple [HTML Imports](http://www.html5rocks.com/en/tutorials/webcomponents/imports/) to load dependencies may end up making lots of network round-trips. In many cases, this can lead to long initial load times and unnecessary bandwidth usage. The polymer-bundler tool follows HTML Imports and `<script>` tags to inline these external assets into a single page, to be used in production.

In the future, technologies such as [HTTP/2](http://en.wikipedia.org/wiki/HTTP/2) and [Server Push](https://http2.github.io/faq/#whats-the-benefit-of-server-push) will likely obsolete the need for a tool like polymer-bundler for production uses.

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
- `--redirect <uri>|<path>`: Takes an argument in the form of URI|PATH where url is a URI composed of a protocol, hostname, and path and PATH is a local filesystem path to replace the matched URI part with. Multiple redirects may be specified; the earliest ones have the highest priority.
- `--strip-comments`: Strips all HTML comments not containing an @license from the document.
- `--sourcemaps`: Honor (or create) sourcemaps for inline script tags.
- `--out-html <path>`: If specified, output will be written to <path> instead of stdout.
- `--out-dir <path>`: If specified, output will be written to <path>. Necessary if bundling multiple files.

## Usage
The command

    polymer-bundler target.html

will inline the HTML Imports of `target.html` and print the resulting HTML to
standard output.

The command

    polymer-bundler target.html > build.html

will inline the HTML Imports of `target.html` and print the result to
`build.html`.

The command

    polymer-bundler -p "path/to/target/" /target.html

will inline the HTML Imports of `target.html`, treat `path/to/target/` as the
webroot of target.html, and make all urls absolute to the provided webroot.

The command

    polymer-bundler --exclude "path/to/target/subpath/" --exclude "path/to/target/subpath2/" target.html

will inline the HTML Imports of `target.html` that are not in the directory
`path/to/target/subpath` nor `path/to/target/subpath2`.

If the `--strip-exclude` flag is used, the HTML Import `<link>` tags that
point to resources in `path/to/target/subpath` and `path/to/target/subpath2/`
will also be removed.

The command

    polymer-bundler --inline-scripts target.html

will inline scripts in `target.html` as well as HTML Imports. Exclude flags will apply to both Imports and Scripts.

The command

    polymer-bundler --inline-css target.html

will inline Polymerized stylesheets, `<link rel="import" type="css">`

The command

    polymer-bundler --strip-comments target.html

will remove HTML comments, except for those that begin with `@license`.
License comments will be deduplicated.

## Using polymer-bundler programmatically

polymer-bundler as a library has two exported function.

`polymer-bundler` constructor takes an object of options similar to the command line
options.
- `excludes`: An array of strings with regular expressions to exclude paths from being inlined.
- `stripExcludes`: Similar to `excludes`, but strips the imports from the output entirely.
    - If `stripExcludes` is empty, it will be set the value of `excludes` by default.
- `inlineScripts`: Inline external scripts.
- `inlineCss`: Inline external stylesheets.
- `addedImports`: Additional HTML imports to inline, added to the end of the
    target file
- `redirects`: An array of strings with the format `URI|PATH` where url is a URI composed of a protocol, hostname, and path and PATH is a local filesystem path to replace the matched URI part with. Multiple redirects may be specified; the earliest ones have the highest priority.
- `sourcemaps`: Honor (or create) sourcemaps for inline scripts
- `stripComments`: Remove non-license HTML comments.
- `loader`: A [hydrolysis](https://www.npmjs.com/package/hydrolysis) loader.
    This loader is generated with the `target` argument to `vulcan.process` and
    the `exclude` paths. A custom loader can be given if more advanced setups
    are necesssary.

`polymer-bundler.process` takes a `target` path to `target.html` and a callback.

Example:
```js
var Bundler = require('polymer-bundler');
var Analyzer = require('polymer-analyzer');


var bundler = new Bundler({
  excludes: [
    '\\.css$'
  ],
  stripExcludes: [
  ],
  inlineScripts: false,
  inlineCss: false,
  addedImports: [
  ],
  redirects: [
  ],
  implicitStrip: true,
  stripComments: true
});

bundler.bundle([target]).then((bundles) => {
    /**
      * do stuff here
      */
})
```

## Caveats

Because HTML Imports changes the order of execution scripts can have, polymer-bundler
has to make a few compromises to achieve that same script execution order.

1. Contents of all HTML Import documents will be moved to `<body>`

1. Any scripts or styles, inline or linked, which occur after a `<link rel="import">` node in `<head>` will be moved to `<body>` after the contents of the HTML Import.
