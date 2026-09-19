#!/usr/bin/env node
// docs/scales/build-docx.mjs
//
// 把三感项目的文档打成 Word（.docx）
// ==================================
// 与 build-pdf.mjs 共用 lib/md-parse.mjs 的解析结果，只换渲染端，
// 所以两条产线不会各自漂移。用 docx（npm）生成真正的 OOXML：
// 标题是内置 Heading 样式（Word 导航窗格与自动目录可用）、表格是真表格、
// 列表是真编号 —— 可以直接在上面改字、批注、留修订，这是 Word 相对 PDF 的意义。
//
// 字体按**收件人机器**选，不是按本容器：正文宋体 + Times New Roman，
// 标题黑体 + Arial，代码 Consolas + 宋体。本容器只有文泉驿，故本机预览
// 会替换字体，属正常现象，不代表文件有问题。
//
// 产出（docs/scales/docx/，已 gitignore）：
//   00-三感项目-合订本.docx   封面 + 自动目录 + 三份文档 + 代码附录
//   01/02/03 三份分册.docx
//   04-施测卷-TSS-30.docx     纸质卷（勾选格）+ 末页「施测者用计分键」
//   05-代码附录.docx
//
// 用法：node docs/scales/build-docx.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  Footer, PageNumber, PageBreak, TableOfContents, LevelFormat, ExternalHyperlink,
} from 'docx';
import { parse, plainText } from './lib/md-parse.mjs';
import { formItems, DOMAINS, ANCHORS } from './lib/tss-items.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = join(HERE, 'docx');

// ─────────────────────────────────────────────────────────── 版式常量
const BODY = { ascii: 'Times New Roman', eastAsia: '宋体', hAnsi: 'Times New Roman' };
const HEAD = { ascii: 'Arial', eastAsia: '黑体', hAnsi: 'Arial' };
const MONO = { ascii: 'Consolas', eastAsia: '宋体', hAnsi: 'Consolas' };
const INK = '1A1B1D', INK2 = '4A4C50', INK3 = '76787D', RULE = 'C8C8C4', BG = 'F5F5F3';
const MARGIN = 1134;                       // 2cm
const CONTENT_W = 11906 - MARGIN * 2;      // A4 宽 - 左右页边距 = 9638 DXA

const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: RULE };
const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
const noBorders = Object.fromEntries(['top', 'bottom', 'left', 'right']
  .map(k => [k, { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }]));

// 列宽：按单元格显示宽度（CJK 记 2）加权分配，并设上下限避免极端窄列
const dispW = s => [...s].reduce((a, c) => a + (/[⺀-鿿＀-￯]/.test(c) ? 2 : 1), 0);
function columnWidths(head, rows, total = CONTENT_W) {
  const n = head.length;
  const w = head.map((h, k) => Math.max(
    dispW(plainText(h)),
    ...rows.map(r => Math.min(dispW(plainText(r[k] ?? [])), 46))));
  const sum = w.reduce((a, b) => a + b, 0) || n;
  const lo = 0.055, hi = 0.46;
  let frac = w.map(x => Math.min(hi, Math.max(lo, x / sum)));
  const fs = frac.reduce((a, b) => a + b, 0);
  frac = frac.map(f => f / fs);
  const out = frac.map(f => Math.round(f * total));
  out[n - 1] += total - out.reduce((a, b) => a + b, 0);   // 抹平取整误差，保证合计精确
  return out;
}

