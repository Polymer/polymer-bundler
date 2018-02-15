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
import {Analyzer, Document, Import, ResolvedUrl} from 'polymer-analyzer';
import {JavaScriptDocument} from 'polymer-analyzer/lib/javascript/javascript-document';

import {getAnalysisDocument} from './analyzer-utils';

// An index of entrypoint -> html dependencies
export type DepsIndex = Map<ResolvedUrl, Set<ResolvedUrl>>;

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
      for (const [id, imported] of deps.moduleScriptImports) {
        const subBundleUrl = getSubBundleUrl(document.url, id);
        allEntrypoints.add(subBundleUrl);
        inlineDocuments.set(subBundleUrl, imported);
      }
    } catch (e) {
      console.warn(e.message);
    }
  }

  return depsIndex;
}

/**
 * Constructs a ResolvedUrl to identify a sub bundle, which is a concatenation
 * of the super bundle or containing file's URL and an id for the sub-bundle.
 */
export function getSubBundleUrl(
    superBundleUrl: ResolvedUrl, id: string): ResolvedUrl {
  return `${superBundleUrl}>${id}` as ResolvedUrl;
}

/**
 * Strips the sub-bundle id off the end of a URL to return the super bundle or
 * containing file's URL.  If there is no sub-bundle id on the provided URL, the
 * result is essentially a NOOP, since nothing will have been stripped.
 */
export function getSuperBundleUrl(subBundleUrl: string): ResolvedUrl {
  return subBundleUrl.replace(/>[^>]+$/, '') as ResolvedUrl;
}

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
  moduleScriptImports: Map<string, Document>,
};

/**
 * These are the options included in every `Document#getFeatures` call, DRY'd up
 * here for brevity and consistency.
 */
const getFeaturesOptions = {
  imported: false,
  externalPackages: true,
  excludeBackreferences: true,
};

/**
 * For a given document, return a set of transitive dependencies, including
 * all eagerly-loaded dependencies and lazy html imports encountered.
 */
function getDependencies(document: Document): DependencyMapEntry {
  const deps = new Set<ResolvedUrl>();
  const eagerDeps = new Set<ResolvedUrl>();
  const lazyImports = new Set<ResolvedUrl>();
  const moduleScriptImports = new Map<string, Document>();
  _getDependencies(document, true);
  return {deps, eagerDeps, lazyImports, moduleScriptImports};

  function _getDependencies(document: Document, viaEager: boolean) {
    if (document.kinds.has('html-document')) {
      _getHtmlExternalModuleDependencies(document);
      _getHtmlInlineModuleDependencies(document);
      _getImportDependencies(
          document.getFeatures({kind: 'html-import', ...getFeaturesOptions}),
          viaEager);
    }

    if (document.kinds.has('js-document')) {
      _getImportDependencies(
          modulesOnly(
              document.getFeatures({kind: 'js-import', ...getFeaturesOptions})),
          viaEager);
    }
  }

  function _getHtmlExternalModuleDependencies(document: Document) {
    let externalModuleCount = 0;
    const htmlScripts =
        [...document.getFeatures({kind: 'html-script', ...getFeaturesOptions})]
            .filter(
                (s) => (s.document.parsedDocument as JavaScriptDocument)
                           .parsedAsSourceType === 'module');
    for (const htmlScript of htmlScripts) {
      moduleScriptImports.set(
          `external-module:${++externalModuleCount}`, htmlScript.document);
    }
  }

  function _getHtmlInlineModuleDependencies(document: Document) {
    let jsDocumentCount = 0;
    const jsDocuments =
        [...document.getFeatures({kind: 'js-document', ...getFeaturesOptions})]
            .filter(
                (d) => d.kinds.has('inline-document') &&
                    d.parsedDocument.parsedAsSourceType === 'module');
    for (const jsDocument of jsDocuments) {
      moduleScriptImports.set(`inline-module:${++jsDocumentCount}`, jsDocument);
    }
  }

  function _getImportDependencies(imports: Set<Import>, viaEager: boolean) {
    for (const imprt of imports) {
      const importUrl = imprt.document.url;
      if (imprt.lazy) {
        lazyImports.add(importUrl);
      }
      if (eagerDeps.has(importUrl)) {
        continue;
      }
      const isEager = viaEager && !lazyImports.has(importUrl);
      if (isEager) {
        // In this case we've visited a node eagerly for the first time,
        // so recurse.
        eagerDeps.add(importUrl);
      } else if (deps.has(importUrl)) {
        // In this case we're seeing a node lazily again, so don't recurse
        continue;
      }
      deps.add(importUrl);
      _getDependencies(imprt.document, isEager);
    }
  }
}

/**
 * Convenience function to return a set where JavaScript documents which were
 * not parsed as source type 'module' are removed.
 */
function modulesOnly(imports: Set<Import>): Set<Import> {
  const newSet = new Set<Import>();
  for (const imprt of imports) {
    if ((imprt.document.parsedDocument as JavaScriptDocument)
            .parsedAsSourceType === 'module') {
      newSet.add(imprt);
    }
  }
  return newSet;
}
