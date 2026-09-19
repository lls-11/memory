#!/usr/bin/env node
// docs/scales/build-pdf.mjs
//
// 把三感项目的文档打成 PDF
// =========================
// 零依赖：自带一个够用的 Markdown→HTML 转换，再用 Chromium 的 CDP 打印。
// 之所以不用 pandoc / weasyprint / puppeteer：本机都没有，且 pip 装不动；
// Node 22 自带全局 WebSocket，直接驱 DevTools Protocol 即可，不引入任何包。
//
// 产出（默认写到 docs/scales/pdf/，已 gitignore —— PDF 是构建产物，不入库）：
//   00-三感项目-合订本.pdf     封面 + 目录 + 三份文档 + 代码附录
//   01-实验设计-三感闭环.pdf
//   02-量表编制方案-TSS.pdf
//   03-制作流程与验证关卡.pdf
//   04-施测卷-TSS-30.pdf        由施测卷 HTML 的打印样式渲染，可直接复印施测
//   05-代码附录.pdf
//
// 用法：
//   node docs/scales/build-pdf.mjs
//   node docs/scales/build-pdf.mjs --shot     # 另存一张首页 PNG 用于目视检查字体
//
// 字体说明：本机 CJK 字体只有文泉驿正黑（无宋体/思源系列），因此正文与标题
// 统一用黑体，靠字重与字号区分层级。等宽用文泉驿等宽正黑。
// Chromium 以 --host-resolver-rules 断网运行：渲染完全确定、不等任何外部资源。

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = join(HERE, 'pdf');
const SHOT = process.argv.includes('--shot');

const CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find(p => existsSync(p));
if (!CHROME) { console.error('找不到 Chromium 可执行文件'); process.exit(1); }

// ════════════════════════════════════════════════ 1. Markdown → HTML
// 覆盖本项目文档实际用到的语法：标题、段落、有序/无序列表（含两级嵌套与
// 任务列表）、表格（含列对齐）、围栏代码块、引用块、分隔线，以及行内的
// 粗体/斜体/代码/链接。不追求通用，追求对这几份文档正确。

// 本机字体缺少的符号 → 换成能渲染的文字，避免 PDF 里出现豆腐块
const GLYPHS = [
  [/✅/g, '【完成】'], [/⚠️|⚠/g, '【部分】'], [/❌/g, '【未做】'],
  [/ℹ️|ℹ/g, '注：'], [/✓/g, '·通过'], [/✗/g, '·失败'],
];

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s) {
  let t = esc(s);
  // 行内代码优先，避免其中的 * _ 被当作强调
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, href) =>
    /^https?:/.test(href) ? `<a href="${href}">${txt}</a>` : `<span class="xref">${txt}</span>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  for (const [re, to] of GLYPHS) t = t.replace(re, to);
  return t;
}

// 「无助 → 无意义 → 绝望 → 无助」闭环图：mermaid 在 PDF 里没法渲染，
// 换成手写 SVG，内容与 mermaid 源一致。
const LOOP_SVG = `<figure class="diagram">
<svg viewBox="0 0 660 230" role="img" aria-label="三感闭环：无助→无意义→绝望→无助"
     xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:560px">
  <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"
      orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#3b3d42"/></marker></defs>
  <g font-family="WenQuanYi Zen Hei, sans-serif" text-anchor="middle">
    <rect x="18"  y="24" width="176" height="62" rx="3" fill="#eaf2fc" stroke="#2a78d6" stroke-width="1.5"/>
    <text x="106" y="50" font-size="15" font-weight="bold" fill="#16354f">① 无助感</text>
    <text x="106" y="72" font-size="11.5" fill="#44546a">行动 → 结果　断裂</text>

    <rect x="242" y="24" width="176" height="62" rx="3" fill="#fdefe7" stroke="#eb6834" stroke-width="1.5"/>
    <text x="330" y="50" font-size="15" font-weight="bold" fill="#5a2a10">② 无意义感</text>
    <text x="330" y="72" font-size="11.5" fill="#6b4530">结果 → 价值　断裂</text>

    <rect x="466" y="24" width="176" height="62" rx="3" fill="#e7f6f0" stroke="#1baf7a" stroke-width="1.5"/>
    <text x="554" y="50" font-size="15" font-weight="bold" fill="#0e4632">③ 绝望感</text>
    <text x="554" y="72" font-size="11.5" fill="#2d5a49">价值 → 未来　断裂</text>

    <line x1="198" y1="55" x2="236" y2="55" stroke="#3b3d42" stroke-width="1.6" marker-end="url(#ar)"/>
    <text x="217" y="44" font-size="12" font-style="italic" fill="#3b3d42">a</text>
    <line x1="422" y1="55" x2="460" y2="55" stroke="#3b3d42" stroke-width="1.6" marker-end="url(#ar)"/>
    <text x="441" y="44" font-size="12" font-style="italic" fill="#3b3d42">b</text>

    <path d="M554,92 L554,150 L106,150 L106,92" fill="none" stroke="#3b3d42"
          stroke-width="1.6" marker-end="url(#ar)"/>
    <text x="330" y="142" font-size="12" fill="#3b3d42">
      <tspan font-style="italic">c</tspan>　预先放弃 → 不再检验行动与结果的联结
    </text>
    <text x="330" y="182" font-size="11.5" fill="#55575c">
      闭环的关键边：预期不会变好，于是不试；因为不试，无助被自己的不行动所证实
    </text>
  </g>
