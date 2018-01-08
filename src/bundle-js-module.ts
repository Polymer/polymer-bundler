/**
 * @license
 * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
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

import babelTraverse, {NodePath} from 'babel-traverse';
import * as babel from 'babel-types';
import * as clone from 'clone';
import {Document, ResolvedUrl} from 'polymer-analyzer';
import * as rollup from 'rollup';
import * as urlLib from 'url';

import {getAnalysisDocument} from './analyzer-utils';
import * as babelUtils from './babel-utils';
import {AssignedBundle, BundleManifest} from './bundle-manifest';
import {Bundler} from './bundler';
import * as urlUtils from './url-utils';

const polymerBundlerScheme = 'polymer-bundler://root/';
const polymerBundlerDynamicImportIdentifier = '____polymerBundlerDynamicImport';

export type ExportedJsModuleNameFn =
    (importerUrl: ResolvedUrl, importeeUrl: ResolvedUrl) => string;

export function defaultExportedJsModuleNameFn(
    importerUrl: ResolvedUrl, importeeUrl: ResolvedUrl): string {
  return '$bundled$' +
      urlUtils.relativeUrl(importerUrl, importeeUrl)
          .replace(/^\.\//, '')
          .replace(/\.js$/, '')
          .replace(/[^A-Za-z0-9_]/g, '$');
};

export async function bundleJsModule(
    bundler: Bundler,
    docBundle: AssignedBundle,
    bundleManifest: BundleManifest,
    exportedJsModuleNameFn: ExportedJsModuleNameFn =
        defaultExportedJsModuleNameFn): Promise<{code: string}> {
  let document: Document;

  document =
      await generateJsBasisDocument(bundler, docBundle, exportedJsModuleNameFn);

  const analysis = await bundler.analyzer.analyze([...docBundle.bundle.files]);
  // We have to compose the `external` array here because the id value yielded
  // to the external function has no importer context making that form totally
  // useless. *shakes fist*
  let external: string[] = [];
  bundleManifest.bundles.forEach((b, url) => {
    if (url !== docBundle.url) {
      external.push(
          ...[...b.files, url].map((u) => `${polymerBundlerScheme}${u}`));
    }
  });

  const bundle = await rollup.rollup({
    input: docBundle.url,
    external,
    plugins: [
      {
        resolveId: (importee: string, importer: string | undefined) => {
          if (importer && !isRollupResolvedUrl(importee) &&
              urlUtils.isRelativePath(importee)) {
            importee = urlLib.resolve(importer, importee);
          }
          if (!isRollupResolvedUrl(importee)) {
            importee = `${polymerBundlerScheme}${importee}`;
          }
          return importee;
        },
        load: (id: string) => {
          if (!isRollupResolvedUrl(id)) {
            throw new Error(`Unable to load unresolved id ${id}`);
          }
          const url = id.slice(polymerBundlerScheme.length) as ResolvedUrl;
          if (docBundle.bundle.files.has(url)) {
            let code =
                getAnalysisDocument(analysis, url).parsedDocument.contents;
            code = obscureDynamicImports(docBundle.url, url, code);
            return code;
          } else if (docBundle.url === url) {
            let code = document.parsedDocument.contents;
            code = obscureDynamicImports(docBundle.url, url, code);
            return code;
          }
        }
      },
    ],
  });

  // generate code and a sourcemap
  let {code} = await bundle.generate(
      {sourcemap: true, sourcemapFile: docBundle.url + '.map', format: 'es'});

  // This bit replaces those polymer-bundler:// urls with relative paths to
  // the original resolved paths.
  code = convertPolymerBundlerSchemeUrlsToRelativeUrls(docBundle.url, code);
  code = restoreDynamicImports(docBundle.url, code);

  // Now we analyze the document code again to get features related to the
  // imports.
  document = await bundler.analyzeContents(docBundle.url, code);

  const ast = clone(document.parsedDocument.ast);

  // With the newly analyzed document, we can now rewrite the import sites.
  await rewriteJsBundleImports(
      bundler, ast, docBundle, bundleManifest, exportedJsModuleNameFn);

  code = babelUtils.serialize(ast);

  document = await bundler.analyzeContents(docBundle.url, code);

  // TODO(usergenic): Update sourcemap?
  return {code: document.parsedDocument.contents};
}

export async function rewriteJsBundleImports(
    bundler: Bundler,
    astRoot: babel.Node,
    docBundle: AssignedBundle,
    bundleManifest: BundleManifest,
    exportedJsModuleNameFn: ExportedJsModuleNameFn) {
  const jsImports: babel.Node[] = [];

  babelTraverse(astRoot, {
    enter(path: NodePath) {
      const node = path.node;
      if (babel.isImportDeclaration(node)) {
        jsImports.push(node);
      }
      if (node.type === 'Import') {
        jsImports.push(node);
      }
    },
    noScope: true,
  });

  const importedBundledModuleNames: Set<string> = new Set();

  for (const jsImport of jsImports) {
    const importedNamesBySource:
        Map<string, {local: string, imported: string}[]> = new Map();
    if (babel.isImportDeclaration(jsImport)) {
      const source = jsImport.source;
      let sourceUrl: string = '';
      if (babel.isStringLiteral(source)) {
        sourceUrl = source.value;
      }
      if (!sourceUrl) {
        continue;
      }
      const resolvedSourceUrl =
          urlLib.resolve(docBundle.url, sourceUrl) as ResolvedUrl;
      const sourceBundle = bundleManifest.getBundleForFile(resolvedSourceUrl);
      if (sourceBundle && sourceBundle.url !== resolvedSourceUrl) {
        // TODO(usergenic): Rewrite the url to the bundle url.  Also, now we
        // know we have to hoist out the bundled values.  This last bit of
        // knowledge is actually a bit of a hack though, because in actuality
        // we need a way to actually determine whether this is true or we need
        // bundling to always make it true.  Bundles should probably be
        // annotated to express.

        // TODO(usergenic): Preserve the single-quote preference of original
        // codebase when changing the value.
        source.value =
            urlUtils.relativeUrl(docBundle.url, sourceBundle.url, true);

        if (!importedNamesBySource.has(sourceBundle.url)) {
          importedNamesBySource.set(sourceBundle.url, []);
        }
        for (const specifier of jsImport.specifiers) {
          if (babel.isImportSpecifier(specifier)) {
            importedNamesBySource.get(sourceBundle.url)!.push({
              local: specifier.local.name,
              imported: specifier.imported.name,
            });
          }
          if (babel.isImportDefaultSpecifier(specifier) ||
              babel.isImportNamespaceSpecifier(specifier)) {
            importedNamesBySource.get(sourceBundle.url)!.push({
              local: specifier.local.name,
              imported: '*',
            });
          }
        }

        const exportedName = getOrSet(
            docBundle.bundle.exportedJsModules,
            resolvedSourceUrl,
            () => exportedJsModuleNameFn(sourceBundle.url, resolvedSourceUrl))!;

        jsImport.specifiers.splice(
            0,
            jsImport.specifiers.length,
            babel.importSpecifier(
                babel.identifier(exportedName),
                babel.identifier(exportedName)));

        const duplicateJsImportSpecifier =
            importedBundledModuleNames.has(exportedName);
        importedBundledModuleNames.add(exportedName);

        const importDeclarationParent =
            babelUtils.getParentNode(astRoot, jsImport)!;
        if (!importDeclarationParent) {
          // TODO(usergenic): This log should be a real error or warning or
          // something.
          console.log(
              'CAN NOT INSERT CODE BECAUSE CAN NOT FIND PARENT OF IMPORT IN DOCUMENT AST');
          continue;
        }
        let importDeclarationContainerArray;
        if (babel.isProgram(importDeclarationParent)) {
          importDeclarationContainerArray = importDeclarationParent.body;
        }
        if (!importDeclarationContainerArray) {
          // TODO(usergenic): This log should be a real error or warning or
          // something.
          console.log(
              'DONT KNOW HOW TO INSERT CODE INTO CONTAINER TYPE',
              importDeclarationParent.type);
          continue;
        }
        const variableDeclarations = [];

        // Transform:
        //   import {a as A, b as B} from './some/module.js';
        // Into:
        //   import {$bundled$some$module} from './bundle_1.js';
        //   const {a: A, b: B} = $bundled$some$module;
        const importsInSourceBundle =
            importedNamesBySource.get(sourceBundle.url)!;
        const importsOfNamedValues =
            importsInSourceBundle.filter(({imported}) => imported !== '*');
        if (importsOfNamedValues.length > 0) {
          variableDeclarations.push(babel.variableDeclaration(
              'const',
              [babel.variableDeclarator(
                  // TODO(usergenic): There's some kind of typings
                  // mismatch here- should allow ObjectProperty[] but is
                  // not doing so 'as any' to the rescue.
                  babel.objectPattern(
                      importsOfNamedValues.map(
                          ({local, imported}) => babel.objectProperty(
                              babel.identifier(imported),
                              babel.identifier(local))) as any),
                  babel.identifier(exportedName))]));
        }

        // Transform:
        //   import * as A from './some/module.js';
        // Into:
        //   import {$bundled$some$module} from './bundle_1.js';
        //   const A = $bundled$some$module;
        const importsOfNamespace =
            importsInSourceBundle.filter(({imported}) => imported === '*');
        if (importsOfNamespace.length > 0) {
          for (const importOfNamespace of importsOfNamespace) {
            variableDeclarations.push(babel.variableDeclaration(
                'const', [babel.variableDeclarator(
                             babel.identifier(importOfNamespace.local),
                             babel.identifier(exportedName))]));
          }
        }

        importDeclarationContainerArray.splice(
            importDeclarationContainerArray.indexOf(jsImport) + 1,
            0,
            ...variableDeclarations);

        if (duplicateJsImportSpecifier) {
          importDeclarationContainerArray.splice(
              importDeclarationContainerArray.indexOf(jsImport), 1);
        }
      }
    }
    // Dynamic Import
    if (jsImport.type === 'Import') {
      // Transform:
      //   import('./some/module.js')
      // Into:
      //   import('./bundle_1.js')
      //       .then(({ $bundled$some$module }) => $bundled$some$module)
      const importCallExpression = babelUtils.getParentNode(astRoot, jsImport);
      if (!importCallExpression ||
          !babel.isCallExpression(importCallExpression)) {
        // TODO(usergenic): This log should be a real error or warning or
        // something.
        console.log(
            'CAN NOT INSERT CODE BECAUSE CAN NOT FIND PARENT OF IMPORT IN DOCUMENT AST');
        continue;
      }
      const importCallArgument = importCallExpression.arguments[0]!;
      if (!babel.isStringLiteral(importCallArgument)) {
        console.log(
            'CAN NOT FIGURE OUT WHERE THE DYNAMIC IMPORT IS PULLING FROM.  I ONLY UNDERSTAND STRING LITERALS');
        continue;
      }
      const sourceUrl = importCallArgument.value;
      const resolvedSourceUrl =
          urlLib.resolve(docBundle.url, sourceUrl) as ResolvedUrl;
      const sourceBundle = bundleManifest.getBundleForFile(resolvedSourceUrl);
      if (sourceBundle && sourceBundle.url !== resolvedSourceUrl) {
        const exportedName = getOrSet(
            docBundle.bundle.exportedJsModules,
            resolvedSourceUrl,
            () => exportedJsModuleNameFn(sourceBundle.url, resolvedSourceUrl));

        importCallExpression.arguments[0] = babel.stringLiteral(
            urlUtils.relativeUrl(docBundle.url, sourceBundle.url));
        const thenifiedCallExpression = babel.callExpression(
            babel.memberExpression(
                importCallExpression, babel.identifier('then')),
            [babel.arrowFunctionExpression(
                [
                  babel.objectPattern([
                    babel.objectProperty(
                        babel.identifier(exportedName),
                        babel.identifier(exportedName)) as any,
                  ]),
                ],
                babel.identifier(exportedName))]);

        babelTraverse(astRoot, {
          enter(path: NodePath) {
            const node = path.node;
            if (babel.isAwaitExpression(node) &&
                node.argument === importCallExpression) {
              node.argument = thenifiedCallExpression;
              path.stop();
              return;
            }
            if (babel.isExpressionStatement(node) &&
                node.expression === importCallExpression) {
              node.expression = thenifiedCallExpression;
              path.stop();
              return;
            }
            if (babel.isMemberExpression(node) &&
                node.object === importCallExpression) {
              node.object = thenifiedCallExpression;
              path.stop();
              return;
            }
            if (babel.isVariableDeclarator(node) &&
                node.init === importCallExpression) {
              node.init = thenifiedCallExpression;
              path.stop();
              return;
            }
          },
          noScope: true,
        });
      }
    }
  }
}

/**
 * Removes the polymer bundler scheme prefix from import declaration urls after
 * code has been rolled up.
 */
