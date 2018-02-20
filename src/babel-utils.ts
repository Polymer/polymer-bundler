import generate from 'babel-generator';
import traverse from 'babel-traverse';
import {NodePath} from 'babel-traverse';
import * as babel from 'babel-types';
import * as babylon from 'babylon';

/**
 * Within the `root` of the babel AST, find and returns the parent node of the
 * given `node`.  Returns `undefined` if no parent found within `root`.
 */
export function getParentNode(root: babel.Node, node: babel.Node): babel.Node|
    undefined {
  let parent;
  traverse(root, {
    noScope: true,
    enter(path: NodePath) {
      if (path.node === node) {
        parent = path.parent;
        path.stop();
      }
    }
  });
  return parent;
}

/**
 * Parse the module with babylon and return a babel.Node
 */
// export function parseModuleFile(url: string, code: string): babel.File {
//   return babylon.parse(code, {
//     sourceFilename: url,
//     sourceType: 'module',
//     plugins: [
//       'asyncGenerators',
//       'dynamicImport',
//       // 'importMeta', // not yet in the @types file
//       'objectRestSpread',
//     ],
//   });
// }

export function serialize(root: babel.Node): string {
  return generate(root, {quotes: 'single'}).code;
}
