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
import * as clone from 'clone';
import {Document} from 'polymer-analyzer';

import {getAnalysisDocument} from './analyzer-utils';
import {serialize} from './babel-utils';
import {AssignedBundle, BundleManifest} from './bundle-manifest';
import {Bundler} from './bundler';
import {BundledDocument} from './document-collection';

export class Es6ModuleBundler {
  document: Document;

  constructor(
      public bundler: Bundler,
      public assignedBundle: AssignedBundle,
      public manifest: BundleManifest) {
  }

  async bundle(): Promise<BundledDocument> {
    this.document = await this._prepareBundleDocument();
    let ast = clone(this.document.parsedDocument.ast);
    const {code: content} = serialize(ast);
    const files = [...this.assignedBundle.bundle.files];
    // TODO(usergenic): Keep going!
    return {ast, content, files};
  }

  /**
   * Generate a fresh document to bundle contents into.  If we're building a
   * bundle which is based on an existing file, we should load that file and
   * prepare it as the bundle document, otherwise we'll create a clean/empty JS
   * document.
   */
  private async _prepareBundleDocument(): Promise<Document> {
    if (!this.assignedBundle.bundle.files.has(this.assignedBundle.url)) {
      return this.bundler.analyzeContents(this.assignedBundle.url, '');
    }
    const analysis =
        await this.bundler.analyzer.analyze([this.assignedBundle.url]);
    const document = getAnalysisDocument(analysis, this.assignedBundle.url);
    return document;
  }
}
