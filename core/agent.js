// core/agent.js
//
// PersonaAgent —— 拟人化对话智能体的核心编排器
// ================================================
//
// 设计哲学：agent 核心只是一个很薄的「认知循环」，一切拟人能力都是模块。
// 一轮对话 = 一次认知循环，模仿人处理一句话的过程：
//
//   用户说话
//     │
//   ① perceive  感知 —— 每个模块观察这句话（记忆做注意门控；将来：情绪模块被触动）
//     │
//   ② recall    组装心理语境 —— 每个模块贡献一段「此刻脑子里有什么」
//     │            （身份：我是谁 / 记忆：我还记得什么 / 将来：我现在心情如何）
//     │
//   ③ think     思考与行动 —— LLM 依据心理语境生成回复，途中可调用技能（会做什么）
//     │
//   ④ reflect   反思 —— 每个模块观察这轮完整交流（记忆巩固；将来：性格微调、经历累积）
//     │
//   回复用户            （另有 ⑤ idle：离线的「睡眠/发呆」，不在对话循环里）
//
// 模块契约（全部钩子可选，模块只实现自己关心的阶段）：
//   {
//     name: 'memory',
//     perceive(ctx)          // ① 观察用户输入
//     recall(ctx) -> string  // ② 返回注入 system prompt 的心理语境片段（'' = 无）
//     skills() -> Skill[]    // ③ 提供可调用技能 { name, description, parameters, run(args) }
//     reflect(ctx)           // ④ 观察 { userText, reply, usedSkills }
//     idle() -> report       // ⑤ 离线心理过程（睡眠巩固、写日记…）
//     serialize()/restore()  // 持久化（可选）
//   }
//
// ctx 在整个循环中共享：{ userText, history, agent, notes: Map<module,any> }
// 将来加「人格 / 身份 / 经历 / 性格 / 情绪」= 各写一个模块 use() 进来，核心不改。

export class PersonaAgent {
  /**
   * @param {object} opts
   * @param {object} opts.llm       LLM 客户端（core/llm.js），需实现 chat({messages, tools})
   * @param {string} [opts.name]    agent 的名字（占位；正式身份由 persona 模块提供）
   * @param {number} [opts.historyWindow]  携带的近期对话轮数上限。
   *   这就是 agent 的「工作记忆」：窗口内逐字记得，滑出窗口的只能靠记忆模块想起来。
   */
  constructor({ llm, name = '小忆', historyWindow = 12 } = {}) {
    this.llm = llm;
    this.name = name;
    this.historyWindow = historyWindow;
    this.modules = [];
    this.history = []; // [{role:'user'|'assistant', content}]
  }

  use(module) {
    if (!module?.name) throw new Error('模块必须有 name');
    this.modules.push(module);
    return this;
  }

  module(name) {
    return this.modules.find((m) => m.name === name);
  }

  // 汇总所有模块提供的技能
  _skills() {
    return this.modules.flatMap((m) => (m.skills ? m.skills() : []));
  }

  // 认知循环：一轮对话
  async chat(userText) {
    const ctx = { userText, history: this.history, agent: this, notes: new Map() };

    // ① 感知
    for (const m of this.modules) {
      try { m.perceive?.(ctx); } catch (e) { console.error(`[${m.name}] perceive:`, e.message); }
    }

    // ② 组装心理语境
    const fragments = [];
    for (const m of this.modules) {
      try {
        const f = await m.recall?.(ctx);
        if (f && f.trim()) fragments.push(f.trim());
      } catch (e) { console.error(`[${m.name}] recall:`, e.message); }
    }
    const system = this._buildSystem(fragments);

    // ③ 思考与行动（技能循环：LLM 要求调用技能 → 执行 → 把结果还给它继续想）
    const skills = this._skills();
    const usedSkills = [];
    const messages = [
      { role: 'system', content: system },
      ...this.history.slice(-this.historyWindow),
      { role: 'user', content: userText },
    ];
    let reply = await this.llm.chat({ messages, skills });
    let guard = 0;
    while (reply.skillCalls?.length && guard++ < 4) {
      for (const call of reply.skillCalls) {
        const skill = skills.find((s) => s.name === call.name);
        let result;
        try {
          result = skill ? await skill.run(call.args) : `未知技能 ${call.name}`;
        } catch (e) { result = `技能执行失败：${e.message}`; }
        usedSkills.push({ name: call.name, args: call.args, result });
        messages.push(reply.raw, {
          role: 'tool', tool_call_id: call.id, content: String(result),
        });
      }
      reply = await this.llm.chat({ messages, skills });
    }

    // 更新工作记忆（对话窗口）
    this.history.push({ role: 'user', content: userText });
    this.history.push({ role: 'assistant', content: reply.text });
    if (this.history.length > this.historyWindow * 2) {
      this.history = this.history.slice(-this.historyWindow);
    }

    // ④ 反思
    for (const m of this.modules) {
      try { m.reflect?.({ ...ctx, reply: reply.text, usedSkills }); }
      catch (e) { console.error(`[${m.name}] reflect:`, e.message); }
    }

    return { text: reply.text, usedSkills };
  }

  // ⑤ 离线心理过程：所有模块的 idle（如记忆的睡眠巩固）。返回各模块报告。
  idle() {
    const reports = {};
    for (const m of this.modules) {
      try { const r = m.idle?.(); if (r !== undefined) reports[m.name] = r; }
      catch (e) { console.error(`[${m.name}] idle:`, e.message); }
    }
    return reports;
  }

  _buildSystem(fragments) {
    return [
      `你在扮演一个具体的「人」，而不是一个 AI 助手。自然地对话，像朋友闲聊；`
        + `不要用列表和标题排版日常对话，不要过度热情，可以有自己的立场和不知道的事。`,
      ...fragments,
      `以上是你此刻的全部心理语境。基于它自然回应，语境里没有的私人细节不要编造；`
        + `记不清的就坦然说记不清——像人一样。`,
    ].join('\n\n');
  }

  // 持久化：收集各模块状态
  serialize() {
    const state = { history: this.history, modules: {} };
    for (const m of this.modules) {
      if (m.serialize) state.modules[m.name] = m.serialize();
    }
    return state;
  }
  restore(state) {
    if (!state) return;
    this.history = state.history || [];
    for (const m of this.modules) {
      if (m.restore && state.modules?.[m.name]) m.restore(state.modules[m.name]);
    }
  }
}
