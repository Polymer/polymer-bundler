/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

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
  }
};
