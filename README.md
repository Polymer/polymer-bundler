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

## Usage
The command

    vulcanize target.html

will inline the HTML Imports of `target.html` and print the resulting HTML to
standard output.

The command

    vulcanize target.html > build.html

will inline the HTML Imports of `target.html` and print the result to
`build.html`.

## Using vulcanize programmatically

Vulcanize as a library has only one exported function.

`vulcanize.process` takes a `target` path to `target.html`, a `output directory`
path for rebasing urls in the main document, a hydrolysis loader (more on that
later), and a callback.

Example:
```js
var vulcan = require('vulcanize');
var hydrolysis = require('hydrolysis');

var loader = new hydrolysis.Loader();
loader.addResolver(new hydrolysis.FSResolver({}));

vulcan.process(target, process.cwd(), loader, function(err, inlinedHtml) {
});
```

`vulcanize` depends on `hydrolysis` to crawl the tree of HTML Imports, and
`vulcanize.process` depends on being given a `hydrolysis` loader to resolve
files.
**Note: fill this in later**

[![Analytics](https://ga-beacon.appspot.com/UA-39334307-2/Polymer/vulcanize/README)](https://github.com/igrigorik/ga-beacon)
