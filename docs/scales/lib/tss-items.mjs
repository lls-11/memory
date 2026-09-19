// docs/scales/lib/tss-items.mjs
//
// TSS-30 卷面条目（按卷面呈现顺序）
// =================================
// 由两个已有来源组合而来，不新增第三份条目副本：
//   条目文本  ← three-senses-scale.md 附录 A（唯一权威来源）
//   题号/维度/侧面/反向/顺序 ← tss-scoring.js 的 TSS30 与 PRESENTATION_ORDER
//
// 与 verify.js 的关系：verify.js 的职责是让「文档 / 登记 / 卷面」三方**独立**
// 对账，所以它不用本模块。本模块是那套对账通过之后的消费方，供 Word / 纸质卷
// 生成使用。换言之：先由 verify.js 证明三方一致，再由本模块放心地组合它们。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TSS30, PRESENTATION_ORDER } from '../tss-scoring.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DOMAINS = {
  H:  { name: '无助感',   chain: '行动 → 结果', facets: { 'H-a': '随因失联', 'H-b': '控制外置', 'H-c': '无效努力' } },
  M:  { name: '无意义感', chain: '结果 → 价值', facets: { 'M-a': '重要性缺失', 'M-b': '目的缺失', 'M-c': '连贯性缺失' } },
  D:  { name: '绝望感',   chain: '价值 → 未来', facets: { 'D-a': '未来负性预期', 'D-b': '不可改变性', 'D-c': '未来视野塌缩' } },
  PD: { name: '预先放弃', chain: '绝望 → 无助', facets: { 'PD': '预先放弃' } },
};

export const ANCHORS = [
  ['1', '几乎没有'], ['2', '有几天'], ['3', '一半以上的日子'],
  ['4', '几乎每天'], ['5', '一直如此'],
];

/** 解析文档附录 A，返回 Map<题库编号, { text, facet, dom, reverse }> */
function parsePool() {
  const md = readFileSync(join(HERE, '../three-senses-scale.md'), 'utf8');
  const body = md.split('## 附录 A')[1]?.split('## 附录 B')[0];
  if (!body) throw new Error('three-senses-scale.md 中找不到附录 A');
  const pool = new Map();
  let facet = null;
  for (const line of body.split('\n')) {
    const fh = line.match(/^\*\*([HMD]-[abc])\s+\S+\*\*\s*$/);
    if (fh) { facet = fh[1]; continue; }
    if (/^###\s+模块\s+PD/.test(line)) { facet = 'PD'; continue; }
    const m = line.match(/^(\d+)\.\s+(★\s+)?(.*?)(\s*\*\*\(R\)\*\*)?\s*$/);
    if (!m || !facet) continue;
    pool.set(Number(m[1]), {
      text: m[3].trim(), facet, dom: facet === 'PD' ? 'PD' : facet[0],
      reverse: Boolean(m[4]),
    });
  }
  return pool;
}

/**
 * 卷面 30 题，按呈现顺序。
 * @returns {{no:number, bank:number, dom:string, facet:string, reverse:boolean, text:string}[]}
 */
export function formItems() {
  const pool = parsePool();
  const registered = new Set(Object.values(TSS30).flatMap(s => s.items));
  const reverse = new Set(Object.values(TSS30).flatMap(s => s.reverse));
  const order = PRESENTATION_ORDER.filter(b => registered.has(b));
  if (order.length !== registered.size)
    throw new Error(`呈现顺序 ${order.length} 题与登记 ${registered.size} 题不符，先跑 verify.js`);
  return order.map((bank, k) => {
    const p = pool.get(bank);
    if (!p) throw new Error(`题库编号 ${bank} 在附录 A 中找不到`);
    return { no: k + 1, bank, dom: p.dom, facet: p.facet, reverse: reverse.has(bank), text: p.text };
  });
}
