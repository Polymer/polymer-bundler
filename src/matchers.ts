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
import {ASTNode} from 'parse5';

export const urlAttrMatchers = constants.URL_ATTR.map(attr => p.hasAttr(attr));

export const urlAttrs = p.OR.apply(null, urlAttrMatchers);

export const jsMatcher = p.AND(
    p.hasTagName('script'),
    p.OR(
        p.NOT(p.hasAttr('type')), p.hasAttrValue('type', 'text/javascript'),
        p.hasAttrValue('type', 'application/javascript')));

export const externalStyle =
    p.AND(p.hasTagName('link'), p.hasAttrValue('rel', 'stylesheet'));
// polymer specific external stylesheet
export const polymerExternalStyle = p.AND(
    p.hasTagName('link'), p.hasAttrValue('rel', 'import'),
    p.hasAttrValue('type', 'css'));

export const styleMatcher = p.AND(
    p.hasTagName('style'),
    p.OR(p.NOT(p.hasAttr('type')), p.hasAttrValue('type', 'text/css')));

export const targetMatcher = p.AND(
    p.OR(p.hasTagName('a'), p.hasTagName('form')), p.NOT(p.hasAttr('target')));

export const head = p.hasTagName('head');
export const body = p.hasTagName('body');
export const base = p.hasTagName('base');
export const domModule = p.AND(
    p.hasTagName('dom-module'), p.hasAttr('id'), p.NOT(p.hasAttr('assetpath')));
export const meta = p.AND(p.hasTagName('meta'), p.hasAttr('charset'));
export const polymerElement = p.hasTagName('polymer-element');
export const ALL_CSS_LINK = p.OR(externalStyle, polymerExternalStyle);
export const JS_SRC = p.AND(p.hasAttr('src'), jsMatcher);
export const JS_INLINE = p.AND(p.NOT(p.hasAttr('src')), jsMatcher);
export polymerElement = p.hasTagName('polymer-element');
export urlAttrs = urlAttrs;
export targetMatcher = targetMatcher;
export polymerExternalStyle = polymerExternalStyle;
export JS = jsMatcher;
export CSS = styleMatcher;
export CSS_LINK = externalStyle;
export POLY_CSS_LINK = polymerExternalStyle;
export ALL_CSS_LINK = p.OR(externalStyle, polymerExternalStyle);
export JS_SRC = p.AND(p.hasAttr('src'), jsMatcher);
export JS_INLINE = p.AND(p.NOT(p.hasAttr('src')), jsMatcher);
