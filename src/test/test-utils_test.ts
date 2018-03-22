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
import {assert} from 'chai';

import {heredoc, inMemoryAnalyzer, mindent, undent} from './test-utils';

suite('test-utils', () => {

  suite('inMemoryAnalyzer', () => {

    test('can load the provided string literals as files', async () => {
      const analyzer = inMemoryAnalyzer({
        'index.html': `
        <link rel="import" href="components/cool-element/cool-element.html">
        <cool-element></cool-element>
      `,
        'components/cool-element/cool-element.html': `
        <!-- something something custom elements -->
      `,
      });
      const indexUrl = analyzer.resolveUrl('index.html')!;
      const elementUrl =
          analyzer.resolveUrl('components/cool-element/cool-element.html')!;
      const analysis = await analyzer.analyze([indexUrl, elementUrl]);
      const indexResult = analysis.getDocument(indexUrl);
      assert.equal(indexResult.successful, true);
      const indexDocument = indexResult.successful && indexResult.value;
      assert.deepEqual(
          indexDocument && indexDocument.parsedDocument.contents,
          '<link rel="import" href="components/cool-element/cool-element.html">\n' +
              '<cool-element></cool-element>\n');
    });
  });

  suite('heredoc', () => {

    test('fixes indent level', () => {
      assert.deepEqual(heredoc`
          check

        this
            out
      `, '  check\n\nthis\n    out\n');
    });
  });

  suite('mindent', () => {

    test('returns the minimum indentation in a string', () => {
      assert.equal(mindent('  x'), 2);
      assert.equal(mindent(`
          x
        y <-- 8 characters indented
            z
      `), 8);
    });
  });

  suite('undent', () => {

    test('removes the minimum indentation from a string', () => {
      assert.deepEqual(undent('  x'), 'x');
      assert.deepEqual(undent(`
          x
        y
            z
      `), '\n  x\ny\n    z\n');
    });
  });
});
