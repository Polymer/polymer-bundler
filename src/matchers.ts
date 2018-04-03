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

// jshint node: true
'use strict';

import constants from './constants';
import {predicates} from 'dom5';
import * as parse5 from 'parse5';

export interface Matcher { (node: parse5.ASTNode): boolean; }

// TODO(aomarks) Look at what's using this matcher. A number of code paths
// should probably not be excluding type=module scripts.
export const nonModuleScript: Matcher = predicates.AND(
    predicates.hasTagName('script'),
    predicates.OR(
        predicates.NOT(predicates.hasAttr('type')),
        predicates.hasAttrValue('type', 'text/javascript'),
        predicates.hasAttrValue('type', 'application/javascript')));

export const moduleScript: Matcher = predicates.AND(
    predicates.hasTagName('script'), predicates.hasAttrValue('type', 'module'));

export const externalStyle: Matcher = predicates.AND(
    predicates.hasTagName('link'),
    predicates.hasAttrValue('rel', 'stylesheet'));
// polymer specific external stylesheet
export const polymerExternalStyle: Matcher = predicates.AND(
    predicates.hasTagName('link'),
    predicates.hasAttrValue('rel', 'import'),
    predicates.hasAttrValue('type', 'css'));

export const styleMatcher: Matcher = predicates.AND(
    predicates.hasTagName('style'),
    predicates.OR(
        predicates.NOT(predicates.hasAttr('type')),
        predicates.hasAttrValue('type', 'text/css')));

export const targetMatcher: Matcher = predicates.AND(
    predicates.OR(predicates.hasTagName('a'), predicates.hasTagName('form')),
    predicates.NOT(predicates.hasAttr('target')));

export const head: Matcher = predicates.hasTagName('head');
export const body: Matcher = predicates.hasTagName('body');
export const base: Matcher = predicates.hasTagName('base');
export const template: Matcher = predicates.hasTagName('template');
export const domModuleWithoutAssetpath: Matcher = predicates.AND(
    predicates.hasTagName('dom-module'),
    predicates.hasAttr('id'),
    predicates.NOT(predicates.hasAttr('assetpath')));
export const polymerElement: Matcher = predicates.hasTagName('polymer-element');

export const externalNonModuleScript: Matcher =
    predicates.AND(predicates.hasAttr('src'), nonModuleScript);

export const inlineNonModuleScript: Matcher =
    predicates.AND(predicates.NOT(predicates.hasAttr('src')), nonModuleScript);

export const externalModuleScript: Matcher =
    predicates.AND(predicates.hasAttr('src'), moduleScript);

export const eagerHtmlImport: Matcher = predicates.AND(
    predicates.hasTagName('link'),
    predicates.hasAttrValue('rel', 'import'),
    predicates.hasAttr('href'),
    predicates.OR(
        predicates.hasAttrValue('type', 'text/html'),
        predicates.hasAttrValue('type', 'html'),
        predicates.NOT(predicates.hasAttr('type'))));
export const lazyHtmlImport: Matcher = predicates.AND(
    predicates.hasTagName('link'),
    predicates.hasAttrValue('rel', 'lazy-import'),
    predicates.hasAttr('href'),
    predicates.OR(
        predicates.hasAttrValue('type', 'text/html'),
        predicates.hasAttrValue('type', 'html'),
        predicates.NOT(predicates.hasAttr('type'))));
export const htmlImport: Matcher =
    predicates.OR(eagerHtmlImport, lazyHtmlImport);
export const stylesheetImport: Matcher = predicates.AND(
    predicates.hasTagName('link'),
    predicates.hasAttrValue('rel', 'import'),
    predicates.hasAttr('href'),
    predicates.hasAttrValue('type', 'css'));
export const hiddenDiv: Matcher = predicates.AND(
    predicates.hasTagName('div'),
    predicates.hasAttr('hidden'),
    predicates.hasAttr('by-polymer-bundler'));
export const inHiddenDiv: Matcher = predicates.parentMatches(hiddenDiv);

export const elementsWithUrlAttrsToRewrite: Matcher = predicates.AND(
    predicates.OR(
        ...constants.URL_ATTR.map((attr) => predicates.hasAttr(attr))),
    predicates.NOT(predicates.AND(
        predicates.parentMatches(predicates.hasTagName('dom-module')),
        lazyHtmlImport)));

/**
 * TODO(usergenic): From garlicnation's PR comment - "This matcher needs to deal
 * with a number of edge cases. Whitespace-only text nodes should be ignored,
 * text nodes with meaningful space should be preserved. Comments should be
 * ignored if --strip-comments is set. License comments should be deduplicated
 * and moved to the start of the document."
 */
const nextToHiddenDiv = (offset: number) => {
  return (node: parse5.ASTNode) => {
    const siblings = node.parentNode!.childNodes!;
    const hiddenDivIndex = siblings.indexOf(node) + offset;
    if (hiddenDivIndex < 0 || hiddenDivIndex >= siblings.length) {
      return false;
    }
    return hiddenDiv(siblings[hiddenDivIndex]);
  };
};
export const beforeHiddenDiv = nextToHiddenDiv(1);
export const afterHiddenDiv = nextToHiddenDiv(-1);
export const orderedImperative: Matcher = predicates.OR(
    eagerHtmlImport,
    nonModuleScript,
    styleMatcher,
    externalStyle,
    polymerExternalStyle);
