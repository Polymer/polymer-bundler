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
/// <reference path="../../node_modules/@types/chai/index.d.ts" />
/// <reference path="../../node_modules/@types/node/index.d.ts" />
/// <reference path="../../node_modules/@types/mocha/index.d.ts" />
import {assert} from 'chai';

import {generateShellMergeStrategy} from '../bundle-manifest';
import {Bundler} from '../bundler';

import {heredoc, inMemoryAnalyzer} from './test-utils';

suite('Es6 Module Bundling', () => {

  suite('rewriting import specifiers', () => {
    const analyzer = inMemoryAnalyzer({
      'a.js': `
        import bee from './b.js';
        import * as b from './b.js';
        import {honey} from './b.js';
        import sea from './c.js';
        import * as c from './c.js';
        import {boat} from './c.js';
        console.log(bee, b, honey);
        console.log(sea, c, boat);
      `,
      'b.js': `
        import sea from './c.js';
        export default bee = '🐝';
        export const honey = '🍯';
        export const beeSea = bee + sea;
      `,
      'c.js': `
        export default sea = '🌊';
        export const boat = '⛵️';
      `,
    });
    const aUrl = analyzer.resolveUrl('a.js')!;
    const bUrl = analyzer.resolveUrl('b.js')!;
    const cUrl = analyzer.resolveUrl('c.js')!;

    test('non-shared bundles', async () => {
      const bundler = new Bundler({analyzer});
      const {documents} = await bundler.bundle(
          await bundler.generateManifest([aUrl, bUrl, cUrl]));
      assert.deepEqual(documents.get(aUrl)!.content, heredoc`
        import * as bee from './b.js';
        import bee__default, { honey } from './b.js';
        import * as sea from './c.js';
        import sea__default, { boat } from './c.js';

        console.log(bee__default, bee, honey);
        console.log(sea__default, sea, boat);`);
      assert.deepEqual(documents.get(bUrl)!.content, heredoc`
        import sea from './c.js';

        var b = bee = '🐝';
        const honey = '🍯';
        const beeSea = bee + sea;

        export default b;
        export { honey, beeSea };`);
      assert.deepEqual(documents.get(cUrl)!.content, heredoc`
        var c = sea = '🌊';
        const boat = '⛵️';

        export default c;
        export { boat };`);
    });

    test('shared bundle', async () => {
      const bundler =
          new Bundler({analyzer, strategy: generateShellMergeStrategy(bUrl)});
      const {documents} =
          await bundler.bundle(await bundler.generateManifest([aUrl, bUrl]));
      assert.deepEqual(documents.get(aUrl)!.content, heredoc`
        import * as bee from './b.js';
        import bee__default, { honey } from './b.js';
        import { $all as sea } from './b.js';
        import { $default as sea__default, boat } from './b.js';

        console.log(bee__default, bee, honey);
        console.log(sea__default, sea, boat);`);
      assert.deepEqual(documents.get(bUrl)!.content, heredoc`
        var sea$1 = sea = '🌊';

        var b = bee = '🐝';
        const honey = '🍯';
        const beeSea = bee + sea$1;

        export default b;
        export { honey, beeSea };`);
    });
  });
});
