// cli.js —— 命令行聊天入口
//
// 运行：node cli.js
//   · 配置 DEEPSEEK_API_KEY 后是真实对话；不配也能跑（演示模式，验证循环与记忆）
//   · 状态存 data/state.json：关掉再开，它还「记得」你——但记得的样子像人：
//     反复聊过的记得牢，随口一提的会淡忘
//
// 命令：/memory 看它脑子里记着什么 | /sleep 让它睡一觉（巩固+整合+遗忘）
//       /persona 看人设 | /reset 清空所有状态 | /exit 退出（自动睡觉+存档）

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { PersonaAgent } from './core/agent.js';
import { createLLM } from './core/llm.js';
import { createMemoryModule } from './modules/memory/index.js';
import { createSkillsModule } from './modules/skills/index.js';
import { createPersonaModule } from './modules/persona/index.js';

const STATE_FILE = path.join(import.meta.dirname, 'data', 'state.json');

const llm = createLLM();
const agent = new PersonaAgent({ llm })
  .use(createPersonaModule())                 // 我是谁（先注入，最稳定）
  .use(createMemoryModule({ timeScale: 86400 })) // 我记得什么（按天遗忘）
  .use(createSkillsModule());                 // 我会做什么

// 恢复上次的状态
try { agent.restore(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch {}

function save() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(agent.serialize()));
}

const persona = agent.module('persona').get();
console.log(`\n💬 ${persona.name} 上线了${llm.demo ? '（演示模式：未配置 API Key，回复为占位）' : `（${llm.model}）`}`);
console.log('   命令：/memory /sleep /persona /reset /exit\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = () => rl.question('你> ', async (input) => {
  const text = input.trim();
  if (!text) return ask();

  if (text === '/exit') {
    const report = agent.idle(); // 退出前睡一觉
    save();
    console.log(`（${persona.name} 睡了：巩固 ${report.memory?.replayed?.length ?? 0} 条、整合 ${report.memory?.integrated?.length ?? 0} 组、忘掉 ${report.memory?.forgotten?.length ?? 0} 条。状态已保存）`);
    rl.close();
    return;
  }
  if (text === '/memory') {
    const snap = agent.module('memory').introspect();
    console.log(snap.length ? snap.map((m) =>
      `  [${m.store}] 激活${m.activation} 强度${m.strength} 用${m.uses}次 | ${m.content}`).join('\n')
      : '  （脑子里还是空的）');
    return ask();
  }
  if (text === '/sleep') {
    console.log('  🌙 梦境报告：', JSON.stringify(agent.idle().memory));
    save();
    return ask();
  }
  if (text === '/persona') {
    console.log(JSON.stringify(persona, null, 2));
    return ask();
  }
  if (text === '/reset') {
    try { fs.unlinkSync(STATE_FILE); } catch {}
    console.log('  （状态已清空，重启后生效）');
    return ask();
  }

  try {
    const { text: reply, usedSkills } = await agent.chat(text);
    for (const s of usedSkills) console.log(`  ⚙️  用了技能 ${s.name} → ${s.result}`);
    console.log(`${persona.name}> ${reply}\n`);
    save();
  } catch (e) {
    console.error('出错了：', e.message);
  }
  ask();
});
ask();
