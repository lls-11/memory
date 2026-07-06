# persona-agent

**一个「像人」的对话智能体框架**：认知循环 + 可插拔模块。

它不追求成为更强的助手，而是成为**更可信的对话对象**——
有记忆但会淡忘，有技能但不万能，有人设、有立场、会说"我记不太清了"。

```
用户说话 → ①感知(注意门控) → ②组装心理语境(我是谁/我记得什么/我会什么)
        → ③思考与行动(LLM+技能) → ④反思 → 回复
                     ⑤ idle：睡眠巩固（离线做梦）
```

当前模块：

- 🧠 **memory** — 基于认知心理学建模的记忆（多存储模型 / ACT-R 激活 / 遗忘曲线 /
  回忆vs识别 / 话到嘴边 / 睡眠巩固），会遗忘、会联想、会记串——像人。
- ⚙️ **skills** — 程序性记忆：会做的事（function calling），内置最小示例。
- 🎭 **persona** — 「我是谁」占位模块，将来拆成 身份/经历/性格/情绪。

## 快速开始

```bash
npm install
node test/smoke.js         # 冒烟测试（无需 API Key）
node demo/memory-demo.js   # 记忆引擎的八种类人现象演示

export DEEPSEEK_API_KEY=sk-...
node cli.js                # 和「小忆」聊天：/memory /sleep /persona /exit
```

不配 API Key 也能跑（演示模式），用于验证循环与记忆行为。

## 加一个新模块

```js
agent.use({
  name: 'mood',
  perceive(ctx) { /* 被这句话触动 */ },
  recall()      { return '【你现在的心情】有点低落。'; },
  reflect(ctx)  { /* 向基线衰减 */ },
});
```

核心循环永远不用改。完整架构、模块契约、后续「身份/经历/性格/情绪」模块的
设计路线见 **[docs/DESIGN.md](docs/DESIGN.md)**。
