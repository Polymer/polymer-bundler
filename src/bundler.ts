/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
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
import {Analyzer, Document, FsUrlLoader, InMemoryOverlayUrlLoader, ResolvedUrl} from 'polymer-analyzer';

import {getAnalysisDocument} from './analyzer-utils';
import * as bundleManifestLib from './bundle-manifest';
import {Bundle, BundleManifest, BundleStrategy, BundleUrlMapper} from './bundle-manifest';
import * as depsIndexLib from './deps-index';
import {BundledDocument, DocumentCollection} from './document-collection';
import {bundle as bundleEs6Module} from './es6-module-bundler';
import {reserveBundleModuleExportNames} from './es6-module-utils';
import {bundle as bundleHtmlFragment} from './html-bundler';
import {resolvePath} from './url-utils';

export * from './bundle-manifest';

// TODO(usergenic): Add plylog
export interface Options {
  // The instance of the Polymer Analyzer which has completed analysis
  analyzer?: Analyzer;

  // URLs of files and/or folders that should not be inlined. HTML tags
  // referencing excluded URLs are preserved.'
  excludes?: ResolvedUrl[];

  // When true, inline external CSS file contents into <style> tags in the
  // output document.
  inlineCss?: boolean;

  // When true, inline external Javascript file contents into <script> tags in
  // the output document.
  inlineScripts?: boolean;

  // Rewrite element attributes inside of templates to adjust URLs in inlined
  // html imports.
  rewriteUrlsInTemplates?: boolean;

  // Create identity source maps for inline scripts
  sourcemaps?: boolean;

  // Remove of all comments (except those containing '@license') when true.
  stripComments?: boolean;

  // Bundle strategy used to construct the output bundles.
  strategy?: BundleStrategy;

  // Bundle URL mapper function that produces URLs for the generated bundles.
  urlMapper?: BundleUrlMapper;
}

export interface BundleResult {
  documents: DocumentCollection;
  manifest: BundleManifest;
}

export class Bundler {
  analyzer: Analyzer;
  enableCssInlining: boolean;
  enableScriptInlining: boolean;
  excludes: ResolvedUrl[];
  rewriteUrlsInTemplates: boolean;
  sourcemaps: boolean;
  stripComments: boolean;
  strategy: BundleStrategy;
  urlMapper: BundleUrlMapper;

  private _overlayUrlLoader: InMemoryOverlayUrlLoader;

  constructor(options?: Options) {
    const opts = options ? options : {};

    // In order for the bundler to use a given analyzer, we'll have to fork it
    // so we can provide our own overlayUrlLoader which falls back to the
    // analyzer's load method.
    if (opts.analyzer) {
      const analyzer = opts.analyzer;
      this._overlayUrlLoader = new InMemoryOverlayUrlLoader(analyzer);
      this.analyzer = analyzer._fork({urlLoader: this._overlayUrlLoader});
    } else {
      this._overlayUrlLoader =
          new InMemoryOverlayUrlLoader(new FsUrlLoader(resolvePath('.')));
      this.analyzer = new Analyzer({urlLoader: this._overlayUrlLoader});
    }

    this.excludes = Array.isArray(opts.excludes) ? opts.excludes : [];
    this.stripComments = Boolean(opts.stripComments);
    this.enableCssInlining =
        opts.inlineCss === undefined ? true : opts.inlineCss;
    this.enableScriptInlining =
        opts.inlineScripts === undefined ? true : opts.inlineScripts;
    this.rewriteUrlsInTemplates = Boolean(opts.rewriteUrlsInTemplates);
    this.sourcemaps = Boolean(opts.sourcemaps);
    this.strategy =
        opts.strategy || bundleManifestLib.generateSharedDepsMergeStrategy();
    this.urlMapper = opts.urlMapper ||
        bundleManifestLib.generateCountingSharedBundleUrlMapper(
            this.analyzer.resolveUrl('shared_bundle_')!);
  }

