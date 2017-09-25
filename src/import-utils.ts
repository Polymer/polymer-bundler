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
import {Analyzer, Document, ParsedHtmlDocument} from 'polymer-analyzer';
import * as urlLib from 'url';

import * as astUtils from './ast-utils';
import {AssignedBundle, BundleManifest} from './bundle-manifest';
import constants from './constants';
import * as matchers from './matchers';
import {addOrUpdateSourcemapComment} from './source-map';
import encodeString from './third_party/UglifyJS2/encode-string';
import * as urlUtils from './url-utils';
import {UrlString} from './url-utils';


// TODO(usergenic): Revisit the organization of this module and *consider*
// building a class to encapsulate the common document details like docUrl and
// docBundle and global notions like manifest etc.

/**
 * Inline the contents of the html document returned by the link tag's href
 * at the location of the link tag and then remove the link tag.  If the link
 * is a `lazy-import` link, content will not be inlined.
 */
export async function inlineHtmlImport(
    analyzer: Analyzer,
    document: Document,
    linkTag: ASTNode,
    stripImports: Set<UrlString>,
    docBundle: AssignedBundle,
    manifest: BundleManifest,
    enableSourcemaps: boolean,
    rewriteUrlsInTemplates?: boolean,
    excludes?: string[]) {
  const isLazy = dom5.getAttribute(linkTag, 'rel')!.match(/lazy-import/i);
  const rawImportUrl = dom5.getAttribute(linkTag, 'href')!;
  const importUrl = urlLib.resolve(document.url, rawImportUrl);
  if (!analyzer.canResolveUrl(importUrl)) {
    return;
  }
  const resolvedImportUrl = analyzer.resolveUrl(importUrl);
  const importBundle = manifest.getBundleForFile(resolvedImportUrl);

  // We don't want to process the same eager import again, but we want to
  // process every lazy import we see.
  if (!isLazy) {
    // Just remove the import from the DOM if it is in the stripImports Set.
    if (stripImports.has(resolvedImportUrl)) {
      astUtils.removeElementAndNewline(linkTag);
      return;
    }

    // We've never seen this import before, so we'll add it to the
    // stripImports Set to guard against inlining it again in the future.
    stripImports.add(resolvedImportUrl);
  }

  // If we can't find a bundle for the referenced import, we will just leave the
  // import link alone.  Unless the file was specifically excluded, we need to
  // record it as a "missing import".
  if (!importBundle) {
    if (!excludes ||
        !excludes.some(
            (u) => u === resolvedImportUrl ||
                resolvedImportUrl.startsWith(
                    urlUtils.ensureTrailingSlash(u)))) {
      docBundle.bundle.missingImports.add(resolvedImportUrl);
    }
    return;
  }

  // Don't inline an import into itself.
  if (document.url === resolvedImportUrl) {
    astUtils.removeElementAndNewline(linkTag);
    return;
  }

  const importIsInAnotherBundle = importBundle.url !== docBundle.url;

  // If the import is in another bundle and that bundle is in the stripImports
  // Set, we should not link to that bundle.
  const stripLinkToImportBundle = importIsInAnotherBundle &&
      stripImports.has(importBundle.url) &&
      // We just added resolvedImportUrl to stripImports, so we'll exclude
      // the case where resolved import url is not the import bundle.  This
      // scenario happens when importing a file from a bundle with the same
      // name as the original import, like an entrypoint or lazy edge.
      resolvedImportUrl !== importBundle.url;

  // If the html import refers to a file which is bundled and has a different
  // url, then lets just rewrite the href to point to the bundle url.
  if (importIsInAnotherBundle) {
    // We guard against inlining any other file from a bundle that has
    // already been imported.  A special exclusion is for lazy imports, which
    // are not deduplicated here, since we can not infer developer's intent
    // from here.
    if (stripLinkToImportBundle && !isLazy) {
      astUtils.removeElementAndNewline(linkTag);
      return;
    }

    const relative = urlUtils.relativeUrl(document.url, importBundle.url) ||
        importBundle.url;
    dom5.setAttribute(linkTag, 'href', relative);
    stripImports.add(importBundle.url);
    return;
  }

  // We don't actually inline a `lazy-import` because its loading is intended
  // to be deferred until the client requests it.
  if (isLazy) {
    return;
  }

  // If the analyzer could not load the import document, we can't inline it,
  // so lets skip it.
  const htmlImport = findInSet(
      document.getFeatures(
          {kind: 'html-import', imported: true, externalPackages: true}),
      (i) => i.document && i.document.url === resolvedImportUrl);
  if (!htmlImport) {
    return;
  }

  // When inlining html documents, we'll parse it as a fragment so that we do
  // not get html, head or body wrappers.
  const importAst = parse5.parseFragment(
      htmlImport.document.parsedDocument.contents, {locationInfo: true});
  rewriteAstToEmulateBaseTag(
      importAst, resolvedImportUrl, rewriteUrlsInTemplates);
  rewriteAstBaseUrl(
      importAst, resolvedImportUrl, document.url, rewriteUrlsInTemplates);

  if (enableSourcemaps) {
    const reparsedDoc = new ParsedHtmlDocument({
      url: document.url,
      contents: htmlImport.document.parsedDocument.contents,
      ast: importAst,
      isInline: false,
      locationOffset: undefined,
      astNode: null
    });
    await addOrUpdateSourcemapsForInlineScripts(
        analyzer, document, reparsedDoc, resolvedImportUrl);
  }
  const nestedImports = dom5.queryAll(importAst, matchers.htmlImport);

  // Move all of the import doc content after the html import.
  astUtils.insertAllBefore(linkTag.parentNode!, linkTag, importAst.childNodes!);
  astUtils.removeElementAndNewline(linkTag);

  // Record that the inlining took place.
  docBundle.bundle.inlinedHtmlImports.add(resolvedImportUrl);

  // Recursively process the nested imports.
  for (const nestedImport of nestedImports) {
    await inlineHtmlImport(
        analyzer,
        document,
        nestedImport,
        stripImports,
        docBundle,
        manifest,
        enableSourcemaps,
        rewriteUrlsInTemplates,
        excludes);
  }
}

