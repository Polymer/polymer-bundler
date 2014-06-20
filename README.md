# Spock

### A gulp task to concatenate a set of Web Components into one file.  A 
preprocessor for `<link rel="import">`.

>Named for the [Vulcanization](http://en.wikipedia.org/wiki/Vulcanization) process that turns polymers into more durable
materials.

## Installation

`spock` is available on npm. For maximium utility, `spock` should be installed globally.

    npm install --save-dev spock


## Options

 - verbose
   - Enable more verbose logging
 - outputDir
   - Required for correctly setting links (for now)

## Example Usage

Gulp task:

```javascript
gulp.task('build-html', function () {
  gulp.src('./*.html').pipe(spock({
    verbose: true,
    outputDir: './build'
  })).pipe(gulp.dest('./build'));
});
```

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

Running spock on `index.html` will result in an output file that
appears as so:

```html
<!DOCTYPE html>
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
<x-app></x-app>
```
