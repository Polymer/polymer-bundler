import * as shared from './shared-module.js';
export function doSomething(value) {
  shared.doSomething('b(' + value + ')');
}