// ────────────────────────────────────────────────── 行内 token → TextRun
function runs(tokens, base = {}) {
  const out = [];
  const walk = (ts, sty) => {
    for (const k of ts) {
      if (k.t === 'text') out.push(new TextRun({ text: k.v, font: BODY, ...sty }));
      else if (k.t === 'code')
        out.push(new TextRun({ text: k.v, font: MONO, size: 18,
          shading: { type: ShadingType.CLEAR, fill: BG, color: 'auto' }, ...sty }));
      else if (k.t === 'strong') walk(k.kids, { ...sty, bold: true });
      else if (k.t === 'em') walk(k.kids, { ...sty, italics: true });
      else if (k.t === 'link') {
        // 只有 http(s) 才做成真超链接；指向仓库内文件的相对路径做成普通文字，
        // 否则在 Word 里是个点不开的蓝色链接，比不做链接更糟。
        const external = /^https?:/.test(k.href);
        const save = out.length;
        walk(k.kids, external ? { ...sty, color: '1F4E79', underline: {} } : { ...sty, color: INK2 });
        const inner = out.splice(save);
        if (external) out.push(new ExternalHyperlink({ children: inner, link: k.href }));
        else out.push(...inner);
      }
    }
  };
  walk(tokens, base);
  return out;
}

// ──────────────────────────────────────────────────── 块 AST → docx
let numInstance = 0;                         // 每个有序列表一个实例，编号从 1 重起

function blocksToDocx(blocks, opts = {}) {
  const out = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        const lv = Math.min(4, Math.max(1, b.level));
        out.push(new Paragraph({
          heading: HeadingLevel[`HEADING_${lv}`],
          children: runs(b.tokens).map(r => r),
          spacing: { before: lv <= 2 ? 300 : 220, after: 110 },
          keepNext: true,
          ...(lv === 2 ? { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE } } } : {}),
        }));
        break;
      }
      case 'p':
        out.push(new Paragraph({ children: runs(b.tokens), spacing: { after: 130, line: 300 } }));
        break;
      case 'quote':
        out.push(new Paragraph({
          children: runs(b.tokens, { size: 19, color: INK2 }),
          indent: { left: 240, right: 160 },
          spacing: { before: 130, after: 160, line: 290 },
          shading: { type: ShadingType.CLEAR, fill: BG, color: 'auto' },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: INK3 } },
        }));
        break;
      case 'hr':
        out.push(new Paragraph({
          text: '', spacing: { before: 140, after: 140 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE } },
        }));
        break;
      case 'code': {
        const n = b.lines.length;
        b.lines.forEach((l, k) => out.push(new Paragraph({
          children: [new TextRun({ text: l || ' ', font: MONO, size: 16, color: INK })],
          spacing: { before: k === 0 ? 120 : 0, after: k === n - 1 ? 150 : 0, line: 230 },
          indent: { left: 200 },
          shading: { type: ShadingType.CLEAR, fill: BG, color: 'auto' },
          border: {
            left: { style: BorderStyle.SINGLE, size: 10, color: RULE },
            ...(k === 0 ? { top: thinBorder } : {}),
            ...(k === n - 1 ? { bottom: thinBorder } : {}),
          },
        })));
        break;
      }
      case 'list': {
        const inst = b.ordered ? ++numInstance : undefined;
        const emit = (items, level, ordered, instance) => {
          for (const it of items) {
            const pre = it.task === null || it.task === undefined ? []
              : [new TextRun({ text: it.task ? '■ ' : '□ ', font: BODY })];
            out.push(new Paragraph({
              children: [...pre, ...runs(it.tokens)],
              numbering: { reference: ordered ? 'tss-num' : 'tss-bul', level, ...(instance ? { instance } : {}) },
              spacing: { after: 70, line: 290 },
            }));
            for (const sub of it.blocks)
              if (sub.type === 'list')
                emit(sub.items, Math.min(2, level + 1), sub.ordered,
                     sub.ordered ? ++numInstance : undefined);
          }
        };
        emit(b.items, 0, b.ordered, inst);
        break;
      }
      case 'table': {
        const widths = columnWidths(b.head, b.rows);
        const cell = (tokens, k, hdr) => new TableCell({
          width: { size: widths[k], type: WidthType.DXA },
          borders: cellBorders,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          ...(hdr ? { shading: { type: ShadingType.CLEAR, fill: BG, color: 'auto' } } : {}),
          children: [new Paragraph({
            children: runs(tokens, { size: 18, ...(hdr ? { bold: true, color: INK2 } : {}) }),
            alignment: { left: AlignmentType.LEFT, center: AlignmentType.CENTER,
                         right: AlignmentType.RIGHT }[b.align[k]] ?? AlignmentType.LEFT,
            spacing: { after: 0, line: 260 },
          })],
        });
        out.push(new Table({
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: widths,
          rows: [
            new TableRow({ tableHeader: true, children: b.head.map((h, k) => cell(h, k, true)) }),
            ...b.rows.map(r => new TableRow({ children: r.map((c, k) => cell(c, k, false)) })),
          ],
        }));
        out.push(new Paragraph({ text: '', spacing: { after: 130 } }));
        break;
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────── 文档骨架
const NUMBERING = {
  config: [
    { reference: 'tss-bul', levels: [0, 1, 2].map(level => ({
        level, format: LevelFormat.BULLET, text: ['•', '◦', '▪'][level],
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 340 + level * 300, hanging: 240 } } },
      })) },
    { reference: 'tss-num', levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 280 } } } },
        { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2)', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 680, hanging: 280 } } } },
        { level: 2, format: LevelFormat.LOWER_ROMAN, text: '%3.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1000, hanging: 280 } } } },
      ] },
  ],
};

