/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

// jshint node: true
'use strict';

import constants from './constants';
import {predicates as p} from 'dom5';

const urlAttrMatchers = constants.URL_ATTR.map(attr => p.hasAttr(attr));

const urlAttrs = p.OR.apply(null, urlAttrMatchers);

const jsMatcher = p.AND(
  p.hasTagName('script'),
  p.OR(
    p.NOT(
      p.hasAttr('type')
    ),
    p.hasAttrValue('type', 'text/javascript'),
    p.hasAttrValue('type', 'application/javascript')
  )
);

const externalStyle = p.AND(
  p.hasTagName('link'),
  p.hasAttrValue('rel', 'stylesheet')
);
// polymer specific external stylesheet
const polymerExternalStyle = p.AND(
  p.hasTagName('link'),
  p.hasAttrValue('rel', 'import'),
  p.hasAttrValue('type', 'css')
);

const styleMatcher = p.AND(
  p.hasTagName('style'),
  p.OR(
    p.NOT(
      p.hasAttr('type')
    ),
    p.hasAttrValue('type', 'text/css')
  )
);

const targetMatcher = p.AND(
  p.OR(
    p.hasTagName('a'),
    p.hasTagName('form')
  ),
  p.NOT(p.hasAttr('target'))
);

export default {
  head: p.hasTagName('head'),
  body: p.hasTagName('body'),
  base: p.hasTagName('base'),
  domModule: p.AND(
    p.hasTagName('dom-module'),
    p.hasAttr('id'),
    p.NOT(
      p.hasAttr('assetpath')
    )
  ),
  meta: p.AND(
    p.hasTagName('meta'),
    p.hasAttr('charset')
  ),
  polymerElement: p.hasTagName('polymer-element'),
  urlAttrs: urlAttrs,
  targetMatcher: targetMatcher,
  polymerExternalStyle: polymerExternalStyle,
  JS: jsMatcher,
  CSS: styleMatcher,
  CSS_LINK: externalStyle,
  POLY_CSS_LINK: polymerExternalStyle,
  ALL_CSS_LINK: p.OR(externalStyle, polymerExternalStyle),
  JS_SRC: p.AND(p.hasAttr('src'), jsMatcher),
  JS_INLINE: p.AND(p.NOT(p.hasAttr('src')), jsMatcher)
};
