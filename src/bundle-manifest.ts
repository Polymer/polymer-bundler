/**
 * A bundle strategy function is used to transform an array of bundles.
 */
export type BundleStrategy = (bundles: Bundle[]) => Bundle[];
export type BundleUrlMapper = (bundles: Bundle[]) => Map<UrlString, Bundle>;

/**
 * A mapping of entrypoints to their full set of transitive dependencies,
 * such that a dependency graph `a->c, c->d, d->e, b->d, b->f` would be
 * represented `{a:[a,c,d,e], b:[b,d,e,f]}`.  Please note that there is an
 * explicit identity dependency (`a` depends on `a`, `b` depends on `b`).
 */
export type TransitiveDependenciesMap = Map<UrlString, Set<UrlString>>;

/**
 * Defining this URL type to make it clear which strings represent URLs.
 */
export type UrlString = string;

/**
 * A bundle is a grouping of files which serve the need of one or more
 * entrypoint files.
 */
export class Bundle {
  // Set of all dependant entrypoint urls of this bundle.
  entrypoints: Set<UrlString>;

  // Set of all files included in the bundle.
  files: Set<UrlString>;

  constructor(entrypoints?: Set<UrlString>, files?: Set<UrlString>) {
    this.entrypoints = entrypoints || new Set<UrlString>();
    this.files = files || new Set<UrlString>();
  }
}

/**
 * Represents a bundle assigned to an output URL.
 */
export class AssignedBundle {
  bundle: Bundle;
  url: UrlString;
}

/**
 * A bundle manifest is a mapping of urls to bundles.
 */
export class BundleManifest {
  // Map of bundle url to bundle.
  bundles: Map<UrlString, Bundle>;

  // Map of file url to bundle url.
  bundleUrlForFile: Map<UrlString, UrlString>;

  /**
   * Given a collection of bundles and a BundleUrlMapper to generate urls for
   * them, the constructor populates the `bundles` and `files` index properties.
   */
  constructor(bundles: Bundle[], urlMapper: BundleUrlMapper) {
    this.bundles = urlMapper(Array.from(bundles));
    this.bundleUrlForFile = new Map();

    for (const bundleMapEntry of this.bundles) {
      const bundleUrl = bundleMapEntry[0];
      const bundle = bundleMapEntry[1];
      for (const fileUrl of bundle.files) {
        console.assert(!this.bundleUrlForFile.has(fileUrl));
        this.bundleUrlForFile.set(fileUrl, bundleUrl);
      }
    }
  }

  // Convenience method to return a bundle for a constituent file url.
  getBundleForFile(url: UrlString): AssignedBundle|undefined {
    const bundleUrl = this.bundleUrlForFile.get(url);
    if (bundleUrl) {
      return {bundle: this.bundles.get(bundleUrl)!, url: bundleUrl};
    }
  }
}

/**
 * Returns true if both sets contain exactly the same items.  This check is
 * order-independent.
 */
function setEquals(set1: Set<any>, set2: Set<any>): boolean {
  if (set1.size !== set2.size) {
    return false;
  }
  for (const item of set1) {
    if (!set2.has(item)) {
      return false;
    }
  }
  return true;
}

/**
 * Given an index of files and their dependencies, produce an array of bundles,
 * where a bundle is defined for each set of dependencies.
 *
 * For example, a dependency index representing the graph:
 *   `a->b, b->c, b->d, e->c, e->f`
 *
 * Would produce an array of three bundles:
 *   `[a]->[a,b,d], [e]->[e,f], [a,e]->[c]`
 */
export function generateBundles(depsIndex: TransitiveDependenciesMap):
    Bundle[] {
  const bundles: Bundle[] = [];

  const prunedDepsIndex: TransitiveDependenciesMap =
      pruneTransitiveDependenciesMap(depsIndex);

  // TODO(usergenic): Assert a valid transitive dependencies map; i.e.
  // entrypoints should include themselves as dependencies.
  const invertedIndex = invertMultimap(prunedDepsIndex);

  for (const entry of invertedIndex.entries()) {
    const dep: UrlString = entry[0];
    const entrypoints: Set<UrlString> = entry[1];
    const entrypointsArray = Array.from(entrypoints);

    // Find the bundle defined by the specific set of shared dependant
    // entrypoints.
    let bundle =
        bundles.find((bundle) => setEquals(entrypoints, bundle.entrypoints));
    if (!bundle) {
      bundle = new Bundle(entrypoints);
      bundles.push(bundle);
    }
    bundle.files.add(dep);
  }


  return bundles;
}

/**
 * Create a version of the dependency map where no entrypoint A contains
 * another entrypoint B as a dependency.  If we encounter an A that does
 * contain a B, we remove B and all of its transitive dependencies from
 * A's dependencies.
 */
export function pruneTransitiveDependenciesMap(
    depsIndex: TransitiveDependenciesMap): TransitiveDependenciesMap {
  const prunedDepsIndex: TransitiveDependenciesMap = new Map();
  for (const entry of depsIndex) {
    const entrypoint: UrlString = entry[0];
    const deps: Set<UrlString> = entry[1];
    const prunedDeps: Set<UrlString> = new Set(deps);
    prunedDepsIndex.set(entrypoint, prunedDeps);
    for (const dep of deps) {
      // Ignore current entrypoint which is a dependency of itself.
      if (dep === entrypoint) {
        continue;
      }
      const otherEntrypointDeps = depsIndex.get(dep);
      // Skip if dependency is not another entrypoint.
      if (!otherEntrypointDeps) {
        continue;
      }
      // If there is a circular dependency, we'll only remove the other
      // entrypoint from the current entrypoints dependencies.
      if (otherEntrypointDeps.has(entrypoint)) {
        prunedDeps.delete(dep);
        continue;
      }
      // When there is no circular dependency, remove the other entrypoint and
      // all of its dependencies from current entrypoint's dependencies.
      for (const otherDep of otherEntrypointDeps) {
        prunedDeps.delete(otherDep);
      }
    }
  }
  return prunedDepsIndex;
}

