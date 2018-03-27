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

import * as clone from 'clone';
import {PackageRelativeUrl, ResolvedUrl, UrlResolver} from 'polymer-analyzer';

import {getSuperBundleUrl} from './deps-index';
import {getFileExtension} from './url-utils';
import {partitionMap, uniq} from './utils';

/**
 * A bundle strategy function is used to transform an array of bundles.
 */
export type BundleStrategy = (bundles: Bundle[]) => Bundle[];

/**
 * A bundle URL mapper function produces a map of URLs to bundles.
 */
export type BundleUrlMapper = (bundles: Bundle[]) => Map<ResolvedUrl, Bundle>;

/**
 * A mapping of entrypoints to their full set of transitive dependencies,
 * such that a dependency graph `a->c, c->d, d->e, b->d, b->f` would be
 * represented `{a:[a,c,d,e], b:[b,d,e,f]}`.  Please note that there is an
 * explicit identity dependency (`a` depends on `a`, `b` depends on `b`).
 */
export type TransitiveDependenciesMap = Map<ResolvedUrl, Set<ResolvedUrl>>;

/**
 * The output format of the bundle.
 */
export type BundleType = 'html-fragment' | 'es6-module';

export const bundleTypeExtnames = new Map<BundleType, string>([
  ['es6-module', '.js'],
  ['html-fragment', '.html'],
]);

/**
 * A bundle is a grouping of files which serve the need of one or more
 * entrypoint files.
 */
export class Bundle {
  // Set of imports which should be removed when encountered.
  stripImports = new Set<ResolvedUrl>();

  // Set of imports which could not be loaded.
  missingImports = new Set<ResolvedUrl>();

  // These sets are updated as bundling occurs.
  inlinedHtmlImports = new Set<ResolvedUrl>();
  inlinedScripts = new Set<ResolvedUrl>();
  inlinedStyles = new Set<ResolvedUrl>();

  // Maps the URLs of bundled ES6 modules to a map of their original exported
  // names to names which may have been rewritten to prevent conflicts.
  bundledExports = new Map<ResolvedUrl, Map<string, string>>();

  constructor(
      // Filetype discriminator for Bundles.
      public type: BundleType,
      // Set of all dependant entrypoint URLs of this bundle.
      public entrypoints = new Set<ResolvedUrl>(),
      // Set of all files included in the bundle.
      public files = new Set<ResolvedUrl>()) {
  }

  get extname() {
    return bundleTypeExtnames.get(this.type);
  }
}

/**
 * Represents a bundle assigned to an output URL.
 */
export class AssignedBundle {
  bundle: Bundle;
  url: ResolvedUrl;
}

export interface BundleManifestJson {
  [entrypoint: string]: PackageRelativeUrl[];
}

/**
 * A bundle manifest is a mapping of URLs to bundles.
 */
export class BundleManifest {
  // Map of bundle URL to bundle.
  bundles: Map<ResolvedUrl, Bundle>;

  // Map of file URL to bundle URL.
  private _bundleUrlForFile: Map<ResolvedUrl, ResolvedUrl>;

  /**
   * Given a collection of bundles and a BundleUrlMapper to generate URLs for
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

  // Returns a clone of the manifest.
  fork(): BundleManifest {
    return clone(this);
  }

  // Convenience method to return a bundle for a constituent file URL.
  getBundleForFile(url: ResolvedUrl): AssignedBundle|undefined {
    const bundleUrl = this._bundleUrlForFile.get(url);
    if (bundleUrl) {
      return {bundle: this.bundles.get(bundleUrl)!, url: bundleUrl};
    }
  }

  toJson(urlResolver: UrlResolver): BundleManifestJson {
    const json = {};
    const missingImports: Set<ResolvedUrl> = new Set();

    for (const [url, bundle] of this.bundles) {
      json[urlResolver.relative(url)] =
          [...new Set([
            // `files` and `inlinedHtmlImports` will be partially
            // duplicative, but use of both ensures the basis document
            // for a file is included since there is no other specific
            // property that currently expresses it.
            ...bundle.files,
            ...bundle.inlinedHtmlImports,
            ...bundle.inlinedScripts,
            ...bundle.inlinedStyles
          ])].map((url: ResolvedUrl) => urlResolver.relative(url));

      for (const missingImport of bundle.missingImports) {
        missingImports.add(missingImport);
      }
    }
    if (missingImports.size > 0) {
      json['_missing'] = [...missingImports].map(
          (url: ResolvedUrl) => urlResolver.relative(url));
    }
    return json;
  }
}

/**
 * Chains multiple bundle strategy functions together so the output of one
 * becomes the input of the next and so-on.
 */
export function composeStrategies(strategies: BundleStrategy[]):
    BundleStrategy {
  return strategies.reduce((s1, s2) => (b) => s2(s1(b)));
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
    const dep: ResolvedUrl = entry[0];
    const entrypoints: Set<ResolvedUrl> = entry[1];

    // Find the bundle defined by the specific set of shared dependant
    // entrypoints.
    let bundle =
        bundles.find((bundle) => setEquals(entrypoints, bundle.entrypoints));

    if (!bundle) {
      const type = getBundleTypeForUrl([...entrypoints][0]);
      bundle = new Bundle(type, entrypoints);
      bundles.push(bundle);
    }
    bundle.files.add(dep);
  }

