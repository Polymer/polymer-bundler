/**
 * @license
 * Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
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
import generate from 'babel-generator';
import {GeneratorResult} from 'babel-generator';
import traverse from 'babel-traverse';
import {NodePath} from 'babel-traverse';
import * as babel from 'babel-types';
import * as babylon from 'babylon';

/**
 * Within the `root` of the babel AST, find and returns a NodePath of the
 * given `node`.  Returns `undefined` if node not found within `root`.
 */
export function getNodePath(root: babel.Node, node: babel.Node): NodePath|
    undefined {
  let nodepath;
  traverse(root, {
    noScope: true,
    enter(path: NodePath) {
      if (path.node === node) {
        nodepath = path;
        path.stop();
      }
    }
  });
  return nodepath;
}

/**
 * Parse the module with babylon and return a babel.Node
 */
export function parseModuleFile(url: string, code: string): babel.File {
  return babylon.parse(code, {
    sourceFilename: url,
    sourceType: 'module',
    plugins: [
      'asyncGenerators',
      'dynamicImport',
      // 'importMeta', // not yet in the @types file
      'objectRestSpread',
    ],
  });
}

/**
 * Performs an in-place rewrite of a target node's properties from a given
 * replacement node.  This is useful because there are some transformations
 * of the AST which simply require replacing a node, but it is not always
 * convenient to obtain the specific parent node property to which a node may be
 * attached out of many possible configurations.
 */
export function rewriteNode(target: babel.Node, replacement: babel.Node) {
  // Strip all properties from target
  for (const key in target) {
    if (target.hasOwnProperty(key)) {
      delete target[key];
    }
  }
  // Transfer remaining properties from replacement
  for (const key in replacement) {
    if (replacement.hasOwnProperty(key)) {
      target[key] = replacement[key];
    }
  }
}

/**
 * Convenience wrapper for generating source text from the babel AST node.
 */
export function serialize(root: babel.Node): GeneratorResult {
  return generate(root, {quotes: 'single'});
}
