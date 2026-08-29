// Dev-only helper: load Forefront's browser scripts into Node for testing.
// The app itself never uses this. Node is not required to run Forefront.
'use strict';
const path = require('path');
const root = path.join(__dirname, '..');

global.window = global;
if (!global.crypto) global.crypto = require('crypto').webcrypto;

require(path.join(root, 'js', 'constants.js'));
require(path.join(root, 'js', 'changelog.js'));
require(path.join(root, 'js', 'model.js'));

module.exports = { FF: global.window.FF, root };
