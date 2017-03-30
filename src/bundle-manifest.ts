/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
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

import {UrlString} from './url-utils';

/**
 * A bundle strategy function is used to transform an array of bundles.
 */
export type BundleStrategy = (bundles: Bundle[]) => Bundle[];

/**
 * A bundle url mapper function produces a map of urls to bundles.
 */
export type BundleUrlMapper = (bundles: Bundle[]) => Map<UrlString, Bundle>;

/**
 * A mapping of entrypoints to their full set of transitive dependencies,
 * such that a dependency graph `a->c, c->d, d->e, b->d, b->f` would be
 * represented `{a:[a,c,d,e], b:[b,d,e,f]}`.  Please note that there is an
 * explicit identity dependency (`a` depends on `a`, `b` depends on `b`).
 */
export type TransitiveDependenciesMap = Map<UrlString, Set<UrlString>>;

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
  private _bundleUrlForFile: Map<UrlString, UrlString>;

  /**
   * Given a collection of bundles and a BundleUrlMapper to generate urls for
   * them, the constructor populates the `bundles` and `files` index properties.
   */
  constructor(bundles: Bundle[], urlMapper: BundleUrlMapper) {
    this.bundles = urlMapper(Array.from(bundles));
    this._bundleUrlForFile = new Map();

    for (const bundleMapEntry of this.bundles) {
      const bundleUrl = bundleMapEntry[0];
      const bundle = bundleMapEntry[1];
      for (const fileUrl of bundle.files) {
        console.assert(!this._bundleUrlForFile.has(fileUrl));
        this._bundleUrlForFile.set(fileUrl, bundleUrl);
      }
    }
  }

  // Convenience method to return a bundle for a constituent file url.
  getBundleForFile(url: UrlString): AssignedBundle|undefined {
    const bundleUrl = this._bundleUrlForFile.get(url);
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

  // TODO(usergenic): Assert a valid transitive dependencies map; i.e.
  // entrypoints should include themselves as dependencies and entrypoints
  // should *probably* not include other entrypoints as dependencies.

  const invertedIndex = invertMultimap(depsIndex);

  for (const entry of invertedIndex.entries()) {
    const dep: UrlString = entry[0];
    const entrypoints: Set<UrlString> = entry[1];

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
 * Chains multiple bundle strategy functions together so the output of one
 * becomes the input of the next and so-on.
 */
export function composeStrategies(strategies: BundleStrategy[]) {
  return strategies.reduce((s1, s2) => (b) => s2(s1(b)));
}

/**
 * Generates a strategy function which finds all non-entrypoint bundles which
 * are dependencies of the given entrypoint and merges them into that
 * entrypoint's bundle.
 */
export function generateEagerMergeStrategy(entrypoint: UrlString):
    BundleStrategy {
  return generateMatchMergeStrategy(
      (b) => b.files.has(entrypoint) ||
          b.entrypoints.has(entrypoint) && !getBundleEntrypoint(b));
}

/**
 * Generates a strategy function which finds all bundles matching the predicate
 * function and merges them into the bundle containing the target file.
 */
export function generateMatchMergeStrategy(predicate: (b: Bundle) => boolean):
    BundleStrategy {
  return (bundles: Bundle[]) => mergeMatchingBundles(bundles, predicate);
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
export function generateSharedDepsMergeStrategy(maybeMinEntrypoints?: number):
    BundleStrategy {
  const minEntrypoints =
      maybeMinEntrypoints === undefined ? 2 : maybeMinEntrypoints;
  if (minEntrypoints < 0) {
    throw new Error(`Minimum entrypoints argument must be non-negative`);
  }
  return generateMatchMergeStrategy(
      (b) => b.entrypoints.size >= minEntrypoints && !getBundleEntrypoint(b));
}

/**
 * A bundle strategy function which merges all shared dependencies into a
 * bundle for an application shell.
 */
export function generateShellMergeStrategy(
    shell: UrlString, maybeMinEntrypoints?: number): BundleStrategy {
  const minEntrypoints =
      maybeMinEntrypoints === undefined ? 2 : maybeMinEntrypoints;
  if (minEntrypoints < 0) {
    throw new Error(`Minimum entrypoints argument must be non-negative`);
  }
  return composeStrategies([
    generateEagerMergeStrategy(shell),
    generateMatchMergeStrategy(
        (b) => b.files.has(shell) ||
            b.entrypoints.size >= minEntrypoints && !getBundleEntrypoint(b))
  ]);
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
 * Return a new bundle array where all bundles within it matching the predicate
 * are merged.
 */
export function mergeMatchingBundles(
    bundles: Bundle[], predicate: (bundle: Bundle) => boolean): Bundle[] {
  const newBundles = Array.from(bundles);
  const bundlesToMerge = newBundles.filter(predicate);
  if (bundlesToMerge.length > 1) {
    for (const bundle of bundlesToMerge) {
      newBundles.splice(newBundles.indexOf(bundle), 1);
    }
    newBundles.push(mergeBundles(bundlesToMerge));
  }
  return newBundles;
}

/**
 * Return the entrypoint that represents the given bundle, or null if no
 * entrypoint represents the bundle.
 */
function getBundleEntrypoint(bundle: Bundle): UrlString|null {
  for (const entrypoint of bundle.entrypoints) {
    if (bundle.files.has(entrypoint)) {
      return entrypoint;
    }
  }
  return null;
}

/**
 * A simple function for generating shared bundle names based on a counter.
 */
export function sharedBundleUrlMapper(bundles: Bundle[]):
    Map<UrlString, Bundle> {
  let counter = 0;
  const urlMap = new Map<UrlString, Bundle>();
  for (const bundle of bundles) {
    const bundleEntrypoint = getBundleEntrypoint(bundle);
    if (bundleEntrypoint) {
      urlMap.set(bundleEntrypoint, bundle);
    } else {
      urlMap.set(`shared_bundle_${++counter}.html`, bundle);
    }
  }
  return urlMap;
}