  return bundles;
}

/**
 * Instances of `<script type="module">` generate synthetic entrypoints in the
 * depsIndex and are treated as entrypoints during the initial phase of
 * `generateBundles`.  Any bundle which provides dependencies to a single
 * synthetic entrypoint of this type (aka a single entrypoint sub-bundle) are
 * merged back into the bundle for the HTML containing the script tag.
 *
 * For example, the following bundles:
 *   `[a]->[a], [a>1]->[x], [a>1,a>2]->[y], [a>2]->[z]`
 *
 * Would be merged into the following set of bundles:
 *   `[a]->[a,x,z], [a>1,a>2]->[y]`
 *
 * `a>1` and `a>2` represent script tag entrypoints. Only `x` and `z` are
 * bundled with `a` because they each serve only a single script tag entrypoint.
 * `y` has to be in a separate bundle so that it is not inlined into bundle `a`
 * in both script tags.
 */
export function mergeSingleEntrypointSubBundles(bundles: Bundle[]) {
  for (const subBundle of [...bundles]) {
    if (subBundle.entrypoints.size !== 1) {
      continue;
    }
    const entrypointUrl = [...subBundle.entrypoints][0];
    const superBundleUrl = getSuperBundleUrl(entrypointUrl);

    // If the entrypoint URL is the same as the super bundle URL then the
    // entrypoint URL has not changed and did not represent a sub bundle, so
    // continue to next candidate sub bundle.
    if (entrypointUrl === superBundleUrl) {
      continue;
    }

    const superBundleIndex =
        bundles.findIndex((b) => b.files.has(superBundleUrl));
    if (superBundleIndex < 0) {
      continue;
    }
    const superBundle = bundles[superBundleIndex];

    // The synthetic entrypoint identifier does not need to be represented in
    // the super bundle's entrypoints list, so we'll clear the sub-bundle's
    // entrypoints in the bundle before merging.
    subBundle.entrypoints.clear();
    const mergedBundle = mergeBundles([superBundle, subBundle], true);
    bundles.splice(superBundleIndex, 1, mergedBundle);
    const subBundleIndex = bundles.findIndex((b) => b === subBundle);
    bundles.splice(subBundleIndex, 1);
  }
}

/**
 * Creates a bundle URL mapper function which takes a prefix and appends an
 * incrementing value, starting with `1` to the filename.
 */
export function generateCountingSharedBundleUrlMapper(urlPrefix: ResolvedUrl):
    BundleUrlMapper {
  return generateSharedBundleUrlMapper(
      (sharedBundles: Bundle[]): ResolvedUrl[] => {
        let counter = 0;
        return sharedBundles.map(
            (b) => `${urlPrefix}${++counter}${b.extname}` as ResolvedUrl);
      });
}

/**
 * Generates a strategy function which finds all non-entrypoint bundles which
 * are dependencies of the given entrypoint and merges them into that
 * entrypoint's bundle.
 */
export function generateEagerMergeStrategy(entrypoint: ResolvedUrl):
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
 * Creates a bundle URL mapper function which maps non-shared bundles to the
 * URLs of their single entrypoint and yields responsibility for naming
 * remaining shared bundle URLs to the `mapper` function argument.  The
 * mapper function takes a collection of shared bundles and a URL map, calling
 * `.set(url, bundle)` for each.
 */
export function generateSharedBundleUrlMapper(
    mapper: (sharedBundles: Bundle[]) => ResolvedUrl[]): BundleUrlMapper {
  return (bundles: Bundle[]) => {
    const urlMap = new Map<ResolvedUrl, Bundle>();
    const sharedBundles: Bundle[] = [];
    for (const bundle of bundles) {
      const bundleUrl = getBundleEntrypoint(bundle);
      if (bundleUrl) {
        urlMap.set(bundleUrl, bundle);
      } else {
        sharedBundles.push(bundle);
      }
    }
    mapper(sharedBundles)
        .forEach((url, i) => urlMap.set(url, sharedBundles[i]));
    return urlMap;
  };
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
    shell: ResolvedUrl, maybeMinEntrypoints?: number): BundleStrategy {
  const minEntrypoints =
      maybeMinEntrypoints === undefined ? 2 : maybeMinEntrypoints;
  if (minEntrypoints < 0) {
    throw new Error(`Minimum entrypoints argument must be non-negative`);
  }
  return composeStrategies([
    // Merge all bundles that are direct dependencies of the shell into the
    // shell.
    generateEagerMergeStrategy(shell),
    // Create a new bundle which contains the contents of all bundles which
    // either...
    generateMatchMergeStrategy((bundle) => {
      // ...contain the shell file
      return bundle.files.has(shell) ||
          // or are dependencies of at least the minimum number of
          // entrypoints and are not entrypoints themselves.
          bundle.entrypoints.size >= minEntrypoints &&
          !getBundleEntrypoint(bundle);
    }),
    // Don't link to the shell from other bundles.
    generateNoBackLinkStrategy([shell]),
  ]);
}

