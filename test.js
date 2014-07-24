/**
 * Simple stdio vulcanize test. Loads the import test
 * file and tries to fully resolve it. If this fails,
 * the process will exit with a non-zero error code.
 */
var vulcan = require('./lib/vulcan.js');
var fs = require('fs');
process.chdir('test');
var data = fs.readFileSync('./import-test.html').toString();
vulcan.process(data, function(err, data) {
	if(err) {
		console.error(err);
		process.exit(1);
	}
	console.log(data);
});