export function convertPolymerBundlerSchemeUrlsToRelativeUrls(
    bundleUrl: ResolvedUrl, code: string): string {
  const ast = babelUtils.parseModuleFile(bundleUrl, code);
  babelTraverse(ast, {
    noScope: true,
    ImportDeclaration: {
      enter(path: NodePath) {
        const importDeclaration = path.node as babel.ImportDeclaration;
        const source = importDeclaration.source;
        if (babel.isStringLiteral(source)) {
          const sourceUrl = source.value;
          if (sourceUrl.startsWith(polymerBundlerScheme)) {
            source.value = urlUtils.relativeUrl(
                bundleUrl,
                sourceUrl.slice(polymerBundlerScheme.length) as ResolvedUrl,
                true);
          }
        }
      },
    }
  });
  return babelUtils.serialize(ast);
}

async function generateJsBasisDocument(
    bundler: Bundler,
    docBundle: AssignedBundle,
    exportedJsModuleNameFn: ExportedJsModuleNameFn):
    Promise<Document> {
      let jsLines: string[] = [];
      // If there's already a document at the url, we don't want to step on it.
      // We have one of two cases:
      // 1. It's a bundle which incorporates only files which are its direct
      //    dependencies, i.e. it is not a merged bundle.
      // 2. It is a merged bundle which needs to export the modules it
      //    imports to make them available to other bundles.
      if (docBundle.bundle.files.has(docBundle.url)) {
        const originalDocument = (await bundler.analyzer.analyze([
                                   docBundle.url
                                 ])).getDocument(docBundle.url) as Document;
        // If this isn't a merged bundle, it can skip exporting all the files
        // in the bundle.  This can significantly reduce amount of unnecessary
        // code in the rolled up module.
        if (!docBundle.bundle.isMerged) {
          return originalDocument;
        }
        // We'll use the original document contents as the basis, appending
        // the bundle's import and export statements to it.
        jsLines.push(originalDocument.parsedDocument.contents);
      }
      const exportNames: string[] = [];
      for (const url of docBundle.bundle.files) {
        // No need to re-export what we're already exporting.
        if (url === docBundle.url) {
          continue;
        }
        const exportName = getOrSet(
            docBundle.bundle.exportedJsModules,
            url,
            () => exportedJsModuleNameFn(docBundle.url, url))!;
        exportNames.push(exportName);
        const relativeUrl = urlUtils.relativeUrl(docBundle.url, url, true);
        jsLines.push(`import * as ${exportName} from '${relativeUrl}';`);
      }
      jsLines.push(`export {${exportNames.join(', ')}};`);
      return bundler.analyzeContents(docBundle.url, jsLines.join('\n'));
    }

