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
import traverse, {NodePath} from 'babel-traverse';
import * as babel from 'babel-types';
import {FileRelativeUrl, PackageRelativeUrl, ResolvedUrl} from 'polymer-analyzer';
import {rollup} from 'rollup';

import {getAnalysisDocument} from './analyzer-utils';
import {getNodeValue, parseModuleFile, serialize} from './babel-utils';
import {AssignedBundle, BundleManifest} from './bundle-manifest';
import {Bundler} from './bundler';

/**
 * Looks up and/or defines the unique name for an item exported with the given
 * name in a module within a in a bundle.
 */
export function getBundleModuleExportName(
    bundle: AssignedBundle, moduleUrl: ResolvedUrl, name: string): string {
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
          trialName = trialName.replace(/[0-9]+$/, (v) => `${parseInt(v) + 1}`);
        } else {
          trialName = `${trialName}$1`;
        }
      }
    }
    moduleExports.set(name, exportName);
  }
  return exportName;
}

export function getModuleExportNames(node: babel.Node): Set<string> {
  const exportedNames: string[] = [];
  traverse(node, {
    noScope: true,
    ExportNamedDeclaration: {
      enter(path: NodePath) {
        const exportNode: babel.ExportNamedDeclaration = path.node as any;
        exportedNames.push(
            ...getModuleExportIdentifiers(...exportNode.specifiers));
        exportedNames.push(
            ...getModuleExportIdentifiers(exportNode.declaration));
      }
    }
  });
  return new Set(exportedNames);
}

function getModuleExportIdentifiers(...nodes: babel.Node[]): string[] {
  const identifiers = [];
  for (const node of nodes) {
    if (babel.isArrayPattern(node)) {
      identifiers.push(...getModuleExportIdentifiers(...node.elements));
    }
    if (babel.isClassDeclaration(node) || babel.isFunctionDeclaration(node) ||
        babel.isVariableDeclarator(node)) {
      identifiers.push(...getModuleExportIdentifiers(node.id));
    }
    if (babel.isExportSpecifier(node)) {
      identifiers.push(...getModuleExportIdentifiers(node.exported));
    }
    if (babel.isIdentifier(node)) {
      identifiers.push(node.name);
    }
    if (babel.isObjectPattern(node)) {
      identifiers.push(...getModuleExportIdentifiers(...node.properties));
    }
    if (babel.isObjectProperty(node)) {
      identifiers.push(...getModuleExportIdentifiers(node.value));
    }
    if (babel.isVariableDeclaration(node)) {
      identifiers.push(...getModuleExportIdentifiers(...node.declarations));
    }
  }
  return identifiers;
}

/**
 * Utility class to rollup/merge ES6 modules code using rollup and rewrite
 * import statements to point to appropriate bundles.
 */
export class Es6Rewriter {
  constructor(
      public bundler: Bundler,
      public manifest: BundleManifest,
      public bundle: AssignedBundle) {
  }

  async rollup(url: ResolvedUrl, code: string) {
    const analysis =
        await this.bundler.analyzer.analyze([...this.bundle.bundle.files]);
    const external: string[] = [];
    for (const [url, bundle] of this.manifest.bundles) {
      if (url !== this.bundle.url) {
        external.push(...[...bundle.files, url]);
      }
    }
    const rollupBundle = await rollup({
      input: url,
      external,
      onwarn: (warning: string) => {},
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
            if (this.bundle.url === id) {
              return code;
            }
            if (this.bundle.bundle.files.has(id)) {
              return getAnalysisDocument(analysis, id).parsedDocument.contents;
            }
          },
        },
      ],
      experimentalDynamicImport: true,
    });
    const {code: rolledUpCode} = await rollupBundle.generate({format: 'es'});
    const babelFile = parseModuleFile(url, rolledUpCode);
    this._rewriteJsImportStatements(url, babelFile);
    const {code: rewrittenCode} = serialize(babelFile);
    return {code: rewrittenCode, map: undefined};
  }

  private _rewriteJsImportStatements(baseUrl: ResolvedUrl, node: babel.Node) {
    const {bundler, manifest} = this;
    traverse(node, {
      noScope: true,
      ImportDeclaration: {
        enter(path: NodePath) {
          const importDeclaration = path.node as babel.ImportDeclaration;
          const source = getNodeValue(importDeclaration.source) as ResolvedUrl;
          const importBundle = manifest.getBundleForFile(source);
          // If there is no import bundle, then this URL is not bundled (maybe
          // excluded or something) so we should just ensure the URL is
          // converted back to a relative URL.
          if (!importBundle) {
            importDeclaration.source.value =
                bundler.analyzer.urlResolver.relative(baseUrl, source);
            return;
          }
          for (const specifier of importDeclaration.specifiers) {
            if (babel.isImportSpecifier(specifier)) {
              const originalExportName = specifier.imported.name;
              const exportName = getBundleModuleExportName(
                  importBundle, source, originalExportName);
              specifier.imported.name = exportName;
            }
          }
          importDeclaration.source.value =
              bundler.analyzer.urlResolver.relative(baseUrl, importBundle.url);
        }
      }
    });
  }
}
