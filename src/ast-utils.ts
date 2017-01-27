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
import {ASTNode, treeAdapters} from 'parse5';

import * as matchers from './matchers';

/**
 * Move the `node` to be the immediate sibling after the `target` node.
 * TODO(usergenic): Migrate this code to polymer/dom5
 */
export function insertAfter(target: ASTNode, node: ASTNode) {
  dom5.remove(node);
  const index = target.parentNode!.childNodes!.indexOf(target);
  target.parentNode!.childNodes!.splice(index + 1, 0, node);
  node.parentNode = target.parentNode!;
}

/**
 * Move the entire collection of nodes to be the immediate sibling before the
 * `after` node.
 */
export function insertAllBefore(
    target: ASTNode, after: ASTNode, nodes: ASTNode[]) {
  let lastNode = after;
  for (let n = nodes.length - 1; n >= 0; n--) {
    const node = nodes[n];
    dom5.insertBefore(target, lastNode, node);
    lastNode = node;
  }
}

/**
 * Return true if node is a text node that is empty or consists only of white
 * space.
 */
export function isBlankTextNode(node: ASTNode): boolean {
  return node && dom5.isTextNode(node) &&
      dom5.getTextContent(node).trim() === '';
}

/**
 * Return true if node is a comment node consisting of a license (annotated by
 * the `@license` string.)
 */
export function isLicenseComment(node: ASTNode): boolean {
  if (dom5.isCommentNode(node)) {
    return dom5.getTextContent(node).indexOf('@license') > -1;
  }
  return false;
}

/**
 * Inserts the node as the first child of the parent.
 * TODO(usergenic): Migrate this code to polymer/dom5
 */
export function prepend(parent: ASTNode, node: ASTNode) {
  if (parent.childNodes && parent.childNodes.length) {
    dom5.insertBefore(parent, parent.childNodes[0], node);
  } else {
    dom5.append(parent, node);
  }
}

/**
 * Find content inside all <template> tags that descend from `node`.
 * If `noRecursion` is true, no results will be returned from nested templates.
 * Will not match elements outside of <template>.
 */
export function querySelectorAllTemplates(
    node: ASTNode, predicate: dom5.Predicate, noRecursion?: boolean):
    ASTNode[] {
  let results: ASTNode[] = [];
  const templates = dom5.queryAll(node, matchers.template);
  for (const template of templates) {
    const content = treeAdapters.default.getTemplateContent(template);
    results = results.concat(dom5.queryAll(content, predicate));
    if (noRecursion) {
      continue;
    }
    results = results.concat(querySelectorAllTemplates(content, predicate));
  }
  return results;
}

/**
 * The results of `queryAll` combined with `querySelectorAllTemplates`.
 */
export function querySelectorAllWithTemplates(
    node: ASTNode, predicate: dom5.Predicate, noRecursion?: boolean):
    ASTNode[] {
  let results = dom5.queryAll(node, predicate);
  results =
      results.concat(querySelectorAllTemplates(node, predicate, noRecursion));
  return results;
}

/**
 * Removes an AST Node and the whitespace-only text node following it, if
 * present.
 */
export function removeElementAndNewline(node: ASTNode, replacement?: ASTNode) {
  const siblings = Array.from(node.parentNode!.childNodes!);
  let nextIdx = siblings.indexOf(node) + 1;
  let next = siblings[nextIdx];
  while (next && isBlankTextNode(next)) {
    dom5.remove(next);
    next = siblings[++nextIdx];
  }
  if (replacement) {
    dom5.replace(node, replacement);
  } else {
    dom5.remove(node);
  }
}

/**
 * Return all sibling nodes following node.
 */
export function siblingsAfter(node: ASTNode): ASTNode[] {
  const siblings: ASTNode[] = Array.from(node.parentNode!.childNodes!);
  return siblings.slice(siblings.indexOf(node) + 1);
}

/**
 * Find all comment nodes in the document, removing them from the document
 * if they are note license comments, and if they are license comments,
 * deduplicate them and prepend them in document's head.
 */
export function stripComments(document: ASTNode) {
  // Use of a Map keyed by comment text enables deduplication.
  const comments: Map<string, ASTNode> = new Map();
  dom5.nodeWalkAll(document, dom5.isCommentNode).forEach((comment: ASTNode) => {
    comments.set(comment.data || '', comment);
    removeElementAndNewline(comment);
  });
  const head = dom5.query(document, matchers.head);
  for (const comment of comments.values()) {
    if (isLicenseComment(comment)) {
      prepend(head || document, comment);
    }
  }
}
