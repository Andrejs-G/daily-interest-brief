/* A small, dependency-free Markdown reader. Source text never becomes HTML. */
(function (root) {
  'use strict';

  function node(tag, text) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    return result;
  }

  function safeURL(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }

  function externalLink(label, href) {
    const link = node('a', label);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  // Read a Markdown link without treating a parenthesis inside its URL as its end.
  function readLink(text, start) {
    const image = text[start] === '!';
    const opening = start + (image ? 1 : 0);
    if (text[opening] !== '[') return null;
    let endLabel = opening + 1;
    for (; endLabel < text.length; endLabel++) {
      if (text[endLabel] === '\\') { endLabel++; continue; }
      if (text[endLabel] === ']') break;
    }
    if (text[endLabel + 1] !== '(') return null;
    let depth = 1;
    let end = endLabel + 2;
    for (; end < text.length; end++) {
      if (text[end] === '\\') { end++; continue; }
      if (text[end] === '(') depth++;
      if (text[end] === ')' && --depth === 0) break;
    }
    if (depth) return null;
    let destination = text.slice(endLabel + 2, end).trim();
    // Optional link titles are not interpreted; angle-wrapped destinations are supported.
    if (destination.startsWith('<') && destination.endsWith('>')) destination = destination.slice(1, -1);
    return { image, label: text.slice(opening + 1, endLabel), href: safeURL(destination), end: end + 1 };
  }

  function inline(parent, text, nesting = 0) {
    if (nesting > 12) { parent.append(document.createTextNode(text)); return; }
    let buffer = '';
    function flush() {
      if (buffer) parent.append(document.createTextNode(buffer));
      buffer = '';
    }
    for (let i = 0; i < text.length;) {
      if (text[i] === '\\' && /[\\`*_[\]{}()#+.!|>-]/.test(text[i + 1] || '')) {
        buffer += text[i + 1]; i += 2; continue;
      }
      if (text[i] === '[' || (text[i] === '!' && text[i + 1] === '[')) {
        const match = readLink(text, i);
        if (match) {
          flush();
          if (match.href) {
            const link = externalLink('', match.href);
            if (match.image) link.append(document.createTextNode('Изображение: '));
            inline(link, match.label || (match.image ? 'открыть' : match.href), nesting + 1);
            parent.append(link);
          } else {
            // Keep invalid / unsupported link syntax visible, never actionable.
            parent.append(document.createTextNode(text.slice(i, match.end)));
          }
          i = match.end; continue;
        }
      }
      if (text[i] === '`') {
        const end = text.indexOf('`', i + 1);
        if (end > i + 1) {
          flush(); parent.append(node('code', text.slice(i + 1, end))); i = end + 1; continue;
        }
      }
      let marker = '';
      if (text.slice(i, i + 2) === '**' || text.slice(i, i + 2) === '__') marker = text.slice(i, i + 2);
      else if (text[i] === '*') marker = '*';
      else if (text[i] === '_' && (i === 0 || /\s|[([{-]/.test(text[i - 1]))) marker = '_';
      if (marker) {
        const end = text.indexOf(marker, i + marker.length);
        if (end > i + marker.length && !/^\s/.test(text.slice(i + marker.length, end))) {
          flush();
          const formatted = node(marker.length === 2 ? 'strong' : 'em');
          inline(formatted, text.slice(i + marker.length, end), nesting + 1);
          parent.append(formatted); i = end + marker.length; continue;
        }
      }
      buffer += text[i++];
    }
    flush();
  }

  function cells(line) {
    const result = [];
    let value = '';
    let inCode = false;
    const text = line.trim();
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\\' && text[i + 1] === '|') { value += '\\|'; i++; continue; }
      if (text[i] === '`') inCode = !inCode;
      if (text[i] === '|' && !inCode) { result.push(value.trim()); value = ''; }
      else value += text[i];
    }
    result.push(value.trim());
    if (text.startsWith('|')) result.shift();
    if (text.endsWith('|') && !text.endsWith('\\|')) result.pop();
    return result;
  }

  const listMatch = line => /^(\s*)([-+*]|\d+[.)])\s+(.+)$/.exec(line);
  const headingMatch = line => /^\s{0,3}(#{1,6})\s+(.+)$/.exec(line);
  const rule = line => /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
  const fenceMatch = line => /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);

  function renderBlocks(lines, depth = 0) {
    const fragment = document.createDocumentFragment();
    let i = 0;
    function isTable(index) {
      if (!lines[index]?.includes('|') || !lines[index + 1]) return false;
      const header = cells(lines[index]);
      const divider = cells(lines[index + 1]);
      return header.length > 1 && header.length === divider.length && divider.every(cell => /^:?-{3,}:?$/.test(cell));
    }
    function startsBlock(index) {
      const line = lines[index] || '';
      return !line.trim() || headingMatch(line) || rule(line) || fenceMatch(line) || listMatch(line) || /^\s{0,3}>/.test(line) || isTable(index);
    }
    function readList(indent, nesting = 0) {
      const first = listMatch(lines[i]);
      const ordered = /^\d/.test(first[2]);
      const list = node(ordered ? 'ol' : 'ul');
      if (ordered && parseInt(first[2], 10) !== 1) list.setAttribute('start', String(parseInt(first[2], 10)));
      let item = null;
      while (i < lines.length) {
        const match = listMatch(lines[i]);
        if (!match) {
          if (item && lines[i].trim() && /^\s/.test(lines[i]) && !startsBlock(i)) {
            item.append(document.createTextNode(' ')); inline(item, lines[i].trim()); i++; continue;
          }
          break;
        }
        const nextIndent = match[1].length;
        if (nextIndent < indent) break;
        if (nextIndent > indent) {
          if (!item) break;
          if (nesting >= 12) { item.append(document.createTextNode(' ' + lines[i++].trim())); continue; }
          item.append(readList(nextIndent, nesting + 1)); continue;
        }
        if (/^\d/.test(match[2]) !== ordered) break;
        item = node('li'); inline(item, match[3]); list.append(item); i++;
      }
      return list;
    }
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const fence = fenceMatch(line);
      if (fence) {
        const content = [];
        i++;
        const closing = new RegExp('^\\s{0,3}' + (fence[1][0] === '`' ? '`' : '~') + '{' + fence[1].length + ',}\\s*$');
        while (i < lines.length && !closing.test(lines[i])) content.push(lines[i++]);
        if (i < lines.length) i++;
        const pre = node('pre'); pre.append(node('code', content.join('\n'))); fragment.append(pre); continue;
      }
      const heading = headingMatch(line);
      if (heading) {
        const title = node('h' + Math.min(6, heading[1].length + 1));
        inline(title, heading[2].replace(/[ \t]+#+[ \t]*$/, '')); fragment.append(title); i++; continue;
      }
      if (rule(line)) { fragment.append(node('hr')); i++; continue; }
      if (isTable(i)) {
        const wrapper = node('div');
        wrapper.className = 'table-scroll';
        wrapper.setAttribute('tabindex', '0');
        wrapper.setAttribute('role', 'region');
        wrapper.setAttribute('aria-label', 'Таблица из выпуска; прокрутите по горизонтали при необходимости');
        const table = node('table');
        const head = node('thead');
        const headerRow = node('tr');
        for (const value of cells(lines[i])) { const th = node('th'); th.setAttribute('scope', 'col'); inline(th, value); headerRow.append(th); }
        head.append(headerRow); table.append(head);
        const body = node('tbody');
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
          const row = node('tr');
          for (const value of cells(lines[i])) { const td = node('td'); inline(td, value); row.append(td); }
          body.append(row); i++;
        }
        table.append(body); wrapper.append(table); fragment.append(wrapper); continue;
      }
      if (listMatch(line)) { fragment.append(readList(listMatch(line)[1].length)); continue; }
      if (/^\s{0,3}>/.test(line) && depth < 12) {
        const quoteLines = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quoteLines.push(lines[i++].replace(/^\s{0,3}> ?/, ''));
        const quote = node('blockquote'); quote.append(renderBlocks(quoteLines, depth + 1)); fragment.append(quote); continue;
      }
      const paragraph = [line.trim()];
      i++;
      while (i < lines.length && !startsBlock(i)) paragraph.push(lines[i++].trim());
      const p = node('p'); inline(p, paragraph.join(' ')); fragment.append(p);
    }
    return fragment;
  }

  function render(markdown) {
    const cleaned = String(markdown ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\uE200image_group\uE202[\s\S]*?\uE201/g, '')
      .replace(/:chatgpt-content-reference\{[^}]*\}/g, '');
    return renderBlocks(cleaned.split('\n'));
  }

  root.BriefMarkdown = Object.freeze({ render });
})(globalThis);
