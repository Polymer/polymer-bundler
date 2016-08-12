/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */
class CommentMap {
  constructor() {
    this.commentMap = Object.create(null);
  }

  get(comment) {
    return this.commentMap[comment];
  }

  set(comment, value) {
    this.commentMap[comment] = value;
  }

  keys() {
    return Object.keys(this.commentMap);
  }
}

module.exports = CommentMap;
