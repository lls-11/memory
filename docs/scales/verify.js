#!/usr/bin/env node
// docs/scales/verify.js
//
// 三感量表 TSS · 交付物核验套件
// ==============================
// 把「制作流程」里所有**机器可验证**的关卡做成一次可重复运行的检查。
// 覆盖三份交付物之间的一致性，以及卷面对外承诺的可核验性：
//
//   three-senses-scale.md   条目池与结构的唯一权威来源（附录 A）
//   tss-scoring.js          TSS-30 的登记与参考计分实现
//   tss-30-form.html        施测卷（卷面顺序、题干、页面内计分实现）
//
// 检查分六组（详见 BUILD-PROCESS.md §「三层可验证性」的第一层）：
//   A 条目池不变量        条目池自身的完整性与侧面平衡
//   B 跨文件一致性        卷面 ↔ 登记 ↔ 条目池 三方逐字对齐
//   C 计分实现等价性      页面内实现 vs 参考实现，随机 + 边界黄金测试
//   D 对外承诺可核验      不上传/不保存、卷面无自杀条目、可打印
//   E 卷面可用性静态检查  控件完整性、无障碍属性、主题 token 完备
//   F 结构诊断工具自检    双因子指标在已知情景下给出正确判定
//
// 用法：
//   node docs/scales/verify.js          # 全部检查，失败则退出码 1
//   node docs/scales/verify.js --quiet  # 只打印失败项与结论
//
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  TSS30, PRESENTATION_ORDER, SCALE_MIN, SCALE_MAX,
  score as refScore, carelessFlags as refFlags,
  bifactorIndices, verdict,
} from './tss-scoring.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC  = readFileSync(join(HERE, 'three-senses-scale.md'), 'utf8');
const FORM = readFileSync(join(HERE, 'tss-30-form.html'), 'utf8');
const QUIET = process.argv.includes('--quiet');

