/**
 * A bundle strategy function is used to transform an array of bundles.
 */
export type BundleStrategy = (bundles: Bundle[]) => Bundle[];
export type BundleUrlMapper = (bundles: Bundle[]) => UrlString[];

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
  entrypoints: Set<UrlString>;
  files: Set<UrlString>;

  constructor(entrypoints?: Set<UrlString>, files?: Set<UrlString>) {
    this.entrypoints = entrypoints || new Set<UrlString>();
    this.files = files || new Set<UrlString>();
  }
}

/**
 * A bundle manifest is a mapping of urls to bundles.
 */
export class BundleManifest {
  // Map of bundle url to bundle.
  bundles: Map<UrlString, Bundle>;

  // Map of file url to bundle url.
  files: Map<UrlString, UrlString>;

  /**
   * Given a collection of bundles and a BundleUrlMapper to generate urls for
   * them, the constructor populates the `bundles` and `files` index properties.
   */
  constructor(bundles: Bundle[], urlMapper: BundleUrlMapper) {
    const bundleUrls = urlMapper(bundles);

    this.bundles = new Map();
    this.files = new Map();

    for (let i = 0; i < bundles.length; ++i) {
      const bundle = bundles[i], bundleUrl = bundleUrls[i];
      this.bundles.set(bundleUrl, bundle);
      for (const fileUrl of bundle.files) {
        this.files.set(fileUrl, bundleUrl);
      }
    }
  }

  // Convenience method to return a bundle for a constituent file url.
  getBundleForFile(url: UrlString): Bundle|undefined {
    const bundleUrl = this.files.get(url);
    if (bundleUrl) {
      return this.bundles.get(bundleUrl);
    }
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
 *   `[a]->[a,b,d], [e]->[e,f], [a,e]->[c]`
 */
export function generateBundles(depsIndex: TransitiveDependenciesMap):
    Bundle[] {
  const bundles: Bundle[] = [];
  const invertedIndex = invertMultimap(depsIndex);

  for (const entry of invertedIndex.entries()) {
    const dep: UrlString = entry[0], entrypoints: Set<UrlString> = entry[1];
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
export function sharedBundleUrlMapper(bundles: Bundle[]): UrlString[] {
  let counter = 0;
  const urls: UrlString[] = [];
  for (const bundle of bundles) {
    if (bundle.entrypoints.size == 1) {
      urls.push(Array.from(bundle.entrypoints)[0]);
    } else {
      urls.push(`shared_bundle_${++counter}.html`);
    }
  }
  return urls;
}
