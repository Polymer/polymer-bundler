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
export function heredoc(
    strings: TemplateStringsArray, ...values: any[]): string {
  let buildAString = '';
  for (const s of strings) {
    buildAString += s;
    if (values.length > 0) {
      buildAString += values.shift();
    }
  }
  buildAString = undent(buildAString);
  // Remove first blank line.
  buildAString = buildAString.replace(/^ *\n/, '');
  return buildAString;
}

export function mindent(text: string): number {
  const matches = text.match(/^ *(?=[^ \n])/mg) || [];
  let mindent = null;
  for (const match of matches) {
    if (mindent === null || mindent > match.length) {
      mindent = match.length;
    }
  }
  return mindent === null ? 0 : mindent;
}

export function undent(text: string): string {
  return text.replace(new RegExp(`^ {0,${mindent(text)}}`, 'mg'), '');
}
