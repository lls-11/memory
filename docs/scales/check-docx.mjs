#!/usr/bin/env node
// docs/scales/check-docx.mjs
//
// Word 产出的结构核验
// ===================
// 本容器没装 LibreOffice 的 Writer 组件（soffice 连纯文本都打不开），
// 因此无法渲染目视检查。改为直接检查 OOXML，并与 Markdown AST 交叉对账 ——
// 验的是「渲染有没有丢东西、表格宽度是否自洽、引用的样式与编号是否存在」，
// 这几项恰好是手写渲染端最容易出错的地方。
//
// 用法：node docs/scales/check-docx.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parse } from './lib/md-parse.mjs';
import { formItems } from './lib/tss-items.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const DIR = join(HERE, 'docx');

const part = (file, entry) =>
  execFileSync('unzip', ['-p', join(DIR, file), entry], { maxBuffer: 1 << 28 }).toString();

let pass = 0; const fails = [];
function check(file, name, fn) {
  let ok, detail = '';
  try { const r = fn(); ok = r === true || r === undefined; if (typeof r === 'string') { ok = false; detail = r; } }
  catch (e) { ok = false; detail = e.message; }
  if (ok) { pass++; console.log(`  \x1b[32m·通过\x1b[0m ${name}`); }
  else { fails.push({ file, name, detail }); console.log(`  \x1b[31m·失败\x1b[0m ${name}${detail ? '\n        → ' + detail : ''}`); }
}

// 各文件预期的表格数与标题数（由 AST 推出，不是手填的魔法数字）
const MD = {
  '01-实验设计-三感闭环.docx': 'docs/experiments/three-senses-loop.md',
  '02-量表编制方案-TSS.docx': 'docs/scales/three-senses-scale.md',
  '03-制作流程与验证关卡.docx': 'docs/scales/BUILD-PROCESS.md',
};
const astCounts = md => {
  const { blocks } = parse(readFileSync(join(ROOT, md), 'utf8'));
  let tables = 0, headings = 0;
  for (const b of blocks) { if (b.type === 'table') tables++; if (b.type === 'heading') headings++; }
  return { tables, headings };
};

const FILES = [
  ...Object.keys(MD), '00-三感项目-合订本.docx', '04-施测卷-TSS-30.docx', '05-代码附录.docx',
];

console.log('Word 产出结构核验');
console.log('─'.repeat(64));

