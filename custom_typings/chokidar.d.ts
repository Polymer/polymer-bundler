/**
 * This file exists to satisfy a TypeScript check that otherwise reports this
 * error, even though we don't actually use the watch option for rollup.
 */
declare module 'chokidar' {
  interface WatchOptions {}
  export {WatchOptions};
}
