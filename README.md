[![NPM version](http://img.shields.io/npm/v/vulcanize.svg)](https://npmjs.org/package/vulcanize)
[![Build Status](http://img.shields.io/travis/Polymer/vulcanize.svg)](https://travis-ci.org/Polymer/vulcanize)

# Vulcanize

### Concatenate a set of Web Components into one file

>Named for the [Vulcanization](http://en.wikipedia.org/wiki/Vulcanization) process that turns polymers into more durable
materials.

## Installation

`vulcanize` is available on npm. For maximium utility, `vulcanize` should be installed globally.

    sudo npm install -g vulcanize

This will install `vulcanize` to `/usr/local/bin/vulcanize`.

## Usage

    vulcanize index.html

At the simplest, `vulcanize` only requires an html file as an argument. The optimized output file will be named
`vulcanized.html`.

If you want to control the output name, use the `-o` flag

    vulcanize -o build.html index.html

Most URLs will be automatically adjusted by the vulcanizer.


## Options

-  `--output`, `-o`
  - Output file name (defaults to vulcanized.html)
-  `--verbose`, `-v`
  - More verbose logging
-  `--help`, `-v`, `-?`
  - Print this message
- `--config`
  - Read a given config file
- `--strip`, `-s`
  - Remove comments and empty text nodes
-  `--csp`
  - Extract inline scripts to a separate file (uses `<output file name>`.js)
-  `--inline`
  - The opposite of CSP mode, inline all assets (script and css) into the document
- `--inline --csp`
  - Bundle all javascript (inline and external) into `<output file name>`.js
- `--abspath`, `-p`
  - Specify site root. Resolve paths to absolute paths based on site root
- `--no-strip-excludes`
  - Keep imports excluded from inlining
- `--version`, ` -V`
  - print version information

## Additional options when used as Node module

In addition to the above options, `vulcan` when used as Node module has additional options for string-based rather than file-based document processing. These are:

- `inputSrc`
  - The document to process, represented as String, String Buffer, or any Object with a `toString` function that yields valid HTML souce. Imports are resolved relative to the directory in which the node process was started.
- `outputHandler`
  - An output handler function to call rather than writing the processing result to file. The handler must be of the form `function(filename, data)`, which is called with the following arguments:
    - `filename`
      - The file that vulcanize would create if it were running in file I/O mode.
    -  `data`
      - The HTML source that vulcanize writes to file if no outputhandler is used.

An example of using these options is shown below:

```
var vulcan = require("./lib/vulcan");

var head = "<head><link rel='import' href='test/html/imports/simple-import.html'></head>";
var body = "<body><my-element>test</my-element></body>";
var input = "<!doctype><html>" + head + body + "</html>";

var outputHandler = function(filename, data) {
  console.log(data);
};

vulcan.setOptions({inputSrc: input, outputHandler: outputHandler}, function(err) {
  if(err) {
    console.error(err);
    process.exit(1);
  }
  vulcan.processDocument();
});

```

## Config
> JSON file for additional options

- Excludes: Remove the selected urls completely from the vulcanized bundle:
  - Use the `--no-strip-excludes` command line flag, or set `"strip-excludes": false`
    in the config to keep excluded urls in the output bundle.

### Example Config
```json
{
  "excludes": {
    "imports": [
      "regex-to-exclude"
    ]
  }
}
```

### Keep excludes config
```json
{
  "excludes": {
    "imports": [
      "regex-to-exclude"
    ]
  },
  "strip-excludes": false
}
```

## Example Usage

Say we have three html files: `index.html`, `x-app.html`, and `x-dep.html`.

index.html:

```html
<!DOCTYPE html>
<link rel="import" href="x-app.html">
<x-app></x-app>
```

x-app.html:

```html
<link rel="import" href="path/to/x-dep.html">
<polymer-element name="x-app">
  <template>
    <x-dep></x-dep>
  </template>
  <script>Polymer('x-app')</script>
</polymer-element>
```

x-dep.html:

```html
<polymer-element name="x-dep">
  <template>
    <img src="x-dep-icon.jpg">
  </template>
  <script>
    Polymer('x-dep');
  </script>
</polymer-element>
```

Running vulcan on `index.html`, and specifying `build.html` as the output:

    vulcanize -o build.html index.html

Will result in `build.html` that appears as so:

```html
<!DOCTYPE html>
<div hidden><polymer-element name="x-dep" assetpath="path/to/">
  <template>
    <img src="http://www.polymer-project.org/images/logos/p-logo.svg">
  </template>
  <script>
    Polymer('x-dep');
  </script>
</polymer-element>

<polymer-element name="x-app" assetpath="">
  <template>
    <x-dep></x-dep>
  </template>
  <script>Polymer('x-app')</script>
</polymer-element>
</div>
<x-app></x-app>
```

## Content Security Policy
[Content Security Policy](http://en.wikipedia.org/wiki/Content_Security_Policy), or CSP, is a Javascript security model
that aims to prevent XSS and other attacks. In so doing, it prohibits the use of inline scripts.

To help automate the use of Polymer element registration with CSP, the `--csp` flag to vulcan will remove all scripts
from the HTML Imports and place their contents into an output javascript file.

Using the previous example, the output from `vulcanize --csp -o build.html index.html` will be

build.html:
```html
<!DOCTYPE html>
<div hidden><polymer-element name="x-dep" assetpath="path/to/">
  <template>
    <img src="http://www.polymer-project.org/images/logos/p-logo.svg">
  </template>

</polymer-element>

<polymer-element name="x-app" assetpath="">
  <template>
    <x-dep></x-dep>
  </template>

</polymer-element>
</div>
<x-app></x-app>
<script src="build.js"></script>
```

build.js:
```js

    Polymer('x-dep');
  ;
Polymer('x-app')
```

The JS files can become a bit messy without reformatting, and semi-colons are inserted between script contents as a
precaution.

## Stripping whitespace

Vulcanize includes a set of size reducing heuristics to remove unnecessary whitespace and comments in HTML, JS, and CSS.
This can be activated by using the `--strip` option.

Using the previous example, the output from `vulcanize --csp -o build.html --strip index.html` will be

build.html:
```html
<!DOCTYPE html>
<div hidden><polymer-element name="x-dep" assetpath="path/to/"><template><img src="http://www.polymer-project.org/images/logos/p-logo.svg"></template></polymer-element><polymer-element name="x-app" assetpath=""><template><x-dep></x-dep></template></polymer-element></div>
<x-app></x-app>
<script src="build.js"></script>
```

```js
Polymer("x-dep");Polymer("x-app");
```

[![Analytics](https://ga-beacon.appspot.com/UA-39334307-2/Polymer/vulcanize/README)](https://github.com/igrigorik/ga-beacon)