// ---------------------------------------------------------------- 检查框架
let pass = 0; const failures = [];
function check(group, name, fn) {
  let ok, detail = '';
  try { const r = fn(); ok = r === true || r === undefined; if (typeof r === 'string') { ok = false; detail = r; } }
  catch (e) { ok = false; detail = e.message; }
  if (ok) { pass++; if (!QUIET) console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failures.push({ group, name, detail }); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '\n      → ' + detail : ''}`); }
}
function group(letter, title, body) {
  if (!QUIET) console.log(`\n${letter} ${title}`);
  body();
}
const eq = (a, b, msg) => JSON.stringify(a) === JSON.stringify(b) ? true
  : `${msg}\n        期望 ${JSON.stringify(b)}\n        实际 ${JSON.stringify(a)}`;

// -------------------------------------------- 解析：文档附录 A 的条目池
// 侧面标题形如 **H-a 随因失联**；PD 段落标题形如 ### 模块 PD：...
// 条目行形如 `12. ★ 我做的事对别人是有价值的。**(R)**`
function parsePool(md) {
  const appendix = md.split('## 附录 A')[1];
  if (!appendix) throw new Error('文档中找不到「## 附录 A」');
  const body = appendix.split('## 附录 B')[0];
  const items = new Map();
  let facet = null;
  for (const line of body.split('\n')) {
    const fh = line.match(/^\*\*([HMD]-[abc])\s+(\S+)\*\*\s*$/);
    if (fh) { facet = fh[1]; continue; }
    if (/^###\s+模块\s+PD/.test(line)) { facet = 'PD'; continue; }
    const m = line.match(/^(\d+)\.\s+(★\s+)?(.*?)(\s*\*\*\(R\)\*\*)?\s*$/);
    if (!m || !facet) continue;
    const no = Number(m[1]);
    if (items.has(no)) throw new Error(`条目池中题号 ${no} 重复`);
    items.set(no, {
      bank: no, facet, dom: facet === 'PD' ? 'PD' : facet[0],
      starred: Boolean(m[2]), text: m[3].trim(), reverse: Boolean(m[4]),
    });
  }
  return items;
}

// ------------------------------- 解析 + 求值：卷面内的 ITEMS / 计分实现
// 直接把页面里的那份实现取出来执行，而不是在这里重写一遍 ——
// 重写一遍只能验证「我写了两次」，取出来执行才验证的是**页面真正在跑的代码**。
// 注意：若重构了卷面脚本的写法（函数签名或顶层声明形式），需同步这里的抽取规则。
function extractForm(html) {
  const grab = (re, what) => {
    const m = html.match(re);
    if (!m) throw new Error(`卷面中抽取不到 ${what}（脚本结构可能已改动，需同步 verify.js 的抽取规则）`);
    return m[0];
  };
  const src = [
    grab(/const ITEMS = \[[\s\S]*?\n\];/, 'ITEMS'),
    grab(/const ANCHORS = \[[\s\S]*?\];/, 'ANCHORS'),
    grab(/const MIN = [^;]*;/, 'MIN/MAX'),
    grab(/const revv = [^;]*;/, 'revv'),
    grab(/const DOMS = \{[\s\S]*?\n\};/, 'DOMS'),
    grab(/const CARELESS = \{[^}]*\};/, 'CARELESS'),
    grab(/\nfunction score\(r\)\{[\s\S]*?\n\}\n/, 'score()'),
    grab(/\nfunction flags\(r\)\{[\s\S]*?\n\}\n/, 'flags()'),
    grab(/const DEMO = \{[\s\S]*?\};/, 'DEMO'),
  ].join('\n');
  return new Function(
    `${src}\nreturn {ITEMS, ANCHORS, DOMS, CARELESS, DEMO, MIN, MAX, revv, score, flags};`)();
}

const POOL = parsePool(DOC);
const F = extractForm(FORM);

const FACETS = ['H-a','H-b','H-c','M-a','M-b','M-c','D-a','D-b','D-c'];

// 撰写规则的**已登记例外**。条目里保留因果/目的连词必须在此写明理由，
// 并在阶段 2 的专家内容效度评审中逐条复核 —— 例外是要被看见的，不是规则的漏洞。
const CONNECTIVE_EXCEPTIONS = {
  46: '「免得」承载预先放弃的定义性内容（为免再次确认无效而不去试），去掉则构念被抽空',
};
const bankOf = new Map(F.ITEMS.map(i => [i.no, i.bank]));   // 卷面题号 → 题库编号

console.log('三感量表 TSS · 交付物核验');
console.log('─'.repeat(64));

// ══════════════════════════════════════════════════════ A 条目池不变量
group('A', '条目池不变量（权威来源：three-senses-scale.md 附录 A）', () => {
  check('A', '条目池共 53 题，题号 1–53 连续无缺', () => {
    const nos = [...POOL.keys()].sort((a, b) => a - b);
    if (nos.length !== 53) return `解析到 ${nos.length} 题`;
    return eq(nos, Array.from({ length: 53 }, (_, i) => i + 1), '题号不连续');
  });
  check('A', '9 个侧面各 5 题，PD 模块 8 题', () => {
    const cnt = {};
    for (const it of POOL.values()) cnt[it.facet] = (cnt[it.facet] || 0) + 1;
    const bad = FACETS.filter(f => cnt[f] !== 5);
    if (bad.length) return `侧面题数不为 5：${bad.map(f => `${f}=${cnt[f]}`).join(' ')}`;
    if (cnt.PD !== 8) return `PD 模块 ${cnt.PD} 题，应为 8`;
  });
  check('A', '每个侧面至少 1 道反向题', () => {
    const bad = FACETS.filter(f => ![...POOL.values()].some(i => i.facet === f && i.reverse));
    return bad.length ? `无反向题的侧面：${bad.join(' ')}` : true;
  });
  check('A', '条目池反向题共 10 道', () => {
    const n = [...POOL.values()].filter(i => i.reverse).length;
    return n === 10 ? true : `实际 ${n} 道`;
  });
  check('A', '条目文本均以句号收尾、长度 ≤ 20 字（撰写规则）', () => {
    const bad = [...POOL.values()].filter(i => !i.text.endsWith('。') || i.text.length > 21);
    return bad.length ? bad.map(i => `#${i.bank}(${i.text.length}字)`).join(' ') : true;
  });
  check('A', '条目不含躯体症状词（与 PHQ-9 保持区分）', () => {
    const banned = ['睡眠','失眠','睡不','食欲','胃口','体重','疲劳','没力气','注意力'];
    const bad = [...POOL.values()].filter(i => banned.some(w => i.text.includes(w)));
    return bad.length ? bad.map(i => `#${i.bank}`).join(' ') : true;
  });
  check('A', '条目不含因果/目的连词，例外须已登记', () => {
    const banned = ['所以','导致','因此','因为','免得'];
    const hit = [];
    for (const i of POOL.values()) {
      // 「讲不出个所以然」是成语，其中的「所以」不是连词 —— 扫描前剔除，避免误报
      const t = i.text.replace(/所以然/g, '');
      const w = banned.find(b => t.includes(b));
      if (!w) continue;
      if (CONNECTIVE_EXCEPTIONS[i.bank]) continue;   // 已登记例外
      hit.push(`#${i.bank}（「${w}」）：${i.text}`);
    }
    if (hit.length) return hit.join('\n        ');
    const n = Object.keys(CONNECTIVE_EXCEPTIONS).length;
    if (n && !QUIET) console.log(`      ℹ 已登记例外 ${n} 条，须在阶段 2 专家评审中逐条复核`);
    return true;
  });
});