const STYLES = {
  default: {
    document: { run: { font: BODY, size: 21, color: INK }, paragraph: { spacing: { line: 300 } } },
    heading1: { run: { font: HEAD, size: 36, bold: true, color: INK }, paragraph: { spacing: { before: 360, after: 160 } } },
    heading2: { run: { font: HEAD, size: 28, bold: true, color: INK }, paragraph: { spacing: { before: 300, after: 120 } } },
    heading3: { run: { font: HEAD, size: 24, bold: true, color: INK }, paragraph: { spacing: { before: 240, after: 100 } } },
    heading4: { run: { font: HEAD, size: 21, bold: true, color: INK2 }, paragraph: { spacing: { before: 200, after: 90 } } },
  },
};

const footer = label => new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0 },
    children: [new TextRun({ text: `${label}　　`, font: BODY, size: 16, color: INK3 }),
               new TextRun({ children: [PageNumber.CURRENT], font: BODY, size: 16, color: INK3 }),
               new TextRun({ text: ' / ', font: BODY, size: 16, color: INK3 }),
               new TextRun({ children: [PageNumber.TOTAL_PAGES], font: BODY, size: 16, color: INK3 })],
  })],
});

function doc(label, children) {
  return new Document({
    styles: STYLES, numbering: NUMBERING,
    sections: [{
      properties: { page: { margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      footers: { default: footer(label) },
      children,
    }],
  });
}

const partHead = (kicker, title, src) => [
  new Paragraph({ children: [new TextRun({ text: kicker, font: HEAD, size: 17, color: INK3, characterSpacing: 30 })],
                  spacing: { after: 60 } }),
  new Paragraph({ heading: HeadingLevel.HEADING_1,
                  children: [new TextRun({ text: title, font: HEAD, size: 38, bold: true, color: INK })],
                  spacing: { before: 0, after: 60 } }),
  new Paragraph({ children: [new TextRun({ text: src, font: MONO, size: 16, color: INK3 })],
                  spacing: { after: 240 },
                  border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK } } }),
];

