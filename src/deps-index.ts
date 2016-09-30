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
  // An index of entrypoint -> html dependencies
  entrypointToDeps: Map<string, Set<string>>;
}

type DependencyMapEntry = {
  url: string,
  // Eagerly reachable dependencies.
  eager: Set<string>,
  // Lazily reachable dependencies - may also include some entries from "eager"
  lazy: Set<string>
};

async function _getTransitiveDependencies(url: string, analyzer: Analyzer):
    Promise<DependencyMapEntry> {
      const document = await analyzer.analyzeRoot(url);
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
      return {url: url, eager: eagerImports, lazy: lazyImports};
    }

export async function buildDepsIndex(entrypoints: string[], analyzer: Analyzer):
    Promise<DepsIndex> {
      const entrypointToDependencies: Map<string, Set<string>> = new Map();
      const dependenciesToEntrypoints: Map<string, Set<string>> = new Map();
      let depsIndex = {};
      const queue = Array.from(entrypoints);
      const visitedEntrypoints = new Set<string>();
      while (queue.length > 0) {
        const entrypoint = queue.shift()!;
        if (visitedEntrypoints.has(entrypoint)) {
          continue;
        }
        const dependencyEntry =
            await _getTransitiveDependencies(entrypoint, analyzer);
        const dependencies = new Set(dependencyEntry.eager);
        dependencies.add(entrypoint);
        entrypointToDependencies.set(entrypoint, dependencies);
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
      return {entrypointToDeps: entrypointToDependencies};
    }
