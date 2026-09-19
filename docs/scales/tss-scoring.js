#!/usr/bin/env node
// docs/scales/tss-scoring.js
//
// 三感量表 TSS · 计分与结构诊断工具
// ==================================
// 配合 docs/scales/three-senses-scale.md 使用。三个功能：
//
//   1) score()            —— 反向计分、分量表得分、缺失处理
//   2) carelessFlags()    —— 不认真作答筛查（长串、题内变异、反向题不一致）
//   3) bifactorIndices()  —— 双因子指标 ω / ωH / ωHS / ECV / PUC / H
//
// 其中 (3) 是本量表的**生死判据**：若一般因子 ωH 很高而各分量表 ωHS 很低，
// 说明「三感」在测量层面只是同一个负性因子的三种措辞，三个分量表分数不可
// 单独解释——那么整个三维结构应当被放弃（见设计文档 §6.2 的否证条件）。
// 参考：Rodriguez, Reise & Haviland (2016), Psychological Methods.
//
// 用法：
//   node docs/scales/tss-scoring.js              # 跑内置的两个对照情景 + 计分示例
//   node docs/scales/tss-scoring.js --demo bi    # 只跑双因子诊断

// ---------------------------------------------------------------- 量表结构
// 键名 = 条目编号（对应设计文档附录 A 的题号）
// domain: H 无助 / M 无意义 / D 绝望 / PD 预先放弃（循环模块）
// 这里登记的是 TSS-30 正式版的题号与反向题（条目文本见设计文档）
export const TSS30 = {
  H:  { items: [1, 2, 3, 6, 7, 8, 11, 12, 13], reverse: [8] },
  M:  { items: [16, 17, 18, 21, 22, 24, 26, 27, 29], reverse: [18] },
  D:  { items: [31, 32, 33, 36, 37, 39, 41, 42, 44], reverse: [33] },
  PD: { items: [46, 47, 52], reverse: [] },
};
export const SCALE_MIN = 1, SCALE_MAX = 5;   // 特质版：5 点频率
const rev = x => SCALE_MIN + SCALE_MAX - x;

