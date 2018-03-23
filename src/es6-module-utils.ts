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
import * as clone from 'clone';
import {Analyzer, FileRelativeUrl, PackageRelativeUrl, ResolvedUrl} from 'polymer-analyzer';
import {rollup} from 'rollup';

import {getAnalysisDocument} from './analyzer-utils';
import {getNodePath, parseModuleFile, rewriteNode, serialize} from './babel-utils';
import {AssignedBundle, BundleManifest} from './bundle-manifest';
import {Bundler} from './bundler';
import {ensureLeadingDot, getFileName} from './url-utils';
import {camelCase} from './utils';

/**
 * Looks up and/or defines the unique name for an item exported with the given
 * name in a module within a bundle.
 */
export function getOrSetBundleModuleExportName(
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
    let moduleFileNameIdentifier =
        '$' + camelCase(getFileName(moduleUrl).replace(/\.[a-z0-9_]+$/, ''));
    trialName =
        trialName.replace(/^default$/, `${moduleFileNameIdentifier}Default`)
            .replace(/^\*$/, moduleFileNameIdentifier)
            .replace(/[^a-z0-9_]/gi, '$');
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

export function hasDefaultModuleExport(node: babel.Node): boolean {
  let hasDefaultModuleExport = false;
  traverse(node, {
    noScope: true,
    ExportDefaultDeclaration: {
      enter(path: NodePath) {
        hasDefaultModuleExport = true;
        path.stop();
      }
    }
  });
  return hasDefaultModuleExport;
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
 * Ensures that exported names from modules which have the same URL as their
 * bundle will have precedence over other module exports, which will be
 * counter-suffixed in the event of name collisions.  This has no technical
 * benefit, but it results in module export naming choices that are easier
 * to reason about for developers and may aid in debugging.
 */
export async function reserveBundleModuleExportNames(
    analyzer: Analyzer, manifest: BundleManifest) {
  const es6ModuleBundles =
      [...manifest.bundles]
          .map(([url, bundle]) => ({url, bundle}))
          .filter(({bundle}) => bundle.type === 'es6-module');
  const analysis = await analyzer.analyze(es6ModuleBundles.map(({url}) => url));
  for (const {url, bundle} of es6ModuleBundles) {
    if (bundle.files.has(url)) {
      const document = getAnalysisDocument(analysis, url);
      for (const exportName of getModuleExportNames(
               document.parsedDocument.ast as any)) {
        getOrSetBundleModuleExportName({url, bundle}, url, exportName);
      }
    }
  }
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
    // This is a synthetic module specifier used to identify the code to rollup
    // and differentiate it from the a request to contents of the document at
    // the actual given url which should load from the analyzer.
    const input = '*bundle*';
    const analysis =
        await this.bundler.analyzer.analyze([...this.bundle.bundle.files]);
    const external: string[] = [];
    for (const [url, bundle] of this.manifest.bundles) {
      if (url !== this.bundle.url) {
        external.push(...[...bundle.files, url]);
      }
    }
    // For each document loaded from the analyzer, we build a map of the
    // original specifiers to the resolved URLs since we want to use analyzer
    // resolutions for such things as bare module specifiers.
    const jsImportResolvedUrls =
        new Map<ResolvedUrl, Map<string, ResolvedUrl>>();
    const rollupBundle = await rollup({
      input,
      external,
      onwarn: (warning: string) => {},
      treeshake: false,
      plugins: [
        {
          name: 'analyzerPlugin',
          resolveId: (importee: string, importer?: string) => {
            if (importee === input) {
              return input;
            }
            if (importer) {
              if (jsImportResolvedUrls.has(importer as ResolvedUrl)) {
                const resolutions =
                    jsImportResolvedUrls.get(importer as ResolvedUrl)!;
                if (resolutions.has(importee)) {
                  return resolutions.get(importee);
                }
              }
              return this.bundler.analyzer.urlResolver.resolve(
                         importer === input ? url : importer as ResolvedUrl,
                         importee as FileRelativeUrl)! as string;
            }
            return this.bundler.analyzer.urlResolver.resolve(
                       importee as PackageRelativeUrl)! as string;
          },
          load: (id: ResolvedUrl) => {
            if (id === input) {
              return code;
            }
            if (this.bundle.bundle.files.has(id)) {
              const document = getAnalysisDocument(analysis, id);
              if (!jsImportResolvedUrls.has(id)) {
                const jsImports = document.getFeatures({
                  kind: 'js-import',
                  imported: false,
                  externalPackages: true,
                  excludeBackreferences: true,
                });
                const resolutions = new Map<string, ResolvedUrl>();
                jsImportResolvedUrls.set(id, resolutions);
                for (const jsImport of jsImports) {
                  const source = jsImport.astNode && jsImport.astNode.source &&
                      jsImport.astNode.source.value;
                  if (source) {
                    resolutions.set(source, jsImport.document.url);
                  }
                }
              }
              return document.parsedDocument.contents;
            }
          },
        },
      ],
      experimentalDynamicImport: true,
    });
    const {code: rolledUpCode} = await rollupBundle.generate({
      format: 'es',
      freeze: false,
    });
    const babelFile = parseModuleFile(url, rolledUpCode);
    this._rewriteImportStatements(url, babelFile);
    this._deduplicateImportStatements(babelFile);
    const {code: rewrittenCode} = serialize(babelFile);
    return {code: rewrittenCode, map: undefined};
  }

  private _deduplicateImportStatements(node: babel.Node) {
    const importDeclarations = new Map<string, babel.ImportDeclaration>();
    traverse(node, {
      noScope: true,
      ImportDeclaration: {
        enter(path: NodePath) {
          const importDeclaration = path.node;
          if (!babel.isImportDeclaration(importDeclaration)) {
            return;
          }
          const source = babel.isStringLiteral(importDeclaration.source) &&
              importDeclaration.source.value;
          if (!source) {
            return;
          }
          const hasNamespaceSpecifier = importDeclaration.specifiers.some(
              (s) => babel.isImportNamespaceSpecifier(s));
          const hasDefaultSpecifier = importDeclaration.specifiers.some(
              (s) => babel.isImportDefaultSpecifier(s));
          if (!importDeclarations.has(source) && !hasNamespaceSpecifier &&
              !hasDefaultSpecifier) {
            importDeclarations.set(source, importDeclaration);
          } else if (importDeclarations.has(source)) {
            const existingDeclaration = importDeclarations.get(source)!;
            for (const specifier of importDeclaration.specifiers) {
              existingDeclaration.specifiers.push(specifier);
            }
            path.remove();
          }
        }
      }
    });
  }

  private _rewriteImportStatements(baseUrl: ResolvedUrl, node: babel.Node) {
    const this_ = this;
    traverse(node, {
      noScope: true,
      // Dynamic import() syntax doesn't have full type support yet, so we
      // have to use generic `enter` and walk all nodes unti that's fixed.
      // TODO(usergenic): Switch this to the `Import: { enter }` style
      // after dynamic imports fully supported.
      enter(path: NodePath) {
        if (path.node.type === 'Import') {
          this_._rewriteDynamicImport(baseUrl, node, path.node);
        }
      },
    });

    traverse(node, {
      noScope: true,
      ImportDeclaration: {
        enter(path: NodePath) {
          const importDeclaration = path.node as babel.ImportDeclaration;
          if (!babel.isStringLiteral(importDeclaration.source)) {
            // We can't actually handle values which are not string literals, so
            // we'll skip them.
            return;
          }
          const source = importDeclaration.source.value as ResolvedUrl;
          const sourceBundle = this_.manifest.getBundleForFile(source);
          // If there is no import bundle, then this URL is not bundled (maybe
          // excluded or something) so we should just ensure the URL is
          // converted back to a relative URL.
          if (!sourceBundle) {
            importDeclaration.source.value =
                this_.bundler.analyzer.urlResolver.relative(baseUrl, source);
            return;
          }
          for (const specifier of importDeclaration.specifiers) {
            if (babel.isImportSpecifier(specifier)) {
              this_._rewriteImportSpecifierName(
                  specifier, source, sourceBundle);
            }
            if (babel.isImportDefaultSpecifier(specifier)) {
              this_._rewriteImportDefaultSpecifier(
                  specifier, source, sourceBundle);
            }
            if (babel.isImportNamespaceSpecifier(specifier)) {
              this_._rewriteImportNamespaceSpecifier(
                  specifier, source, sourceBundle);
            }
          }
          importDeclaration.source.value =
              ensureLeadingDot(this_.bundler.analyzer.urlResolver.relative(
                  baseUrl, sourceBundle.url));
        }
      }
    });
  }

  private _rewriteDynamicImport(
      baseUrl: ResolvedUrl,
      root: babel.Node,
      importNode: babel.Node) {
    const importNodePath = getNodePath(root, importNode);
    if (!importNodePath) {
      return;
    }
    const importCallExpression = importNodePath.parent;
    if (!importCallExpression ||
        !babel.isCallExpression(importCallExpression)) {
      return;
    }
    const importCallArgument = importCallExpression.arguments[0];
    if (!babel.isStringLiteral(importCallArgument)) {
      return;
    }
    const sourceUrl = importCallArgument.value;
    const resolvedSourceUrl = this.bundler.analyzer.urlResolver.resolve(
        baseUrl, sourceUrl as FileRelativeUrl);
    if (!resolvedSourceUrl) {
      return;
    }
    const sourceBundle = this.manifest.getBundleForFile(resolvedSourceUrl);
    // TODO(usergenic): To support *skipping* the rewrite, we need a way to
    // identify whether a bundle contains a single top-level module or is a
    // merged bundle with multiple top-level modules.
    //
    // if (!sourceBundle || sourceBundle.url === resolvedSourceUrl) {
    let exportName;
    if (sourceBundle) {
      exportName =
          getOrSetBundleModuleExportName(sourceBundle, resolvedSourceUrl, '*');
    }
    // If there's no source bundle or the namespace export name of the bundle
    // is just '*', then we don't need to append a .then() to transform the
    // return value of the import().  Lets just rewrite the URL to be a relative
    // path and exit.
    if (!sourceBundle || exportName === '*') {
      const relativeSourceUrl =
          ensureLeadingDot(this.bundler.analyzer.urlResolver.relative(
              baseUrl, resolvedSourceUrl));
      importCallArgument.value = relativeSourceUrl;
      return;
    }
    // Rewrite the URL to be a relative path to the bundle.
    const relativeSourceUrl = ensureLeadingDot(
        this.bundler.analyzer.urlResolver.relative(baseUrl, sourceBundle.url));
    importCallArgument.value = relativeSourceUrl;
    const importCallExpressionParent = importNodePath.parentPath.parent!;
    if (!importCallExpressionParent) {
      return;
    }
    const thenifiedCallExpression = babel.callExpression(
        babel.memberExpression(
            clone(importCallExpression), babel.identifier('then')),
        [babel.arrowFunctionExpression(
            [
              babel.objectPattern(
                  [babel.objectProperty(
                       babel.identifier(exportName),
                       babel.identifier(exportName),
                       undefined,
                       true) as any]),
            ],
            babel.identifier(exportName))]);
    rewriteNode(importCallExpression, thenifiedCallExpression);
  }

  private _rewriteImportSpecifierName(
      specifier: babel.ImportSpecifier,
      source: ResolvedUrl,
      sourceBundle: AssignedBundle) {
    const originalExportName = specifier.imported.name;
    const exportName = getOrSetBundleModuleExportName(
        sourceBundle, source, originalExportName);
    specifier.imported.name = exportName;
  }

  private _rewriteImportDefaultSpecifier(
      specifier: babel.ImportDefaultSpecifier,
      source: ResolvedUrl,
      sourceBundle: AssignedBundle) {
    const exportName =
        getOrSetBundleModuleExportName(sourceBundle, source, 'default');
    // No rewrite necessary if default is the name, since this indicates there
    // was no rewriting or bundling of the default export.
    if (exportName === 'default') {
      return;
    }
    const importSpecifier = specifier as any as babel.ImportSpecifier;
    Object.assign(
        importSpecifier,
        {type: 'ImportSpecifier', imported: babel.identifier(exportName)});
  }

  private _rewriteImportNamespaceSpecifier(
      specifier: babel.ImportNamespaceSpecifier,
      source: ResolvedUrl,
      sourceBundle: AssignedBundle) {
    const exportName =
        getOrSetBundleModuleExportName(sourceBundle, source, '*');
    // No rewrite necessary if * is the name, since this indicates there was no
    // bundling of the namespace.
    if (exportName === '*') {
      return;
    }
    const importSpecifier = specifier as any as babel.ImportSpecifier;
    Object.assign(
        importSpecifier,
        {type: 'ImportSpecifier', imported: babel.identifier(exportName)});
  }
}
