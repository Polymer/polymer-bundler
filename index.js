// ## Dependencies
var vulcanize = require('./lib/vulcan');
var File = require('vinyl');
var deco = require('deco');
var es = require('event-stream');
// ## Module Definition
var plugin = module.exports = function (options) {
  var defaults = {
    excludes: {
      imports: []
    }
  };

  options = deco.merge(defaults, options);

  return es.map(function (file, callback) {
    if (file.isNull()) return callback(null, file);

    var fileDefaults = {
      file: file,
      outputDir: '/'
    };
    var fileOptions = deco.merge(fileDefaults, options);
    var imported;
    try {
      imported = vulcanize.processDocument(fileOptions)
    }
    catch (exception) {
      return callback(exception);
    }
    
    var out = new File({
      cwd: file.cwd,
      base: file.base,
      path: file.path,
      contents: new Buffer(imported)
    });
    callback(null, out);
  });
};