// ───────────────────────────────────────────────────────── 内容清单
const DOCS = [
  { n: '1', src: 'docs/experiments/three-senses-loop.md', short: '三感闭环实验设计',
    file: '01-实验设计-三感闭环.docx' },
  { n: '2', src: 'docs/scales/three-senses-scale.md', short: '三感量表 TSS 编制方案',
    file: '02-量表编制方案-TSS.docx' },
  { n: '3', src: 'docs/scales/BUILD-PROCESS.md', short: '问卷制作流程与验证关卡',
    file: '03-制作流程与验证关卡.docx' },
];
const CODE = [
  { src: 'docs/experiments/loop-power-sim.js', desc: '闭环放大实验的蒙特卡洛功效分析' },
  { src: 'docs/scales/tss-scoring.js', desc: '量表登记、计分、作答筛查、双因子结构诊断' },
  { src: 'docs/scales/verify.js', desc: '交付物核验套件（48 项）' },
];
const TOTAL_PARTS = 4;
const today = new Date().toISOString().slice(0, 10);

function codeSection(bound) {
  const out = partHead(bound ? '第 4 部分' : `三感项目 · 分册 4 / ${TOTAL_PARTS}`,
    '代码附录', '可运行脚本全文，供独立复算');
  out.push(new Paragraph({
    children: runs(parse('以下脚本零依赖，Node 18+ 可直接运行。').blocks[0].tokens),
    spacing: { after: 200 } }));
  for (const c of CODE) {
    const lines = readFileSync(join(ROOT, c.src), 'utf8').split('\n');
    out.push(new Paragraph({ children: [new PageBreak()] }));
    out.push(new Paragraph({ heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: basename(c.src), font: MONO, size: 26, bold: true })] }));
    out.push(new Paragraph({
      children: [new TextRun({ text: `${c.src} · ${c.desc} · ${lines.length} 行`, font: BODY, size: 17, color: INK3 })],
      spacing: { after: 140 } }));
    lines.forEach((l, k) => out.push(new Paragraph({
      children: [
        new TextRun({ text: String(k + 1).padStart(3, ' ') + '  ', font: MONO, size: 13, color: INK3 }),
        new TextRun({ text: l || ' ', font: MONO, size: 14, color: INK }),
      ],
      spacing: { before: 0, after: 0, line: 200 },
    })));
  }
  return out;
}