/**
 * Inlines the contents of the document returned by the script tag's src url
 * into the script tag content and removes the src attribute.
 */
export async function inlineScript(
    analyzer: Analyzer,
    document: Document,
    scriptTag: ASTNode,
    docBundle: AssignedBundle,
    enableSourcemaps: boolean,
    excludes?: string[]) {
  const rawImportUrl = dom5.getAttribute(scriptTag, 'src')!;
  const importUrl = urlLib.resolve(document.url, rawImportUrl);
  if (!analyzer.canResolveUrl(importUrl)) {
    return;
  }
  const resolvedImportUrl = analyzer.resolveUrl(importUrl);
  if (excludes &&
      excludes.some(
          (e) => resolvedImportUrl === e ||
              resolvedImportUrl.startsWith(urlUtils.ensureTrailingSlash(e)))) {
    return;
  }
  const scriptImport = findInSet(
      document.getFeatures(
          {kind: 'html-script', imported: true, externalPackages: true}),
      (i) => i.document && i.document.url === resolvedImportUrl);
  if (!scriptImport) {
    docBundle.bundle.missingImports.add(resolvedImportUrl);
    return;
  }

  // Second argument 'true' tells encodeString to escape <script> tags.
  let scriptContent = scriptImport.document.parsedDocument.contents;

  if (enableSourcemaps) {
    // it's easier to calculate offsets if the external script contents don't
    // start on the same line as the script tag. Offset the map appropriately.
    scriptContent = await addOrUpdateSourcemapComment(
        analyzer, resolvedImportUrl, '\n' + scriptContent, -1, 0, 1, 0);
  }

  dom5.removeAttribute(scriptTag, 'src');
  dom5.setTextContent(scriptTag, encodeString(scriptContent, true));

  // Record that the inlining took place.
  docBundle.bundle.inlinedScripts.add(resolvedImportUrl);

  return scriptContent;
}

/**
 * Inlines the contents of the stylesheet returned by the link tag's href url
 * into a style tag and removes the link tag.
 */
export async function inlineStylesheet(
    analyzer: Analyzer,
    document: Document,
    cssLink: ASTNode,
    docBundle: AssignedBundle,
    excludes?: string[],
    rewriteUrlsInTemplates?: boolean) {
  const stylesheetUrl = dom5.getAttribute(cssLink, 'href')!;
  const importUrl = urlLib.resolve(document.url, stylesheetUrl);
  if (!analyzer.canResolveUrl(importUrl)) {
    return;
  }
  const resolvedImportUrl = analyzer.resolveUrl(importUrl);
  if (excludes &&
      excludes.some(
          (e) => resolvedImportUrl === e ||
              resolvedImportUrl.startsWith(urlUtils.ensureTrailingSlash(e)))) {
    return;
  }
  const stylesheetImport =  // HACK(usergenic): clang-format workaround
      findInSet(
          document.getFeatures(
              {kind: 'html-style', imported: true, externalPackages: true}),
          (i) => i.document && i.document.url === resolvedImportUrl) ||
      findInSet(
          document.getFeatures(
              {kind: 'css-import', imported: true, externalPackages: true}),
          (i) => i.document && i.document.url === resolvedImportUrl);
  if (!stylesheetImport) {
    docBundle.bundle.missingImports.add(resolvedImportUrl);
    return;
  }
  const stylesheetContent = stylesheetImport.document.parsedDocument.contents;
  const media = dom5.getAttribute(cssLink, 'media');

  let newBaseUrl = document.url;

  // If the css link we are about to inline is inside of a dom-module, the
  // new base url must be calculated using the assetpath of the dom-module
  // if present, since Polymer will honor assetpath when resolving urls in
  // `<style>` tags, even inside of `<template>` tags.
  const parentDomModule =
      findAncestor(cssLink, dom5.predicates.hasTagName('dom-module'));
  if (!rewriteUrlsInTemplates && parentDomModule &&
      dom5.hasAttribute(parentDomModule, 'assetpath')) {
    const assetPath = dom5.getAttribute(parentDomModule, 'assetpath') || '';
    if (assetPath) {
      newBaseUrl = urlLib.resolve(newBaseUrl, assetPath);
    }
  }
  const resolvedStylesheetContent =
      rewriteCssTextBaseUrl(stylesheetContent, resolvedImportUrl, newBaseUrl);
  const styleNode = dom5.constructors.element('style');
  if (media) {
    dom5.setAttribute(styleNode, 'media', media);
  }

  dom5.replace(cssLink, styleNode);
  dom5.setTextContent(styleNode, resolvedStylesheetContent);

  // Record that the inlining took place.
  docBundle.bundle.inlinedStyles.add(resolvedImportUrl);
  return styleNode;
}

