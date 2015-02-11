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

function CommentMap() {
  this.commentMap = Object.create(null);
}

CommentMap.prototype = {
  has: function(comment) {
    var c = this.normalize(comment);
    return !!this.commentMap[c];
  },
  set: function(comment) {
    var c = this.normalize(comment);
    this.commentMap[c] = 1;
  },
  normalize: function (comment) {
    var c = comment;
    // remove leading slashes
    c = c.replace(/^\/*/, '');
    // remove leading stars
    c = c.replace(/^\s*[*]*/gm, '');
    // remove trailing stars and slash
    c = c.replace(/[*]*\s*\/?$/, '');
    // remove all whitespace
    c = c.replace(/\s/g, '');
    return c;
  }
};

module.exports = CommentMap;
