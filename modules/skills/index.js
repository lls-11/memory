// modules/skills/index.js
//
// 技能模块 —— agent 的「程序性记忆」（会做的事，对应心理学里 procedural memory）。
//
// 设计：技能就是一个 { name, description, parameters, run } 对象。
// 模块通过 skills() 钩子把它们交给核心，核心经由 LLM 的 function calling 触发。
// 这里放几个最简单的内置技能证明通路；真实技能（查天气、搜索、执行代码…）照样子加。
//
// 有意思的一点：技能的「熟练度」也可以拟人化——将来可以给每个技能挂一条
// 程序性记忆痕迹，久不用会生疏（执行前需要 LLM 多想一步），常用则一步到位。
// 这是后续「性格/习惯」模块可以做的事，接口已经留出（reflect 里能看到 usedSkills）。

const builtin = [
  {
    name: 'now',
    description: '获取当前日期和时间。当对话涉及"现在几点/今天几号/星期几"时使用。',
    parameters: { type: 'object', properties: {}, required: [] },
    run: () => new Date().toLocaleString('zh-CN', { dateStyle: 'full', timeStyle: 'short' }),
  },
  {
    name: 'calc',
    description: '计算一个算术表达式（只支持 + - * / % ( ) 和数字）。',
    parameters: {
      type: 'object',
      properties: { expression: { type: 'string', description: '如 (3+4)*2' } },
      required: ['expression'],
    },
    run: ({ expression = '' }) => {
      if (!/^[\d+\-*/%().\s]+$/.test(expression)) return '表达式含不支持的字符';
      try { return String(Function(`"use strict";return (${expression})`)()); }
      catch { return '算不出来'; }
    },
  },
  {
    name: 'coin',
    description: '抛一枚硬币或掷骰子，用于做小决定。sides=2 是硬币，6 是骰子。',
    parameters: {
      type: 'object',
      properties: { sides: { type: 'integer', description: '面数，默认 2' } },
      required: [],
    },
    run: ({ sides = 2 }) => {
      const n = 1 + Math.floor(Math.random() * Math.max(2, sides));
      return sides <= 2 ? (n === 1 ? '正面' : '反面') : `掷出了 ${n}`;
    },
  },
];

export function createSkillsModule({ extra = [] } = {}) {
  const registry = [...builtin, ...extra];

  return {
    name: 'skills',

    skills: () => registry,

    // ② 让 agent 知道自己会什么（放进心理语境，LLM 才会想到去用）
    recall() {
      if (!registry.length) return '';
      return [
        '【你会做的事】',
        ...registry.map((s) => `- ${s.name}：${s.description}`),
        '需要时直接调用对应技能，不要凭空编造结果。',
      ].join('\n');
    },

    register(skill) { registry.push(skill); },
  };
}
