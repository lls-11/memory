// modules/memory/index.js
//
// 记忆模块 —— 把「像人一样记忆」引擎（engine.js，认知心理学建模）接入认知循环。
//
//   ① perceive：注意门控。对方说的话，只有足够显著（新颖/带情绪/被强调）才被记住。
//   ② recall  ：检索「此刻还想得起来的关于对方的印象」，作为心理语境注入。
//               模糊的记忆用模糊措辞，绝不假装记得清楚——这是拟人的关键。
//   ④ reflect ：本轮被用到的记忆已在检索时自动强化（提取练习效应），这里无需重复。
//   ⑤ idle    ：睡眠巩固——重放重要的、整合相似的、剪掉衰减殆尽的。
//
// 引擎的理论依据（多存储模型 / ACT-R 激活 / 遗忘曲线 / 回忆vs识别 / 编码特异性 /
// 睡眠巩固）见 engine.js 头注释与 docs/DESIGN.md。

import { HumanMemory, tokenize } from './engine.js';

// 情绪与强调的轻量启发式（将来可由「情绪模块」替代——模块间通过 ctx.notes 协作）
const EMO_HINTS = /[！!？?]|终于|原来|居然|竟然|太|好难|不懂|困惑|明白|懂了|重要|关键|震撼|有意思|有趣|开心|难过|生气|喜欢|讨厌/g;
const EMPHASIS_HINTS = /[「」『』《》""]|重点|关键|记住|一定|其实|我觉得|我认为|说真的|老实说|别忘了/g;
const est = (text, re, k) => Math.min(1, (text.match(re) || []).length * k);

export function createMemoryModule({
  timeScale = 86400,          // 记忆按「天」衰减；调成 1 可在秒级观察遗忘（调试用）
  ...engineOpts
} = {}) {
  let mem = new HumanMemory({ timeScale, ...engineOpts });

  return {
    name: 'memory',

    // ① 注意门控：显著性不足的输入根本不会被记住
    perceive(ctx) {
      const text = String(ctx.userText || '').trim();
      if (!text) return;
      const r = mem.perceive(text.slice(0, 300), {
        mode: 'chat',
        emotion: est(text, EMO_HINTS, 0.25),
      }, { emphasis: est(text, EMPHASIS_HINTS, 0.3) });
      if (r.attended) mem.rehearse(r.trace.id); // 说出来即一次加工
      ctx.notes.set('memory.attended', r.attended);
    },

    // ② 此刻想得起来的印象 → 心理语境片段
    recall(ctx) {
      const { hits, tipOfTongue } = mem.recall(String(ctx.userText || ''), { mode: 'chat' }, { limit: 4 });
      if (!hits.length && !tipOfTongue) return '';
      const lines = [];
      for (const h of hits) {
        const r = h.recollection;
        if (r.fidelity === 'verbatim') lines.push(`- 对方说过：「${r.text}」`);
        else if (r.fidelity === 'gist') lines.push(`- 你大概记得对方提过：${r.text}（细节已经模糊）`);
        else lines.push(`- 你隐约有个模糊印象：${r.text}`);
      }
      if (tipOfTongue) {
        lines.push(`- 你有件事话到嘴边想不起来，只记得和「${tipOfTongue.cues.join('、')}」有关`);
      }
      return [
        '【你对对方的记忆（凭印象，可能不准）】',
        ...lines,
        '相关就自然带出（"你之前好像说过…"），不相关别硬提；记不清就说记不清。',
      ].join('\n');
    },

    // ⑤ 睡一觉：巩固 + 整合 + 遗忘，返回「梦境报告」
    idle() {
      return mem.consolidate();
    },

    // --- 模块自有 API（不属于循环钩子，供 CLI/调试/其他模块使用） ---
    engine: () => mem,
    introspect: (goal = '') => mem.introspect({ goal }),
    recognize: (probe) => mem.recognize(probe, { mode: 'chat' }),

    serialize: () => mem.toJSON(),
    restore(state) { mem = HumanMemory.fromJSON(state); },
  };
}
