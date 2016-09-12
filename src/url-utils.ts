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

export function isAbsoluteUrl(href: string): boolean {
  return constants.ABS_URL.test(href);
}

export function isTemplatedUrl(href: string): boolean {
  return href.search(constants.URL_TEMPLATE) >= 0;
}


export function pathToUrl(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  if (process.platform === 'win32') {
    // encode C:\foo\ as C:/foo/
    return absolutePath.split('\\').join('/');
  } else {
    return absolutePath;
  }
}

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


export function rewriteImportedRelPath(
    basePath: string|undefined, importUrl: string, mainDocUrl: string,
    relUrl: string): string {
  if (isAbsoluteUrl(relUrl)) {
    return relUrl;
  }
  const absUrl = url.resolve(importUrl, relUrl);
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

export function urlToPath(uri: string): string {
  const parsed = url.parse(uri);
  const pathname = parsed.pathname || '';
  if (process.platform === 'win32') {
    return parsed.protocol + pathname.split('/').join('\\');
  } else {
    return (parsed.protocol || '') + pathname;
  }
}
