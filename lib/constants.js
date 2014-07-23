/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

var JS = 'script:not([type]), script[type="text/javascript"]';
var URL_ATTR = ['href', 'src', 'action', 'style'];

module.exports = {
  EOL: require('os').EOL,
  ELEMENTS: 'polymer-element:not([assetpath])',
  ELEMENTS_NOSCRIPT: 'polymer-element[noscript]',
  ABS_URL: /(^data:)|(^http[s]?:)|(^\/)/,
  IMPORTS: 'link[rel="import"][href]',
  URL: /url\([^)]*\)/g,
  URL_ATTR: URL_ATTR,
  URL_ATTR_SEL: '[' + URL_ATTR.join('],[') + ']',
  URL_TEMPLATE: '{{.*}}',
  JS: JS,
  JS_SRC: JS.split(',').map(function(s){ return s + '[src]'; }).join(','),
  JS_INLINE: JS.split(',').map(function(s) { return s + ':not([src])'; }).join(','),
  CSS: 'style:not([type]), style[type="text/css"]',
  // Output match is [ 'Polymer(', NAME_OF_ELEMENT OR undefined, '{' OR ')' ]
  POLYMER_INVOCATION: /Polymer\(([^,{]+)?(?:,\s*)?({|\))/
};
