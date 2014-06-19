// ## Dependencies
var vulcanize = require('./lib/vulcanize');
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
    var fileDefaults = {
      file: file,
      outputDir: '/'
    };
    var fileOptions = deco.merge(fileDefaults, options);
    var out = new File({
      cwd: file.cwd,
      base: file.base,
      path: file.path
      contents: new Buffer(vulcanize.processDocument(fileOptions))
    });
    callback(null, out);
  });
};
