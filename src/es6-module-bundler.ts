/**
 * @license
 * Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
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
import generate from 'babel-generator';
import * as babel from 'babel-types';
import {ResolvedUrl} from 'polymer-analyzer';

import {getAnalysisDocument} from './analyzer-utils';
import {AssignedBundle, BundleManifest} from './bundle-manifest';
import {Bundler} from './bundler';
import {BundledDocument} from './document-collection';
import {Es6Rewriter, getModuleExportNames, getOrSetBundleModuleExportName, hasDefaultModuleExport} from './es6-module-utils';
import {ensureLeadingDot, stripUrlFileSearchAndHash} from './url-utils';

/**
 * Produces an ES6 Module BundledDocument.
 */
export async function bundle(
    bundler: Bundler, manifest: BundleManifest, url: ResolvedUrl):
    Promise<BundledDocument> {
  const bundle = manifest.bundles.get(url);
  if (!bundle) {
    throw new Error(`No bundle found in manifest for url ${url}.`);
  }
  const assignedBundle = {url, bundle};
  const generatedCode =
      await prepareBundleModule(bundler, manifest, assignedBundle);
  const es6Rewriter = new Es6Rewriter(bundler, manifest, assignedBundle);
  const {code: rolledUpCode} = await es6Rewriter.rollup(url, generatedCode);
  const document =
      await bundler.analyzeContents(assignedBundle.url, rolledUpCode);
  return {
    ast: document.parsedDocument.ast,
    content: document.parsedDocument.contents,
    files: [...assignedBundle.bundle.files]
  };
}

/**
 * Generate code containing import statements to all bundled modules and
 * export statements to re-export their namespaces and exports.
 */
async function prepareBundleModule(
    bundler: Bundler,
    manifest: BundleManifest,
    assignedBundle: AssignedBundle): Promise<string> {
  let bundleSource = babel.program([]);
  const sourceAnalysis =
      await bundler.analyzer.analyze([...assignedBundle.bundle.files]);
  for (const sourceUrl of [...assignedBundle.bundle.files].sort()) {
    const rebasedSourceUrl =
        ensureLeadingDot(bundler.analyzer.urlResolver.relative(
            stripUrlFileSearchAndHash(assignedBundle.url), sourceUrl));
    const moduleDocument =
        getAnalysisDocument(sourceAnalysis, sourceUrl).parsedDocument;
    const moduleExports = getModuleExportNames(moduleDocument.ast);
    const starExportName =
        getOrSetBundleModuleExportName(assignedBundle, sourceUrl, '*');
    bundleSource.body.push(babel.importDeclaration(
        [babel.importNamespaceSpecifier(babel.identifier(starExportName))],
        babel.stringLiteral(rebasedSourceUrl)));
    if (moduleExports.size > 0) {
      bundleSource.body.push(babel.exportNamedDeclaration(
          undefined, [babel.exportSpecifier(
                         babel.identifier(starExportName),
                         babel.identifier(starExportName))]));
      bundleSource.body.push(babel.exportNamedDeclaration(
          undefined,
          [...moduleExports].map(
              (e) => babel.exportSpecifier(
                  babel.identifier(e),
                  babel.identifier(getOrSetBundleModuleExportName(
                      assignedBundle, sourceUrl, e)))),
          babel.stringLiteral(rebasedSourceUrl)));
    }
    if (hasDefaultModuleExport(moduleDocument.ast)) {
      const defaultExportName =
          getOrSetBundleModuleExportName(assignedBundle, sourceUrl, 'default');
      bundleSource.body.push(babel.importDeclaration(
          [babel.importDefaultSpecifier(babel.identifier(defaultExportName))],
          babel.stringLiteral(rebasedSourceUrl)));
      bundleSource.body.push(babel.exportNamedDeclaration(
          undefined, [babel.exportSpecifier(
                         babel.identifier(defaultExportName),
                         babel.identifier(defaultExportName))]));
    }
  }
  const {code} = generate(bundleSource);
  return code;
}
