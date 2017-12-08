import * as babelGenerate from 'babel-generator';
import * as babel from 'babel-types';
import {Document} from 'polymer-analyzer';
import * as rollup from 'rollup';
import * as urlLib from 'url';

import * as babelUtils from './babel-utils';
import {AssignedBundle, BundleManifest} from './bundle-manifest';
import {Bundler} from './bundler';
import * as urlUtils from './url-utils';

const polymerBundlerScheme = 'polymer-bundler://';

export async function bundleJsModule(
    bundler: Bundler,
    docBundle: AssignedBundle,
    bundleManifest: BundleManifest): Promise<{code: string}> {
  let document: Document;
  if (!docBundle.bundle.files.has(docBundle.url)) {
    document = await generateJsBasisDocument(bundler, docBundle);
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
              isRelativePath(importee)) {
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
            return (analysis.getDocument(url) as Document)
                .parsedDocument.contents;
          } else if (docBundle.url === url) {
            return document.parsedDocument.contents;
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

  // Now we analyze the document code again to get features related to the
  // imports.
  document = await bundler.analyzeContents(docBundle.url, code);

  // With the newly analyzed document, we can now rewrite the import sites.
  document = await rewriteJsBundleImports(
      bundler, document, docBundle, bundleManifest);

  // TODO(usergenic): Update sourcemap?
  return {code: document.parsedDocument.contents};
}

async function rewriteJsBundleImports(
    bundler: Bundler,
    document: Document,
    docBundle: AssignedBundle,
    bundleManifest: BundleManifest) {
  const jsImports = document.getFeatures({kind: 'js-import'});
  const importedNamesBySource:
      Map<string, {local: string, imported: string}[]> = new Map();
  for (const jsImport of jsImports) {
    const astNode = jsImport.astNode;
    if (babel.isImportDeclaration(astNode)) {
      const source = astNode.source;
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
        for (const specifier of astNode.specifiers) {
          if (babel.isImportSpecifier(specifier)) {
            importedNamesBySource.get(sourceBundle.url)!.push({
              local: specifier.local.name,
              imported: specifier.imported.name
            });
          }
        }
        astNode.specifiers.splice(
            0,
            astNode.specifiers.length,
            babel.importSpecifier(
                babel.identifier(
                    moduleUrlToExportName(sourceBundle.url, resolvedSourceUrl)),
                babel.identifier(moduleUrlToExportName(
                    sourceBundle.url, resolvedSourceUrl))));
        const importDeclarationParent =
            babelUtils.getParent(document.parsedDocument.ast, astNode)!;
        if (!importDeclarationParent) {
          // TODO(usergenic): This log should be a real error or warning or
          // something.
          console.log(
              'CAN NOT INSERT CODE BECAUSE CAN NOT FIND PARENT OF IMPORT IN DOCUMENT AST');
          continue;
        }
        const objectProperties: babel.ObjectProperty[] =
            importedNamesBySource.get(sourceBundle.url)!.map(
                ({local, imported}) => babel.objectProperty(
                    babel.identifier(imported), babel.identifier(local)));
        const variableDeclaration = babel.variableDeclaration(
            'const', [babel.variableDeclarator(
                         // TODO(usergenic): There's some kind of typings
                         // mismatch here- should allow ObjectProperty[] but is
                         // not doing so 'as any' to the rescue.
                         babel.objectPattern(objectProperties as any[]),
                         babel.identifier(moduleUrlToExportName(
                             sourceBundle.url, resolvedSourceUrl)))]);

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
        importDeclarationContainerArray.splice(
            importDeclarationContainerArray.indexOf(astNode) + 1,
            0,
            variableDeclaration);
      }
    }
  }

  return bundler.analyzeContents(
      docBundle.url, babelGenerate.default(document.parsedDocument.ast).code);
}


async function generateJsBasisDocument(
    bundler: Bundler, docBundle: AssignedBundle):
    Promise<Document> {
      let jsLines: string[] = [];
      const exportNames: string[] = [];
      docBundle.bundle.files.forEach((url: string) => {
        const exportName = moduleUrlToExportName(docBundle.url, url);
        exportNames.push(exportName);
        const relativeUrl = urlUtils.relativeUrl(docBundle.url, url, true);
        jsLines.push(`import * as ${exportName} from '${relativeUrl}';`);
      });
      jsLines.push(`export {${exportNames.join(', ')}}`);
      return bundler.analyzeContents(docBundle.url, jsLines.join('\n'));
    }

function regexpEscape(pattern: string):
    string {
      return pattern.replace(/([/^$.+()[\]])/g, '\\$1');
    }

function isRollupResolvedUrl(url: string):
    boolean {
      return url.startsWith(polymerBundlerScheme);
    }

function isRelativePath(url: string):
    boolean {
      return /^\.+\//.test(url);
    }

function moduleUrlToExportName(bundleUrl: string, moduleUrl: string): string {
  return urlUtils.relativeUrl(bundleUrl, moduleUrl)
      .replace(/[^a-z0-9_]+/g, '$')
      .replace(/^\$/, '')
      .replace(/\$js/, '');
}
