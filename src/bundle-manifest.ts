/**
 * A bundle is a grouping of files which serve the need of one or more
 * entrypoint files.
 */
export interface IBundle {
  entrypoints: Set<URL>;
  files: Set<URL>;
}

/**
 * A bundle strategy function is used to transform an array of bundles.
 */
export type IBundleStrategy = (bundles: IBundle[]) => IBundle[];

/**
 * A mapping of URLs to their full set of transitive dependencies, such that
 * `a->b, b->c, b->d, e->f` would be represented `{a:[b,c,d], e:[f]}`
 */
export type IFileTransDepsIndex = Map<URL, Set<URL>>;

/**
 * Defining this URL type to make it clear which strings represent URLs.
 */
export type URL = string;

/**
 * Standard implementation of IBundle.
 */
export class Bundle implements IBundle {
  public entrypoints: Set<URL>;
  public files: Set<URL>;
  constructor(entrypoints?: Set<URL>, files?: Set<URL>) {
    this.entrypoints = entrypoints || new Set<URL>();
    this.files = files || new Set<URL>();
  }
}

/**
 * Given an index of files and their dependencies, produce an array of bundles,
 * where a bundle is defined for each set of dependencies.
 *
 * For example, a dependency index representing the graph:
 *   `a->b, b->c, b->d, e->c, e->f`
 *
 * Would produce an array of three bundles:
 *   `[a]->[b,d], [e]->[f], [a,e]->[c]`
 */
export function generateBundles(depsIndex: IFileTransDepsIndex): IBundle[] {
  const bundles: IBundle[] = [];
  const invertedIndex = invertFileTransDepsIndex(depsIndex);

  for (let [dep, entrypoints] of invertedIndex.entries()) {
    const entrypointsArray = Array.from(entrypoints);
    let bundle = bundles.find((bundle) => {
      return bundle.entrypoints.size === entrypoints.size &&
          entrypointsArray.every((e) => bundle.entrypoints.has(e));
    });
    if (!bundle) {
      bundle = new Bundle(entrypoints);
      bundles.push(bundle);
    }
    bundle.files.add(dep);
  }
  return bundles;
}

/**
 * Generates a strategy function to merge all bundles where the dependencies
 * for a bundle are shared by at least 2 entrypoints (default; set
 * `minEntrypoints` to change threshold).
 *
 * This function will convert an array of 4 bundles:
 *   `[a]->[b], [a,c]->[d], [c]->[e], [f,g]->[h]`
 *
 * Into the following 3 bundles, including a single bundle for all of the
 * dependencies which are shared by at least 2 entrypoints:
 *   `[a]->[b], [c]->[e], [a,c,f,g]->[d,h]`
 */
export function generateSharedDepsMergeStrategy(minEntrypoints: number):
    IBundleStrategy {
  return (bundles: IBundle[]): IBundle[] => {
    const newBundles: IBundle[] = [];
    let sharedBundle: Bundle|undefined;
    bundles.forEach((bundle) => {
      if (bundle.entrypoints.size >= minEntrypoints) {
        sharedBundle =
            sharedBundle ? mergeBundles([sharedBundle, bundle]) : bundle;
      } else {
        const newBundle = new Bundle();
        bundle.entrypoints.forEach((e) => newBundle.entrypoints.add(e));
        bundle.files.forEach((f) => newBundle.files.add(f));
        newBundles.push(newBundle);
      }
    });
    if (sharedBundle) {
      newBundles.push(sharedBundle);
    }
    return newBundles;
  };
}

/**
 * A bundle strategy function which merges all shared dependencies into a
 * bundle for an application shell.
 */
export function generateShellMergeStrategy(shell: URL): IBundleStrategy {
  return (bundles: IBundle[]): IBundle[] => {
    const newBundles = singleSharedDepsStrategy(bundles);
    const shellBundle = newBundles.find((bundle) => bundle.files.has(shell));
    const sharedBundle =
        newBundles.find((bundle) => bundle.entrypoints.size > 1);
    if (shellBundle && sharedBundle && shellBundle !== sharedBundle) {
      newBundles.splice(newBundles.indexOf(shellBundle), 1);
      newBundles.splice(newBundles.indexOf(sharedBundle), 1);
      newBundles.push(mergeBundles([shellBundle, sharedBundle]));
    }
    return newBundles;
  };
}

/**
 * Returns an inverted FileTransDepsIndex where the keys are the dependencies
 * and the values are the set of files which are dependent on them.
 * `{a:[b,c], d:[b,e]}` becomes `{a:[a], b:[a,b,d], c:[a], d:[d], e:[d]}`.
 */
export function invertFileTransDepsIndex(depsIndex: IFileTransDepsIndex):
    IFileTransDepsIndex {
  const invertedIndex = new Map<URL, Set<URL>>();

  for (let [entrypoint, deps] of depsIndex.entries()) {
    [entrypoint].concat(Array.from(deps)).forEach((dep) => {
      if (!invertedIndex.has(dep)) {
        invertedIndex.set(dep, new Set<URL>());
      }
      invertedIndex.get(dep)!.add(entrypoint);
    });
  }

  return invertedIndex;
}

/**
 * Given an Array of bundles, produce a single bundle with the entrypoints and
 * files of all bundles represented.
 */
export function mergeBundles(bundles: IBundle[]): IBundle {
  const newBundle = new Bundle();
  bundles.forEach((bundle) => {
    bundle.entrypoints.forEach((url) => newBundle.entrypoints.add(url));
    bundle.files.forEach((url) => newBundle.files.add(url));
  });
  return newBundle;
}

/**
 * A bundle strategy function which merges all bundles containing shared
 * dependencies into a single bundle.
 */
export const singleSharedDepsStrategy: IBundleStrategy =
    generateSharedDepsMergeStrategy(2);
