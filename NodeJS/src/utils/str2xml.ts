import type { XmlNode, XmlObject } from '../core/interfaces.js';

/** Parse XML into a plain object without browser APIs or external packages. */
export function str2xml(xml: string): XmlObject {
  let position = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  const stack: XmlNode[] = [];
  let root: XmlObject | undefined;

  const fail = (message: string): never => {
    throw new SyntaxError(`Invalid XML at position ${position}: ${message}`);
  };
  const addChild = (parent: XmlObject, name: string, value: XmlObject): void => {
    const current = parent[name];
    if (current === undefined) parent[name] = value;
    else if (Array.isArray(current)) current.push(value);
    else parent[name] = [current, value];
  };
  const decodeEntities = (text: string): string => text.replace(/&([^;\s<&]+);/g, (_match, entity: string) => {
    switch (entity) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
    }
    const codePoint = entity.startsWith('#x')
      ? Number.parseInt(entity.slice(2), 16)
      : entity.startsWith('#')
        ? Number.parseInt(entity.slice(1), 10)
        : Number.NaN;
    if (!Number.isInteger(codePoint) || codePoint < 1 || codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      fail(`unsupported entity reference &${entity};`);
    }
    return String.fromCodePoint(codePoint);
  });
  const appendText = (text: string): void => {
    if (stack.length === 0) {
      if (text.trim()) fail('text is not allowed outside the root element');
      return;
    }
    stack[stack.length - 1]!.text += text;
  };
  const closeNode = (name: string): void => {
    const node = stack.pop();
    if (node === undefined) throw new SyntaxError(`Invalid XML at position ${position}: unexpected closing element "${name}"`);
    if (node.name !== name) fail(`unexpected closing element "${name}"`);
    if (node.text.trim()) node.value['#text'] = node.text.trim();
  };

  while (position < xml.length) {
    if (xml[position] !== '<') {
      const nextTag = xml.indexOf('<', position);
      const end = nextTag < 0 ? xml.length : nextTag;
      const text = xml.slice(position, end);
      if (/&(?![^;\s<&]+;)/.test(text)) fail('unterminated entity reference');
      appendText(decodeEntities(text));
      position = end;
      continue;
    }

    if (xml.startsWith('<!--', position)) {
      const end = xml.indexOf('-->', position + 4);
      if (end < 0) fail('unterminated comment');
      position = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', position)) {
      const end = xml.indexOf(']]>', position + 9);
      if (end < 0) fail('unterminated CDATA section');
      appendText(xml.slice(position + 9, end));
      position = end + 3;
      continue;
    }
    if (xml.startsWith('<?', position)) {
      const end = xml.indexOf('?>', position + 2);
      if (end < 0) fail('unterminated processing instruction');
      position = end + 2;
      continue;
    }
    if (/^<!DOCTYPE\b/i.test(xml.slice(position))) {
      let cursor = position + 9;
      let quote = '';
      let subsetDepth = 0;
      for (; cursor < xml.length; cursor++) {
        const char = xml[cursor]!;
        if (quote) {
          if (char === quote) quote = '';
        } else if (char === '"' || char === "'") quote = char;
        else if (char === '[') subsetDepth++;
        else if (char === ']') subsetDepth--;
        else if (char === '>' && subsetDepth === 0) break;
      }
      if (cursor >= xml.length) fail('unterminated DOCTYPE');
      position = cursor + 1;
      continue;
    }

    let cursor = position + 1;
    let quote = '';
    for (; cursor < xml.length; cursor++) {
      const char = xml[cursor]!;
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (cursor >= xml.length) fail('unterminated element tag');

    const tag = xml.slice(position + 1, cursor).trim();
    position = cursor + 1;
    if (tag.startsWith('/')) {
      const closingName = tag.slice(1).trim();
      if (!/^[A-Za-z_:][\w.:-]*$/.test(closingName)) fail('invalid closing element name');
      closeNode(closingName);
      continue;
    }

    const selfClosing = tag.endsWith('/');
    const openingTag = selfClosing ? tag.slice(0, -1).trimEnd() : tag;
    const nameMatch = /^([A-Za-z_:][\w.:-]*)/.exec(openingTag);
    if (nameMatch === null) throw new SyntaxError(`Invalid XML at position ${position}: invalid opening element name`);
    const name = nameMatch[1]!;
    const attributes = openingTag.slice(name.length);
    if (attributes && !/^(?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*$/.test(attributes)) {
      fail('invalid attribute syntax');
    }
    const value: XmlObject = {};
    if (stack.length === 0) {
      if (root !== undefined) fail('document has more than one root element');
      root = value;
    } else {
      addChild(stack[stack.length - 1]!.value, name, value);
    }
    if (selfClosing) continue;
    stack.push({ name, value, text: '' });
  }

  if (stack.length > 0) fail(`element "${stack[stack.length - 1]!.name}" is not closed`);
  if (root === undefined) fail('document has no root element');
  return root!;
}
