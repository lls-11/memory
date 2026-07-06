// test/smoke.js —— 冒烟测试：不需要 API Key，验证认知循环端到端可用
// 运行：node test/smoke.js

import assert from 'node:assert';
import { PersonaAgent } from '../core/agent.js';
import { createLLM } from '../core/llm.js';
import { createMemoryModule } from '../modules/memory/index.js';
import { createSkillsModule } from '../modules/skills/index.js';
import { createPersonaModule } from '../modules/persona/index.js';

const llm = createLLM({ apiKey: null }); // 强制演示模式
assert.ok(llm.demo, '应处于演示模式');

function freshAgent() {
  return new PersonaAgent({ llm })
    .use(createPersonaModule())
    .use(createMemoryModule({ timeScale: 1, retrievalThreshold: 0.2, noise: 0.1 }))
    .use(createSkillsModule());
}

const agent = freshAgent();

// 1. 认知循环跑通，persona 注入
{
  const r = await agent.chat('你好呀');
  assert.ok(typeof r.text === 'string' && r.text.length > 0, 'chat 应返回文本');
}

// 2. 注意门控 + 记忆注入：带强调/情绪的话被记住，并出现在后续心理语境里
{
  await agent.chat('记住，我最喜欢的作家是「卡尔维诺」！太喜欢了！');
  const r = await agent.chat('聊聊卡尔维诺吧');
  assert.ok(r.text.includes('卡尔维诺'), `记忆片段应进入心理语境，实际：${r.text}`);
}

// 3. 技能调用通路（演示模式用「用技能 xxx {...}」触发）
{
  const r = await agent.chat('用技能 calc {"expression":"(3+4)*2"}');
  assert.equal(r.usedSkills.length, 1, '应调用一次技能');
  assert.equal(r.usedSkills[0].result, '14', 'calc 结果应为 14');
}

// 4. 序列化/恢复：新 agent 恢复状态后仍记得
{
  const state = agent.serialize();
  const agent2 = freshAgent();
  agent2.restore(state);
  const snap = agent2.module('memory').introspect();
  assert.ok(snap.some((m) => m.content.includes('卡尔维诺')), '恢复后应仍记得卡尔维诺');
}

// 5. idle（睡眠巩固）返回梦境报告
{
  const report = agent.idle();
  assert.ok(report.memory && Array.isArray(report.memory.replayed), 'idle 应返回记忆巩固报告');
}

// 6. 记忆引擎本身的类人行为（速查，engine 细节由 demo/memory-demo.js 展示）
{
  const memMod = createMemoryModule({ timeScale: 1, retrievalThreshold: 0.7, noise: 0.1 });
  const engine = memMod.engine();
  // 低显著性输入被注意门控忽略
  const r1 = engine.perceive('嗯。', { mode: 'chat', emotion: 0 }, { emphasis: 0 });
  assert.equal(r1.attended, false, '琐碎输入应被忽略');
  // 高情绪输入被记住
  const r2 = engine.perceive('我今天终于拿到 offer 了！！太开心了！', { mode: 'chat', emotion: 0.9 }, { emphasis: 0.5 });
  assert.equal(r2.attended, true, '高情绪输入应被记住');
  // 识别比回忆容易
  const rec = engine.recognize('offer');
  assert.ok(rec.recognized, '识别探针应能唤醒记忆');
}

console.log('✅ 冒烟测试全部通过（6 组）');
