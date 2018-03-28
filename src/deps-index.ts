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

// An index of entrypoint -> dependencies
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
    let document;
    try {
      document = inlineDocuments.has(entrypoint) ?
          inlineDocuments.get(entrypoint)! :
          getAnalysisDocument(analysis, entrypoint);
    } catch (e) {
      console.warn(e.message);
    }
    if (document) {
      const deps = getDependencies(analyzer, document);
      depsIndex.set(entrypoint, new Set([
                      ...(document.isInline ? [] : [document.url]),
                      ...deps.eagerDeps
                    ]));

      // Add lazy imports to the set of all entrypoints, which supports
      // recursive
      for (const dep of deps.lazyImports) {
        allEntrypoints.add(dep);
      }

      // Treat top-level module imports as entrypoints by creating "sub-bundle"
      // URLs to enable the inline document to be processed as an entrypoint
      // document on a subsequent iteration of the outer loop over all
      // entrypoints.
      for (const [id, imported] of deps.moduleScriptImports) {
        const subBundleUrl = getSubBundleUrl(document.url, id);
        allEntrypoints.add(subBundleUrl);
        inlineDocuments.set(subBundleUrl, imported);
      }
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
 *
 * Sub-Bundle URL for an inline ES6 module document:
 *     file:///my-project/src/page.html>inline#1>es6-module
 *
 * Super-bundle URL for the containing HTML document:
 *     file:///my-project/src/page.html
 */
export function getSuperBundleUrl(subBundleUrl: string): ResolvedUrl {
  return subBundleUrl.split('>').shift()! as ResolvedUrl;
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
function getDependencies(
    analyzer: Analyzer, document: Document): DependencyMapEntry {
  const deps = new Set<ResolvedUrl>();
  const eagerDeps = new Set<ResolvedUrl>();
  const lazyImports = new Set<ResolvedUrl>();
  const moduleScriptImports = new Map<string, Document>();
  _getDependencies(document, true);
  return {deps, eagerDeps, lazyImports, moduleScriptImports};

  function _getDependencies(document: Document, viaEager: boolean) {
    // HTML document dependencies include external modules referenced by script
    // src attribute, external modules imported by inline module import
    // statements, and HTML imports (recursively).
    if (document.kinds.has('html-document')) {
      _getHtmlExternalModuleDependencies(document);
      _getHtmlInlineModuleDependencies(document);
      _getImportDependencies(
          document.getFeatures({kind: 'html-import', ...getFeaturesOptions}),
          viaEager);
    }

    // JavaScript documents, when parsed as modules, have dependencies defined
    // by their import statements.
    if (document.kinds.has('js-document')) {
      _getImportDependencies(
          // TODO(usergenic): We should be able to filter here on:
          // `.filter((d) => d.parsedAsSourceType === 'module')`
          // here, but Analyzer wont report that if there are no
          // import/export statements in the imported file.
          document.getFeatures({kind: 'js-import', ...getFeaturesOptions}) as
              Set<Import>,
          viaEager);
    }
  }

  function _getHtmlExternalModuleDependencies(document: Document) {
    let externalModuleCount = 0;
    const htmlScripts =
        [...document.getFeatures({kind: 'html-script', ...getFeaturesOptions})]
            .filter(
                (i) => i.document !== undefined &&
                    (i.document.parsedDocument as JavaScriptDocument)
                            .parsedAsSourceType === 'module');
    for (const htmlScript of htmlScripts) {
      const relativeUrl =
          analyzer.urlResolver.relative(document.url, htmlScript.document!.url);
      moduleScriptImports.set(
          `external#${++externalModuleCount}>${relativeUrl}>es6-module`,
          htmlScript.document!);
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
      moduleScriptImports.set(
          `inline#${++jsDocumentCount}>es6-module`, jsDocument);
    }
  }

  function _getImportDependencies(
      imports: Iterable<Import>, viaEager: boolean) {
    for (const imprt of imports) {
      if (imprt.document === undefined) {
        continue;
      }
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
