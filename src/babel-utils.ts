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
 *
 * TODO(usergenic): Normalize list of plugins by using a babel preset or
 * delegate only to Analyzer.
 * https://github.com/Polymer/polymer-bundler/issues/646
 */
export function parseModuleFile(url: string, code: string): babel.File {
  return babylon.parse(code, {
    sourceFilename: url,
    sourceType: 'module',
    plugins: [
      'asyncGenerators',
      'dynamicImport',
      'importMeta' as any,  // not yet in the @types file
      'objectRestSpread',
    ],
  });
}

/**
 * Convenience wrapper for generating source text from the babel AST node.
 */
export function serialize(root: babel.Node): GeneratorResult {
  return generate(root, {quotes: 'single'});
}
