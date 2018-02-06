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
import {parseUrl} from 'polymer-analyzer/lib/core/utils';
import constants from './constants';
import {FileRelativeUrl, ResolvedUrl} from 'polymer-analyzer';
import Uri from 'vscode-uri';

const sharedRelativeUrlProperties =
    ['protocol', 'slashes', 'auth', 'host', 'port', 'hostname'];

/**
 * Given a string representing a URL or path of some form, append a `/`
 * character if it doesn't already end with one.
 */
export function ensureTrailingSlash<T>(href: T): T {
  const hrefString = href as any as string;
  return hrefString.endsWith('/') ? href : (href + '/') as any as T;
}

/**
 * Returns a WHATWG ResolvedURL for a filename on local filesystem.
 */
export function getFileUrl(filename: string): ResolvedUrl {
  return Uri.file(resolvePath(filename)).toString() as ResolvedUrl;
}

/**
 * Returns a URL with the basename removed from the pathname.  Strips the
 * search off of the URL as well, since it will not apply.
 */
export function stripUrlFileSearchAndHash<T>(href: T): T {
  const u = url.parse(href as any);
  // Using != so tests for null AND undefined
  if (u.pathname != null) {
    // Suffix path with `_` so that `/a/b/` is treated as `/a/b/_` and that
    // `path.posix.dirname()` returns `/a/b` because it would otherwise
    // return `/a` incorrectly.
    u.pathname = ensureTrailingSlash(
        path.posix.dirname(u.pathname + '_') as FileRelativeUrl);
  }
  // Assigning to undefined because TSC says type of these is
  // `string | undefined` as opposed to `string | null`
  u.search = undefined;
  u.hash = undefined;
  return url.format(u) as any as T;
}

/**
 * Returns true if the href is an absolute path.
 */
export function isAbsolutePath(href: string): boolean {
  return constants.ABS_URL.test(href);
}

/**
 * Returns true if the href is a templated value, i.e. `{{...}}` or `[[...]]`
 */
export function isTemplatedUrl(href: string): boolean {
  return href.search(constants.URL_TEMPLATE) >= 0;
}

/**
 * TODO(usergenic): Remove this hack if nodejs bug is fixed:
 * https://github.com/nodejs/node/issues/13683
 */
function pathPosixRelative(from: string, to: string): string {
  const relative = path.posix.relative(from, to);
  return path === path.win32 ? relative.replace(/\.\.\.\./g, '../..') :
                               relative;
}

/**
 * Computes the most succinct form of a relative URL representing the path from
 * the `fromUri` to the `toUri`.  Function is URL aware, not path-aware, so
 * `/a/` is correctly treated as a folder path where `/a` is not.
 *
 * TODO(usergenic): Delegate all uses of this function to the analyzer's
 * `.urlResolver.relative()` method.  This will require passing along the
 * bundler's instantiated analyzer all over the place in import utils, so
 * some significant refactor is probably due there.
 */
export function relativeUrl(
    fromUri: ResolvedUrl, toUri: ResolvedUrl): FileRelativeUrl {
  const fromUrl = parseUrl(fromUri)!;
  const toUrl = parseUrl(toUri)!;
  // Return the toUri as-is if there are conflicting components which
  // prohibit calculating a relative form.
  if (sharedRelativeUrlProperties.some(
          (p) => toUrl[p] !== null && fromUrl[p] !== toUrl[p])) {
    return toUri as any as FileRelativeUrl;
  }
  const fromDir = fromUrl.pathname !== undefined ?
      fromUrl.pathname.replace(/[^/]+$/, '') :
      '';
  const toDir = toUrl.pathname !== undefined ? toUrl.pathname : '';
  // Note, below, the _ character is appended so that paths with trailing
  // slash retain the trailing slash in the path.relative result.
  const relPath = pathPosixRelative(fromDir, toDir + '_').replace(/_$/, '');
  sharedRelativeUrlProperties.forEach((p) => toUrl[p] = null);
  toUrl.path = undefined;
  toUrl.pathname = relPath;
  return url.format(toUrl) as FileRelativeUrl;
}

/**
 * The path library's resolve function drops the trailing slash from the input
 * when returning the result.  This is bad because clients of the function then
 * have to ensure it is reapplied conditionally.  This function resolves the
 * input path while preserving the trailing slash, when present.
 */
export function resolvePath(...segments: string[]): string {
  if (segments.length === 0) {
    // Special cwd case
    return ensureTrailingSlash(path.resolve());
  }
  const lastSegment = segments[segments.length - 1];
  const resolved = path.resolve(...segments);
  return lastSegment.endsWith('/') ? ensureTrailingSlash(resolved) : resolved;
}

/**
 * Modifies an href by the relative difference between the old base URL and
 * the new base URL.
 */
export function rewriteHrefBaseUrl<T>(
    href: T, oldBaseUrl: ResolvedUrl, newBaseUrl: ResolvedUrl): T|
    FileRelativeUrl {
  if (isAbsolutePath(href as any)) {
    return href;
  }
  const relativeUrl = url.resolve(oldBaseUrl, href as any);
  const parsedFrom = url.parse(newBaseUrl);
  const parsedTo = url.parse(relativeUrl);
  if (parsedFrom.protocol === parsedTo.protocol &&
      parsedFrom.host === parsedTo.host) {
    let dirFrom = path.posix.dirname(
        // Have to append a '_' to the path because path.posix.dirname('foo/')
        // returns '.' instead of 'foo'.
        parsedFrom.pathname ? parsedFrom.pathname + '_' : '');
    let pathTo = parsedTo.pathname || '';
    if (isAbsolutePath(oldBaseUrl) || isAbsolutePath(newBaseUrl)) {
      dirFrom = makeAbsolutePath(dirFrom);
      pathTo = makeAbsolutePath(pathTo);
    }
    const pathname = pathPosixRelative(dirFrom, pathTo);
    return url.format({
      pathname: pathname,
      search: parsedTo.search,
      hash: parsedTo.hash,
    }) as FileRelativeUrl;
  }
  return relativeUrl as FileRelativeUrl;
}

function makeAbsolutePath(path: string): string {
  return path.startsWith('/') ? path : '/' + path;
}
