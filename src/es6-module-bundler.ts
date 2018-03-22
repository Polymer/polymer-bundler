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

import {getAnalysisDocument} from './analyzer-utils';
import {AssignedBundle, BundleManifest} from './bundle-manifest';
import {Bundler} from './bundler';
import {BundledDocument} from './document-collection';
import {Es6Rewriter, getBundleModuleExportName, getModuleExportNames, hasDefaultModuleExport} from './es6-module-utils';
import {ensureLeadingDot, stripUrlFileSearchAndHash} from './url-utils';

export class Es6ModuleBundler {
  constructor(
      public bundler: Bundler,
      public assignedBundle: AssignedBundle,
      public manifest: BundleManifest) {
  }

  async bundle(): Promise<BundledDocument> {
    const generatedCode = await this._prepareBundleModule();
    const baseUrl = this.assignedBundle.url;
    const es6Rewriter =
        new Es6Rewriter(this.bundler, this.manifest, this.assignedBundle);
    const {code: rolledUpCode} =
        await es6Rewriter.rollup(baseUrl, generatedCode);
    const document = await this.bundler.analyzeContents(
        this.assignedBundle.url, rolledUpCode);
    return {
      ast: document.parsedDocument.ast,
      content: document.parsedDocument.contents,
      files: [...this.assignedBundle.bundle.files]
    };
  }

  /**
   * Generate code containing import statements to all bundled modules and
   * export statements to re-export their namespaces and exports.
   */
  private async _prepareBundleModule(): Promise<string> {
    let bundleSource = babel.program([]);
    const sourceAnalysis = await this.bundler.analyzer.analyze(
        [...this.assignedBundle.bundle.files]);
    for (const sourceUrl of [...this.assignedBundle.bundle.files].sort()) {
      const rebasedSourceUrl =
          ensureLeadingDot(this.bundler.analyzer.urlResolver.relative(
              stripUrlFileSearchAndHash(this.assignedBundle.url), sourceUrl));
      const moduleDocument =
          getAnalysisDocument(sourceAnalysis, sourceUrl).parsedDocument;
      const moduleExports = getModuleExportNames(moduleDocument.ast);
      const starExportName =
          getBundleModuleExportName(this.assignedBundle, sourceUrl, '*');
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
                    babel.identifier(getBundleModuleExportName(
                        this.assignedBundle, sourceUrl, e)))),
            babel.stringLiteral(rebasedSourceUrl)));
      }
      if (hasDefaultModuleExport(moduleDocument.ast)) {
        const defaultExportName = getBundleModuleExportName(
            this.assignedBundle, sourceUrl, 'default');
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
}