  /**
   * Analyze a URL using the given contents in place of what would otherwise
   * have been loaded.
   */
  async analyzeContents(
      url: ResolvedUrl,
      contents: string,
      // By default, the contents given to analyzeContents are not kept in the
      // Analyzer's cache and the Analyzer will act as though it never happened.
      // By giving a `true` value to `permanent`, the Analysis cache and the
      // in-memory overlay will not be purged of the contents.  This toggle lets
      // us use the Analyzer to process documents in intermediate stages without
      // committing to them.
      permanent?: boolean): Promise<Document> {
    this._overlayUrlLoader.urlContentsMap.set(url, contents);
    await this.analyzer.filesChanged([url]);
    const analysis = await this.analyzer.analyze([url]);
    const document = getAnalysisDocument(analysis, url);
    // Unless we explicitly want to make this analysis permanent, we remove the
    // entry from the overlay and tell analyzer to forget what it just analyzed.
    // This is because logic in many parts of the bundler assume the documents
    // and features will be of the original content.
    if (!permanent) {
      this._overlayUrlLoader.urlContentsMap.delete(url);
      await this.analyzer.filesChanged([url]);
    }
    return document;
  }

  /**
   * Given a manifest describing the bundles, produce a collection of bundled
   * documents with HTML imports, external stylesheets and external scripts
   * inlined according to the options for this Bundler.
   *
   * @param manifest - The manifest that describes the bundles to be produced.
   */
  async bundle(manifest: BundleManifest): Promise<BundleResult> {
    const documents: DocumentCollection =
        new Map<ResolvedUrl, BundledDocument>();
    manifest = manifest.fork();

    // Ensure exports of modules sharing the URL of their bundle have priority
    // in name-collision scenarios.
    reserveBundleModuleExportNames(this.analyzer, manifest);

    for (const [url, {type: bundleType}] of manifest.bundles) {
      switch (bundleType) {
        case 'html-fragment':
          documents.set(url, await bundleHtmlFragment(this, manifest, url));
          break;
        case 'es6-module':
          documents.set(url, await bundleEs6Module(this, manifest, url));
          break;
      }
    }

    return {manifest, documents};
  }

  /**
   * Generates a BundleManifest with all bundles defined, using entrypoints,
   * strategy and mapper.
   *
   * @param entrypoints - The list of entrypoints that will be analyzed for
   *     dependencies. The results of the analysis will be passed to the
   *     `strategy`.
   * @param strategy - The strategy used to construct the output bundles.
   *     See 'polymer-analyzer/src/bundle-manifest'.
   * @param mapper - A function that produces URLs for the generated bundles.
   *     See 'polymer-analyzer/src/bundle-manifest'.
   */
  async generateManifest(entrypoints: ResolvedUrl[]): Promise<BundleManifest> {
    const dependencyIndex =
        await depsIndexLib.buildDepsIndex(entrypoints, this.analyzer);
    let bundles = bundleManifestLib.generateBundles(dependencyIndex);
    // Merge single-entrypoint sub-bundles into their containing documents so
    // that inlining code can know which module scripts can be inlined.
    if (this.enableScriptInlining) {
      bundleManifestLib.mergeSingleEntrypointSubBundles(bundles);
    }
    this._filterExcludesFromBundles(bundles);
    bundles = this.strategy(bundles);
    return new BundleManifest(bundles, this.urlMapper);
  }

  /**
   * Given an array of Bundles, remove all files from bundles which are in the
   * "excludes" set.  Remove any bundles which are left empty after excluded
   * files are removed.
   */
  private _filterExcludesFromBundles(bundles: Bundle[]) {
    // Remove excluded files from bundles.
    for (const bundle of bundles) {
      for (const exclude of this.excludes) {
        const resolvedExclude = this.analyzer.resolveUrl(exclude);
        if (!resolvedExclude) {
          continue;
        }
        bundle.files.delete(resolvedExclude);
        const excludeAsFolder = exclude.endsWith('/') ? exclude : exclude + '/';
        for (const file of bundle.files) {
          if (file.startsWith(excludeAsFolder)) {
            bundle.files.delete(file);
          }
        }
      }
    }

    let b = 0;
    while (b < bundles.length) {
      if (bundles[b].files.size < 0) {
        bundles.splice(b, 1);
        continue;
      }
      ++b;
    }
  }
}