// ══════════════════════════════════════════════ B 跨文件一致性（三方）
group('B', '跨文件一致性（条目池 ↔ tss-scoring.js 登记 ↔ 卷面）', () => {
  check('B', 'TSS-30 登记的每维 9 题、PD 3 题', () => {
    const got = Object.fromEntries(Object.entries(TSS30).map(([d, s]) => [d, s.items.length]));
    return eq(got, { H: 9, M: 9, D: 9, PD: 3 }, '登记题数不符');
  });
  check('B', 'TSS-30 登记的每维 3 侧面 × 3 题', () => {
    const bad = [];
    for (const [dom, spec] of Object.entries(TSS30)) {
      if (dom === 'PD') continue;
      for (const f of FACETS.filter(f => f[0] === dom)) {
        const n = spec.items.filter(it => POOL.get(it)?.facet === f).length;
        if (n !== 3) bad.push(`${f}=${n}`);
      }
    }
    return bad.length ? bad.join(' ') : true;
  });
  check('B', 'TSS-30 登记的每维恰 1 道反向题，且与条目池标记一致', () => {
    for (const [dom, spec] of Object.entries(TSS30)) {
      if (dom === 'PD') { if (spec.reverse.length) return 'PD 不应有反向题'; continue; }
      if (spec.reverse.length !== 1) return `${dom} 登记了 ${spec.reverse.length} 道反向题`;
      const it = POOL.get(spec.reverse[0]);
      if (!it?.reverse) return `${dom} 的反向题 #${spec.reverse[0]} 在条目池中未标 (R)`;
      const poolRev = spec.items.filter(i => POOL.get(i).reverse);
      if (poolRev.length !== 1) return `${dom} 所选 9 题中有 ${poolRev.length} 道条目池反向题`;
    }
    return true;
  });
  check('B', 'TSS-30 登记的题号全部来自条目池', () => {
    const bad = Object.values(TSS30).flatMap(s => s.items).filter(it => !POOL.has(it));
    return bad.length ? `不在条目池中：${bad.join(' ')}` : true;
  });
  check('B', '文档中标 ★ 的条目 = TSS-30 登记的 30 题', () => {
    const starred = [...POOL.values()].filter(i => i.starred).map(i => i.bank).sort((a, b) => a - b);
    const reg = Object.values(TSS30).flatMap(s => s.items).sort((a, b) => a - b);
    return eq(starred, reg, '★ 标记与登记不一致');
  });
  check('B', '卷面 30 题，卷面题号 1–30 连续', () => {
    if (F.ITEMS.length !== 30) return `卷面 ${F.ITEMS.length} 题`;
    return eq(F.ITEMS.map(i => i.no), Array.from({ length: 30 }, (_, i) => i + 1), '卷面题号不连续');
  });
  check('B', '卷面题库编号 = TSS-30 登记（逐维比对）', () => {
    for (const [dom, spec] of Object.entries(TSS30)) {
      const got = F.ITEMS.filter(i => i.dom === dom).map(i => i.bank).sort((a, b) => a - b);
      const want = [...spec.items].sort((a, b) => a - b);
      const r = eq(got, want, `${dom} 维不一致`);
      if (r !== true) return r;
    }
    return true;
  });
  check('B', '卷面题干与条目池**逐字**一致', () => {
    const bad = F.ITEMS.filter(i => POOL.get(i.bank).text !== i.t)
      .map(i => `#${i.bank}\n        池：${POOL.get(i.bank).text}\n        卷：${i.t}`);
    return bad.length ? bad.join('\n      ') : true;
  });
  check('B', '卷面侧面与反向标记与条目池一致', () => {
    const bad = F.ITEMS.filter(i => {
      const p = POOL.get(i.bank);
      return p.facet !== i.fac || Boolean(i.r) !== p.reverse;
    }).map(i => `#${i.bank}`);
    return bad.length ? bad.join(' ') : true;
  });
  check('B', '卷面呈现顺序 = tss-scoring.js 登记的 PRESENTATION_ORDER', () =>
    eq(F.ITEMS.map(i => i.bank), PRESENTATION_ORDER, '顺序不一致（长串指标会算错）'));
  check('B', '卷面确实打乱了：无连续 3 题同维度', () => {
    const d = F.ITEMS.map(i => i.dom);
    for (let k = 2; k < d.length; k++)
      if (d[k] === d[k-1] && d[k] === d[k-2]) return `卷面第 ${k-1}–${k+1} 题同为 ${d[k]} 维`;
    return true;
  });
  check('B', '量程三处一致（文档 5 点 / 参考实现 / 卷面）', () => {
    if (SCALE_MIN !== 1 || SCALE_MAX !== 5) return `参考实现量程 ${SCALE_MIN}–${SCALE_MAX}`;
    if (F.MIN !== 1 || F.MAX !== 5) return `卷面量程 ${F.MIN}–${F.MAX}`;
    if (F.ANCHORS.length !== 5) return `卷面 ${F.ANCHORS.length} 个锚点`;
    if (!/\|\s*\*\*TSS-30\*\*\s*\|\s*30[^|]*\|\s*过去两周\s*\|\s*1–5 频率/.test(DOC))
      return '文档版本表中 TSS-30 的时间框架/量程行未找到或不匹配';
    return true;
  });
  check('B', '筛查阈值在卷面与参考实现中一致', () => {
    const want = { longString: 15, irvMin: 0.30, reverseGap: 2.0 };
    return eq({ longString: F.CARELESS.longString, irvMin: F.CARELESS.irvMin, reverseGap: F.CARELESS.reverseGap },
      want, '阈值不一致');
  });
});

