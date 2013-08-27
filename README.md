# Vulcan

### Concatenate a set of Web Components into one file

>Named for the [Vulcanization](http://en.wikipedia.org/wiki/Vulcanization) process that turns polymers into more durable
materials.

## Getting Started
- Install the node dependencies with `npm install`
  - Depends on [cheerio](https://github.com/MatthewMueller/cheerio) and [nopt](https://github.com/isaacs/nopt)
- Give a main input html file with the `--input` or `-i` flags and output file name with the `--output` or `-o` flags.
  - Example: `node vulcan.js -i index.html -o build.html`
  - Defaults to `output.html`
- URL paths are adjusted for the new output location automatically (execpt ones set in Javascript)
- When finished, `index-vulcanized.js` will be placed in the output location
  with the vulcanized imports and scripts included.

## Example

Say we have three html files: `index.html`, `x-app.html`, and `x-dep.html`.

index.html:

```html
<!DOCTYPE html>
<link rel="import" href="app.html">
<x-app></x-app>
```

app.html:

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

    node vulcan.js -i index.html -o build.html

Will result in `build.html` that appears as so:

```html
<polymer-element name="x-dep" assetpath="path/to/">
  <template>
    <img src="path/to/x-dep-icon.jpg">
  </template>
  <script>
    Polymer('x-dep');
  </script>
</polymer-element>
<polymer-element name="x-app" assetpath="">
  <template>
    <x-dep></x-dep>
  </template>
  <script>
    Polymer('x-app');
  </script>
</polymer-element>
```

And an `index-vulcanized.html` file that includes `build.html` as the only import:

```html
<!DOCTYPE html>
<link rel="import" href="build.html">
<x-app></x-app>
```

## Content Security Policy
[Content Security Policy](http://en.wikipedia.org/wiki/Content_Security_Policy), or CSP, is a Javascript security model
that aims to prevent XSS and other attacks. In so doing, it prohibits the use of inline scripts.

To help automate the use of Polymer element registration with CSP, the `--csp` flag to vulcan will remove all scripts
from the HTML Imports and place their contents into an output javascript file.

Using the previous example, the output from `node vulcan.js --csp -i index.html -o build.html` will be

build.html:
```html
<polymer-element name="x-dep" assetpath="path/to/">
  <template>
    <img src="path/to/x-dep-icon.jpg">
  </template>
</polymer-element>
<polymer-element name="x-app" assetpath="">
  <template>
    <x-dep></x-dep>
  </template>
</polymer-element>
```

build.js:
```js
Polymer('x-dep');
Polymer('x-app');
```

index-vulcanized.html:
```html
<!DOCTYPE html>
<link rel="import" href="build.html">
<script src="build.js"></script>
```
