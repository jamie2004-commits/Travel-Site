// A very small HTML reader, enough for the four static guide files in source/.
// Kept dependency free on purpose: the brief allows no packages beyond the
// listed ones, so the extraction step brings its own parser.

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

// Elements whose contents are not markup.
const RAW = new Set(['script', 'style']);

function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function parseAttrs(src) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;
  let m;
  while ((m = re.exec(src))) {
    attrs[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return attrs;
}

/** Parse an HTML string into a tree of { tag, attrs, children } / { text }. */
export function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const tagRe = /<(!--[\s\S]*?--|!\[CDATA\[[\s\S]*?\]\]|!?\/?[a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;
  let cursor = 0;
  let m;

  const pushText = (raw) => {
    if (!raw) return;
    const text = decode(raw);
    if (text.trim() === '' && !/[ \n\t]/.test(text)) return;
    stack[stack.length - 1].children.push({ text });
  };

  while ((m = tagRe.exec(html))) {
    pushText(html.slice(cursor, m.index));
    cursor = tagRe.lastIndex;

    const name = m[1];
    if (name.startsWith('!--') || name.startsWith('![CDATA[')) continue;
    if (name.startsWith('!')) continue; // doctype

    if (name.startsWith('/')) {
      const tag = name.slice(1).toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const tag = name.toLowerCase();
    const node = { tag, attrs: parseAttrs(m[2]), children: [] };
    stack[stack.length - 1].children.push(node);

    if (VOID.has(tag) || m[3] === '/') continue;

    if (RAW.has(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, 'i');
      const rest = html.slice(cursor);
      const end = rest.search(close);
      const body = end === -1 ? rest : rest.slice(0, end);
      node.children.push({ text: body });
      cursor += end === -1 ? rest.length : end + rest.slice(end).match(close)[0].length;
      tagRe.lastIndex = cursor;
      continue;
    }

    stack.push(node);
  }
  pushText(html.slice(cursor));
  return root;
}

export function walk(node, visit) {
  if (node.children) {
    for (const child of node.children) {
      visit(child);
      walk(child, visit);
    }
  }
}

export function classes(node) {
  return (node.attrs?.class ?? '').split(/\s+/).filter(Boolean);
}

/** All descendants carrying the given class name. */
export function byClass(root, className) {
  const out = [];
  walk(root, (n) => {
    if (n.tag && classes(n).includes(className)) out.push(n);
  });
  return out;
}

/** All descendants with the given tag name. */
export function byTag(root, tag) {
  const out = [];
  walk(root, (n) => {
    if (n.tag === tag) out.push(n);
  });
  return out;
}

/** Visible text of a subtree, whitespace collapsed. */
export function text(node) {
  let out = '';
  const visit = (n) => {
    if (n.text !== undefined) {
      out += n.text;
      return;
    }
    if (n.tag === 'script' || n.tag === 'style' || n.tag === 'svg') return;
    if (n.tag === 'br') out += ' ';
    for (const c of n.children ?? []) visit(c);
  };
  visit(node);
  return out.replace(/\s+/g, ' ').trim();
}
