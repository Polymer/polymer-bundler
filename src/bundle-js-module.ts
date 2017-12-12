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

import * as babelGenerate from 'babel-generator';
import * as babelTraverse from 'babel-traverse';
import * as babel from 'babel-types';
import * as clone from 'clone';
import {Document} from 'polymer-analyzer';
import * as rollup from 'rollup';
import * as urlLib from 'url';

import * as babelUtils from './babel-utils';
import {AssignedBundle, BundleManifest} from './bundle-manifest';
import {Bundler} from './bundler';
import * as urlUtils from './url-utils';
import {UrlString} from './url-utils';

const polymerBundlerScheme = 'polymer-bundler://root/';

export type ExportedJsModuleNameFn =
    (importerUrl: UrlString, importeeUrl: UrlString) => string;

export function defaultExportedJsModuleNameFn(
    importerUrl: UrlString, importeeUrl: UrlString): string {
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
  if (!docBundle.bundle.files.has(docBundle.url)) {
    document = await generateJsBasisDocument(
        bundler, docBundle, exportedJsModuleNameFn);
  }

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
    /*external: (url: string): boolean => {
      const originalUrl = url;
      if (this._isRelativePath(url)) {
        url = urlLib.resolve(docBundle.url, url);
      }
      const isExternal =
          !(docBundle.bundle.files.has(url) || docBundle.url === url);
      console.log(
          docBundle.url, 'testing', originalUrl, 'is external?', isExternal);
      return isExternal;
    },*/
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
          const url = id.slice(polymerBundlerScheme.length);
          if (docBundle.bundle.files.has(url)) {
            let code =
                (analysis.getDocument(url) as Document).parsedDocument.contents;
            code = obscureDynamicImports(docBundle.url, url, code);
            return code;
          } else if (docBundle.url === url) {
            let code = document.parsedDocument.contents;
            code = obscureDynamicImports(docBundle.url, url, code);
            return code;
          }
        }
      },
      /*
                rollupResolve({
                  module: true,
                  main: true,
                  modulesOnly: true,
                }),
                */
    ],
  });
  // generate code and a sourcemap
  let {code} = await bundle.generate(
      {sourcemap: true, sourcemapFile: docBundle.url + '.map', format: 'es'});

  // This bit replaces those polymer-bundler:// urls with relative paths to
  // the original resolved paths.
  code = code.replace(
      new RegExp(`${regexpEscape(polymerBundlerScheme)}[^'"]+`, 'g'),
      (m) => urlUtils.relativeUrl(
          docBundle.url, m.slice(polymerBundlerScheme.length), true));

  code = restoreDynamicImports(docBundle.url, code);

  // Now we analyze the document code again to get features related to the
  // imports.
  document = await bundler.analyzeContents(docBundle.url, code);

  const ast = clone(document.parsedDocument.ast);

  // With the newly analyzed document, we can now rewrite the import sites.
  await rewriteJsBundleImports(
      bundler, ast, docBundle, bundleManifest, exportedJsModuleNameFn);

  code = babelGenerate.default(ast).code;

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

  babelTraverse.default(astRoot, {
    enter(path: babelTraverse.NodePath) {
      const node = path.node;
      if (babel.isImportDeclaration(node)) {
        jsImports.push(node);
      }
    },
    noScope: true,
  });

  const importedNamesBySource:
      Map<string, {local: string, imported: string}[]> = new Map();
  for (const jsImport of jsImports) {
    if (babel.isImportDeclaration(jsImport)) {
      const source = jsImport.source;
      let sourceUrl: string = '';
      if (babel.isStringLiteral(source)) {
        sourceUrl = source.value;
      }
      if (!sourceUrl) {
        continue;
      }
      const resolvedSourceUrl = urlLib.resolve(docBundle.url, sourceUrl);
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
            () => exportedJsModuleNameFn(sourceBundle.url, resolvedSourceUrl));

        jsImport.specifiers.splice(
            0,
            jsImport.specifiers.length,
            babel.importSpecifier(
                babel.identifier(exportedName),
                babel.identifier(exportedName)));

        const importDeclarationParent =
            babelUtils.getParent(astRoot, jsImport)!;
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
      }
    }
  }
}

async function generateJsBasisDocument(
    bundler: Bundler,
    docBundle: AssignedBundle,
    exportedJsModuleNameFn: ExportedJsModuleNameFn):
    Promise<Document> {
      let jsLines: string[] = [];
      const exportNames: string[] = [];
      for (const url of docBundle.bundle.files) {
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
regexpEscape(pattern: string):
    string {
      return pattern.replace(/([/^$.+()[\]])/g, '\\$1');
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
// as we restore the `import()` syntax after rollup is done.
export function obscureDynamicImports(
    bundleUrl: UrlString, sourceUrl: UrlString, code: string) {
  return code.replace(
      /\bimport\([^)]+/gm,
      (m) => `____dynamic_${m}, ${JSON.stringify(sourceUrl)}`);
}

export function restoreDynamicImports(bundleUrl: UrlString, code: string) {
  return code.replace(/\b____dynamic_import\([^)]+/gm, (m: string) => {
    let argspan = m.split('(')[1];
    argspan = argspan.slice(1, argspan.length - 2);
    const args = argspan.split(', "');
    const importUrl = args[0]!.slice(0, args[0]!.length - 1);
    let sourceUrl = args[1]!;
    const resolvedImportUrl = urlLib.resolve(sourceUrl, importUrl);
    const newRelativeImportUrl =
        urlUtils.relativeUrl(bundleUrl, resolvedImportUrl, true);
    return `import(${JSON.stringify(newRelativeImportUrl)}`;
  });
}
