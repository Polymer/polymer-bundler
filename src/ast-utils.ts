/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import * as dom5 from 'dom5';
import {ASTNode} from 'parse5';

export default class ASTUtils {
  static prepend(parent, node) {
    if (parent.childNodes && parent.childNodes.length) {
      dom5.insertBefore(parent, parent.childNodes[0], node);
    } else {
      dom5.append(parent, node);
    }
  }

  static prependMultiple(target, nodes: ASTNode[]) {
    let moveIndex = nodes.length - 1;
    while (moveIndex >= 0) {
      const nodeToMove = nodes[moveIndex];
      dom5.remove(nodeToMove);
      ASTUtils.prepend(target, nodeToMove);
      moveIndex--;
    }
  }

  /**
   * Move node and its subsequent siblings to target.
   */
  static moveRemainderToTarget(node: ASTNode, target: ASTNode) {
    const siblings: Array<ASTNode> = node.parentNode.childNodes;
    const importIndex = siblings.indexOf(node);
    const nodesToMove = siblings.slice(importIndex);
    ASTUtils.prependMultiple(target, nodesToMove);
  }
}
