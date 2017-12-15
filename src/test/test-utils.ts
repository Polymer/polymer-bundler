import {ResolvedUrl} from 'polymer-analyzer';

export function undent(text: string) {
  const indents = text.match(/^ *(?=\S)/gm);
  const mindent = indents ? Math.min(...indents.map((i) => i.length)) : 0;
  return text.replace(new RegExp(`^ {${mindent}}`, 'gm'), '').trim();
}

export function resolvedUrl(
    templateStrings: TemplateStringsArray, ...values: any[]) {
  let result = '';
  for (const templateString of templateStrings) {
    result = result + templateString;
    if (values.length > 0) {
      result = result + values.shift();
    }
  }
  return result as ResolvedUrl;
}
