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
import traverse from 'babel-traverse';
import {NodePath} from 'babel-traverse';
import * as babel from 'babel-types';
import {Document, FileRelativeUrl, Import, PackageRelativeUrl, ResolvedUrl} from 'polymer-analyzer';
import {JavaScriptDocument} from 'polymer-analyzer/lib/javascript/javascript-document';
import {rollup} from 'rollup';

import {getAnalysisDocument} from './analyzer-utils';
import {serialize} from './babel-utils';
import {AssignedBundle, BundleManifest} from './bundle-manifest';
import {Bundler} from './bundler';
import {BundledDocument} from './document-collection';

export class Es6ModuleBundler {
  document: Document;

  constructor(
      public bundler: Bundler,
      public assignedBundle: AssignedBundle,
      public manifest: BundleManifest) {
  }

  async bundle(): Promise<BundledDocument> {
    this.document = await this._prepareBundleDocument();
    let ast = this.document.parsedDocument.ast;
    const jsImports = [...this.document.getFeatures({
                        kind: 'js-import',
                        excludeBackreferences: true,
                        noLazyImports: false,
                        imported: false,
                      })].filter((i) => !this.bundler.excludes.includes(i.url));
    const baseUrl = this.document.parsedDocument.baseUrl;
    for (const jsImport of jsImports) {
      const jsImportUrl = jsImport.document.url;
      const jsImportBundle =
          this.manifest.getBundleForFile(jsImport.document.url);
      // We need to rewrite import statements when the document they point to is
      // in a bundle that is not the current bundle.
      if (jsImportBundle && jsImportBundle.url !== this.assignedBundle.url) {
        if (jsImportBundle.url !== jsImportUrl) {
          this._rewriteJsImportStatement(baseUrl, jsImport, jsImportBundle);
        }
      }
    }
    const preRollupSerialization = serialize(ast);
    const {code} = await this._rollup(baseUrl, preRollupSerialization.code);
    this.document =
        await this.bundler.analyzeContents(this.assignedBundle.url, code);
    return {
      ast: this.document.parsedDocument.ast,
      content: this.document.parsedDocument.contents,
      files: [...this.assignedBundle.bundle.files]
    };
  }

  private _getExportName(
      bundle: AssignedBundle,
      moduleUrl: ResolvedUrl,
      name: string): string {
    let moduleExports = bundle.bundle.bundledExports.get(moduleUrl);
    const bundledExports = bundle.bundle.bundledExports;
    if (!moduleExports) {
      moduleExports = new Map<string, string>();
      bundledExports.set(moduleUrl, moduleExports);
    }
    let exportName = moduleExports.get(name);
    if (!exportName) {
      let trialName = name;
      while (!exportName) {
        if ([...bundledExports.values()].every(
                (map) => [...map.values()].indexOf(trialName) === -1)) {
          exportName = trialName;
        } else {
          if (trialName.match(/\$[0-9]+$/)) {
            trialName =
                trialName.replace(/[0-9]+$/, (v) => `${parseInt(v) + 1}`);
          } else {
            trialName = `${trialName}$1`;
          }
        }
      }
      moduleExports.set(name, exportName);
    }
    return exportName;
  }

  /**
   * Generate a fresh document to bundle contents into.  If we're building a
   * bundle which is based on an existing file, we should load that file and
   * prepare it as the bundle document, otherwise we'll create a clean/empty
   * JS document.
   */
  private async _prepareBundleDocument(): Promise<Document> {
    if (!this.assignedBundle.bundle.files.has(this.assignedBundle.url)) {
      let bundleSource = '';
      const sourceAnalysis = await this.bundler.analyzer.analyze(
          [...this.assignedBundle.bundle.files]);
      for (const sourceUrl of [...this.assignedBundle.bundle.files].sort()) {
        const rebasedSourceUrl = this.bundler.analyzer.urlResolver.relative(
            this.assignedBundle.url, sourceUrl);
        const result = sourceAnalysis.getDocument(sourceUrl);
        if (!result.successful) {
          continue;
        }
        const moduleDocument =
            result.value.parsedDocument as any as JavaScriptDocument;
        const moduleExports = this._getModuleExportedNames(moduleDocument);
        // TODO(usergenic): Use babel AST to build the source document instead
        // of string concatenation, to handle special cases of names that might
        // break syntax otherwise.
        bundleSource += 'export {' +
            [...moduleExports]
                .map((e) => {
                  const exportName =
                      this._getExportName(this.assignedBundle, sourceUrl, e);
                  return e === exportName ? e : `${e} as ${exportName}`;
                })
                .join(', ') +
            '} from \'' + rebasedSourceUrl + '\';\n';
      }
      return this.bundler.analyzeContents(
          this.assignedBundle.url, bundleSource);
    }
    const analysis =
        await this.bundler.analyzer.analyze([this.assignedBundle.url]);
    const document = getAnalysisDocument(analysis, this.assignedBundle.url);
    return document;
  }

