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
import * as dom5 from 'dom5';
import {Analyzer, Document, ResolvedUrl} from 'polymer-analyzer';

import {getAnalysisDocument} from './analyzer-utils';

// An index of entrypoint -> html dependencies
export type DepsIndex = Map<ResolvedUrl, Set<ResolvedUrl>>;

type ScriptImport = {
  scriptId: string,
  url: ResolvedUrl,
  imported: Document,
};

type DependencyMapEntry = {
  // All dependencies of the document
  deps: Set<ResolvedUrl>,
  // Eagerly loaded dependencies of the document
  eagerDeps: Set<ResolvedUrl>,
  // All imports defined with `<link rel="lazy-import">` or with dynamic ES
  // module import syntax like `import().then()`
  lazyImports: Set<ResolvedUrl>,
  // All imports defined with `<script type="module" src="...">` or as import
  // statements within a `<script type="module">...</script>`
  scriptImports: Set<ScriptImport>,
};

/**
 * For a given document, return a set of transitive dependencies, including
 * all eagerly-loaded dependencies and lazy html imports encountered.
 */
function getDependencies(document: Document): DependencyMapEntry {
  const deps = new Set<ResolvedUrl>();
  const eagerDeps = new Set<ResolvedUrl>();
  const lazyImports = new Set<ResolvedUrl>();
  const scriptImports = new Set<ScriptImport>();
  _getDependencies(document, true, deps, eagerDeps, lazyImports, scriptImports);
  return {deps, eagerDeps, lazyImports, scriptImports};
}

function _getDependencies(
    document: Document,
    viaEager: boolean,
    visited: Set<ResolvedUrl>,
    visitedEager: Set<ResolvedUrl>,
    lazyImports: Set<ResolvedUrl>,
    scriptImports: Set<ScriptImport>) {
  if (document.kinds.has('html-document')) {
    _getHtmlDependencies(
        document, viaEager, visited, visitedEager, lazyImports, scriptImports);
  }

  if (document.kinds.has('js-document')) {
    _getJavaScriptDependencies(
        document, viaEager, visited, visitedEager, lazyImports, scriptImports);
  }
}

function _getHtmlDependencies(
    document: Document,
    viaEager: boolean,
    visited: Set<ResolvedUrl>,
    visitedEager: Set<ResolvedUrl>,
    lazyImports: Set<ResolvedUrl>,
    scriptImports: Set<ScriptImport>) {
  // We have to wind through the html scripts, but we don't treat html scripts
  // AS imports.
  let htmlScriptCount = 0;
  const htmlScripts = document.getFeatures(
      {kind: 'html-script', imported: false, externalPackages: true});
  for (const htmlScript of htmlScripts) {
    ++htmlScriptCount;
    // TODO(usergenic): Update polymer-analyzer to discriminate between
    // `<script>` and `<script type=module>` instead of using dom5 here to
    // inspect AST.
    const isModule = dom5.getAttribute(htmlScript.astNode, 'type') === 'module';
    if (!isModule) {
      continue;
    }
    const url = htmlScript.document.url;
    const scriptId = `external-module-${htmlScriptCount}`;
    scriptImports.add({scriptId, url, imported: htmlScript.document});
    continue;
  }

  const htmlImports = document.getFeatures(
      {kind: 'html-import', imported: false, externalPackages: true});
  for (const htmlImport of htmlImports) {
    const importUrl = htmlImport.document.url;
    if (htmlImport.lazy) {
      lazyImports.add(importUrl);
    }
    if (visitedEager.has(importUrl)) {
      continue;
    }
    const isEager = viaEager && !lazyImports.has(importUrl);
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
        htmlImport.document,
        isEager,
        visited,
        visitedEager,
        lazyImports,
        scriptImports);
  }

  const jsDocuments = [
    ...document.getFeatures(
        {kind: 'js-document', imported: false, externalPackages: true})
  ].filter((d) => d.kinds.has('inline-document'));
  for (const jsDocument of jsDocuments) {
    if (jsDocument.parsedDocument.parsedAsSourceType === 'module') {
      ++htmlScriptCount;
      const url = jsDocument.parsedDocument.url;
      const scriptId = `inline-module-${htmlScriptCount}`;
      scriptImports.add({scriptId, url, imported: jsDocument});
    }
  }
}

function _getJavaScriptDependencies(
    document: Document,
    viaEager: boolean,
    visited: Set<ResolvedUrl>,
    visitedEager: Set<ResolvedUrl>,
    lazyImports: Set<ResolvedUrl>,
    scriptImports: Set<ScriptImport>) {
  const jsImports = document.getFeatures({
    kind: 'js-import',
    imported: false,
    externalPackages: true,
    excludeBackreferences: true,
  });
  for (const jsImport of jsImports) {
    const importUrl = jsImport.document.url;
    if (jsImport.lazy) {
      lazyImports.add(importUrl);
    }
    if (visitedEager.has(importUrl)) {
      continue;
    }

    const isEager = viaEager && !lazyImports.has(importUrl);
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
        jsImport.document,
        isEager,
        visited,
        visitedEager,
        lazyImports,
        scriptImports);
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
    entrypoints: ResolvedUrl[], analyzer: Analyzer): Promise<DepsIndex> {
  const depsIndex = new Map<ResolvedUrl, Set<ResolvedUrl>>();
  const analysis = await analyzer.analyze(entrypoints);
  const allEntrypoints = new Set<ResolvedUrl>(entrypoints);
  const inlineDocuments = new Map<ResolvedUrl, Document>();

  // Note: the following iteration takes place over a Set which may be added
  // to from within the loop.
  for (const entrypoint of allEntrypoints) {
    try {
      const document = inlineDocuments.has(entrypoint) ?
          inlineDocuments.get(entrypoint)! :
          getAnalysisDocument(analysis, entrypoint);
      const deps = getDependencies(document);
      depsIndex.set(entrypoint, new Set([
                      ...(document.isInline ? [] : [document.url]),
                      ...deps.eagerDeps
                    ]));

      // Add lazy imports to the set of all entrypoints, which supports
      // recursive
      for (const dep of deps.lazyImports) {
        allEntrypoints.add(dep);
      }

      // Add script
      for (const {scriptId, imported} of deps.scriptImports) {
        const syntheticUrl = `${document.url}>${scriptId}` as ResolvedUrl;
        allEntrypoints.add(syntheticUrl);
        inlineDocuments.set(syntheticUrl, imported);
      }
    } catch (e) {
      console.warn(e.message);
    }
  }

  return depsIndex;
}