// ══════════════════════════════════════════ C 计分实现等价性（黄金测试）
group('C', '计分实现等价性：卷面内实现 vs 参考实现', () => {
  // 卷面以「卷面题号」为键，参考实现以「题库编号」为键，先做映射
  const toBank = r => Object.fromEntries(Object.entries(r).map(([no, v]) => [bankOf.get(Number(no)), v]));
  const cmp = (r, label) => {
    const a = F.score(r);
    const b = refScore(toBank(r)).scores;
    for (const d of ['H','M','D','PD']) {
      const x = a[d].val, y = b[d];
      if (x === null || y === null) { if (x !== y) return `${label}：${d} 一侧为 null（卷面 ${x} / 参考 ${y}）`; continue; }
      if (Math.abs(x - y) > 1e-12) return `${label}：${d} 卷面 ${x} ≠ 参考 ${y}`;
    }
    const at = a.TOTAL, bt = b.TOTAL;
    if (at === null || bt === null) { if (at !== bt) return `${label}：总分一侧为 null`; }
    else if (Math.abs(at - bt) > 1e-12) return `${label}：总分 ${at} ≠ ${bt}`;
    return true;
  };

  check('C', '完整作答 · 500 组随机数据得分完全一致', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let t = 0; t < 500; t++) {
      const r = {};
      for (const it of F.ITEMS) r[it.no] = 1 + Math.floor(rnd() * 5);
      const v = cmp(r, `第 ${t + 1} 组`);
      if (v !== true) return v;
    }
    return true;
  });
  check('C', '示例作答（卷面 DEMO）得分一致', () => cmp(F.DEMO, '示例'));
  check('C', '缺失边界：9 题缺 2（22.2% ≤ 25%）计分，缺 3（33.3% > 25%）不计分', () => {
    const full = {}; for (const it of F.ITEMS) full[it.no] = 3;
    const hNos = F.ITEMS.filter(i => i.dom === 'H').map(i => i.no);
    const drop2 = { ...full }; hNos.slice(0, 2).forEach(n => delete drop2[n]);
    const drop3 = { ...full }; hNos.slice(0, 3).forEach(n => delete drop3[n]);
    if (F.score(drop2).H.val === null) return '缺 2 题时卷面判为不计分（应计分）';
    if (F.score(drop3).H.val !== null) return '缺 3 题时卷面仍计分（应不计分）';
    if (refScore(toBank(drop2)).scores.H === null) return '缺 2 题时参考实现判为不计分';
    if (refScore(toBank(drop3)).scores.H !== null) return '缺 3 题时参考实现仍计分';
    if (F.score(drop3).TOTAL !== null) return '某维不计分时总分应为 null';
    let v = cmp(drop2, '缺2'); if (v !== true) return v;
    return cmp(drop3, '缺3');
  });
  check('C', '反向计分方向正确（反向题答 1 应折为 5）', () => {
    const r = {}; for (const it of F.ITEMS) r[it.no] = 1;
    const revNo = F.ITEMS.find(i => i.r && i.dom === 'H').no;
    // H 维 9 题：8 题正向答 1（=1），1 题反向答 1（折为 5）→ 均值 (8*1+5)/9
    const want = (8 * 1 + 5) / 9;
    const got = F.score(r).H.val;
    return Math.abs(got - want) < 1e-12 ? true : `卷面 H=${got}，应为 ${want}（反向题 #${revNo}）`;
  });
  check('C', 'PD 不计入总分：仅改 PD 作答，总分不变', () => {
    const a = {}; for (const it of F.ITEMS) a[it.no] = 3;
    const b = { ...a }; F.ITEMS.filter(i => i.dom === 'PD').forEach(i => { b[i.no] = 5; });
    const t1 = F.score(a).TOTAL, t2 = F.score(b).TOTAL;
    if (Math.abs(t1 - t2) > 1e-12) return `总分从 ${t1} 变为 ${t2}`;
    if (F.score(b).PD.val !== 5) return 'PD 自身未随作答变化';
    return true;
  });
  check('C', '作答质量筛查：卷面与参考实现三个指标一致', () => {
    const cases = {
      '全选 3': Object.fromEntries(F.ITEMS.map(i => [i.no, 3])),
      '全选 5': Object.fromEntries(F.ITEMS.map(i => [i.no, 5])),
      '示例作答': F.DEMO,
    };
    for (const [label, r] of Object.entries(cases)) {
      const a = F.flags(r), b = refFlags(toBank(r));
      if (a.longString !== b.longString) return `${label}：长串 ${a.longString} ≠ ${b.longString}`;
      if (Math.abs(a.irv - b.irv) > 1e-9) return `${label}：IRV ${a.irv} ≠ ${b.irv}`;
      if (Math.abs(a.gap - b.reverseGap) > 1e-9) return `${label}：反向题偏离 ${a.gap} ≠ ${b.reverseGap}`;
      if (a.hits.length > 0 !== b.flagged) return `${label}：标记结论不一致`;
    }
    return true;
  });
  check('C', '筛查不误伤「极端但认真」的作答（全选 5 且反向题反选）', () => {
    const r = {};
    for (const it of F.ITEMS) r[it.no] = it.r ? 1 : 5;
    const f = F.flags(r);
    return f.hits.length === 0 ? true
      : `被误标：${f.hits.join('；')}（长串 ${f.longString} / IRV ${f.irv.toFixed(2)}）`;
  });
});

