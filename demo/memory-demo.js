// demo/memory-demo.js
//
// 叙事式演示：让「伴读」AI 用人类记忆引擎陪你读《学习的科学》。
// 运行：node demo/memory-demo.js
//
// 演示会展示这些「像人」的现象：
//   1. 注意门控——闲聊被忽略，重点被记住
//   2. 遗忘曲线——不复述的东西会淡化、想不起来
//   3. 复述/间隔效应——反复出现的东西记得牢、回忆得快
//   4. 自由回忆 vs 识别——想不起来的，一给线索就「哦对！」
//   5. 话到嘴边——明明有印象却卡住，被线索唤醒
//   6. 重构式回忆——淡化的记忆返回要点而非原文，带置信度
//   7. 睡眠巩固——离线重放，弱而重要的被巩固，相似的被整合

import { HumanMemory } from '../modules/memory/engine.js';

// 为了几秒内看到「遗忘」，把时间尺度压缩：真实产品设 timeScale=86400（按天）
// noise 调小只为演示可复现；默认值(0.35)下每次回忆结果会像人一样有波动。
const mem = new HumanMemory({ timeScale: 1, retrievalThreshold: 0.7, noise: 0.15 });

const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(64));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function showRecall(query, ctx = {}, opts = {}) {
  const { hits, tipOfTongue } = mem.recall(query, ctx, opts);
  line(`\n🧠 回忆「${query}」：`);
  if (!hits.length) line('   …想不起来了。');
  for (const h of hits) {
    const r = h.recollection;
    line(`   · [${r.fidelity} 置信${r.confidence} 用时${h.latency}s] ${r.text}`);
  }
  if (tipOfTongue) line(`   💭 ${tipOfTongue.feeling}（线索：${tipOfTongue.cues.join('、')}）`);
}

