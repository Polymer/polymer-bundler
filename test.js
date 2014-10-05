/**
 * A small battery of vulcanize tests, to make sure it can deal
 * with a variety of arguments being supplied or implied.
 */

var vulcan = require('./lib/vulcan.js');
var fs = require('fs');
var fail = function(err) {
  console.error(err);
  process.exit(1);
};

process.chdir('test');
var data = fs.readFileSync('./import-test.html').toString();


try { vulcan.process("lol"); process.exit(1); }
catch (e) {
  // this is supposed to throw an Error, never
  // reaching process.exit - continue the run.
}

vulcan.process(function(err,data) {
  // there should be an error here
  if (!err) {
    fail("Error: process was successfully called without any form of input. This should not happen.");
  }
});

vulcan.process("this", { input: "that.html" }, function(err,data) {
  // there should be an error here
  if (!err) {
    fail("Error: process was successfully called with both forms of input. This should not happen.");
  }
});

vulcan.process(data, {input: "import-test.html", stdio: true}, function(err, data) {
  if(!err) {
    fail("Error: process was successfully called with both forms of input. This should not happen.");
  }
});

vulcan.process(data, function(err, data) {
  if(err) {
    fail(err);
  }
});

vulcan.process({input: "import-test.html", stdio: true}, function(err, data) {
  if(err) {
    fail(err);
  }
});

vulcan.process({input: "import-test.html"}, function(err, data) {
  try {
    fs.readFileSync("vulcanized.html");
    fs.unlinkSync("vulcanized.html");
  } catch (e) {
    fail("No vulcanized.html file was written despite options.stdio not being set.");
  }
});

console.log("All tests succeeded.");
