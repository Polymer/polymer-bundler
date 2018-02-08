/**
 * @license
 * Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
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

/**
 * Simple utility function used to find an item in a set with a predicate
 * function.  Analagous to Array.find(), without requiring converting the set
 * an Array.
 */
export function find<T>(items: Iterable<T>, predicate: (item: T) => boolean): T|
    undefined {
  for (const item of items) {
    if (predicate(item)) {
      return item;
    }
  }
}

/**
 * Returns a set of unique/distinct values returned by calling the given
 * function on each item.
 */
export function uniq<T, R>(items: Iterable<T>, map: (item: T) => R): Set<R> {
  const results = new Set();
  for (const item of items) {
    results.add(map(item));
  }
  return results;
}