for (const f of FILES) {
  console.log(`\n${f}`);
  if (!existsSync(join(DIR, f))) { check(f, '文件存在', () => '未生成'); continue; }

  let doc, styles, numbering;
  check(f, 'OPC 包完整（含 [Content_Types].xml 与四个部件）', () => {
    const list = execFileSync('unzip', ['-l', join(DIR, f)]).toString();
    for (const need of ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml',
                        'word/numbering.xml', '_rels/.rels'])
      if (!list.includes(need)) return `缺少 ${need}`;
    doc = part(f, 'word/document.xml');
    styles = part(f, 'word/styles.xml');
    numbering = part(f, 'word/numbering.xml');
    return true;
  });
  if (!doc) continue;

  check(f, '表格列宽合计等于表格宽度（Word/Google Docs 都依赖这一点）', () => {
    const tbls = doc.split('<w:tbl>').slice(1);
    const bad = [];
    tbls.forEach((t, k) => {
      const w = t.match(/<w:tblW[^>]*w:w="(\d+)"/);
      const cols = [...t.slice(0, t.indexOf('</w:tblGrid>'))
        .matchAll(/<w:gridCol[^>]*w:w="(\d+)"/g)].map(m => +m[1]);
      if (!w || !cols.length) { bad.push(`第 ${k + 1} 个表缺 tblW 或 tblGrid`); return; }
      const sum = cols.reduce((a, b) => a + b, 0);
      if (sum !== +w[1]) bad.push(`第 ${k + 1} 个表：列宽合计 ${sum} ≠ 表宽 ${w[1]}`);
    });
    return bad.length ? bad.join('；') : true;
  });

  check(f, '每个单元格都带显式宽度（缺则在 Google Docs 里错位）', () => {
    const cells = (doc.match(/<w:tc>/g) || []).length;
    const widths = (doc.match(/<w:tcW\b/g) || []).length;
    return cells === widths ? true : `单元格 ${cells} 个，tcW ${widths} 个`;
  });

  check(f, '引用的编号定义都存在于 numbering.xml', () => {
    const used = new Set([...doc.matchAll(/<w:numId w:val="(\d+)"/g)].map(m => m[1]));
    const defined = new Set([...numbering.matchAll(/<w:num w:numId="(\d+)"/g)].map(m => m[1]));
    const miss = [...used].filter(id => id !== '0' && !defined.has(id));
    return miss.length ? `未定义的 numId：${miss.join(' ')}` : true;
  });

  check(f, '引用的段落样式都存在于 styles.xml', () => {
    const used = new Set([...doc.matchAll(/<w:pStyle w:val="([^"]+)"/g)].map(m => m[1]));
    const defined = new Set([...styles.matchAll(/w:styleId="([^"]+)"/g)].map(m => m[1]));
    const miss = [...used].filter(s => !defined.has(s) && !/^ListParagraph$/.test(s));
    return miss.length ? `未定义的样式：${miss.join(' ')}` : true;
  });

  check(f, '列表用真编号，未插入字面项目符号', () => {
    const texts = [...doc.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]);
    // 「•」「◦」只应出现在 numbering.xml 的定义里，不应出现在正文文字中
    const bad = texts.filter(t => /^[•◦▪]\s*/.test(t));
    return bad.length ? `正文里有 ${bad.length} 处字面项目符号` : true;
  });

  check(f, '正文文字中没有换行符（docx 里必须拆段落）', () => {
    const texts = [...doc.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]);
    const bad = texts.filter(t => t.includes('\n'));
    return bad.length ? `${bad.length} 处 w:t 内含换行` : true;
  });

  check(f, '中西文字体分别指定（eastAsia 不缺）', () => {
    const rf = (doc + styles).match(/<w:rFonts[^>]*w:eastAsia="[^"]+"/g);
    return rf && rf.length > 0 ? true : '未找到带 eastAsia 的 rFonts，中文会用错字体';
  });

  if (MD[f]) {
    const want = astCounts(MD[f]);
    check(f, `表格数与 Markdown 一致（应为 ${want.tables}）`, () => {
      const got = doc.split('<w:tbl>').length - 1;
      return got === want.tables ? true : `文档里 ${got} 个表`;
    });
    check(f, `标题数与 Markdown 一致（正文 ${want.headings} + 分册页头 1）`, () => {
      const got = (doc.match(/<w:pStyle w:val="Heading[1-4]"/g) || []).length;
      return got === want.headings + 1 ? true : `文档里 ${got} 个标题`;
    });
  }

  if (f.startsWith('04-')) {
    const items = formItems();
    check(f, `施测卷有 2 个表（卷面 + 计分键）`, () => {
      const got = doc.split('<w:tbl>').length - 1;
      return got === 2 ? true : `${got} 个`;
    });
    check(f, `卷面表 ${items.length} 题 + 1 表头行；计分键同题数`, () => {
      const tbls = doc.split('<w:tbl>').slice(1);
      const rows = tbls.map(t => (t.slice(0, t.indexOf('</w:tbl>')).match(/<w:tr\b/g) || []).length);
      if (rows[0] !== items.length + 1) return `卷面表 ${rows[0]} 行，应为 ${items.length + 1}`;
      if (rows[1] !== items.length + 1) return `计分键 ${rows[1]} 行，应为 ${items.length + 1}`;
      return true;
    });
    check(f, '每题 5 个勾选格', () => {
      const first = doc.split('<w:tbl>')[1];
      const boxes = (first.slice(0, first.indexOf('</w:tbl>')).match(/>□</g) || []).length;
      return boxes === items.length * 5 ? true : `${boxes} 个勾选格，应为 ${items.length * 5}`;
    });
    check(f, '卷面题干与条目源逐字一致', () => {
      const bad = items.filter(it => !doc.includes(it.text.replace(/&/g, '&amp;')));
      return bad.length ? `缺失或不一致：${bad.map(i => '第' + i.no + '题').join(' ')}` : true;
    });
    check(f, '计分键单独成页且标注「交给被试前请移除」', () =>
      doc.includes('交给被试前请移除本页') && /<w:br w:type="page"\/>/.test(doc)
        ? true : '缺少分页或提示');
    check(f, '卷面不含切分点/严重程度分档措辞', () => {
      // 否定守卫：「没有常模也没有切分点」是应当保留的表述，不算违规。
      // 只在词前 12 个字内没有否定词时才算命中。
      const texts = [...doc.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join('\n');
      const bad = [];
      for (const w of ['切分点', '重度', '中度', '轻度', '高危', '阳性']) {
        let from = 0, idx;
        while ((idx = texts.indexOf(w, from)) !== -1) {
          const before = texts.slice(Math.max(0, idx - 12), idx);
          if (!/没有|不会|不得|无[^限]|并非/.test(before)) { bad.push(`${w}（上文：…${before}）`); break; }
          from = idx + w.length;
        }
      }
      return bad.length ? `出现：${bad.join('；')}` : true;
    });
  }

  if (f.startsWith('00-')) {
    check(f, '合订本含自动目录域', () =>
      /TOC \\o/.test(doc) || doc.includes('w:instrText') ? true : '未找到 TOC 域');
    check(f, '四个部分都在（三份文档 + 代码附录）', () => {
      const need = ['第 1 部分', '第 2 部分', '第 3 部分', '第 4 部分'];
      const miss = need.filter(s => !doc.includes(s));
      return miss.length ? `缺少：${miss.join(' ')}` : true;
    });
  }
}

console.log('\n' + '─'.repeat(64));
if (!fails.length) { console.log(`\x1b[32m全部通过\x1b[0m：${pass} 项检查`); process.exit(0); }
console.log(`\x1b[31m${fails.length} 项失败\x1b[0m（通过 ${pass} 项）`);
for (const f of fails) console.log(`  ${f.file} → ${f.name}`);
process.exit(1);
