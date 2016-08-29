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
import {predicates as p} from 'dom5';
import * as parse5 from 'parse5';

export interface Matcher { (node: parse5.ASTNode): boolean; }
;

export const urlAttrMatchers: (Matcher)[] =
    constants.URL_ATTR.map(attr => p.hasAttr(attr));

export const urlAttrs: Matcher = p.OR.apply(null, urlAttrMatchers);

export const jsMatcher: Matcher = p.AND(
    p.hasTagName('script'),
    p.OR(
        p.NOT(p.hasAttr('type')), p.hasAttrValue('type', 'text/javascript'),
        p.hasAttrValue('type', 'application/javascript')));

export const externalStyle: Matcher =
    p.AND(p.hasTagName('link'), p.hasAttrValue('rel', 'stylesheet'));
// polymer specific external stylesheet
export const polymerExternalStyle: Matcher = p.AND(
    p.hasTagName('link'), p.hasAttrValue('rel', 'import'),
    p.hasAttrValue('type', 'css'));

export const styleMatcher: Matcher = p.AND(
    p.hasTagName('style'),
    p.OR(p.NOT(p.hasAttr('type')), p.hasAttrValue('type', 'text/css')));

export const targetMatcher: Matcher = p.AND(
    p.OR(p.hasTagName('a'), p.hasTagName('form')), p.NOT(p.hasAttr('target')));

export const head: Matcher = p.hasTagName('head');
export const body: Matcher = p.hasTagName('body');
export const base: Matcher = p.hasTagName('base');
export const domModule: Matcher = p.AND(
    p.hasTagName('dom-module'), p.hasAttr('id'), p.NOT(p.hasAttr('assetpath')));
export const meta: Matcher = p.AND(p.hasTagName('meta'), p.hasAttr('charset'));
export const polymerElement: Matcher = p.hasTagName('polymer-element');
export const externalJavascript: Matcher = p.AND(p.hasAttr('src'), jsMatcher);
export const inlineJavascript: Matcher =
    p.AND(p.NOT(p.hasAttr('src')), jsMatcher);
export const htmlImport: Matcher = p.AND(
    p.hasTagName('link'), p.hasAttrValue('rel', 'import'), p.hasAttr('href'));
