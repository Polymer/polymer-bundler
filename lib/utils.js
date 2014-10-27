/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */
var path = require('path');

module.exports = {
  // directly update the textnode child of <style>
  // equivalent to <style>.textContent
  setTextContent: function(node, text) {
    var unwrapped = node.get(0);
    var child = unwrapped.children[0];
    if (child) {
      child.data = text;
    } else {
      unwrapped.children[0] = {
        data: text,
        type: 'text',
        next: null,
        prev: null,
        parent: unwrapped
      };
    }
  },
  getTextContent: function(node) {
    var unwrapped = node.get(0);
    var child = unwrapped.children[0];
    return child ? child.data : '';
  },
  // escape a string to be used in new RegExp
  escapeForRegExp: function(s) {
    return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  },
  unixPath: function(inpath, optSep) {
    var sep = optSep || path.sep;
    if (sep !== '/') {
      inpath = inpath.split(sep).join('/');
    }
    return inpath;
  },
  processPolymerInvocation: function(elementName, invocation) {
    var name = invocation[1] || '';
    var split = invocation[2] || '';
    var trailing = invocation[3];
    var nameIsString = /^['"]/.test(name);
    if (!split) {
      // assume "name" is actually the prototype if it is not a string literal
      if (!name || (name && !nameIsString)) {
        trailing = name + trailing;
        name = '\'' + elementName + '\'';
      }
      if (trailing !== ')') {
        split = ',';
      }
    }
    return 'Polymer(' + name + split + trailing;
  }
};
