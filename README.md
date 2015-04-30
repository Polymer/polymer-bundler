[![NPM version](http://img.shields.io/npm/v/vulcanize.svg)](https://npmjs.org/package/vulcanize)
[![Build Status](http://img.shields.io/travis/Polymer/vulcanize.svg)](https://travis-ci.org/Polymer/vulcanize)

# Vulcanize

### Reduce an HTML file and its dependent HTML Imports into one file

>Named for the [Vulcanization](http://en.wikipedia.org/wiki/Vulcanization) process that turns polymers into more durable
materials.

## Installation

`vulcanize` is available on npm. For maximium utility, `vulcanize` should be installed globally.

    npm install -g vulcanize

This will install `vulcanize` to `/usr/local/bin/vulcanize`.

## Options
- `-h`|`--help`: print this message
- `-v`|`--version`: print version number
- `-p <arg>`|`--abspath <arg>`: use <arg> as the "webserver root", make all adjusted urls absolute
- `--exclude <path>`: exclude a subpath from root. Use multiple times to exclude multiple paths. Tags to excluded paths are kept.
- `--strip-excludes`: Exclude a subpath and remove any links referencing it.
- `--inline-scripts`: Inline external scripts.
- `--inline-css`: Inline external stylesheets.
- `--strip-comments`: Strips all HTML comments not containing an @license from the document.
- `--no-implicit-strip`: *DANGEROUS*! Avoid stripping imports of the transitive dependencies of imports specified with `--exclude`. May result in duplicate javascript inlining.

## Usage
The command

    vulcanize target.html

will inline the HTML Imports of `target.html` and print the resulting HTML to
standard output.

The command

    vulcanize target.html > build.html

will inline the HTML Imports of `target.html` and print the result to
`build.html`.

The command

    vulcanize -p "path/to/target/" /target.html

will inline the HTML Imports of `target.html`, treat `path/to/target/` as the
webroot of target.html, and make all urls absolute to the provided webroot.

The command

    vulcanize --exclude "path/to/target/subpath/" --exclude "path/to/target/subpath2/" target.html

will inline the HTML Imports of `target.html` that are not in the directory
`path/to/target/subpath` nor `path/to/target/subpath2`.

If the `--strip-excludes` flag is used, the HTML Import `<link>` tags that
point to resources in `path/totarget/subpath` and `path/to/target/subpath2/`
will also be removed.

The command

    vulcanize --inline-scripts target.html

will inline scripts in `target.html` as well as HTML Imports. Exclude flags will apply to both Imports and Scripts.

## Using vulcanize programmatically

Vulcanize as a library has two exported function.

`vulcanize.setOptions` takes an object of options similar to the command line
options.
- `abspath`: A folder to treat as "webroot".
  - When specified, use an absolute path to `target`.
- `excludes`: An array of RegExp objects to exclude paths from being inlined.
- `stripExcludes`: Remove paths that were excluded by the regexes in `excludes`.
- `inlineScripts`: Inline external scripts

`vulcanize.process` takes a `target` path to `target.html` and a callback.

Example:
```js
var vulcan = require('vulcanize');
var hydrolysis = require('hydrolysis');

vulcan.setOptions({
  abspath: '',
  excludes: [
  ],
  stripExcludes: false,
  inlineScripts: false
});

vulcan.process(target, function(err, inlinedHtml) {
});
```

## What happened to [feature]?
- `--csp` mode has been moved into [crisper](https://github.com/PolymerLabs/crisper)
- `--strip` mode was removed, use something like [html-minifier](https://github.com/kangax/html-minifier) or [minimize](https://github.com/Moveo/minimize)

[![Analytics](https://ga-beacon.appspot.com/UA-39334307-2/Polymer/vulcanize/README)](https://github.com/igrigorik/ga-beacon)
