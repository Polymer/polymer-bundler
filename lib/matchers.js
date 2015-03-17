/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

// jshint node: true
'use strict';

var constants = require('./constants.js');
var p = require('dom5').predicates;

var urlAttrMatchers = constants.URL_ATTR.map(function(attr) {
  return p.hasAttr(attr);
});

var urlAttrs = p.OR.apply(null, urlAttrMatchers);

var jsMatcher = p.AND(
  p.hasTagName('script'),
  p.OR(
    p.NOT(
      p.hasAttr('type')
    ),
    p.hasAttrValue('type', 'text/javascript')
  )
);

var styleMatcher = p.AND(
  p.hasTagName('style'),
  p.OR(
    p.NOT(
      p.hasAttr('type')
    ),
    p.hasAttrValue('type', 'text/css')
  )
);

module.exports = {
  head: p.hasTagName('head'),
  body: p.hasTagName('body'),
  domModule: p.AND(
    p.hasTagName('dom-module'),
    p.hasAttr('id'),
    p.NOT(
      p.hasAttr('assetpath')
    )
  ),
  urlAttrs: urlAttrs,
  JS: jsMatcher,
  CSS: styleMatcher,
  JS_SRC: p.AND(p.hasAttr('src'), jsMatcher),
  JS_INLINE: p.AND(p.NOT(p.hasAttr('src')), jsMatcher),
  commentOrEmptyText: function(node) {
    if (node.nodeName === '#text') {
      return !/\S/.test(node.value);
    }
    if (node.nodeName === '#comment') {
      return true;
    }
    return false;
  }

};
