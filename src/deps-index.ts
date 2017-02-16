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
import {AssertionError} from 'assert';
import {Analyzer} from 'polymer-analyzer';
import * as urlLib from 'url';

import * as urlUtils from './url-utils';
import {UrlString} from './url-utils';

export interface DepsIndex {
  // An index of entrypoint -> html dependencies
  entrypointToDeps: Map<UrlString, Set<UrlString>>;
}

type DependencyMapEntry = {
  url: UrlString,
  // Eagerly reachable dependencies.
  eager: Set<UrlString>,
  // Lazily reachable dependencies - may also include some entries from "eager"
  lazy: Set<UrlString>
};

async function _getTransitiveDependencies(
    url: UrlString, entrypoints: UrlString[], analyzer: Analyzer):
    Promise<DependencyMapEntry> {
      const document = await analyzer.analyze(url);
      const baseUrl = document.parsedDocument.baseUrl;
      const imports = document.getByKind(
          'import', {externalPackages: true, imported: true});
      const eagerImports = new Set<UrlString>();
      const lazyImports = new Set<UrlString>();
      for (const htmlImport of imports) {
        try {
          console.assert(
              htmlImport.url, 'htmlImport: %s has no url', htmlImport);
        } catch (err) {
          if (err instanceof AssertionError) {
            continue;
          }
          throw err;
        }
        const resolvedHtmlImportUrl = urlLib.resolve(
            baseUrl, urlUtils.relativeUrl(baseUrl, htmlImport.url));
        switch (htmlImport.type) {
          case 'html-import':
            eagerImports.add(resolvedHtmlImportUrl);
            break;
          case 'lazy-html-import':
            lazyImports.add(resolvedHtmlImportUrl);
            break;
        }
      }
      return {url: url, eager: eagerImports, lazy: lazyImports};
    }

export async function buildDepsIndex(
    entrypoints: UrlString[], analyzer: Analyzer): Promise<DepsIndex> {
  const entrypointToDependencies: Map<UrlString, Set<UrlString>> = new Map();
  const dependenciesToEntrypoints: Map<UrlString, Set<UrlString>> = new Map();
  const queue = Array.from(entrypoints);
  const visitedEntrypoints = new Set<UrlString>();
  while (queue.length > 0) {
    const entrypoint = queue.shift()!;
    if (visitedEntrypoints.has(entrypoint)) {
      continue;
    }
    const dependencyEntry =
        await _getTransitiveDependencies(entrypoint, entrypoints, analyzer);
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