// ─────────────────────────────────────── 施测卷（纸质版，Word 专属版式）
function formDoc() {
  const items = formItems();
  const W = { no: 620, stem: 5018, opt: 800 };
  const widths = [W.no, W.stem, ...Array(5).fill(W.opt)];
  const total = widths.reduce((a, b) => a + b, 0);
  if (total !== CONTENT_W) widths[1] += CONTENT_W - total;

  const tc = (children, w, opts = {}) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders: cellBorders,
    margins: { top: 70, bottom: 70, left: 90, right: 90 }, children, ...opts });
  const p = (text, o = {}) => new Paragraph({
    children: [new TextRun({ text, font: o.font ?? BODY, size: o.size ?? 20,
                             bold: o.bold, color: o.color })],
    alignment: o.align, spacing: { before: 0, after: 0, line: o.line ?? 260 } });

  const headRow = new TableRow({
    tableHeader: true,
    children: [
      tc([p('题号', { size: 16, color: INK2, bold: true, align: AlignmentType.CENTER })], W.no,
        { shading: { type: ShadingType.CLEAR, fill: BG, color: 'auto' } }),
      tc([p('过去两周里，这句话符合你的频率', { size: 16, color: INK2, bold: true })], W.stem,
        { shading: { type: ShadingType.CLEAR, fill: BG, color: 'auto' } }),
      ...ANCHORS.map(([n, lab]) => tc([
        p(n, { size: 18, bold: true, align: AlignmentType.CENTER }),
        p(lab, { size: 13, color: INK2, align: AlignmentType.CENTER, line: 200 }),
      ], W.opt, { shading: { type: ShadingType.CLEAR, fill: BG, color: 'auto' } })),
    ],
  });

  const rows = items.map(it => new TableRow({
    children: [
      tc([p(String(it.no).padStart(2, '0'), { font: MONO, size: 17, color: INK3, align: AlignmentType.CENTER })], W.no),
      tc([p(it.text)], W.stem),
      ...ANCHORS.map(() => tc([p('□', { size: 22, align: AlignmentType.CENTER })], W.opt)),
    ],
  }));

  const body = [
    ...partHead('THREE-SENSES SCALE · 编制阶段草案 v0.1', '三感量表 TSS-30',
      '无助感 · 无意义感 · 绝望感　｜　30 题，约 6 分钟'),

    new Paragraph({
      children: [new TextRun({ text: '编号 ____________　　日期 ____________　　填写用时 ______ 分钟',
                               font: BODY, size: 20, color: INK2 })],
      spacing: { after: 220 } }),

    new Paragraph({
      children: [
        new TextRun({ text: '这份卷子是研究用的草案，不是诊断工具。', bold: true, font: BODY, size: 19 }),
        new TextRun({ text: '它还没有完成信效度验证，没有常模也没有切分点，不会告诉你"属于哪一档"。', font: BODY, size: 19 }),
      ],
      shading: { type: ShadingType.CLEAR, fill: BG, color: 'auto' },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: INK } },
      indent: { left: 200, right: 160 }, spacing: { before: 60, after: 60, line: 280 } }),
    new Paragraph({
      children: [
        new TextRun({ text: '它不能用来评估自杀风险。', bold: true, font: BODY, size: 19 }),
        new TextRun({ text: '卷面里没有任何自杀相关条目，这是刻意的设计。如果你正被这类念头困扰，请直接联系专业帮助：心理援助热线 12356，或当地精神卫生中心、校内心理咨询。', font: BODY, size: 19 }),
      ],
      shading: { type: ShadingType.CLEAR, fill: BG, color: 'auto' },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: INK } },
      indent: { left: 200, right: 160 }, spacing: { before: 0, after: 240, line: 280 } }),

    new Paragraph({ heading: HeadingLevel.HEADING_2, text: '怎么填' }),
    new Paragraph({ children: runs(parse(
      '下面每句话描述一种感受。请想一想**过去两周**里，这句话符合你的**频率**有多高，在对应的格子里打勾。不要在单题上停留太久——第一反应通常最准。每题只选一个。'
    ).blocks[0].tokens), spacing: { after: 100 } }),
    new Paragraph({ children: [new TextRun({
      text: '题目是打乱顺序排的，卷面上看不到每题属于哪个维度，这是为了避免被维度名称带着走。',
      font: BODY, size: 19, color: INK2 })], spacing: { after: 200 } }),

    new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths,
                rows: [headRow, ...rows] }),

    new Paragraph({ children: [new PageBreak()] }),
    ...partHead('施测者用 · 交给被试前请移除本页', '计分键',
      '反向题、维度归属与计分规则'),
    new Paragraph({ children: runs(parse(
      '计分规则：反向题按 `1↔5` 折算后，各维度取**已答条目均值**（非总和）。某维度缺失超过 **25%** 则该维度不计分，**不做插补**。三感总分 = 无助 / 无意义 / 绝望三个维度均值的平均。**预先放弃（PD）不计入总分**，单独报告。'
    ).blocks[0].tokens), spacing: { after: 160 } }),
    ...blocksToDocx(parse(
      ['| 卷面题号 | 题库编号 | 维度 | 侧面 | 反向 |', '|---:|---:|---|---|:--:|',
        ...items.map(it => `| ${it.no} | ${it.bank} | ${DOMAINS[it.dom].name} | ` +
          `${it.facet === 'PD' ? '—' : DOMAINS[it.dom].facets[it.facet]} | ${it.reverse ? 'R' : ''} |`),
      ].join('\n')).blocks),
    new Paragraph({ children: runs(parse(
      '计分可用 `tss-scoring.js`（`node docs/scales/tss-scoring.js`），或使用网页版即时出剖面图。'
    ).blocks[0].tokens) }),
  ];
  return doc('三感量表 TSS-30 施测卷 · 研究用草案', body);
}

