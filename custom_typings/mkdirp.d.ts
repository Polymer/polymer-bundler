declare module 'mkdirp' {
  function mkdirp(args: any)
      : string;
  module mkdirp {
    function sync(dir: string, opts?: {}): void;
  }
  export = mkdirp;
}
