// core/llm.js
//
// LLM 客户端：OpenAI 兼容接口（默认 DeepSeek），支持技能调用（function calling）。
// 未配置 API Key 时进入演示模式：不做真实生成，但完整走通认知循环（含技能触发），
// 用于开发期不花钱地调试模块与记忆行为。

import OpenAI from 'openai';

export function createLLM({
  apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  baseURL = process.env.LLM_BASE_URL || 'https://api.deepseek.com',
  model = process.env.LLM_MODEL || 'deepseek-chat',
} = {}) {
  const client = apiKey ? new OpenAI({ apiKey, baseURL }) : null;

  return {
    demo: !client,
    model,

    /**
     * @param {Array} messages OpenAI 格式消息
     * @param {Array} skills   [{name, description, parameters, run}]
     * @returns {{text, skillCalls?: [{id,name,args}], raw}}
     */
    async chat({ messages, skills = [] }) {
      if (!client) return demoChat({ messages, skills });

      const tools = skills.map((s) => ({
        type: 'function',
        function: { name: s.name, description: s.description, parameters: s.parameters },
      }));
      const resp = await client.chat.completions.create({
        model,
        messages,
        ...(tools.length ? { tools } : {}),
        max_tokens: 2000,
      });
      const msg = resp.choices[0].message;
      const skillCalls = (msg.tool_calls || []).map((t) => ({
        id: t.id,
        name: t.function.name,
        args: safeParse(t.function.arguments),
      }));
      return { text: msg.content || '', skillCalls, raw: msg };
    },
  };
}

function safeParse(s) {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

// ---- 演示模式 ----------------------------------------------------------------
// 规则简单但足够验证循环：
//   · 用户消息形如「用技能 xxx {json}」→ 模拟一次技能调用
//   · 否则回显收到的心理语境概要，证明模块注入生效
let demoCallId = 0;
function demoChat({ messages, skills }) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const lastTool = messages[messages.length - 1];

  if (lastTool?.role === 'tool') {
    return { text: `（演示模式）技能返回了：${lastTool.content}`, skillCalls: [], raw: null };
  }

  const m = /^用技能\s+(\S+)\s*(\{.*\})?/.exec(lastUser?.content || '');
  if (m && skills.some((s) => s.name === m[1])) {
    const id = `demo_${demoCallId++}`;
    return {
      text: '',
      skillCalls: [{ id, name: m[1], args: safeParse(m[2]) }],
      raw: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: m[1], arguments: m[2] || '{}' } }] },
    };
  }

  const sys = messages.find((mm) => mm.role === 'system')?.content || '';
  const memBlock = sys.split('【你对对方的记忆')[1] || '';
  const memLine = memBlock.split('\n').filter((l) => l.startsWith('- ')).slice(0, 3);
  return {
    text: `（演示模式，未配置 API Key。我此刻的心理语境里有 ${memLine.length ? '这些印象：\n' + memLine.join('\n') : '还没有对你的印象'}）`,
    skillCalls: [],
    raw: null,
  };
}