// ───────────────────────────────────────────────────────────── 跑
mkdirSync(OUT, { recursive: true });
const made = [];
async function write(name, document) {
  const buf = await Packer.toBuffer(document);
  writeFileSync(join(OUT, name), buf);
  made.push([name, buf.length]);
}

// 分册
for (const d of DOCS) {
  numInstance = 0;
  const { title, blocks } = parse(readFileSync(join(ROOT, d.src), 'utf8'));
  await write(d.file, doc(`${d.short} · v0.1 草案`, [
    ...partHead(`三感项目 · 分册 ${d.n} / ${TOTAL_PARTS}`, title ?? d.short, d.src),
    ...blocksToDocx(blocks),
  ]));
}

// 代码附录
numInstance = 0;
await write('05-代码附录.docx', doc('三感项目 · 代码附录', codeSection(false)));

// 合订本
numInstance = 0;
const cover = [
  new Paragraph({ children: [new TextRun({ text: 'THREE-SENSES PROJECT', font: HEAD, size: 18, color: INK3, characterSpacing: 60 })],
                  spacing: { before: 1200, after: 200 } }),
  new Paragraph({ children: [new TextRun({ text: '无助感 · 无意义感 · 绝望感', font: HEAD, size: 56, bold: true, color: INK })],
                  spacing: { after: 120 } }),
  new Paragraph({ children: [new TextRun({ text: '一个闭环假设的实验设计、测量工具与制作流程', font: BODY, size: 26, color: INK2 })],
                  spacing: { after: 400 },
                  border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: INK } } }),
  ...[['合订本', '实验设计 · 量表编制方案 · 制作流程 SOP · 代码附录'],
      ['版本', 'v0.1 编制阶段草案'],
      ['日期', today],
      ['核验', '交付物核验套件 48 项全过（npm run verify:scale）']]
    .map(([k, v]) => new Paragraph({
      children: [new TextRun({ text: k + '　', font: BODY, size: 19, color: INK3 }),
                 new TextRun({ text: v, font: BODY, size: 19, color: INK2 })],
      spacing: { after: 90 } })),
  new Paragraph({
    children: [
      new TextRun({ text: '这套材料是研究用草案，不是诊断工具。', bold: true, font: BODY, size: 19 }),
      new TextRun({ text: '量表尚未完成信效度验证，没有常模也没有切分点，不得用于个体评估或风险判断；其中的实验设计包含负性情绪诱导，须先通过伦理审查方可实施。', font: BODY, size: 19 }),
    ],
    shading: { type: ShadingType.CLEAR, fill: BG, color: 'auto' },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: INK } },
    indent: { left: 200, right: 160 }, spacing: { before: 500, after: 60, line: 280 } }),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ heading: HeadingLevel.HEADING_1, text: '目录' }),
  new Paragraph({ children: [new TextRun({ text: '在 Word 中打开后，右键目录选择「更新域」，或按 Ctrl+A 再按 F9 生成页码。',
                                           font: BODY, size: 18, color: INK3 })], spacing: { after: 160 } }),
  new TableOfContents('目录', { hyperlink: true, headingStyleRange: '1-3' }),
  new Paragraph({ children: [new PageBreak()] }),
];
const bound = [...cover];
for (const d of DOCS) {
  const { title, blocks } = parse(readFileSync(join(ROOT, d.src), 'utf8'));
  bound.push(...partHead(`第 ${d.n} 部分`, title ?? d.short, d.src), ...blocksToDocx(blocks),
             new Paragraph({ children: [new PageBreak()] }));
}
bound.push(...codeSection(true));
await write('00-三感项目-合订本.docx', doc('三感项目合订本 · v0.1 草案', bound));

// 施测卷
await write('04-施测卷-TSS-30.docx', formDoc());

console.log('Word 已生成 →', OUT);
for (const [f, s] of made.sort()) console.log(`  ${f.padEnd(34)} ${(s / 1024).toFixed(0).padStart(6)} KB`);
