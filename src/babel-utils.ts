import traverse from 'babel-traverse';
import {NodePath} from 'babel-traverse';
import * as babel from 'babel-types';

export function getParent(root: babel.Node, node: babel.Node): babel.Node|
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
