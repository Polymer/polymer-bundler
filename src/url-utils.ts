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

// jshint node:true
'use strict';

import * as path from 'path';
import * as url from 'url';
import * as dom5 from 'dom5';
import * as matchers from './matchers';
import {ASTNode} from 'parse5';
import constants from './constants';

const pathPosix = path.posix;

const sharedRelativeUrlProperties =
    ['protocol', 'slashes', 'auth', 'host', 'port', 'hostname'];


// Returns true if the href is an absolute path.
export function isAbsolutePath(href: string): boolean {
  return constants.ABS_URL.test(href);
}

// Returns true if the href is a templated value, i.e. `{{...}}` or `[[...]]`
export function isTemplatedUrl(href: string): boolean {
  return href.search(constants.URL_TEMPLATE) >= 0;
}

// Computes the most succinct form of a relative URL representing the path from
// the `fromUri` to the `toUri`.  Function is URL aware, not path-aware, so
// `/a/` is correctly treated as a folder path where `/a` is not.
export function relativeUrl(fromUri: string, toUri: string): string {
  const fromUrl = url.parse(fromUri)!;
  const toUrl = url.parse(toUri)!;
  // Return the toUri as-is if there are conflicting components which
  // prohibit
  // calculating a relative form.
  if (sharedRelativeUrlProperties.some(
          p => toUrl[p] !== null && fromUrl[p] !== toUrl[p])) {
    return toUri;
  }
  const fromDir = fromUrl.pathname !== undefined ?
      fromUrl.pathname.replace(/[^/]+$/, '') :
      '';
  const toDir = toUrl.pathname !== undefined ? toUrl.pathname : '';
  // Note, below, the _ character is appended so that paths with trailing
  // slash retain the trailing slash in the path.relative result.
  const relPath = path.relative(fromDir, toDir + '_').replace(/_$/, '');
  sharedRelativeUrlProperties.forEach(p => toUrl[p] = null);
  toUrl.path = undefined;
  toUrl.pathname = relPath;
  return url.format(toUrl);
}

// Modifies an href by the relative difference between the `mainDocUrl` and
// `importUrl` which is the location of the imported document containing the
// href.  If `basePath` is defined, it rewrites the path as an absolute path
// using `basePath` as its root.
export function rewriteImportedRelPath(
    basePath: string|undefined, importUrl: string, mainDocUrl: string,
    href: string): string {
  if (isAbsolutePath(href)) {
    return href;
  }
  const absUrl = url.resolve(importUrl, href);
  if (basePath) {
    return url.resolve(basePath, relativeUrl(mainDocUrl, absUrl));
  }
  const parsedFrom = url.parse(mainDocUrl);
  const parsedTo = url.parse(absUrl);
  if (parsedFrom.protocol === parsedTo.protocol &&
      parsedFrom.host === parsedTo.host) {
    const pathname = pathPosix.relative(
        pathPosix.dirname(parsedFrom.pathname || ''), parsedTo.pathname || '');
    return url.format(
        {pathname: pathname, search: parsedTo.search, hash: parsedTo.hash});
  }
  return absUrl;
}
