/**
 * This file exists to satisfy a TypeScript check that otherwise reports this
 * error, even though we don't actually use the watch option for rollup.
 *
 * node_modules/rollup/dist/typings/watch/index.d.ts:4:30 - error TS7016: Could
 * not find a declaration file for module 'chokidar'.
 * './node_modules/chokidar/index.js'* implicitly has an 'any' type.
 * Try `npm install @types/chokidar` if it exists or add a new declaration
 * (.d.ts) file containing `declare module 'chokidar';` 4 import { WatchOptions
 * } from 'chokidar';
 */
declare module 'chokidar' {
  interface WatchOptions {}
  export {WatchOptions};
}
