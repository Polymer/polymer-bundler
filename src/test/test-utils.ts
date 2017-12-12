export function undent(text: string) {
  const indents = text.match(/^ *(?=\S)/gm);
  const mindent = indents ? Math.min(...indents.map((i) => i.length)) : 0;
  return text.replace(new RegExp(`^ {${mindent}}`, 'gm'), '').trim();
}
