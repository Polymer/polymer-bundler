/**
 * A small battery of vulcanize tests, to make sure it can deal
 * with a variety of arguments being supplied or implied.
 */

var vulcan = require('./lib/vulcan.js');
var fs = require('fs');
process.chdir('test');
var data = fs.readFileSync('./import-test.html').toString();

try { vulcan.process("lol"); process.exit(1); }
catch (e) {
  // this is supposed to throw an Error
}

vulcan.process(function(err,data) {
  // there should be an error here
  if (!err) {
    console.error("Error: process was successfully called without any form of input. This should not happen.");
    process.exit(1);
  }
});

vulcan.process("this", { input: "that.html" }, function(err,data) {
  // there should be an error here
  if (!err) {
    console.error("Error: process was successfully called with both forms of input. This should not happen.");
    process.exit(1);
  }
});

vulcan.process(data, {input: "import-test.html", stdio: true}, function(err, data) {
  if(!err) {
    console.error("Error: process was successfully called with both forms of input. This should not happen.");
    process.exit(1);
  }
});

vulcan.process(data, function(err, data) {
  if(err) {
    console.error(err);
    process.exit(1);
  }
});

vulcan.process({input: "import-test.html", stdio: true}, function(err, data) {
  if(err) {
    console.error(err);
    process.exit(1);
  }
});

vulcan.process({input: "import-test.html"}, function(err, data) {
  try {
    fs.readFileSync("vulcanized.html");
    fs.unlinkSync("vulcanized.html");
  } catch (e) {
    console.error("No vulcanized.html file was written despite options.stdio not being set.");
    process.exit(1);
  }
});

console.log("All tests succeeded.");