// -------------------------------------------------------------------- 计分
// responses: { 条目号: 原始分 }；缺失用 null/undefined 表示
// 规则：某分量表缺失 > 25% 则该分量表记为 null（不做插补）；否则按已答题均值
export function score(responses, spec = TSS30) {
  const out = {}, detail = {};
  for (const [dom, { items, reverse }] of Object.entries(spec)) {
    const vals = [];
    for (const it of items) {
      let v = responses[it];
      if (v === null || v === undefined || Number.isNaN(v)) continue;
      if (v < SCALE_MIN || v > SCALE_MAX) throw new Error(`条目 ${it} 超出量程: ${v}`);
      vals.push(reverse.includes(it) ? rev(v) : v);
    }
    const missing = items.length - vals.length;
    detail[dom] = { answered: vals.length, missing };
    out[dom] = missing / items.length > 0.25
      ? null
      : vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  // 三感总分只由 H/M/D 构成；PD 是独立模块，不计入总分（见文档 §5.3）
  const core = ['H', 'M', 'D'].map(d => out[d]);
  out.TOTAL = core.some(v => v === null) ? null
    : core.reduce((a, b) => a + b, 0) / 3;
  return { scores: out, detail };
}

// ------------------------------------------------ 不认真作答筛查（三个指标）
//
// 阈值必须按样本校准，不要照抄默认值。两条依据：
//  · 长串指标受**内容同质性**影响：TSS 三个维度高度相关，一个真正的高分被试
//    连答 9–10 个 4 是合理的。因此长串应当在**整份问卷（含其他量表）**上计算，
//    而不是只在 TSS 的 30 题内；单量表内计算时阈值要放宽。
//  · 推荐做法：先在本样本上算出三个指标的分布，取 longString 的 99 百分位、
//    IRV 的 1 百分位作为阈值，再人工核查被标记的作答。
// 默认值是 TSS-30 单独施测时的保守起点（longString = 题数的 1/2）。
export const CARELESS_DEFAULTS = {
  longString: 15,     // ≥ 该值 → 标记（TSS-30 = 30 题的一半）
  irvMin: 0.30,       // < 该值 → 标记（几乎无变异）
  reverseGap: 2.0,    // ≥ 该值 → 标记（反向题与正向题方向矛盾）
};
export function carelessFlags(responses, spec = TSS30, thresholds = {}) {
  const th = { ...CARELESS_DEFAULTS, ...thresholds };
  const order = Object.values(spec).flatMap(s => s.items).sort((a, b) => a - b);
  const seq = order.map(it => responses[it]).filter(v => v !== null && v !== undefined);

  // (a) 最长同一答案连续串（long-string index）
  let longest = 1, run = 1;
  for (let i = 1; i < seq.length; i++) {
    run = seq[i] === seq[i - 1] ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  // (b) 个体内反应变异（IRV）：过低=乱填同一档，过高=随机乱点
  const m = seq.reduce((a, b) => a + b, 0) / seq.length;
  const irv = Math.sqrt(seq.reduce((a, v) => a + (v - m) ** 2, 0) / seq.length);
  // (c) 反向题一致性：反向计分后，反向题均值与同维度正向题均值的偏离
  let maxGap = 0;
  for (const { items, reverse } of Object.values(spec)) {
    if (!reverse.length) continue;
    const pick = list => {
      const v = list.map(it => responses[it]).filter(x => x !== null && x !== undefined);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const fwd = pick(items.filter(it => !reverse.includes(it)));
    const rvs = pick(reverse);
    if (fwd === null || rvs === null) continue;
    maxGap = Math.max(maxGap, Math.abs(fwd - rev(rvs)));
  }
  const hits = [];
  if (longest >= th.longString) hits.push(`长串 ${longest}≥${th.longString}`);
  if (irv < th.irvMin) hits.push(`IRV ${irv.toFixed(2)}<${th.irvMin}`);
  if (maxGap >= th.reverseGap) hits.push(`反向题偏离 ${maxGap.toFixed(2)}≥${th.reverseGap}`);
  return {
    longString: longest,
    irv: Number(irv.toFixed(3)),
    reverseGap: Number(maxGap.toFixed(3)),
    thresholds: th,
    hits,
    flagged: hits.length > 0,
  };
}

// --------------------------------------------------- 双因子结构诊断（核心）
// model: { subscales: { 名称: { g: [一般因子负荷], s: [特异因子负荷] } } }
// 所有负荷为标准化解；唯一度 θ = 1 - g² - s²
export function bifactorIndices(model) {
  const subs = Object.entries(model.subscales);
  const allG = [], allS = [];
  let sumTheta = 0, sumSpecSq = 0;
  const perSub = {};

  for (const [name, { g, s }] of subs) {
    if (g.length !== s.length) throw new Error(`${name}: 一般/特异负荷数量不一致`);
    let sg = 0, ss = 0, th = 0;
    g.forEach((lg, i) => {
      const ls = s[i], t = 1 - lg * lg - ls * ls;
      if (t < 0) throw new Error(`${name} 第 ${i + 1} 题的唯一度为负（负荷之和过大）`);
      sg += lg; ss += ls; th += t;
      allG.push(lg); allS.push(ls);
    });
    const denom = sg * sg + ss * ss + th;
    perSub[name] = {
      k: g.length,
      omegaS: (sg * sg + ss * ss) / denom,      // 分量表总信度
      omegaHS: (ss * ss) / denom,               // 剔除一般因子后，分量表自身的可靠方差
      Hs: hIndex(s),                            // 特异因子的可复制性
    };
    sumTheta += th;
    sumSpecSq += ss * ss;
  }

  const sumG = allG.reduce((a, b) => a + b, 0);
  const total = sumG * sumG + sumSpecSq + sumTheta;
  const omega = (sumG * sumG + sumSpecSq) / total;
  const omegaH = (sumG * sumG) / total;
  const ecv = allG.reduce((a, l) => a + l * l, 0) /
    (allG.reduce((a, l) => a + l * l, 0) + allS.reduce((a, l) => a + l * l, 0));

  // PUC：不受特异因子污染的相关对占全部相关对的比例
  const k = allG.length;
  const totalPairs = k * (k - 1) / 2;
  const withinPairs = subs.reduce((a, [, { g }]) => a + g.length * (g.length - 1) / 2, 0);
  const puc = (totalPairs - withinPairs) / totalPairs;

  return { omega, omegaH, ecv, puc, Hg: hIndex(allG), perSub };
}
function hIndex(loadings) {           // H = 1 / (1 + 1/Σ(λ²/(1-λ²)))
  const s = loadings.reduce((a, l) => a + (l * l) / (1 - l * l), 0);
  return s === 0 ? 0 : 1 / (1 + 1 / s);
}

// --------------------------------------------------------------- 判据与解读
// 阈值来源见设计文档 §6.2（预注册）
//
// 注意 PUC 的结构性上限：PUC 只由「几个维度 × 每维几题」决定，与数据无关。
// 等题数 nSub 个维度、每维 k 题时 PUC = (nSub-1)k / (nSub·k - 1)，
// 3×9 恒为 0.692、3×3 恒为 0.750。因此**不能**把 PUC ≥ .70 当作硬门槛
// （3×9 设计下它永远不成立）。本函数只用 ωH 与 ECV 判定本质单维，
// PUC 仅作报告，并用于提示 ωH 是否被高估（PUC 低时 ωH 偏高）。
export function verdict(ix) {
  const subOK = Object.values(ix.perSub).filter(s => s.omegaHS >= 0.30).length;
  const nSub = Object.keys(ix.perSub).length;
  const unidimensional = ix.ecv >= 0.70 && ix.omegaH >= 0.80;
  let call;
  if (subOK === nSub && !unidimensional) call = '三维结构成立：三个分量表可各自解释';
  else if (subOK === 0) call = '三维结构失败：应改为单维总分，放弃分量表';
  else if (unidimensional && subOK < nSub) call = '以总分为主：仅部分分量表可单独解释';
  else call = `部分成立：${subOK}/${nSub} 个分量表通过 ωHS ≥ .30`;
  return {
    subscalesPassing: `${subOK}/${nSub}`,
    essentiallyUnidimensional: unidimensional,
    pucCaveat: ix.puc < 0.70
      ? `PUC=${ix.puc.toFixed(3)} < .70（本结构的固有值，非数据问题）：ωH 可能被高估，判定以 ECV 为主`
      : null,
    call,
  };
}

// -------------------------------------------------------------------- 演示
function fmt(x) { return x.toFixed(3); }
function report(label, model) {
  const ix = bifactorIndices(model);
  const v = verdict(ix);
  console.log(`\n── ${label} ` + '─'.repeat(Math.max(0, 58 - label.length)));
  console.log(`ω=${fmt(ix.omega)}  ωH=${fmt(ix.omegaH)}  ECV=${fmt(ix.ecv)}  ` +
    `PUC=${fmt(ix.puc)}  H(一般因子)=${fmt(ix.Hg)}`);
  console.log('分量表        k    ωS     ωHS     H(特异)   ωHS≥.30');
  for (const [name, s] of Object.entries(ix.perSub))
    console.log(`  ${name.padEnd(10)} ${String(s.k).padStart(2)}  ` +
      `${fmt(s.omegaS)}  ${fmt(s.omegaHS)}   ${fmt(s.Hs)}      ` +
      `${s.omegaHS >= 0.30 ? '✓' : '✗'}`);
  console.log(`→ 本质单维(ωH≥.80 且 ECV≥.70): ${v.essentiallyUnidimensional ? '是' : '否'} | ` +
    `通过的分量表: ${v.subscalesPassing}`);
  if (v.pucCaveat) console.log(`→ 提示: ${v.pucCaveat}`);
  console.log(`→ 判定: ${v.call}`);
  return ix;
}

const rep = (v, n) => Array(n).fill(v);
const SCENARIOS = {
  // 情景 A：三感可分——一般因子中等，特异因子强
  A: {
    label: '情景 A：三维结构成立（一般因子中等 .45，特异因子强 .60）',
    model: {
      subscales: {
        '无助 H': { g: rep(0.45, 9), s: rep(0.60, 9) },
        '无意义 M': { g: rep(0.45, 9), s: rep(0.60, 9) },
        '绝望 D': { g: rep(0.45, 9), s: rep(0.60, 9) },
      },
    },
  },
  // 情景 B：三感其实是一个东西——一般因子强，特异因子弱
  B: {
    label: '情景 B：三维结构失败（一般因子强 .75，特异因子弱 .25）',
    model: {
      subscales: {
        '无助 H': { g: rep(0.75, 9), s: rep(0.25, 9) },
        '无意义 M': { g: rep(0.75, 9), s: rep(0.25, 9) },
        '绝望 D': { g: rep(0.75, 9), s: rep(0.25, 9) },
      },
    },
  },
  // 情景 C：实际研究里最常见的中间态
  C: {
    label: '情景 C：中间态（一般因子 .62，特异因子 H .45 / M .50 / D .35）',
    model: {
      subscales: {
        '无助 H': { g: rep(0.62, 9), s: rep(0.45, 9) },
        '无意义 M': { g: rep(0.62, 9), s: rep(0.50, 9) },
        '绝望 D': { g: rep(0.62, 9), s: rep(0.35, 9) },
      },
    },
  },
};

const only = process.argv.includes('--demo') ? process.argv[process.argv.indexOf('--demo') + 1] : null;

if (only !== 'score') {
  console.log('TSS 双因子结构诊断 · 三个预设情景');
  console.log('判据（预注册）: ωH≥.80 且 ECV≥.70 → 本质单维；分量表需 ωHS≥.30 方可单独解释');
console.log('PUC 只报告不设门槛——它由维度数×题数决定（3×9 恒为 .692），与数据无关');
  for (const sc of Object.values(SCENARIOS)) report(sc.label, sc.model);
}

if (only !== 'bi') {
  console.log('\n\n═══ 计分示例 ═══');
  // 反向题为 8 / 18 / 33；认真作答者在这三题上的原始分应与正向题相反
  const cases = {
    '典型高分被试': { fill: 4, tweak: { 8: 2, 18: 2, 33: 1 } },
    '典型低分被试': { fill: 2, tweak: { 8: 4, 18: 5, 33: 4 } },
    '真·极端高分（全选 5，反向题正确反选）': { fill: 5, tweak: { 8: 1, 18: 1, 33: 1 } },
    '疑似乱填（全选 3）': { fill: 3, tweak: {} },
    '疑似反向题不一致（全选 5 含反向题）': { fill: 5, tweak: {} },
  };
  for (const [name, { fill, tweak }] of Object.entries(cases)) {
    const r = {};
    for (const it of Object.values(TSS30).flatMap(s => s.items)) r[it] = fill;
    Object.assign(r, tweak);
    const { scores } = score(r);
    const f = carelessFlags(r);
    console.log(`\n${name}`);
    console.log(`  H=${scores.H?.toFixed(2)} M=${scores.M?.toFixed(2)} ` +
      `D=${scores.D?.toFixed(2)} PD=${scores.PD?.toFixed(2)} 总分=${scores.TOTAL?.toFixed(2)}`);
    console.log(`  筛查: 最长同答串=${f.longString} IRV=${f.irv} 反向题偏离=${f.reverseGap}` +
      ` → ${f.flagged ? '⚠ 标记待排除（' + f.hits.join('；') + '）' : '通过'}`);
  }
  // 缺失处理
  const partial = {};
  for (const it of Object.values(TSS30).flatMap(s => s.items)) partial[it] = 3;
  for (const it of [16, 17, 18]) partial[it] = null;   // 无意义维度缺 3/9 = 33% > 25%
  const { scores, detail } = score(partial);
  console.log(`\n缺失处理示例（无意义维度缺 ${detail.M.missing}/9 = 33%）`);
  console.log(`  M=${scores.M} （超过 25% 阈值，不计分）  总分=${scores.TOTAL}`);
}
