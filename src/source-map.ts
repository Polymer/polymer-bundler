/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
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

import * as dom5 from 'dom5';
import * as espree from 'espree';
import * as parse5 from 'parse5';
import {Analyzer, Document, ParsedHtmlDocument} from 'polymer-analyzer';
import {AnalysisContext} from 'polymer-analyzer/lib/core/analysis-context';
import {RawSourceMap, SourceMapConsumer, SourceMapGenerator} from 'source-map';
import * as urlLib from 'url';
import * as astUtils from './ast-utils';
import * as matchers from './matchers';

const inlineSourcemapPrefix =
    '\n//# sourceMappingURL=data:application/json;charset=utf8;base64,';

const sourceMappingUrlExpr = /\n\/\/# sourceMappingURL=(.*)\n?/;
const inlineSourceMapExpr =
    /^data:application\/json;(charset=[^;]+;)?base64,([a-zA-Z0-9+\/=]+)$/;


function base64StringToRawSourceMap(input: string) {
  return JSON.parse(Buffer.from(input, 'base64').toString('utf8')) as
      RawSourceMap;
}

function rawSourceMapToBase64String(sourcemap: RawSourceMap) {
  return Buffer.from(JSON.stringify(sourcemap), 'utf8').toString('base64');
}

/**
 * Creates an identity source map from JS script content. Can offset original
 * line/column data for inline script elements.
 */
function createJsIdentitySourcemap(
    sourceUrl: string,
    sourceContent: string,
    originalFileContent: string,
    lineOffset: number,
    firstLineCharOffset: number) {
  const generator = new SourceMapGenerator();
  const tokens = espree.tokenize(
      sourceContent, {loc: true, ecmaVersion: 2017, sourceType: 'module'});
  tokens.forEach(token => {
    if (!token.loc) {
      return null;
    }
    let mapping: any = {
      original: {
        line: token.loc.start.line + lineOffset,
        column: token.loc.start.column +
            (token.loc.start.line === 1 ? firstLineCharOffset : 0)
      },
      generated: token.loc.start,
      source: sourceUrl
    };

    if (token.type === 'Identifier') {
      mapping.name = token.value;
    }

    generator.addMapping(mapping);
  });

  generator.setSourceContent(sourceUrl, originalFileContent);
  return generator.toJSON();
}

function offsetSourceMap(
    sourcemap: RawSourceMap, lineOffset: number, firstLineCharOffset: number) {
  const consumer = new SourceMapConsumer(sourcemap);
  const generator = new SourceMapGenerator();

  consumer.eachMapping(mapping => {
    const newMapping: any = {
      source: mapping.source,
      original: {line: mapping.originalLine, column: mapping.originalColumn},
      generated: {
        line: mapping.generatedLine + lineOffset,
        column: mapping.generatedColumn +
            (mapping.generatedLine === 1 ? firstLineCharOffset : 0)
      }
    };

    if (mapping.name) {
      newMapping.name = mapping.name;
    }

    generator.addMapping(newMapping);
  });

  sourcemap.sources.forEach(source => {
    generator.setSourceContent(source, consumer.sourceContentFor(source));
  });

  return generator.toJSON();
}

export async function getExistingSourcemap(
    analyzer: Analyzer, sourceUrl: string, sourceContent: string):
    Promise<RawSourceMap|null> {
  const sourceMappingUrlParts = sourceContent.match(sourceMappingUrlExpr);
  if (sourceMappingUrlParts === null) {
    return null;
  }

  let sourcemap: RawSourceMap;
  let mapUrl = sourceUrl;
  const inlineSourcemapParts =
      sourceMappingUrlParts[1].match(inlineSourceMapExpr);
  if (inlineSourcemapParts !== null) {
    sourcemap = base64StringToRawSourceMap(inlineSourcemapParts[2]);
  } else {
    mapUrl = urlLib.resolve(sourceUrl, sourceMappingUrlParts[1].trim());
    sourcemap = JSON.parse(await analyzer.load(mapUrl)) as RawSourceMap;
  }

  // Rewrite the sources array to be relative to the current URL
  if (sourcemap.sources) {
    sourcemap.sources =
        sourcemap.sources.map(source => urlLib.resolve(mapUrl, source));
  }
  return sourcemap;
}