function
isRollupResolvedUrl(url: string):
    boolean {
      return url.startsWith(polymerBundlerScheme);
    }

function
getOrSet<K, V>(map: Map<K, V>, key: K, fn: () => V) {
  if (!map.has(key)) {
    map.set(key, fn());
  }
  return map.get(key);
}

// TODO(usergenic): Rollup is complaining about the 'import' in the dynamic
// import syntax and so we have to rename it to something innocuous before
// rollup sees the code.  The problem with this approach is that dynamic imports
// which are rolled up into a file from another directory aren't rewritten, so
// we have to capture the original dynamic import statement and rewrite the urls
// as we restore the `import()` syntax after rollup is done.  We also have to
// capture the source url of the original import statement so that when rollup
// moves this code into the bundle, we can rebase the url to the bundle's url
// appropriately.
export function obscureDynamicImports(
    bundleUrl: ResolvedUrl, sourceUrl: ResolvedUrl, code: string) {
  const ast = babelUtils.parseModuleFile(bundleUrl, code);
  babelTraverse(ast, {
    noScope: true,
    CallExpression: {
      enter(path: NodePath) {
        const callExpression = path.node as babel.CallExpression;
        const callee = callExpression.callee;
        // Have to cast to string because type defs don't include 'Import' as
        // possible type.
        if (callee.type as string === 'Import') {
          callee.type = 'Identifier';
          (callee as babel.Identifier).name =
              polymerBundlerDynamicImportIdentifier;
          callExpression.arguments.push(babel.stringLiteral(sourceUrl));
        }
      },
    },
  });

  return babelUtils.serialize(ast);
}

export function restoreDynamicImports(bundleUrl: ResolvedUrl, code: string) {
  const ast = babelUtils.parseModuleFile(bundleUrl, code);
  babelTraverse(ast, {
    noScope: true,
    CallExpression: {
      enter(path: NodePath) {
        const callExpression = path.node as babel.CallExpression;
        const callee = callExpression.callee;
        if (babel.isIdentifier(callee) &&
            callee.name === polymerBundlerDynamicImportIdentifier) {
          (callee as babel.Node).type = 'Import';
          delete callee.name;
          const sourceUrl =
              (callExpression.arguments.pop()! as babel.StringLiteral).value;
          const importUrlArgument = callExpression.arguments[0];
          let importUrl;
          if (importUrlArgument && babel.isStringLiteral(importUrlArgument)) {
            importUrl = importUrlArgument.value;
            const resolvedImportUrl =
                urlLib.resolve(sourceUrl, importUrl) as ResolvedUrl;
            const newRelativeImportUrl =
                urlUtils.relativeUrl(bundleUrl, resolvedImportUrl, true);
            importUrlArgument.value = newRelativeImportUrl as string;
            return;
          }
        }
      },
    },
  });

  return babelUtils.serialize(ast);
}