  private _getModuleExportedNames(document: JavaScriptDocument): Set<string> {
    const exportedNames: string[] = [];
    const this_ = this;
    traverse(document.ast, {
      noScope: true,
      ExportNamedDeclaration: {
        enter(path: NodePath) {
          const exportNode: babel.ExportNamedDeclaration = path.node as any;
          exportedNames.push(
              ...this_._getIdentifiers(...exportNode.specifiers));
          exportedNames.push(...this_._getIdentifiers(exportNode.declaration));
        }
      }
    });
    return new Set(exportedNames);
  }

  private _getIdentifiers(...nodes: babel.Node[]): string[] {
    const identifiers = [];
    for (const node of nodes) {
      if (babel.isArrayPattern(node)) {
        identifiers.push(...this._getIdentifiers(...node.elements));
      }
      if (babel.isClassDeclaration(node) || babel.isFunctionDeclaration(node) ||
          babel.isVariableDeclarator(node)) {
        identifiers.push(...this._getIdentifiers(node.id));
      }
      if (babel.isExportSpecifier(node)) {
        identifiers.push(...this._getIdentifiers(node.exported));
      }
      if (babel.isIdentifier(node)) {
        identifiers.push(node.name);
      }
      if (babel.isObjectPattern(node)) {
        identifiers.push(...this._getIdentifiers(...node.properties));
      }
      if (babel.isObjectProperty(node)) {
        identifiers.push(...this._getIdentifiers(node.value));
      }
      if (babel.isVariableDeclaration(node)) {
        identifiers.push(...this._getIdentifiers(...node.declarations));
      }
    }
    return identifiers;
  }

  private _rewriteJsImportStatement(
      baseUrl: ResolvedUrl,
      jsImport: Import,
      jsImportBundle: AssignedBundle) {
    const jsImportNode = jsImport.astNode as babel.Node;
    if (babel.isImportDeclaration(jsImportNode)) {
      for (const specifier of jsImportNode.specifiers) {
        if (babel.isImportSpecifier(specifier)) {
          const originalExportName = specifier.imported.name;
          const exportName = this._getExportName(
              jsImportBundle, jsImport.document.url, originalExportName);
          specifier.imported.name = exportName;
        }
      }
      jsImportNode.source.value = this.bundler.analyzer.urlResolver.relative(
          baseUrl, jsImportBundle.url);
    }
  }

  private async _rollup(url: ResolvedUrl, code: string) {
    const analysis = await this.bundler.analyzer.analyze(
        [...this.assignedBundle.bundle.files]);
    const external: string[] = [];
    for (const [url, bundle] of this.manifest.bundles) {
      if (url !== this.assignedBundle.url) {
        external.push(...[...bundle.files, url]);
      }
    }
    const rollupBundle = await rollup({
      input: url,
      external,
      plugins: [
        {
          name: 'analyzerPlugin',
          resolveId: (importee: string, importer?: string) => {
            if (importer) {
              return this.bundler.analyzer.urlResolver.resolve(
                         importer as ResolvedUrl,
                         importee as FileRelativeUrl)! as string;
            }
            return this.bundler.analyzer.urlResolver.resolve(
                       importee as PackageRelativeUrl)! as string;
          },
          load: (id: ResolvedUrl) => {
            if (this.assignedBundle.url === id) {
              return code;
            }
            if (this.assignedBundle.bundle.files.has(id)) {
              return getAnalysisDocument(analysis, id).parsedDocument.contents;
            }
          },
        },
      ],
      experimentalDynamicImport: true,
    });
    const {code: rolledUpCode} = await rollupBundle.generate({format: 'es'});
    return {code: rolledUpCode, map: undefined};
  }
}