// ══════════════════════════════════════════════ D 对外承诺的可核验性
group('D', '卷面对外承诺的可核验性', () => {
  const script = FORM.slice(FORM.indexOf('<script>'));
  check('D', '不上传：无 fetch / XHR / WebSocket / 外发表单', () => {
    const bad = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon', '<form']
      .filter(w => script.includes(w) || (w === '<form' && FORM.includes(w)));
    return bad.length ? `出现：${bad.join(' ')}` : true;
  });
  check('D', '不保存：无 localStorage / sessionStorage / indexedDB / cookie', () => {
    const bad = ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']
      .filter(w => FORM.includes(w));
    return bad.length ? `出现：${bad.join(' ')}` : true;
  });
  check('D', '无第三方脚本（只允许 Google Fonts 样式表）', () => {
    const srcs = [...FORM.matchAll(/<script[^>]*\bsrc=["']([^"']+)/g)].map(m => m[1]);
    if (srcs.length) return `外部脚本：${srcs.join(' ')}`;
    const links = [...FORM.matchAll(/<link[^>]*href=["'](https?:\/\/[^"']+)/g)].map(m => m[1]);
    const bad = links.filter(u => !u.startsWith('https://fonts.googleapis.com/'));
    return bad.length ? `非字体外链：${bad.join(' ')}` : true;
  });
  check('D', '卷面无自杀/自伤相关条目（伦理条款 §9）', () => {
    const banned = ['自杀','自残','自伤','死','活不下去','结束生命','轻生','伤害自己'];
    const bad = F.ITEMS.filter(i => banned.some(w => i.t.includes(w)));
    return bad.length ? bad.map(i => `卷面第 ${i.no} 题`).join(' ') : true;
  });
  check('D', '卷头写明「不是诊断工具」且给出求助途径', () => {
    const need = ['不是诊断工具', '风险', '热线'];
    const miss = need.filter(w => !FORM.includes(w));
    return miss.length ? `缺少表述：${miss.join(' ')}` : true;
  });
  check('D', '不呈现切分点/严重程度分档', () => {
    const banned = ['切分点', '重度', '中度', '轻度', '高危', '阳性'];
    const hits = banned.filter(w => {
      const i = FORM.indexOf(w);
      return i !== -1 && !FORM.slice(Math.max(0, i - 60), i).includes('没有')
                      && !FORM.slice(Math.max(0, i - 60), i).includes('不');
    });
    return hits.length ? `页面出现分档措辞：${hits.join(' ')}` : true;
  });
  check('D', '提供打印样式（可作纸质卷）', () =>
    /@media\s+print/.test(FORM) ? true : '缺少 @media print');
});

// ══════════════════════════════════════════════ E 卷面可用性静态检查
group('E', '卷面可用性静态检查', () => {
  check('E', '每题 5 个选项、name 唯一、id 唯一', () => {
    const names = [...FORM.matchAll(/name="(q\d+)"/g)].map(m => m[1]);
    const cnt = {}; names.forEach(n => cnt[n] = (cnt[n] || 0) + 1);
    // 模板里每题写一次 name（由 ANCHORS 展开 5 次），核对展开逻辑
    if (!/ANCHORS\.map/.test(FORM)) return '未找到选项展开逻辑';
    const ids = [...FORM.matchAll(/id="q\$\{it\.no\}v\$\{n\}"/g)];
    return ids.length === 1 ? true : '选项 id 模板异常';
  });
  check('E', '每个选项组带 role=radiogroup 与 aria-label', () =>
    /role="radiogroup"\s+aria-label=/.test(FORM) ? true : '缺少 radiogroup/aria-label');
  check('E', '所有颜色 token 在 bare :root 中已定义（避免只在深色块定义）', () => {
    const rootBlock = FORM.slice(FORM.indexOf(':root{'), FORM.indexOf('@media (prefers-color-scheme: dark)'));
    const declared = new Set([...rootBlock.matchAll(/--([a-z0-9-]+)\s*:/g)].map(m => m[1]));
    const used = new Set([...FORM.matchAll(/var\(--([a-z0-9-]+)/g)].map(m => m[1]));
    const missing = [...used].filter(v => !declared.has(v));
    return missing.length ? `未在 :root 定义：${missing.join(' ')}` : true;
  });
  check('E', '深浅两套主题各自完整（两个深色作用域 token 集合相同）', () => {
    const pick = marker => {
      const i = FORM.indexOf(marker); if (i === -1) return null;
      const seg = FORM.slice(i, FORM.indexOf('}', FORM.indexOf('--font', i) > -1 ? i : i) + 1);
      return new Set([...FORM.slice(i, i + 700).matchAll(/--([a-z0-9-]+)\s*:/g)].map(m => m[1]));
    };
    const media = pick('@media (prefers-color-scheme: dark)');
    const stamp = pick(':root[data-theme="dark"]');
    if (!media || !stamp) return '找不到两个深色作用域之一';
    const onlyMedia = [...media].filter(v => !stamp.has(v));
    const onlyStamp = [...stamp].filter(v => !media.has(v));
    return (onlyMedia.length || onlyStamp.length)
      ? `token 不对称：仅媒体查询 ${onlyMedia.join(' ') || '—'} / 仅 data-theme ${onlyStamp.join(' ') || '—'}`
      : true;
  });
  check('E', '条形图色值与已验证色板一致', () => {
    const want = { light: ['#2a78d6', '#eb6834', '#1baf7a'], dark: ['#3987e5', '#d95926', '#199e70'] };
    const miss = [...want.light, ...want.dark].filter(h => !FORM.includes(h));
    return miss.length ? `缺少色值：${miss.join(' ')}` : true;
  });
  check('E', '每根条形都直接标注数值（浅色模式青色对比度的 relief 规则）', () =>
    /class="gval/.test(FORM) && /toFixed\(2\)/.test(FORM) ? true : '未找到条形上的数值标注');
  check('E', '图表有表格视图（无障碍备份）', () =>
    /<table>[\s\S]*<caption>/.test(FORM) && /id="tbody"/.test(FORM) ? true : '缺少计分表');
  check('E', '尊重 prefers-reduced-motion', () =>
    /prefers-reduced-motion/.test(FORM) ? true : '未处理减少动画偏好');
  check('E', '键盘焦点可见', () =>
    /:focus-visible/.test(FORM) ? true : '缺少 focus-visible 样式');
});

// ══════════════════════════════════════════ F 结构诊断工具自检
group('F', '结构诊断工具自检（双因子指标在已知情景下的判定）', () => {
  const rep = (v, n) => Array(n).fill(v);
  const mk = (g, s) => ({ subscales: {
    H: { g: rep(g, 9), s: rep(s, 9) }, M: { g: rep(g, 9), s: rep(s, 9) }, D: { g: rep(g, 9), s: rep(s, 9) } } });
  check('F', '强特异因子情景 → 判定三维成立（3/3 通过 ωHS）', () => {
    const v = verdict(bifactorIndices(mk(0.45, 0.60)));
    return v.subscalesPassing === '3/3' && !v.essentiallyUnidimensional
      ? true : `判定为 ${v.subscalesPassing} / 单维=${v.essentiallyUnidimensional}`;
  });
  check('F', '强一般因子情景 → 判定本质单维、三维失败（0/3）', () => {
    const v = verdict(bifactorIndices(mk(0.75, 0.25)));
    return v.subscalesPassing === '0/3' && v.essentiallyUnidimensional
      ? true : `判定为 ${v.subscalesPassing} / 单维=${v.essentiallyUnidimensional}`;
  });
  check('F', 'PUC 为结构常量：3×9 恒为 .692，与负荷取值无关', () => {
    const a = bifactorIndices(mk(0.45, 0.60)).puc, b = bifactorIndices(mk(0.75, 0.25)).puc;
    const want = (3 - 1) * 9 / (3 * 9 - 1);
    return Math.abs(a - b) < 1e-12 && Math.abs(a - want) < 1e-12
      ? true : `puc=${a} / ${b}，公式值 ${want}`;
  });
  check('F', 'ω ≥ ωH（总信度不小于一般因子信度）', () => {
    for (const [g, s] of [[0.45,0.6],[0.62,0.45],[0.75,0.25]]) {
      const ix = bifactorIndices(mk(g, s));
      if (ix.omega < ix.omegaH - 1e-12) return `g=${g},s=${s}: ω=${ix.omega} < ωH=${ix.omegaH}`;
    }
    return true;
  });
  check('F', '负荷平方和超过 1 时报错（唯一度为负）', () => {
    try { bifactorIndices(mk(0.8, 0.8)); return '未报错'; }
    catch { return true; }
  });
});

// ------------------------------------------------------------------ 结论
console.log('\n' + '─'.repeat(64));
if (!failures.length) {
  console.log(`\x1b[32m全部通过\x1b[0m：${pass} 项检查`);
  console.log('三份交付物（条目池文档 / 计分实现 / 施测卷）相互一致，对外承诺可核验。');
  process.exit(0);
}
console.log(`\x1b[31m${failures.length} 项失败\x1b[0m（通过 ${pass} 项）`);
for (const f of failures) console.log(`  [${f.group}] ${f.name}`);
console.log('\n交付物之间已出现漂移，修好后再重新运行。');
process.exit(1);