async function main() {
  rule();
  line('📖 场景：读者正在读《学习的科学》第 3 章「主动提取」，与伴读 AI 边读边聊。');
  rule();

  // --- 1. 注意门控：有的话被记住，有的被忽略 ---
  line('\n【第 1 幕】读者说了一串话，AI 的注意力只抓住重点\n');
  const ctx = { book: '学习的科学', chapter: '第3章 主动提取', mode: 'companion' };

  const inputs = [
    ['今天天气真好，顺便说一句我叫小鱼。', { emphasis: 0.35 }],
    ['这本书是我室友推荐给我的。', { emphasis: 0.4 }],
    ['我最大的困惑是：为什么反复读书还是记不住？', { emphasis: 0.6, emotion: 0.7 }],
    ['嗯。', {}],
    ['我觉得「提取练习」这个概念对我很重要，比划重点有用多了！', { emphasis: 0.8, emotion: 0.8 }],
    ['（随手翻页的杂音）', {}],
  ];
  for (const [text, opt] of inputs) {
    const r = mem.perceive(text, { ...ctx, emotion: opt.emotion || 0 }, { emphasis: opt.emphasis || 0 });
    line(`  读者：「${text}」`);
    line(`     → ${r.attended ? `✅ 注意到了（显著性 ${r.salience.toFixed(2)}）` : `⬜ 忽略（${r.reason}，显著性 ${r.salience.toFixed(2)}）`}`);
  }

  // --- 2. 复述：读者反复提到「提取练习」，AI 加深记忆 ---
  line('\n【第 2 幕】读者在后续对话里反复用到「提取练习」，记忆被复述巩固\n');
  const key = mem.traces.find((t) => t.content.includes('提取练习'));
  for (let i = 0; i < 3; i++) {
    await sleep(30);
    mem.rehearse(key.id, { elaborative: true });
    line(`  （第 ${i + 1} 次复述「提取练习」，强度 → ${key.strength.toFixed(2)}，存储 → ${key.store}）`);
  }

  // --- 3. 立刻回忆：刚聊过，什么都记得清楚 ---
  line('\n【第 3 幕】此刻的回忆——刚发生的事，记得很清楚');
  showRecall('记不住 提取', ctx);

  // --- 4. 遗忘 + 编码特异性 ---
  line('\n【第 4 幕】过了一会儿（模拟时间流逝），未被复述的记忆开始淡化…');
  await sleep(3500);

  showRecall('提取', ctx);   // 反复复述 → 依然清晰、回忆快
  // 编码特异性：同一条「困惑」记忆，用一个笼统的问法去回忆——
  // reinforce:false 表示「只是想想」，不改变记忆，方便公平对比两种语境。
  line('\n  · 编码特异性：换个语境回忆同一件事，会记得没那么清楚');
  const otherCtx = { ...ctx, chapter: '第7章 间隔重复', mode: 'quiz' };
  const q = '我之前提到的那个困惑';
  const a1 = mem.recall(q, ctx, { reinforce: false }).hits[0]?.recollection;
  const a2 = mem.recall(q, otherCtx, { reinforce: false }).hits[0]?.recollection;
  line(`    在原语境(第3章/伴读)回忆：[${a1?.fidelity} 置信${a1?.confidence}] ${a1?.text}`);
  line(`    在别的语境(第7章/测验)回忆：[${a2?.fidelity} 置信${a2?.confidence}] ${a2?.text}`);

  // --- 5. 话到嘴边(TOT)：笼统地想，卡在嘴边；给个线索就唤醒 ---
  line('\n【第 5 幕】话到嘴边——笼统地想「这本书当初是怎么来的」，卡住了');
  const totTry = mem.recall('这本书当初是怎么到我手里的', ctx, { reinforce: false });
  if (totTry.hits.length) {
    line(`  勉强回忆起来：[${totTry.hits[0].recollection.fidelity}] ${totTry.hits[0].recollection.text}`);
  } else if (totTry.tipOfTongue) {
    line(`  💭 ${totTry.tipOfTongue.feeling}（线索：${totTry.tipOfTongue.cues.join('、')}）`);
    const unlock = mem.recognize('室友', ctx);
    line(`  给个线索「室友」→ ${unlock.recognized ? `💡 想起来了：${unlock.hits[0].recollection.text}` : '还是想不起来'}`);
  } else {
    line('  完全没印象。');
  }

  // --- 6. 识别 vs 回忆：想不起名字，但一给线索就认出来 ---
  line('\n【第 6 幕】自由回忆失败的东西，用「识别」就能唤醒');
  const free = mem.recall('读者叫什么名字', ctx);
  const name = free.hits.find((h) => h.trace.content.includes('小鱼'));
  line(`  自由回忆「读者叫什么名字」→ ${name ? name.recollection.text : '想不起来了…（没有通往它的线索）'}`);
  const rec = mem.recognize('小鱼', ctx);
  line(`  识别探针「小鱼」→ ${rec.recognized ? `✅ 认出来了：${rec.hits[0].recollection.text}` : '仍然认不出'}`);

  // --- 7. 睡眠巩固：离线重放，整合与遗忘 ---
  line('\n【第 7 幕】读者合上书睡了一觉——AI 做一次「睡眠巩固」');
  // 读者临睡前又用自己的话复述了一遍核心概念（自然会有近义重复）：
  const para = mem.perceive('提取练习这个概念真的很重要，比划重点有用', { ...ctx, emotion: 0.4 }, { emphasis: 0.7 });
  if (para.attended) for (let i = 0; i < 3; i++) mem.rehearse(para.trace.id, { elaborative: true });
  const before = mem.introspect(ctx).length;
  const report = mem.consolidate();
  line(`  🌙 梦境报告：重放 ${report.replayed.length} 条、整合 ${report.integrated.length} 组、遗忘 ${report.forgotten.length} 条`);
  line(`     记忆总数 ${before} → ${mem.introspect(ctx).length}`);

  // --- 8. 内省：看看 AI「脑子里」现在还剩什么 ---
  line('\n【第 8 幕】AI 的记忆快照（按当前激活排序）');
  rule();
  for (const m of mem.introspect(ctx)) {
    line(`  [${m.store}] 激活${String(m.activation).padStart(6)} 强度${String(m.strength).padStart(5)} 用${m.uses}次 | ${m.content}`);
  }
  rule();
  line('\n结论：AI 记住了读者反复强调、带情绪的重点（提取练习、核心困惑），');
  line('      淡忘了只提一次的琐事（名字、天气），但一给线索仍能识别唤醒——像人一样。');
}

main();