/**
 * For an inline script AST node, locate an existing source map url comment.
 * If found, load that source map. If no source map url comment is found,
 * create an identity source map.
 *
 * In both cases, the generated mappings reflect the relative position of
 * a token within the script tag itself (rather than the document). This
 * is because the final position within the document is not yet known. These
 * relative positions will be updated later to reflect the absolute position
 * within the bundled document.
 */
export async function addOrUpdateSourcemapComment(
    analyzer: AnalysisContext|Analyzer,
    sourceUrl: string,
    sourceContent: string,
    originalLineOffset: number,
    originalFirstLineCharOffset: number,
    generatedLineOffset: number,
    generatedFirtLineCharOffset: number) {
  let sourcemap: RawSourceMap|null = null;
  try {
    sourcemap = await getExistingSourcemap(
        analyzer as Analyzer, sourceUrl, sourceContent);
  } catch (ex) {
    // TODO(ChadKillingsworth) Surface these errors to the user.
    // They should not be fatal errors though.
    sourceContent = sourceContent.replace(sourceMappingUrlExpr, '');
  }

  const originalFileContent = await analyzer.load(sourceUrl);
  let hasExisting = true;
  if (sourcemap === null) {
    hasExisting = false;
    sourcemap = createJsIdentitySourcemap(
        sourceUrl,
        sourceContent,
        originalFileContent,
        originalLineOffset,
        originalFirstLineCharOffset);
  } else {
    sourcemap = offsetSourceMap(
        sourcemap, generatedLineOffset, generatedFirtLineCharOffset);
  }

  if (sourcemap === null) {
    return sourceContent;
  }

  let updatedSourcemapComment =
      inlineSourcemapPrefix + rawSourceMapToBase64String(sourcemap) + '\n';
  if (hasExisting) {
    return sourceContent.replace(sourceMappingUrlExpr, updatedSourcemapComment);
  } else {
    if (sourceContent.length > 0 &&
        sourceContent[sourceContent.length - 1] === '\n') {
      updatedSourcemapComment = updatedSourcemapComment.substr(1);
    }

    return sourceContent + updatedSourcemapComment;
  }
}


/**
 * Update mappings in source maps within inline script elements to reflect
 * their absolute position within a bundle. Assumes existing mappings
 * are relative to their position within the script tag itself.
 */
export function updateSourcemapLocations(
    document: Document, ast: parse5.ASTNode) {
  // We need to serialize and reparse the dom for updated location information
  const documentContents = parse5.serialize(ast);
  ast = astUtils.parse(documentContents, {locationInfo: true});

  const reparsedDoc = new ParsedHtmlDocument({
    url: document.url,
    contents: documentContents,
    ast: ast,
    isInline: document.isInline,
    locationOffset: undefined,
    astNode: null
  });

  const inlineScripts = dom5.queryAll(ast, matchers.inlineJavascript);
  inlineScripts.forEach(script => {
    let content = dom5.getTextContent(script);

    const sourceMapUrlParts = content.match(sourceMappingUrlExpr);
    if (!sourceMapUrlParts) {
      return;
    }
    const sourceMapContentParts =
        sourceMapUrlParts[1].match(inlineSourceMapExpr);
    if (!sourceMapContentParts) {
      return;
    }

    const sourceRange = reparsedDoc.sourceRangeForStartTag(script)!;
    const sourceMap = base64StringToRawSourceMap(sourceMapContentParts[2]);

    const updatedMap = offsetSourceMap(
        sourceMap, sourceRange.end.line, sourceRange.end.column);

    const base64Map = rawSourceMapToBase64String(updatedMap);
    content = content.replace(
        sourceMappingUrlExpr, `${inlineSourcemapPrefix}${base64Map}\n`);

    dom5.setTextContent(script, content);
  });

  return ast;
}
