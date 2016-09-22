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
import {Analyzer} from 'polymer-analyzer';

export interface DepsIndex {
  // An index of dependency -> fragments that depend on it
  depsToFragments: Map<string, Set<string>>;
  // An index of fragments -> html dependencies
  fragmentToDeps: Map<string, Set<string>>;
}

export interface BundleManifest extends Map<string, Set<string>> {}

export interface BundleOrchestrator {
  (endpoints: string[], depsIndex: DepsIndex): BundleManifest
}

type DependencyMapEntry = {
  url: string,
  eager: Set<string>,
  lazy: Set<string>
};

async function _getDependencies(href: string, analyzer: Analyzer):
    Promise<DependencyMapEntry> {
      const document = await analyzer.analyzeRoot(href);
      const imports = document.getByKind('import');
      const eagerImports = new Set<string>();
      const lazyImports = new Set<string>();
      for (let htmlImport of imports) {
        if (!htmlImport.url) {
          continue;
        }
        switch (htmlImport.type) {
          case 'html-import':
            eagerImports.add(htmlImport.url);
            break;
          case 'lazy-html-import':
            lazyImports.add(htmlImport.url);
            break;
        }
      }
      return {url: href, eager: eagerImports, lazy: lazyImports};
    }

export async function buildDepsIndex(
    entrypoints: string[], analyzer: Analyzer): Promise<DepsIndex> {
  const entrypointToDependencies: Map<string, Set<string>> = new Map();
  const dependenciesToEntrypoints: Map<string, Set<string>> = new Map();
  let depsIndex = {};
  const queue = entrypoints.slice();
  const visitedEntrypoints = new Set<string>();
  while (queue.length > 0) {
    const entrypoint = queue.shift()!;
    if (visitedEntrypoints.has(entrypoint)) {
      continue;
    }
    const dependencyEntry = await _getDependencies(entrypoint, analyzer);
    entrypointToDependencies.set(entrypoint, new Set(dependencyEntry.eager));
    for (const lazyDependency of dependencyEntry.lazy.values()) {
      if (!visitedEntrypoints.has(lazyDependency)) {
        queue.push(lazyDependency);
      }
    }
  }
  entrypointToDependencies.forEach((dependencies, entrypoint, map) => {
    for (const dependency of dependencies) {
      if (!dependenciesToEntrypoints.has(dependency)) {
        dependenciesToEntrypoints.set(dependency, new Set());
      }
      const entrypointSet = dependenciesToEntrypoints.get(dependency)!;
      entrypointSet.add(entrypoint);
    }
  });
  return {
    depsToFragments: dependenciesToEntrypoints,
    fragmentToDeps: entrypointToDependencies
  };
}