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
import {Analyzer, Document} from 'polymer-analyzer';
import {getAnalysisDocument} from './analyzer-utils';
import {UrlString} from './url-utils';

export interface DepsIndex {
  // An index of entrypoint -> html dependencies
  entrypointToDeps: Map<UrlString, Set<UrlString>>;
}

type DependencyMapEntry = {
  // All dependencies of the document
  deps: Set<UrlString>,
  // Eagerly loaded dependencies of the document
  eagerDeps: Set<UrlString>,
  // All imports defined with `<link rel="lazy-import">`
  lazyImports: Set<UrlString>,
};

/**
 * For a given document, return a set of transitive dependencies, including
 * all eagerly-loaded dependencies and lazy html imports encountered.
 */
function getDependencies(document: Document): DependencyMapEntry {
  const deps = new Set<UrlString>();
  const eagerDeps = new Set<UrlString>();
  const lazyImports = new Set<UrlString>();
  _getDependencies(document, true, deps, eagerDeps, lazyImports);
  return {deps, eagerDeps, lazyImports};
}

function _getDependencies(
    document: Document,
    viaEager: boolean,
    visited: Set<UrlString>,
    visitedEager: Set<UrlString>,
    lazyImports: Set<UrlString>) {
  const jsImports = document.getFeatures(
      {kind: 'js-import', imported: false, externalPackages: true});
  const htmlImports = document.getFeatures(
      {kind: 'html-import', imported: false, externalPackages: true});
  const htmlScripts = document.getFeatures(
      {kind: 'html-script', imported: false, externalPackages: true});

  for (const htmlScript of htmlScripts) {
    const importUrl = htmlScript.document.url;
    if (visitedEager.has(importUrl)) {
      continue;
    }
    visitedEager.add(importUrl);
    visited.add(importUrl);
    _getDependencies(
        htmlScript.document, true, visited, visitedEager, lazyImports);
  }

  for (const jsDocument of [...jsImports].map((j) => j.document)) {
    for (const jsImport of jsDocument.getFeatures(
             {kind: 'js-import', imported: false, externalPackages: true})) {
      jsImports.add(jsImport);
    }
  }

  for (const importFeature of [...htmlImports, ...jsImports]) {
    const importUrl = importFeature.document.url;
    if (importFeature.lazy) {
      lazyImports.add(importUrl);
    }
    if (visitedEager.has(importUrl)) {
      continue;
    }
    const isEager = viaEager && !importFeature.lazy;
    if (isEager) {
      visitedEager.add(importUrl);
      // In this case we've visited a node eagerly for the first time,
      // so recurse
    } else if (visited.has(importUrl)) {
      // In this case we're seeing a node lazily again, so don't recurse
      continue;
    }
    visited.add(importUrl);
    _getDependencies(
        importFeature.document, isEager, visited, visitedEager, lazyImports);
  }
}

/**
 * Analyzes all entrypoints and determines each of their transitive
 * dependencies.
 * @param entrypoints Urls of entrypoints to analyze.
 * @param analyzer
 * @return a dependency index of every entrypoint, including entrypoints that
 *     were discovered as lazy entrypoints in the graph.
 */
export async function buildDepsIndex(
    entrypoints: UrlString[], analyzer: Analyzer): Promise<DepsIndex> {
  const depsIndex = {entrypointToDeps: new Map<UrlString, Set<UrlString>>()};
  const analysis = await analyzer.analyze(entrypoints);
  const allEntrypoints = new Set<UrlString>(entrypoints);

  // Note: the following iteration takes place over a Set which may be added
  // to from within the loop.
  for (const entrypoint of allEntrypoints) {
    try {
      const document = getAnalysisDocument(analysis, entrypoint);
      const deps = getDependencies(document);
      depsIndex.entrypointToDeps.set(
          entrypoint, new Set([entrypoint, ...deps.eagerDeps]));
      // Add lazy imports to the set of all entrypoints, which supports
      // recursive
      for (const dep of deps.lazyImports) {
        allEntrypoints.add(dep);
      }
    } catch (e) {
      console.warn(e.message);
    }
  }
  return depsIndex;
}