/**
 * Generates a strategy function that ensures bundles do not link to given URLs.
 * Bundles which contain matching files will still have them inlined.
 */
export function generateNoBackLinkStrategy(urls: ResolvedUrl[]):
    BundleStrategy {
  return (bundles) => {
    for (const bundle of bundles) {
      for (const url of urls) {
        if (!bundle.files.has(url)) {
          bundle.stripImports.add(url);
        }
      }
    }
    return bundles;
  };
}

/**
 * Given an Array of bundles, produce a single bundle with the entrypoints and
 * files of all bundles represented.  By default, bundles of different types
 * can not be merged, but this constraint can be skipped by providing
 * `ignoreTypeCheck` argument with value `true`, which is necessary to merge a
 * bundle containining an inline document's unique transitive dependencies, as
 * inline documents typically are of different type (`<script type="module">`
 * within HTML document contains JavaScript document).
 */
export function mergeBundles(
    bundles: Bundle[], ignoreTypeCheck: boolean = false): Bundle {
  if (bundles.length === 0) {
    throw new Error('Can not merge 0 bundles.');
  }
  const bundleTypes = uniq(bundles, (b: Bundle) => b.type);
  if (!ignoreTypeCheck && bundleTypes.size > 1) {
    throw new Error(
        'Can not merge bundles of different types: ' +
        [...bundleTypes].join(' and '));
  }
  const bundleType = bundles[0].type;
  const newBundle = new Bundle(bundleType);
  for (const {
         entrypoints,
         files,
         inlinedHtmlImports,
         inlinedScripts,
         inlinedStyles,
         bundledExports,
       } of bundles) {
    newBundle.entrypoints =
        new Set<ResolvedUrl>([...newBundle.entrypoints, ...entrypoints]);
    newBundle.files = new Set<ResolvedUrl>([...newBundle.files, ...files]);
    newBundle.inlinedHtmlImports = new Set<ResolvedUrl>(
        [...newBundle.inlinedHtmlImports, ...inlinedHtmlImports]);
    newBundle.inlinedScripts =
        new Set<ResolvedUrl>([...newBundle.inlinedScripts, ...inlinedScripts]);
    newBundle.inlinedStyles =
        new Set<ResolvedUrl>([...newBundle.inlinedStyles, ...inlinedStyles]);
    newBundle.bundledExports = new Map<ResolvedUrl, Map<string, string>>(
        [...newBundle.bundledExports, ...bundledExports]);
  }
  return newBundle;
}

/**
 * Return a new bundle array where bundles within it matching the predicate
 * are merged together.  Note that merge operations are segregated by type so
 * that no attempt to merge bundles of different types will occur.
 */
export function mergeMatchingBundles(
    bundles: Bundle[], predicate: (bundle: Bundle) => boolean): Bundle[] {
  const newBundles = bundles.filter((b) => !predicate(b));
  const bundlesToMerge = partitionMap(
      bundles.filter((b) => !newBundles.includes(b)), (b) => b.type);
  for (const bundlesOfType of bundlesToMerge.values()) {
    newBundles.push(mergeBundles(bundlesOfType));
  }
  return newBundles;
}


/**
 * Return the single entrypoint that represents the given bundle, or null
 * if bundle contains more or less than a single file URL matching URLs
 * in its entrypoints set. This makes it convenient to identify whether a
 * bundle is a named fragment or whether it is simply a shared bundle
 * of some kind.
 */
function getBundleEntrypoint(bundle: Bundle): ResolvedUrl|null {
  let bundleEntrypoint = null;
  for (const entrypoint of bundle.entrypoints) {
    if (bundle.files.has(entrypoint)) {
      if (bundleEntrypoint) {
        return null;
      }
      bundleEntrypoint = entrypoint;
    }
  }
  return bundleEntrypoint;
}

/**
 * Generally bundle types are determined by the file extension of the URL,
 * though in the case of sub-bundles, the bundle type is the last segment of the
 * `>` delimited URL, (e.g. `page1.html>inline#1>es6-module`).
 */
function getBundleTypeForUrl(url: ResolvedUrl): BundleType {
  const segments = url.split('>');
  if (segments.length === 1) {
    const extname = getFileExtension(segments[0]);
    return extname === '.js' ? 'es6-module' : 'html-fragment';
  }
  if (segments.length === 0) {
    throw new Error(`ResolvedUrl "${url}" is empty/invalid.`);
  }
  return segments.pop() as BundleType;
}

/**
 * Inverts a map of collections such that  `{a:[c,d], b:[c,e]}` would become
 * `{c:[a,b], d:[a], e:[b]}`.
 */
function invertMultimap(multimap: Map<any, Set<any>>): Map<any, Set<any>> {
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
