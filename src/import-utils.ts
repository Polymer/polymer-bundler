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
import * as dom5 from 'dom5';
import * as parse5 from 'parse5';
import {ASTNode} from 'parse5';
import * as urlLib from 'url';

import * as astUtils from './ast-utils';
import {AssignedBundle, BundleManifest} from './bundle-manifest';
import constants from './constants';
import * as matchers from './matchers';
import encodeString from './third_party/UglifyJS2/encode-string';
import * as urlUtils from './url-utils';
import {UrlString} from './url-utils';

// TODO(usergenic): Revisit the organization of this module and *consider*
// building a class to encapsulate the common document details like docUrl and
// docBundle and global notions like manifest etc.

/**
 * Inline the contents of the html document returned by the link tag's href
 * at the location of the link tag and then remove the link tag.
 */
export async function inlineHtmlImport(
    docUrl: UrlString,
    htmlImport: ASTNode,
    visitedUrls: Set<UrlString>,
    docBundle: AssignedBundle,
    manifest: BundleManifest,
    loader: (url: UrlString) => Promise<string>) {
  const rawImportUrl = dom5.getAttribute(htmlImport, 'href')!;
  const resolvedImportUrl = urlLib.resolve(docUrl, rawImportUrl);
  const importBundleUrl = manifest.bundleUrlForFile.get(resolvedImportUrl);

  // Don't reprocess the same file again.
  if (visitedUrls.has(resolvedImportUrl)) {
    astUtils.removeElementAndNewline(htmlImport);
    return;
  }

  // We've never seen this import before, so we'll add it to the set to guard
  // against processing it again in the future.
  visitedUrls.add(resolvedImportUrl);

  // If we can't find a bundle for the referenced import, record that we've
  // processed it, but don't remove the import link.  Browser will handle it.
  if (!importBundleUrl) {
    return;
  }

  // Don't inline an import into itself.
  if (docUrl === resolvedImportUrl) {
    astUtils.removeElementAndNewline(htmlImport);
    return;
  }

  // If the html import refers to a file which is bundled and has a different
  // url, then lets just rewrite the href to point to the bundle url.
  if (importBundleUrl !== docBundle.url) {
    // If we've previously visited a url that is part of another bundle, it
    // means we've handled that entire bundle, so we guard against inlining any
    // other file from that bundle by checking the visited urls for the bundle
    // url itself.
    if (visitedUrls.has(importBundleUrl)) {
      astUtils.removeElementAndNewline(htmlImport);
      return;
    }

    const relative =
        urlUtils.relativeUrl(docUrl, importBundleUrl) || importBundleUrl;
    dom5.setAttribute(htmlImport, 'href', relative);
    visitedUrls.add(importBundleUrl);
    return;
  }

  let importSource: string;
  try {
    importSource = await loader(resolvedImportUrl);
  } catch (e) {
    throw new Error(`Unable to load ${resolvedImportUrl}: ${e.message}`);
  }

  const importDoc = parse5.parseFragment(importSource);
  debaseDocument(resolvedImportUrl, importDoc);
  rewriteImportedUrls(importDoc, resolvedImportUrl, docUrl);
  const nestedImports = dom5.queryAll(importDoc, matchers.htmlImport);

  // Move all of the import doc content after the html import.
  astUtils.insertAllBefore(
      htmlImport.parentNode!, htmlImport, importDoc.childNodes!);
  astUtils.removeElementAndNewline(htmlImport);

  // Recursively process the nested imports.
  for (const nestedImport of nestedImports) {
    await inlineHtmlImport(
        docUrl, nestedImport, visitedUrls, docBundle, manifest, loader);
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
  const rawUrl = dom5.getAttribute(externalScript, 'src')!;
  const resolvedUrl = urlLib.resolve(docUrl, rawUrl);
  let script: string|undefined = undefined;
  try {
    script = await loader(resolvedUrl);
  } catch (e) {
    // If a script doesn't load, skip inlining.
    // TODO(usergenic): Add plylog logging for load error.
    console.warn(`Unable to load script at ${resolvedUrl}: ${e.message}`);
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
    docUrl: UrlString,
    cssLink: ASTNode,
    loader: (url: UrlString) => Promise<string>) {
  const stylesheetUrl = dom5.getAttribute(cssLink, 'href')!;
  const resolvedUrl = urlLib.resolve(docUrl, stylesheetUrl);
  let stylesheetContent: string|undefined = undefined;
  try {
    stylesheetContent = await loader(resolvedUrl);
  } catch (e) {
    // If a stylesheet doesn't load, skip inlining.
    // TODO(usergenic): Add plylog logging for load error.
    console.warn(`Unable to load stylesheet at ${resolvedUrl}: ${e.message}`);
  }

  if (stylesheetContent === undefined) {
    return;
  }

  const media = dom5.getAttribute(cssLink, 'media');
  const resolvedStylesheetContent =
      _rewriteImportedStyleTextUrls(resolvedUrl, docUrl, stylesheetContent);
  const styleNode = dom5.constructors.element('style');

  if (media) {
    dom5.setAttribute(styleNode, 'media', media);
  }

  dom5.replace(cssLink, styleNode);
  dom5.setTextContent(styleNode, resolvedStylesheetContent);
  return styleNode;
}

/*
 * Given an import document, transform all of its URLs based on the document
 * base.
 */
export async function debaseDocument(docUrl: UrlString, importDoc: ASTNode) {
  const baseTag = dom5.query(importDoc, matchers.base);
  // If there's no base tag, there's nothing to do.
  if (!baseTag) {
    return;
  }
  for (const baseTag of dom5.queryAll(importDoc, matchers.base)) {
    astUtils.removeElementAndNewline(baseTag);
  }
  if (dom5.predicates.hasAttr('href')(baseTag)) {
    const baseUrl = urlLib.resolve(docUrl, dom5.getAttribute(baseTag, 'href')!);
    rewriteImportedUrls(importDoc, baseUrl, docUrl);
  }
  if (dom5.predicates.hasAttr('target')(baseTag)) {
    const baseTarget = dom5.getAttribute(baseTag, 'target')!;
    for (const tag of dom5.queryAll(importDoc, matchers.baseTargetAppliesTo)) {
      dom5.setAttribute(tag, 'target', baseTarget);
    }
  }
}

/**
 * Walk through an import document, and rewrite all urls so they are
 * correctly relative to the main document url as they've been
 * imported from the import url.
 */
export function rewriteImportedUrls(
    importDoc: ASTNode, importUrl: UrlString, mainDocUrl: UrlString) {
  _rewriteImportedElementAttrUrls(importDoc, importUrl, mainDocUrl);
  _rewriteImportedStyleUrls(importDoc, importUrl, mainDocUrl);
  _setImportedDomModuleAssetpaths(importDoc, importUrl, mainDocUrl);
}

/**
 * Find all element attributes which express urls and rewrite them so they
 * are correctly relative to the main document url as they've been
 * imported from the import url.
 */
function _rewriteImportedElementAttrUrls(
    importDoc: ASTNode, importUrl: UrlString, mainDocUrl: UrlString) {
  const nodes = dom5.queryAll(importDoc, matchers.urlAttrs);
  for (const node of nodes) {
    for (const attr of constants.URL_ATTR) {
      const attrValue = dom5.getAttribute(node, attr);
      if (attrValue && !urlUtils.isTemplatedUrl(attrValue)) {
        let relUrl: UrlString;
        if (attr === 'style') {
          relUrl =
              _rewriteImportedStyleTextUrls(importUrl, mainDocUrl, attrValue);
        } else {
          relUrl =
              urlUtils.rewriteImportedRelPath(importUrl, mainDocUrl, attrValue);
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
function _rewriteImportedStyleTextUrls(
    importUrl: UrlString, mainDocUrl: UrlString, cssText: string): string {
  return cssText.replace(constants.URL, (match) => {
    let path = match.replace(/["']/g, '').slice(4, -1);
    path = urlUtils.rewriteImportedRelPath(importUrl, mainDocUrl, path);
    return 'url("' + path + '")';
  });
}

/**
 * Find all urls in imported style nodes and rewrite them so they are now
 * correctly relative to the main document url as they've been imported from
 * the import url.
 */
function _rewriteImportedStyleUrls(
    importDoc: ASTNode, importUrl: UrlString, mainDocUrl: UrlString) {
  const styleNodes = dom5.queryAll(
      importDoc,
      matchers.styleMatcher,
      undefined,
      dom5.childNodesIncludeTemplate);
  for (const node of styleNodes) {
    let styleText = dom5.getTextContent(node);
    styleText = _rewriteImportedStyleTextUrls(importUrl, mainDocUrl, styleText);
    dom5.setTextContent(node, styleText);
  }
}

/**
 * Set the assetpath attribute of all imported dom-modules which don't yet
 * have them.
 */
function _setImportedDomModuleAssetpaths(
    importDoc: ASTNode, importUrl: UrlString, mainDocUrl: UrlString) {
  const domModules =
      dom5.queryAll(importDoc, matchers.domModuleWithoutAssetpath);
  for (let i = 0, node: ASTNode; i < domModules.length; i++) {
    node = domModules[i];
    const assetPathUrl =
        urlUtils.relativeUrl(mainDocUrl, urlUtils.debaseUrl(importUrl)) || './';
    dom5.setAttribute(node, 'assetpath', assetPathUrl);
  }
}
