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
import * as path from 'path';
import * as urlLib from 'url';
const pathPosix = path.posix;
import * as dom5 from 'dom5';
import encodeString from './third_party/UglifyJS2/encode-string';

import * as parse5 from 'parse5';
import {ASTNode} from 'parse5';
import {Analyzer, Options as AnalyzerOptions} from 'polymer-analyzer';
import {Document, ScannedDocument} from 'polymer-analyzer/lib/model/document';
import {Import} from 'polymer-analyzer/lib/model/import';
import {ParsedHtmlDocument} from 'polymer-analyzer/lib/html/html-document';
import {FSUrlLoader} from 'polymer-analyzer/lib/url-loader/fs-url-loader';
import constants from './constants';
import * as astUtils from './ast-utils';
import * as matchers from './matchers';
import * as urlUtils from './url-utils';
import {Bundle, BundleStrategy, AssignedBundle, generateBundles, BundleUrlMapper, BundleManifest, sharedBundleUrlMapper, generateSharedDepsMergeStrategy} from './bundle-manifest';
import {BundledDocument, DocumentCollection} from './document-collection';
import {buildDepsIndex} from './deps-index';
import {UrlString} from './url-utils';

// TODO(usergenic): Want to figure out a way to get rid of the basePath param
// used in the inline functions, because it feels obnoxious to have to pass it
// around for an only-occasionally used case.

/**
 * Inline the contents of the html document returned by the link tag's href
 * at the location of the link tag and then remove the link tag.
 */
export async function inlineHtmlImport(
    basePath: string|undefined,
    docUrl: string,
    htmlImport: ASTNode,
    reachedImports: Set<string>,
    docBundle: AssignedBundle,
    manifest: BundleManifest,
    loader: (url: UrlString) => Promise<string>) {
  const rawImportUrl: string = dom5.getAttribute(htmlImport, 'href')!;
  const resolvedImportUrl: string = urlLib.resolve(docUrl, rawImportUrl);
  const importBundleUrl = manifest.bundleUrlForFile.get(resolvedImportUrl);

  // Don't reprocess the same file again.
  if (reachedImports.has(resolvedImportUrl)) {
    astUtils.removeElementAndNewline(htmlImport);
    return;
  }

  // If we can't find a bundle for the referenced import, record that we've
  // processed it, but don't remove the import link.  Browser will handle it.
  if (!importBundleUrl) {
    reachedImports.add(resolvedImportUrl);
    return;
  }

  // Don't inline an import into itself.
  if (docUrl === resolvedImportUrl) {
    reachedImports.add(resolvedImportUrl);
    astUtils.removeElementAndNewline(htmlImport);
    return;
  }

  // Guard against inlining a import we've already processed.
  if (reachedImports.has(importBundleUrl)) {
    astUtils.removeElementAndNewline(htmlImport);
    return;
  }

  // If the html import refers to a file which is bundled and has a different
  // url, then lets just rewrite the href to point to the bundle url.
  if (importBundleUrl !== docBundle.url) {
    const relative =
        urlUtils.relativeUrl(docUrl, importBundleUrl) || importBundleUrl;
    dom5.setAttribute(htmlImport, 'href', relative);
    reachedImports.add(importBundleUrl);
    return;
  }

  const document =
      dom5.nodeWalkAncestors(htmlImport, (node) => !node.parentNode)!;
  const body = dom5.query(document, matchers.body)!;
  const importSource = await loader(resolvedImportUrl).catch(err => {
    throw new Error(`Unable to analyze ${resolvedImportUrl}`);
  });

  // Is there a better way to get what we want other than using
  // parseFragment?
  const importDoc = parse5.parseFragment(importSource);
  rewriteImportedUrls(basePath, importDoc, resolvedImportUrl, docUrl);
  const nestedImports = dom5.queryAll(importDoc, matchers.htmlImport);

  // Move all of the import doc content after the html import.
  astUtils.insertAllBefore(
      htmlImport.parentNode!, htmlImport, importDoc.childNodes!);
  astUtils.removeElementAndNewline(htmlImport);

  // If we've never seen this import before, lets add it to the set so we
  // will deduplicate if we encounter it again.
  reachedImports.add(resolvedImportUrl);

  // Recursively process the nested imports.
  for (const nestedImport of nestedImports) {
    await inlineHtmlImport(
        basePath,
        docUrl,
        nestedImport,
        reachedImports,
        docBundle,
        manifest,
        loader);
  }
}

/**
 * Inlines the contents of the document returned by the script tag's src url
 * into the script tag content and removes the src attribute.
 */
export async function inlineScript(
    docUrl: UrlString,
    externalScript: ASTNode,
    loader: (url: UrlString) => Promise<string>) {
  const rawUrl: string = dom5.getAttribute(externalScript, 'src')!;
  const resolvedUrl = urlLib.resolve(docUrl, rawUrl);
  let script: string|undefined = undefined;
  try {
    script = await loader(resolvedUrl);
  } catch (err) {
    // If a script doesn't load, skip inlining.
    // TODO(garlicnation): use a "canLoad" api on analyzer.
  }

  if (script === undefined) {
    return;
  }

  // Second argument 'true' tells encodeString to escape <script> tags.
  const scriptContent = encodeString(script, true);
  dom5.removeAttribute(externalScript, 'src');
  dom5.setTextContent(externalScript, scriptContent);
  return scriptContent;
}