</svg>
<figcaption>图 1　三感闭环。a／b／c 为三条待检验的因果边。</figcaption>
</figure>`;

// 返回 { title, html }：文档自身的 H1 作为分册标题（保证两处永不分叉），
// 并从正文中剥掉，避免与分册页头重复。
function mdToHtml(md) {
  let title = null;
  const lines = md.replace(/\r/g, '').split('\n');
  const h1 = lines.findIndex(l => /^#\s/.test(l));
  if (h1 !== -1) { title = lines[h1].replace(/^#\s*/, '').trim(); lines.splice(h1, 1); }
  const out = [];
  let i = 0;

  const flushTable = () => {
    // 表格：第二行形如 |---|:--:|---:| 时判定
    const rows = [];
    let align = null;
    while (i < lines.length && /^\s*\|/.test(lines[i])) {
      const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (rows.length === 1 && cells.every(c => /^:?-{2,}:?$/.test(c))) {
        align = cells.map(c => c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : 'left');
      } else rows.push(cells);
      i++;
    }
    if (!rows.length) return;
    const head = rows.shift();
    const th = head.map((c, k) =>
      `<th style="text-align:${align?.[k] || 'left'}">${inline(c)}</th>`).join('');
    const body = rows.map(r => '<tr>' + r.map((c, k) =>
      `<td style="text-align:${align?.[k] || 'left'}">${inline(c)}</td>`).join('') + '</tr>').join('');
    out.push(`<div class="tablewrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`);
  };

  // 列表：按缩进递归，支持 - / 1. / - [ ]
  const flushList = (indent) => {
    const m0 = lines[i].match(/^(\s*)([-*]|\d+\.)\s/);
    const ordered = /\d/.test(m0[2]);
    const items = [];
    while (i < lines.length) {
      const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
      if (!m || m[1].length < indent) break;
      if (m[1].length > indent) {                     // 子列表
        items[items.length - 1] += flushList(m[1].length);
        continue;
      }
      let text = m[3];
      const task = text.match(/^\[([ xX])\]\s*(.*)$/);
      if (task) text = `<span class="box">${task[1].trim() ? '■' : '□'}</span> ${task[2]}`;
      i++;
      // 续行（缩进但不是新列表项）
      const cont = [];
      while (i < lines.length && /^\s{2,}\S/.test(lines[i]) &&
             !/^(\s*)([-*]|\d+\.)\s/.test(lines[i]) && !/^\s*\|/.test(lines[i])) {
        cont.push(lines[i].trim()); i++;
      }
      items.push(`<li>${inline(text)}${cont.length ? ' ' + inline(cont.join(' ')) : ''}`);
    }
    const tag = ordered ? 'ol' : 'ul';
    return `<${tag}>${items.map(s => s + '</li>').join('')}</${tag}>`;
  };

  while (i < lines.length) {
    const L = lines[i];

    if (/^\s*$/.test(L)) { i++; continue; }

    if (/^```/.test(L)) {                             // 围栏代码块
      const lang = L.replace(/^```/, '').trim();
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      if (lang === 'mermaid') out.push(LOOP_SVG);
      else out.push(`<pre class="block"><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^#{1,4}\s/.test(L)) {
      const lv = L.match(/^#+/)[0].length;
      out.push(`<h${lv}>${inline(L.replace(/^#+\s*/, ''))}</h${lv}>`);
      i++; continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(L)) { out.push('<hr>'); i++; continue; }
    if (/^\s*\|/.test(L)) { flushTable(); continue; }
    if (/^\s*([-*]|\d+\.)\s/.test(L)) { out.push(flushList(L.match(/^\s*/)[0].length)); continue; }
    if (/^>\s?/.test(L)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }
    const buf = [];                                    // 段落
    while (i < lines.length && !/^\s*$/.test(lines[i]) &&
           !/^(#{1,4}\s|```|>\s?|\s*\||\s*([-*]|\d+\.)\s|\s*---\s*$)/.test(lines[i])) buf.push(lines[i++]);
    if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return { title, html: out.join('\n') };
}

// ════════════════════════════════════════════════════════ 2. 打印样式
const CSS = `
:root{
  --ink:#1a1b1d; --ink-2:#4a4c50; --ink-3:#76787d;
  --rule:#d6d6d2; --rule-2:#b4b4af; --bg-2:#f6f6f4;
  --h:#2a78d6; --m:#eb6834; --d:#1baf7a;
  --cjk:"WenQuanYi Zen Hei","WenQuanYi Micro Hei",sans-serif;
  --mono:"WenQuanYi Zen Hei Mono",monospace;
}
*{box-sizing:border-box}
body{margin:0; font-family:var(--cjk); color:var(--ink);
     font-size:10.2pt; line-height:1.72; text-align:justify}
h1,h2,h3,h4{line-height:1.35; break-after:avoid; page-break-after:avoid; text-align:left}
h1{font-size:19pt; margin:0 0 .5em; letter-spacing:.01em}
h2{font-size:14pt; margin:1.5em 0 .5em; padding-bottom:.24em; border-bottom:1.2px solid var(--rule-2)}
h3{font-size:11.6pt; margin:1.25em 0 .4em; color:var(--ink)}
h4{font-size:10.4pt; margin:1em 0 .3em; color:var(--ink-2)}
p{margin:0 0 .62em}
strong{font-weight:bold}
a{color:var(--ink); text-decoration:none; border-bottom:.6px dotted var(--ink-3)}
.xref{border-bottom:.6px dotted var(--ink-3)}
code{font-family:var(--mono); font-size:.88em; background:var(--bg-2);
     padding:.05em .3em; border:.6px solid var(--rule)}
pre.block{font-family:var(--mono); font-size:8.3pt; line-height:1.5; background:var(--bg-2);
     border:.6px solid var(--rule); border-left:2.5px solid var(--rule-2);
     padding:8px 10px; margin:.7em 0; overflow-wrap:break-word; white-space:pre-wrap;
     break-inside:avoid; page-break-inside:avoid; text-align:left}
pre.block code{background:none; border:0; padding:0; font-size:inherit}
blockquote{margin:.7em 0; padding:8px 12px; background:var(--bg-2);
     border-left:2.5px solid var(--ink-3); font-size:9.5pt; color:var(--ink-2);
     break-inside:avoid}
ul,ol{margin:.35em 0 .7em; padding-left:1.55em}
li{margin:.18em 0}
li>ul,li>ol{margin:.2em 0 .3em}
.box{font-family:var(--mono)}
hr{border:0; border-top:.8px solid var(--rule); margin:1.4em 0}
.tablewrap{margin:.75em 0; break-inside:auto}
table{width:100%; border-collapse:collapse; font-size:9pt; line-height:1.55}
th,td{border:.6px solid var(--rule); padding:4.5px 7px; vertical-align:top; text-align:left}
th{background:var(--bg-2); font-weight:bold; font-size:8.6pt; color:var(--ink-2)}
tr{break-inside:avoid; page-break-inside:avoid}
thead{display:table-header-group}
figure.diagram{margin:1em 0; text-align:center; break-inside:avoid}
figure.diagram figcaption{font-size:8.8pt; color:var(--ink-3); margin-top:.5em}

/* 封面与分册页 */
.cover{height:247mm; display:flex; flex-direction:column; justify-content:center;
       page-break-after:always; text-align:left}
.cover .kicker{font-size:9pt; letter-spacing:.2em; color:var(--ink-3); margin-bottom:1.2em}
.cover h1{font-size:30pt; margin:0 0 .3em; line-height:1.25}
.cover .lede{font-size:13pt; color:var(--ink-2); margin:0 0 2.2em}
.cover .rule{height:2.5px; background:var(--ink); width:74px; margin-bottom:2.2em}
.cover dl{margin:0; font-size:9.6pt; color:var(--ink-2); display:grid;
          grid-template-columns:5.6em 1fr; gap:.42em 1em}
.cover dt{color:var(--ink-3)}
.cover dd{margin:0}
.cover .warn{margin-top:2.6em; padding:11px 13px; border:.8px solid var(--rule-2);
             border-left:2.5px solid var(--ink); background:var(--bg-2);
             font-size:9.3pt; line-height:1.68; color:var(--ink-2)}
.toc{page-break-after:always}
.toc h2{margin-top:0}
.toc ol{list-style:none; padding:0; font-size:10.4pt}
.toc li{display:flex; gap:.6em; align-items:baseline; margin:.55em 0;
        border-bottom:.6px dotted var(--rule); padding-bottom:.3em}
.toc .n{font-family:var(--mono); color:var(--ink-3); font-size:9pt; min-width:2.2em}
.toc .t{flex:1}
.toc .d{color:var(--ink-3); font-size:8.8pt}
.part{page-break-before:always}
.part-head{margin:0 0 1.4em; padding-bottom:.6em; border-bottom:2.5px solid var(--ink)}
.part-head .n{font-family:var(--mono); font-size:9pt; letter-spacing:.14em; color:var(--ink-3)}
.part-head h1{font-size:20pt; margin:.25em 0 0}
.part-head .src{font-family:var(--mono); font-size:8.4pt; color:var(--ink-3); margin-top:.5em}

/* 代码附录 */
.codefile{page-break-before:always}
.codefile h2{margin-top:0; font-family:var(--mono); font-size:11pt}
.codefile .meta{font-size:8.6pt; color:var(--ink-3); margin:-.3em 0 .8em}
table.code{font-family:var(--mono); font-size:7.2pt; line-height:1.45; width:100%}
table.code td{border:0; padding:0 0 0 8px; white-space:pre-wrap; word-break:break-all; text-align:left}
table.code td.ln{padding:0 6px 0 0; text-align:right; color:var(--ink-3);
                 border-right:.6px solid var(--rule); width:3.2em; user-select:none}
`;

function page(title, bodyHtml) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(title)}</title><style>${CSS}</style></head><body>${bodyHtml}</body></html>`;
}

// ════════════════════════════════════════════════════════ 3. CDP 打印
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  const port = 9300 + Math.floor(Math.random() * 400);
  const profile = join(OUT, '.chrome-profile');
  rmSync(profile, { recursive: true, force: true });
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--host-resolver-rules=MAP * ~NOTFOUND',   // 断网：渲染确定、不等外部资源
    '--font-render-hinting=none', '--force-color-profile=srgb',
    '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });

  let ver = null;
  for (let k = 0; k < 120; k++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) { ver = await r.json(); break; }
    } catch {}
    await sleep(120);
  }
  if (!ver) { proc.kill('SIGKILL'); throw new Error('Chromium 未能启动 DevTools 端口'); }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('CDP 连接失败')); });

  let id = 0;
  const waits = new Map(), evs = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) {
      const { ok, no } = waits.get(m.id); waits.delete(m.id);
      m.error ? no(new Error(`${m.error.message}`)) : ok(m.result);
    } else if (m.method) {
      const key = m.sessionId ? `${m.sessionId}:${m.method}` : m.method;
      evs.get(key)?.forEach(fn => fn(m.params)); evs.delete(key);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
    const n = ++id;
    waits.set(n, { ok, no });
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const once = (method, sessionId) => new Promise(ok => {
    const key = sessionId ? `${sessionId}:${method}` : method;
    if (!evs.has(key)) evs.set(key, []);
    evs.get(key).push(ok);
  });
  return { send, once, close: () => { try { ws.close(); } catch {} proc.kill('SIGKILL'); } };
}

const FOOT = title => `<div style="width:100%;font-family:'WenQuanYi Zen Hei',sans-serif;
  font-size:7.4pt;color:#76787d;padding:0 16mm;display:flex;justify-content:space-between;">
  <span>${esc(title)}</span>
  <span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;

async function renderPdf(cdp, html, outFile, footTitle, { shot = false } = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  const loaded = cdp.once('Page.loadEventFired', sessionId);
  const frame = await cdp.send('Page.getFrameTree', {}, sessionId);
  await cdp.send('Page.setDocumentContent',
    { frameId: frame.frameTree.frame.id, html }, sessionId);
  await Promise.race([loaded, sleep(1500)]);
  await sleep(350);                                   // 让布局与字体回落稳定

  if (shot) {
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 820, height: 1160, deviceScaleFactor: 1.5, mobile: false }, sessionId);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(outFile.replace(/\.pdf$/, '-首页.png'), Buffer.from(data, 'base64'));
    await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
  }

  const { data } = await cdp.send('Page.printToPDF', {
    paperWidth: 8.27, paperHeight: 11.69,             // A4
    marginTop: 0.75, marginBottom: 0.72, marginLeft: 0.75, marginRight: 0.75,
    printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<div></div>', footerTemplate: FOOT(footTitle),
    preferCSSPageSize: false, transferMode: 'ReturnAsBase64',
  }, sessionId);
  writeFileSync(outFile, Buffer.from(data, 'base64'));
  await cdp.send('Target.closeTarget', { targetId });
  return Buffer.from(data, 'base64').length;
}

// ════════════════════════════════════════════════════════ 4. 内容组装
const DOCS = [
  { n: '1', src: 'docs/experiments/three-senses-loop.md',
    title: '三感闭环实验设计', desc: '无助 / 无意义 / 绝望 的因果闭环如何验证',
    file: '01-实验设计-三感闭环.pdf' },
  { n: '2', src: 'docs/scales/three-senses-scale.md',
    title: '三感量表 TSS 编制方案', desc: '维度结构、条目池 53 题、信效度验证计划',
    file: '02-量表编制方案-TSS.pdf' },
  { n: '3', src: 'docs/scales/BUILD-PROCESS.md',
    title: '问卷制作流程与验证关卡', desc: '12 个阶段的 SOP，每步的数字门槛与留痕要求',
    file: '03-制作流程与验证关卡.pdf' },
];
const CODE = [
  { src: 'docs/experiments/loop-power-sim.js', desc: '闭环放大实验的蒙特卡洛功效分析' },
  { src: 'docs/scales/tss-scoring.js', desc: '量表登记、计分、作答筛查、双因子结构诊断' },
  { src: 'docs/scales/verify.js', desc: '交付物核验套件（48 项）' },
];

const TOTAL_PARTS = 4;
const partHead = (n, title, src, bound) =>
  `<div class="part-head"><div class="n">${bound ? `第 ${n} 部分` : `三感项目 · 分册 ${n} / ${TOTAL_PARTS}`}</div>
<h1>${esc(title)}</h1><div class="src">${esc(src)}</div></div>`;

function codeHtml(rel, desc) {
  const src = readFileSync(join(ROOT, rel), 'utf8').split('\n');
  const rows = src.map((l, k) =>
    `<tr><td class="ln">${k + 1}</td><td>${esc(l) || '&nbsp;'}</td></tr>`).join('');
  return `<section class="codefile"><h2>${esc(basename(rel))}</h2>
<div class="meta">${esc(rel)} · ${esc(desc)} · ${src.length} 行</div>
<table class="code"><tbody>${rows}</tbody></table></section>`;
}

const today = new Date().toISOString().slice(0, 10);
const COVER = `<section class="cover">
  <div class="kicker">THREE-SENSES PROJECT</div>
  <h1>无助感 · 无意义感 · 绝望感</h1>
  <p class="lede">一个闭环假设的实验设计、测量工具与制作流程</p>
  <div class="rule"></div>
  <dl>
    <dt>合订本</dt><dd>实验设计 · 量表编制方案 · 制作流程 SOP · 代码附录</dd>
    <dt>版本</dt><dd>v0.1 编制阶段草案</dd>
    <dt>日期</dt><dd>${today}</dd>
    <dt>核验</dt><dd>交付物核验套件 48 项全过（npm run verify:scale）</dd>
  </dl>
  <div class="warn"><strong>这套材料是研究用草案，不是诊断工具。</strong>
  量表尚未完成信效度验证，没有常模也没有切分点，不得用于个体评估或风险判断；
  其中的实验设计包含负性情绪诱导，须先通过伦理审查方可实施。</div>
</section>`;

const TOC = `<section class="toc"><h2>目录</h2><ol>
${DOCS.map(d => `<li><span class="n">${d.n}</span><span class="t">${esc(d.title)}
  <span class="d">　${esc(d.desc)}</span></span></li>`).join('')}
<li><span class="n">4</span><span class="t">代码附录
  <span class="d">　${CODE.length} 个可运行脚本，共 ${CODE.reduce((a, c) =>
    a + readFileSync(join(ROOT, c.src), 'utf8').split('\n').length, 0)} 行</span></span></li>
</ol></section>`;

// 施测卷：包一层最小骨架（原文件按 Artifact 约定省略了 html/head），
// 锁定浅色主题，并隐藏交互产物（纸质版算不出剖面）。
function formHtml() {
  const raw = readFileSync(join(ROOT, 'docs/scales/tss-30-form.html'), 'utf8');
  return `<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="utf-8">
<style>:root{color-scheme:light}body{margin:0;font-size:14px}img{max-width:100%}
[hidden]{display:none!important}
@media print{
  #profile,h2.sech{display:none!important}
  body{font-family:"WenQuanYi Zen Hei",sans-serif}
}</style></head><body>${raw}
<script>document.addEventListener('DOMContentLoaded',()=>{
  const f=document.querySelector('footer');
  if(f){const p=document.createElement('p');
    p.innerHTML='<strong>纸质版说明：</strong>本页不含剖面图与计分结果——'+
      '纸质卷请用 tss-scoring.js 计分，或使用网页版即时出图。';
    f.prepend(p);}
});<\/script></body></html>`;
}

// ════════════════════════════════════════════════════════════ 5. 跑
mkdirSync(OUT, { recursive: true });
const cdp = await launch();
const made = [];
const kb = n => (n / 1024).toFixed(0) + ' KB';

try {
  // 各分册
  for (const d of DOCS) {
    const { title, html: body } = mdToHtml(readFileSync(join(ROOT, d.src), 'utf8'));
    const html = page(d.title, partHead(d.n, title ?? d.title, d.src, false) + body);
    const size = await renderPdf(cdp, html, join(OUT, d.file), `${d.title} · v0.1 草案`,
      { shot: SHOT && d.n === '1' });
    made.push([d.file, size]);
  }

  // 代码附录
  const codeBody = bound =>
    partHead('4', '代码附录', '可运行脚本全文，供独立复算', bound)
    + `<p>以下脚本零依赖，Node 18+ 可直接运行。行号用于引用，不属于源码。</p>`
    + CODE.map(c => codeHtml(c.src, c.desc)).join('');
  made.push(['05-代码附录.pdf',
    await renderPdf(cdp, page('代码附录', codeBody(false)), join(OUT, '05-代码附录.pdf'),
      '三感项目 · 代码附录')]);

  // 合订本
  const all = COVER + TOC
    + DOCS.map(d => {
        const { title, html: body } = mdToHtml(readFileSync(join(ROOT, d.src), 'utf8'));
        return `<section class="part">${partHead(d.n, title ?? d.title, d.src, true)}${body}</section>`;
      }).join('')
    + `<section class="part">${codeBody(true)}</section>`;
  made.push(['00-三感项目-合订本.pdf',
    await renderPdf(cdp, page('三感项目 合订本', all), join(OUT, '00-三感项目-合订本.pdf'),
      '三感项目合订本 · v0.1 草案')]);

  // 施测卷
  made.push(['04-施测卷-TSS-30.pdf',
    await renderPdf(cdp, formHtml(), join(OUT, '04-施测卷-TSS-30.pdf'),
      '三感量表 TSS-30 施测卷 · 研究用草案', { shot: SHOT })]);
} finally {
  cdp.close();
  rmSync(join(OUT, '.chrome-profile'), { recursive: true, force: true });
}

console.log('PDF 已生成 →', OUT);
for (const [f, s] of made.sort()) console.log(`  ${f.padEnd(32)} ${kb(s).padStart(8)}`);
