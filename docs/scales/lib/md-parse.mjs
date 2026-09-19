// docs/scales/lib/md-parse.mjs
//
// 本项目文档专用的 Markdown 解析器
// ================================
// 只产出 AST，不产出任何具体格式。PDF 构建（build-pdf.mjs）与 Word 构建
// （build-docx.mjs）共用这一份解析结果，以免两条产线各自漂移。
//
// 覆盖范围以本项目三份文档实际用到的语法为准，不追求通用：
//   块级：标题、段落、无序/有序列表（含两级嵌套与任务列表）、
//         表格（含列对齐）、围栏代码块、引用块、分隔线
//   行内：粗体、斜体、行内代码、链接
//
// 块 AST：
//   { type:'heading', level, tokens }
//   { type:'p',       tokens }
//   { type:'list',    ordered, items:[{ tokens, blocks:[...] }] }
//   { type:'table',   align:[..], head:[tokens..], rows:[[tokens..]..] }
//   { type:'code',    lang, lines:[..] }
//   { type:'quote',   tokens }
//   { type:'hr' }
//
// 行内 token：
//   { t:'text',   v }
//   { t:'code',   v }
//   { t:'strong', kids:[..] }
//   { t:'em',     kids:[..] }
//   { t:'link',   href, kids:[..] }
//
// 注意：解析器**不做**任何字形替换。某些环境缺少 emoji 字形需要替换成文字，
// 那是渲染端的事（PDF 需要，Word 不需要），放进解析器会污染另一条产线。

export function inlineTokens(src) {
  const out = [];
  // 顺序即优先级：行内代码 > 链接 > 粗体 > 斜体
  const re = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g;
  let m, last = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: 'text', v: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: 'code', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'link', href: m[3], kids: inlineTokens(m[2]) });
    else if (m[4] !== undefined) out.push({ t: 'strong', kids: inlineTokens(m[4]) });
    else out.push({ t: 'em', kids: inlineTokens(m[5]) });
    last = re.lastIndex;
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) });
  return out;
}

/** token 数组还原成纯文本（用于目录、书签、比对） */
export function plainText(tokens) {
  return tokens.map(k =>
    k.t === 'text' || k.t === 'code' ? k.v : plainText(k.kids)).join('');
}

const isListLine = l => /^\s*([-*]|\d+\.)\s/.test(l);
const isTableLine = l => /^\s*\|/.test(l);

/**
 * @returns {{ title: string|null, blocks: object[] }}
 *   title 取文档首个 H1，并从 blocks 中剥离 —— 分册页头与正文标题共用一个来源，
 *   两处永不分叉。
 */
export function parse(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  let title = null;
  const h1 = lines.findIndex(l => /^#\s/.test(l));
  if (h1 !== -1) { title = lines[h1].replace(/^#\s*/, '').trim(); lines.splice(h1, 1); }

  let i = 0;
  const blocks = parseBlocks(() => i < lines.length ? lines[i] : null, () => i++, () => i);
  return { title, blocks };

  function parseBlocks() {
    const out = [];
    while (i < lines.length) {
      const L = lines[i];
      if (/^\s*$/.test(L)) { i++; continue; }

      if (/^```/.test(L)) {                                  // 围栏代码块
        const lang = L.replace(/^```/, '').trim(); i++;
        const buf = [];
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push({ type: 'code', lang, lines: buf });
        continue;
      }
      if (/^#{1,4}\s/.test(L)) {
        out.push({ type: 'heading', level: L.match(/^#+/)[0].length,
                   tokens: inlineTokens(L.replace(/^#+\s*/, '')) });
        i++; continue;
      }
      if (/^\s*(---|\*\*\*)\s*$/.test(L)) { out.push({ type: 'hr' }); i++; continue; }
      if (isTableLine(L)) { out.push(parseTable()); continue; }
      if (isListLine(L)) { out.push(parseList(L.match(/^\s*/)[0].length)); continue; }
      if (/^>\s?/.test(L)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
        out.push({ type: 'quote', tokens: inlineTokens(buf.join(' ')) });
        continue;
      }
      const buf = [];                                        // 段落
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^(#{1,4}\s|```|>\s?|\s*---\s*$)/.test(lines[i]) &&
             !isTableLine(lines[i]) && !isListLine(lines[i])) buf.push(lines[i++]);
      if (buf.length) out.push({ type: 'p', tokens: inlineTokens(buf.join(' ')) });
    }
    return out;
  }

  function parseTable() {
    const raw = [];
    let align = null;
    while (i < lines.length && isTableLine(lines[i])) {
      const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (raw.length === 1 && cells.every(c => /^:?-{2,}:?$/.test(c)))
        align = cells.map(c => c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : 'left');
      else raw.push(cells);
      i++;
    }
    const head = (raw.shift() ?? []).map(inlineTokens);
    const cols = head.length;
    const rows = raw.map(r => {
      const cells = r.slice(0, cols).map(inlineTokens);
      while (cells.length < cols) cells.push([]);            // 补齐缺列，渲染端不必再判
      return cells;
    });
    return { type: 'table', align: align ?? head.map(() => 'left'), head, rows };
  }

  function parseList(indent) {
    const ordered = /\d/.test(lines[i].match(/^\s*([-*]|\d+\.)/)[1]);
    const items = [];
    while (i < lines.length) {
      const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
      if (!m || m[1].length < indent) break;
      if (m[1].length > indent) {                            // 子列表挂到上一项
        if (!items.length) break;
        items[items.length - 1].blocks.push(parseList(m[1].length));
        continue;
      }
      let text = m[3];
      let task = null;
      const tm = text.match(/^\[([ xX])\]\s*(.*)$/);
      if (tm) { task = Boolean(tm[1].trim()); text = tm[2]; }
      i++;
      // 续行：缩进但既不是新列表项也不是表格
      const cont = [];
      while (i < lines.length && /^\s{2,}\S/.test(lines[i]) &&
             !isListLine(lines[i]) && !isTableLine(lines[i])) cont.push(lines[i++].trim());
      if (cont.length) text += ' ' + cont.join(' ');
      items.push({ tokens: inlineTokens(text), task, blocks: [] });
    }
    return { type: 'list', ordered, items };
  }
}