/**
 * Inlines the contents of the stylesheet returned by the link tag's href url
 * into a style tag and removes the link tag.
 */
export async function inlineStylesheet(
    basePath: string|undefined,
    docUrl: UrlString,
    cssLink: ASTNode,
    loader: (url: UrlString) => Promise<string>) {
  const stylesheetUrl: string = dom5.getAttribute(cssLink, 'href')!;
  const resolvedStylesheetUrl = urlLib.resolve(docUrl, stylesheetUrl);
  let stylesheetContent: string|undefined = undefined;
  try {
    stylesheetContent = await loader(resolvedStylesheetUrl);
  } catch (err) {
    // Pass here since there's no canLoad api from the analyzer.
  }

  if (stylesheetContent === undefined) {
    return;
  }

  const media = dom5.getAttribute(cssLink, 'media');
  const resolvedStylesheetContent = rewriteImportedStyleTextUrls(
      basePath, resolvedStylesheetUrl, docUrl, stylesheetContent);
  const styleNode = dom5.constructors.element('style');

  if (media) {
    dom5.setAttribute(styleNode, 'media', media);
  }

  dom5.replace(cssLink, styleNode);
  dom5.setTextContent(styleNode, resolvedStylesheetContent);
  return styleNode;
}

/**
 * Find all element attributes which express urls and rewrite them so they
 * are correctly relative to the main document url as they've been
 * imported from the import url.
 */
export function rewriteImportedElementAttrUrls(
    basePath: string|undefined,
    importDoc: ASTNode,
    importUrl: string,
    mainDocUrl: string) {
  const nodes = dom5.queryAll(importDoc, matchers.urlAttrs);
  for (const node of nodes) {
    for (const attr of constants.URL_ATTR) {
      const attrValue = dom5.getAttribute(node, attr);
      if (attrValue && !urlUtils.isTemplatedUrl(attrValue)) {
        let relUrl: string;
        if (attr === 'style') {
          relUrl = rewriteImportedStyleTextUrls(
              basePath, importUrl, mainDocUrl, attrValue);
        } else {
          relUrl = urlUtils.rewriteImportedRelPath(
              basePath, importUrl, mainDocUrl, attrValue);
          if (attr === 'assetpath' && relUrl.slice(-1) !== '/') {
            relUrl += '/';
          }
        }
        dom5.setAttribute(node, attr, relUrl);
      }
    }
  }
}

/**
 * Given a string of CSS, return a version where all occurrences of urls,
 * have been rewritten based on the relationship of the import url to the
 * main doc url.
 * TODO(usergenic): This is a static method that should probably be moved to
 * urlUtils or similar.
 */
export function rewriteImportedStyleTextUrls(
    basePath: string|undefined,
    importUrl: string,
    mainDocUrl: string,
    cssText: string): string {
  return cssText.replace(constants.URL, match => {
    let path = match.replace(/["']/g, '').slice(4, -1);
    path =
        urlUtils.rewriteImportedRelPath(basePath, importUrl, mainDocUrl, path);
    return 'url("' + path + '")';
  });
}

/**
 * Find all urls in imported style nodes and rewrite them so they are now
 * correctly relative to the main document url as they've been imported from
 * the import url.
 */
export function rewriteImportedStyleUrls(
    basePath: string|undefined,
    importDoc: ASTNode,
    importUrl: string,
    mainDocUrl: string) {
  const styleNodes = dom5.queryAll(
      importDoc,
      matchers.styleMatcher,
      undefined,
      dom5.childNodesIncludeTemplate);
  for (const node of styleNodes) {
    let styleText = dom5.getTextContent(node);
    styleText = rewriteImportedStyleTextUrls(
        basePath, importUrl, mainDocUrl, styleText);
    dom5.setTextContent(node, styleText);
  }
}

/**
 * Walk through an import document, and rewrite all urls so they are
 * correctly relative to the main document url as they've been
 * imported from the import url.
 */
export function rewriteImportedUrls(
    basePath: string|undefined,
    importDoc: ASTNode,
    importUrl: string,
    mainDocUrl: string) {
  rewriteImportedElementAttrUrls(basePath, importDoc, importUrl, mainDocUrl);
  rewriteImportedStyleUrls(basePath, importDoc, importUrl, mainDocUrl);
  setImportedDomModuleAssetpaths(basePath, importDoc, importUrl, mainDocUrl);
}

/**
 * Set the assetpath attribute of all imported dom-modules which don't yet
 * have them.
 */
export function setImportedDomModuleAssetpaths(
    basePath: string|undefined,
    importDoc: ASTNode,
    importUrl: string,
    mainDocUrl: string) {
  const domModules =
      dom5.queryAll(importDoc, matchers.domModuleWithoutAssetpath);
  for (let i = 0, node: ASTNode; i < domModules.length; i++) {
    node = domModules[i];
    let assetPathUrl =
        urlUtils.rewriteImportedRelPath(basePath, importUrl, mainDocUrl, '');
    assetPathUrl = pathPosix.dirname(assetPathUrl) + '/';
    dom5.setAttribute(node, 'assetpath', assetPathUrl);
  }
}
