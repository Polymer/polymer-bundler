/**
 * @license
 * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
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
import {Analysis, Document, Warning} from 'polymer-analyzer';

export function getAnalysisDocument(analysis: Analysis, url: string): Document {
  const document = analysis.getDocument(url);
  if (document instanceof Document) {
    return document;
  }
  if (document instanceof Warning || !document ||
      (typeof document === 'object' && document['code'] &&
       document['message'])) {
    const reason = document && document.message || 'unknown';
    const message = `Unable to get document ${url}: ${reason}`;
    throw new Error(message);
  }
  throw new Error(
      `Bundler was given a different version of polymer-analyzer than ` +
      `expected.  Please ensure only one version of polymer-analyzer ` +
      `present in node_modules folder:\n\n` +
      `$ npm ls polymer- analyzer`);
}