/**
 * Given an import document with a base tag, transform all of its URLs and set
 * link and form target attributes and remove the base tag.
 */
export function rewriteAstToEmulateBaseTag(
    ast: ASTNode, docUrl: UrlString, rewriteUrlsInTemplates?: boolean) {
  const baseTag = dom5.query(ast, matchers.base);
  const p = dom5.predicates;
  // If there's no base tag, there's nothing to do.
  if (!baseTag) {
    return;
  }
  for (const baseTag of dom5.queryAll(ast, matchers.base)) {
    astUtils.removeElementAndNewline(baseTag);
  }
  if (dom5.predicates.hasAttr('href')(baseTag)) {
    const baseUrl = urlLib.resolve(docUrl, dom5.getAttribute(baseTag, 'href')!);
    rewriteAstBaseUrl(ast, baseUrl, docUrl, rewriteUrlsInTemplates);
  }
  if (p.hasAttr('target')(baseTag)) {
    const baseTarget = dom5.getAttribute(baseTag, 'target')!;
    const tagsToTarget = dom5.queryAll(
        ast,
        p.AND(
            p.OR(p.hasTagName('a'), p.hasTagName('form')),
            p.NOT(p.hasAttr('target'))));
    for (const tag of tagsToTarget) {
      dom5.setAttribute(tag, 'target', baseTarget);
    }
  }
}

/**
 * Walk through an import document, and rewrite all urls so they are
 * correctly relative to the main document url as they've been
 * imported from the import url.
 */
export function rewriteAstBaseUrl(
    ast: ASTNode,
    oldBaseUrl: UrlString,
    newBaseUrl: UrlString,
    rewriteUrlsInTemplates?: boolean) {
  rewriteElementAttrsBaseUrl(
      ast, oldBaseUrl, newBaseUrl, rewriteUrlsInTemplates);
  rewriteStyleTagsBaseUrl(ast, oldBaseUrl, newBaseUrl, rewriteUrlsInTemplates);
  setDomModuleAssetpaths(ast, oldBaseUrl, newBaseUrl);
}

/**
 * Walk through inline scripts of an import document.
 * For each script create identity source maps unless one already exists.
 *
 * The generated script mapping detail is the relative location within
 * the script tag. Later this will be updated to account for the
 * line offset within the final bundle.
 */
export async function addOrUpdateSourcemapsForInlineScripts(
    analyzer: Analyzer,
    originalDoc: Document,
    reparsedDoc: ParsedHtmlDocument,
    oldBaseUrl: UrlString) {
  const inlineScripts =
      dom5.queryAll(reparsedDoc.ast, matchers.inlineJavascript);
  const promises = inlineScripts.map(scriptAst => {
    let content = dom5.getTextContent(scriptAst);
    const sourceRange = reparsedDoc.sourceRangeForStartTag(scriptAst)!;
    return addOrUpdateSourcemapComment(
               analyzer,
               oldBaseUrl,
               content,
               sourceRange.end.line,
               sourceRange.end.column,
               -sourceRange.end.line + 1,
               -sourceRange.end.column)
        .then(updatedContent => {
          dom5.setTextContent(scriptAst, encodeString(updatedContent));
        });
  });

  return Promise.all(promises);
}

/**
 * Walk the ancestor nodes from parentNode up to document root, returning the
 * first one matching the predicate function.
 */
