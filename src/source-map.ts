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
import {Analyzer} from 'polymer-analyzer';
import {AnalysisContext} from 'polymer-analyzer/lib/core/analysis-context';
import {ParsedHtmlDocument} from 'polymer-analyzer/lib/html/html-document';
import {RawSourceMap, SourceMapConsumer, SourceMapGenerator} from 'source-map';
import * as urlLib from 'url';

import * as matchers from './matchers';

const inlineSourcemapPrefix =
    '\n//# sourceMappingURL=data:application/json;charset=utf8;base64,';

const sourceMappingUrlExpr = /\n\/\/# sourceMappingURL=(.*)\n?/;
const inlineSourceMapExpr =
    /^data:application\/json;(charset=[^;]+;)?base64,([a-zA-Z0-9+\/=]+)$/;


function base64StringToRawSourceMap(input: string) {
  return JSON.parse(
      Buffer.from(input, 'base64').toString('utf8')) as RawSourceMap;
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
    lineOffset: number,
    firstLineCharOffset: number) {
  const generator = new SourceMapGenerator();
  const tokens =
      espree.tokenize(sourceContent, {loc: true} as espree.ParseOpts);
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

  return generator.toJSON();
}

export async function getExistingSourcemap(
    analyzer: AnalysisContext|Analyzer,
    sourceUrl: string,
    sourceContent: string) {
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
    lineOffset: number,
    firstLineCharOffset: number) {
  let sourcemap =
      await getExistingSourcemap(analyzer, sourceUrl, sourceContent);

  let hasExisting = true;
  if (sourcemap === null) {
    hasExisting = false;
    sourcemap = createJsIdentitySourcemap(
        sourceUrl, sourceContent, lineOffset, firstLineCharOffset);
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
    parsedDoc: ParsedHtmlDocument, ast: parse5.ASTNode) {
  // We need to serialize and reparse the dom for updated location information
  ast = parse5.parse(parse5.serialize(ast), {locationInfo: true});
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

    const sourceRange = parsedDoc.sourceRangeForStartTag(script)!;
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