/**
 * Generates a strategy function to merge all bundles where the dependencies
 * for a bundle are shared by at least 2 entrypoints (default; set
 * `minEntrypoints` to change threshold).
 *
 * This function will convert an array of 4 bundles:
 *   `[a]->[a,b], [a,c]->[d], [c]->[c,e], [f,g]->[f,g,h]`
 *
 * Into the following 3 bundles, including a single bundle for all of the
 * dependencies which are shared by at least 2 entrypoints:
 *   `[a]->[a,b], [c]->[c,e], [a,c,f,g]->[d,f,g,h]`
 */
export function generateSharedDepsMergeStrategy(minEntrypoints: number):
    BundleStrategy {
  return (bundles: Bundle[]): Bundle[] => {
    const newBundles: Bundle[] = [];
    const sharedBundles: Bundle[] = [];
    for (const bundle of bundles) {
      if (bundle.entrypoints.size >= minEntrypoints) {
        sharedBundles.push(bundle);
      } else {
        newBundles.push(
            new Bundle(new Set(bundle.entrypoints), new Set(bundle.files)));
      }
    }
    if (sharedBundles.length > 0) {
      newBundles.push(mergeBundles(sharedBundles));
    }
    return newBundles;
  };
}

/**
 * A bundle strategy function which merges all shared dependencies into a
 * bundle for an application shell.
 */
export function generateShellMergeStrategy(
    shell: UrlString, minEntrypoints: number): BundleStrategy {
  return (bundles: Bundle[]): Bundle[] => {
    const newBundles = generateSharedDepsMergeStrategy(minEntrypoints)(bundles);
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
 * Inverts a map of collections such that  `{a:[c,d], b:[c,e]}` would become
 * `{c:[a,b], d:[a], e:[b]}`.
 */
export function invertMultimap(multimap: Map<any, Set<any>>):
    Map<any, Set<any>> {
  const inverted = new Map<any, Set<any>>();

  for (const entry of multimap.entries()) {
    const value = entry[0], keys = entry[1];
    for (const key of keys) {
      const set = inverted.get(key) || new Set();
      set.add(value);
      inverted.set(key, set);
    }
  }

  return inverted;
}

/**
 * Given an Array of bundles, produce a single bundle with the entrypoints and
 * files of all bundles represented.
 */
export function mergeBundles(bundles: Bundle[]): Bundle {
  const newBundle = new Bundle();
  for (const bundle of bundles) {
    for (const url of bundle.entrypoints) {
      newBundle.entrypoints.add(url);
    }
    for (const url of bundle.files) {
      newBundle.files.add(url);
    }
  }
  return newBundle;
}

/**
 * A simple function for generating shared bundle names based on a counter.
 */
export function sharedBundleUrlMapper(bundles: Bundle[]):
    Map<UrlString, Bundle> {
  let counter = 0;
  const urlMap = new Map<UrlString, Bundle>();
  for (const bundle of bundles) {
    if (bundle.entrypoints.size === 1) {
      urlMap.set(Array.from(bundle.entrypoints)[0], bundle);
    } else {
      urlMap.set(`shared_bundle_${++counter}.html`, bundle);
    }
  }
  return urlMap;
}

/**
 * Compute the intersection of all of the passed `sets`.
 * See: https://en.wikipedia.org/wiki/Intersection_(set_theory)
 */
function setIntersection<T>(sets: Set<T>[]): Set<T> {
  return sets.reduce((previous, current) => {
    const reduced = new Set<T>();
    for (const entry of previous) {
      if (current.has(entry)) {
        reduced.add(entry);
      }
    }
    return reduced;
  });
}

/**
 * Returns a list of the sets of entrypoints, for use in performing
 * set intersection and subtraction on the sets.
 */
function getEntrypointSets(bundles: Bundle[]): Set<string>[] {
  const list: Set<string>[] = [];
  for (const bundle of bundles) {
    list.push(bundle.entrypoints);
  }
  return list;
}

/**
 * Names bundles based on entrypoints and dependencies.
 *
 * Bundles without entrypoints will be named using `sharedBundleUrlMapper`.
 */
export function uniqueEntrypointUrlMapper(bundles: Bundle[]):
    Map<UrlString, Bundle> {
  const bundleMap = new Map<UrlString, Bundle>();
  // Avoid mutating passed array;
  const remainingBundles: typeof bundles = [];
  /**
   * Attempt to assign names to bundles that contain entrypoints.
   */
  for (let bundle of bundles) {
    let assigned = false;
    for (const entrypoint of bundle.entrypoints) {
      if (bundle.files.has(entrypoint)) {
        bundleMap.set(entrypoint, bundle);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      remainingBundles.push(bundle);
    }
  }

  // Fall back on the sharedBundleUrlMapper if all bundles aren't assigned.
  if (remainingBundles.length > 0) {
    const remainingMap = sharedBundleUrlMapper(remainingBundles);
    bundleMap.forEach((value, key) => bundleMap.set(key, value));
  }

  return bundleMap;
}