function findAncestor(ast: ASTNode, predicate: dom5.Predicate): ASTNode|
    undefined {
  // The visited set protects us against circular references.
  const visited = new Set();
  while (ast.parentNode && !visited.has(ast.parentNode)) {
    if (predicate(ast.parentNode)) {
      return ast.parentNode;
    }
    visited.add(ast.parentNode);
    ast = ast.parentNode;
  }
  return undefined;
}


/**
 * Simple utility function used to find an item in a set with a predicate
 * function.  Analagous to Array.find(), without requiring converting the set
 * an Array.
 */
function findInSet<T>(set: Set<T>, predicate: (item: T) => boolean): T|
    undefined {
  for (const item of set) {
    if (predicate(item)) {
      return item;
    }
  }
  return;
}

/**
 * Given a string of CSS, return a version where all occurrences of urls,
 * have been rewritten based on the relationship of the old base url to the
 * new base url.
 */
function rewriteCssTextBaseUrl(
    cssText: string, oldBaseUrl: UrlString, newBaseUrl: UrlString): string {
  return cssText.replace(constants.URL, (match) => {
    let path = match.replace(/["']/g, '').slice(4, -1);
    path = urlUtils.rewriteHrefBaseUrl(path, oldBaseUrl, newBaseUrl);
    return 'url("' + path + '")';
  });
}

/**
 * Find all element attributes which express urls and rewrite them so they
 * are based on the relationship of the old base url to the new base url.
 */
function rewriteElementAttrsBaseUrl(
    ast: ASTNode,
    oldBaseUrl: UrlString,
    newBaseUrl: UrlString,
    rewriteUrlsInTemplates?: boolean) {
  const nodes = dom5.queryAll(
      ast,
      matchers.elementsWithUrlAttrsToRewrite,
      undefined,
      rewriteUrlsInTemplates ? dom5.childNodesIncludeTemplate :
                               dom5.defaultChildNodes);
  for (const node of nodes) {
    for (const attr of constants.URL_ATTR) {
      const attrValue = dom5.getAttribute(node, attr);
      if (attrValue && !urlUtils.isTemplatedUrl(attrValue)) {
        let relUrl: UrlString;
        if (attr === 'style') {
          relUrl = rewriteCssTextBaseUrl(attrValue, oldBaseUrl, newBaseUrl);
        } else {
          relUrl =
              urlUtils.rewriteHrefBaseUrl(attrValue, oldBaseUrl, newBaseUrl);
        }
        dom5.setAttribute(node, attr, relUrl);
      }
    }
  }
}

/**
 * Find all urls in imported style nodes and rewrite them so they are based
 * on the relationship of the old base url to the new base url.
 */
function rewriteStyleTagsBaseUrl(
    ast: ASTNode,
    oldBaseUrl: UrlString,
    newBaseUrl: UrlString,
    rewriteUrlsInTemplates: boolean = false) {
  const childNodesOption = rewriteUrlsInTemplates ?
      dom5.childNodesIncludeTemplate :
      dom5.defaultChildNodes;

  // If `rewriteUrlsInTemplates` is `true`, include `<style>` tags that are
  // inside `<template>`.
  const styleNodes =
      dom5.queryAll(ast, matchers.styleMatcher, undefined, childNodesOption);

  // Unless rewriteUrlsInTemplates is on, if a `<style>` tag is anywhere
  // inside a `<dom-module>` tag, then it should not have its urls rewritten.
  if (!rewriteUrlsInTemplates) {
    for (const domModule of dom5.queryAll(
             ast, dom5.predicates.hasTagName('dom-module'))) {
      for (const styleNode of dom5.queryAll(
               domModule, matchers.styleMatcher, undefined, childNodesOption)) {
        const styleNodeIndex = styleNodes.indexOf(styleNode);
        if (styleNodeIndex > -1) {
          styleNodes.splice(styleNodeIndex, 1);
        }
      }
    }
  }

  for (const node of styleNodes) {
    let styleText = dom5.getTextContent(node);
    styleText = rewriteCssTextBaseUrl(styleText, oldBaseUrl, newBaseUrl);
    dom5.setTextContent(node, styleText);
  }
}

/**
 * Set the assetpath attribute of all imported dom-modules which don't yet
 * have them if the base urls are different.
 */
function setDomModuleAssetpaths(
    ast: ASTNode, oldBaseUrl: UrlString, newBaseUrl: UrlString) {
  const domModules = dom5.queryAll(ast, matchers.domModuleWithoutAssetpath);
  for (let i = 0, node: ASTNode; i < domModules.length; i++) {
    node = domModules[i];
    const assetPathUrl = urlUtils.relativeUrl(
        newBaseUrl, urlUtils.stripUrlFileSearchAndHash(oldBaseUrl));

    // There's no reason to set an assetpath on a dom-module if its different
    // from the document's base.
    if (assetPathUrl !== '') {
      dom5.setAttribute(node, 'assetpath', assetPathUrl);
    }
  }
}
