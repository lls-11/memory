// modules/memory/engine.js
//
// 「像人一样记忆」的记忆引擎（Human-like Memory Engine）
// =====================================================
//
// 与主流 agent 记忆框架（Mem0 / Zep / Letta / LangMem）的取向相反：
// 那些框架追求「记得更多、检索更准」，本引擎刻意追求「像人一样地记忆与遗忘」。
// 我们**不**用向量数据库做语义召回，而是用认知心理学的经典理论建模：
//
//   1. Atkinson-Shiffrin 多存储模型：瞬时 → (注意) → 短期 → (复述) → 长期
//   2. ACT-R 激活方程：基础激活(频率+近因) + 扩散激活(线索) + 噪声 + 阈值
//   3. Ebbinghaus 遗忘曲线：R = e^(-t/S)，强度 S 随复述增长（间隔效应）
//   4. 回忆 vs 识别：自由回忆难、线索识别易（识别相当于降低检索阈值）
//   5. 编码特异性：回忆时的语境越接近编码时的语境，越容易提取
//   6. 睡眠巩固：离线重放，优先巩固「弱而重要」的痕迹、整合相似记忆
//
// 附带几个刻意保留的「人性缺陷」（详见 docs/DESIGN.md）：
//   · 重构式回忆：淡化的记忆返回要点而非原文，并附带置信度（会「记串」）
//   · 话到嘴边(TOT)：略低于阈值的记忆返回「似曾相识」，可被线索唤醒
//   · 首因/近因效应、情绪显著性(闪光灯记忆)、扇形干扰
//
// 无外部依赖，纯 ES module，与本项目「零构建」风格一致。

// ----------------------------------------------------------------------------
// 可调参数（默认值经过手工调校，使演示中的遗忘/回忆时间尺度以「秒」为单位可观测；
// 真实产品里把 timeScale 调大即可让记忆以「天」为单位衰减）
// ----------------------------------------------------------------------------
export const DEFAULTS = {
  decay: 0.5,              // ACT-R 基础激活衰减率 d（经典值 0.5）
  retrievalThreshold: -1.0,// τ：自由回忆的检索阈值，低于它就想不起来
  recognitionBonus: 1.6,   // 识别相对回忆的阈值下降量（线索让提取更容易）
  totMargin: 0.5,          // 阈值以下这个范围内 = 「话到嘴边」
  noise: 0.35,             // s：激活的逻辑斯蒂噪声尺度（越大越随机）
  sourceActivation: 1.2,   // G：当前语境线索能扩散出的总激活量
  maxAssoc: 2.5,           // S_max：单条关联的最大强度（扇形效应的基准）
  stmCapacity: 7,          // 短期记忆容量（Miller 7±2）
  attentionThreshold: 0.4, // 注意门控：显著性低于它的输入不进入短期记忆
  consolidateThreshold: 2.5,// 短期记忆被复述达到这个「有效强度」即巩固进长期
  timeScale: 1,            // 时间缩放：1 = 秒；设 86400 让 1 天算作 1 个时间单位
  spacingWindow: 20,       // 间隔效应窗口（秒）：过近的复述收益递减（反填鸭）
};

const now = () => Date.now();

// --- 轻量分词：抽取线索(cue)。中文按 bigram，英文/数字按词。用于扩散激活与识别 ---
const STOP = new Set([
  'the','a','an','of','to','and','is','in','it','you','that','this','for','on',
  '的','了','和','是','我','你','他','她','它','在','有','就','都','也','很','这','那','吗','呢','啊',
]);
export function tokenize(text = '') {
  const cues = new Set();
  const lower = String(text).toLowerCase();
  for (const w of lower.match(/[a-z0-9]{2,}/g) || []) if (!STOP.has(w)) cues.add(w);
  // 中文 bigram
  const han = lower.match(/[一-龥]+/g) || [];
  for (const seg of han) {
    if (seg.length === 1) { if (!STOP.has(seg)) cues.add(seg); continue; }
    for (let i = 0; i < seg.length - 1; i++) {
      const bg = seg.slice(i, i + 2);
      if (!STOP.has(bg)) cues.add(bg);
    }
  }
  return [...cues];
}

// 逻辑斯蒂噪声（近似 ACT-R 的 logistic activation noise）
function logisticNoise(s) {
  const u = Math.random();
  return s * Math.log(u / (1 - u));
}

// ----------------------------------------------------------------------------
// 一条记忆痕迹（memory trace / chunk）
// ----------------------------------------------------------------------------
class Trace {
  constructor({ content, cues, context, salience, createdAt }) {
    this.id = 'm_' + Math.random().toString(36).slice(2, 10);
    this.content = content;
    this.gist = null;                 // 巩固时抽取的「要点」，用于重构式回忆
    this.cues = cues;                 // 关联线索
    this.context = context || {};     // 编码语境（书/章/模式/情绪），供编码特异性使用
    this.salience = salience;         // 情绪/重要性显著性 [0,1]，闪光灯记忆抗遗忘
    this.uses = [createdAt];          // 每次激活的时间戳（基础激活的历史）
    this.strength = 0;                // 巩固强度（复述累积，抗遗忘）
    this.store = 'STM';               // 'STM' 短期 | 'LTM' 长期
    this.createdAt = createdAt;
  }
}

// ----------------------------------------------------------------------------
// 记忆引擎
// ----------------------------------------------------------------------------
export class HumanMemory {
  constructor(opts = {}) {
    this.p = { ...DEFAULTS, ...opts };
    this.traces = [];                 // 短期 + 长期都在这里，用 store 字段区分
    this.assoc = new Map();           // cue -> Set(traceId)，用于扩散激活与扇形效应
    this.sessionOrder = [];           // 本会话进入的顺序，供首因/近因效应
  }

  // 单位化的「当前时间」（秒 / timeScale）
  _t() { return now() / 1000 / this.p.timeScale; }

  _index(trace) {
    for (const c of trace.cues) {
      if (!this.assoc.has(c)) this.assoc.set(c, new Set());
      this.assoc.get(c).add(trace.id);
    }
  }
  _unindex(trace) {
    for (const c of trace.cues) this.assoc.get(c)?.delete(trace.id);
  }

  // --- 注意门控：估计一条输入的显著性，决定它能否从瞬时进入短期记忆 ---
  // 显著性 = 新颖度 × 信息量 + 情绪 + 与当前目标的相关性 + 显式强调
  // 关键：新颖度要乘「信息量(richness)」——「嗯」「翻页杂音」这类内容虽新但空洞，
  // 不该只因新颖就被记住；真正抓住注意的是「新颖且信息密集」或「带情绪/被强调」。
  _salience(cues, context, emphasis) {
    let overlap = 0, known = 0;
    for (const c of cues) { if (this.assoc.get(c)?.size) overlap++; }
    const novelty = cues.length ? 1 - overlap / cues.length : 0;
    const richness = Math.min(1, cues.length / 4); // 线索太少 = 信息量低
    const goalCues = tokenize([context?.goal, context?.chapter].filter(Boolean).join(' '));
    for (const c of cues) if (goalCues.includes(c)) known++;
    const relevance = goalCues.length ? known / goalCues.length : 0;
    const emotion = context?.emotion ?? 0;
    return Math.min(1,
      0.35 * novelty * richness + 0.35 * emotion + 0.20 * relevance + 0.45 * (emphasis || 0));
  }

  // === 感知：一切输入先过瞬时缓冲 + 注意门控 ===
  // 返回被注意到（进入短期记忆）的 trace，或 null（被忽略/遗忘在瞬时层）
  perceive(content, context = {}, { emphasis = 0, cues } = {}) {
    const t = this._t();
    const cueList = cues || tokenize(content + ' ' + (context.tags || ''));
    const salience = this._salience(cueList, context, emphasis);
    if (salience < this.p.attentionThreshold) {
      return { attended: false, salience, reason: '显著性不足，未进入短期记忆' };
    }
    const trace = new Trace({ content, cues: cueList, context, salience, createdAt: t });
    // 情绪显著性直接给一点初始强度（闪光灯记忆：一次就记得很牢）
    trace.strength = salience >= 0.75 ? 1.5 : 0;
    this.traces.push(trace);
    this._index(trace);
    this.sessionOrder.push(trace.id);
    this._evictSTM();
    return { attended: true, salience, trace };
  }

  // 短期记忆容量限制：超出则挤掉激活最低的短期项（未被巩固的就此遗忘）
  _evictSTM() {
    const stm = this.traces.filter((x) => x.store === 'STM');
    if (stm.length <= this.p.stmCapacity) return;
    stm.sort((a, b) => this._activation(a) - this._activation(b));
    const drop = stm.slice(0, stm.length - this.p.stmCapacity);
    for (const d of drop) this._forget(d);
  }

  // === 复述：把某条短期记忆再激活一次；间隔复述比填鸭更有效 ===
  rehearse(id, { elaborative = false } = {}) {
    const tr = this.traces.find((x) => x.id === id);
    if (!tr) return null;
    const t = this._t();
    const lastUse = tr.uses[tr.uses.length - 1];
    tr.uses.push(t);
    // 间隔效应：距上次复述太近，强度收益打折（反对填鸭式突击）
    const gap = (t - lastUse) * this.p.timeScale; // 秒
    const spacingGain = gap < this.p.spacingWindow ? 0.3 : 1;
    // 精细复述（把新信息与已有记忆关联）比机械复述更能巩固
    tr.strength += spacingGain * (elaborative ? 1.4 : 1);
    // 精细复述会把当前语境线索并入，加强关联网络
    if (elaborative) {
      const extra = tokenize(tr.content).filter((c) => !tr.cues.includes(c));
      tr.cues.push(...extra);
      this._index(tr);
    }
    // 达到巩固阈值 → 转入长期记忆
    if (tr.store === 'STM' && tr.strength >= this.p.consolidateThreshold) {
      tr.store = 'LTM';
      tr.gist = this._makeGist(tr);
    }
    return tr;
  }

  // === ACT-R 激活：基础激活 + 扩散激活（+ 由调用方加噪声） ===
  // B_i = ln( Σ_j (t - t_j)^-d ) + 强度项 ；A_i = B_i + Σ_k W_k · S_ki
  _baseLevel(tr) {
    const t = this._t();
    let sum = 0;
    for (const u of tr.uses) {
      const dt = Math.max(t - u, 1 / this.p.timeScale); // 防止刚用完时除零爆炸
      sum += Math.pow(dt * this.p.timeScale, -this.p.decay);
    }
    let b = Math.log(sum || 1e-9);
    // 巩固强度让遗忘变慢（等效于抬高基线，近似 Ebbinghaus 的 S 变大）
    b += Math.log(1 + tr.strength);
    return b;
  }

  // 扩散激活：当前语境线索把激活扩散到共享线索的记忆；扇形效应会稀释
  _spread(tr, contextCues) {
    if (!contextCues || !contextCues.length) return 0;
    const W = this.p.sourceActivation / contextCues.length; // 源激活按线索数均分
    let a = 0;
    for (const c of contextCues) {
      if (!tr.cues.includes(c)) continue;
      const fan = this.assoc.get(c)?.size || 1;             // 关联到该线索的记忆数
      const S = this.p.maxAssoc - Math.log(fan);            // 扇形效应：越泛化越弱
      a += W * S;
    }
    return a;
  }

  _activation(tr, contextCues = []) {
    return this._baseLevel(tr) + this._spread(tr, contextCues);
  }

  // 编码特异性：回忆语境与编码语境（书/章/模式）吻合时给激活加成（只加成，不构成提取路径）
  _contextMatch(tr, context) {
    if (!context) return 0;
    let m = 0;
    if (context.book && context.book === tr.context.book) m += 0.2;
    if (context.chapter && context.chapter === tr.context.chapter) m += 0.35;
    if (context.mode && context.mode === tr.context.mode) m += 0.15;
    return m;
  }

  // === 自由回忆：只凭当前语境线索去提取，难，返回结果概率性、可能被重构 ===
  // 关键的「人性」约束：**提取需要线索通路**——探针不与某条记忆共享任何线索时，
  // 那条记忆根本进不了候选（你无法回忆起探针触及不到的东西，即线索依赖性遗忘）。
  // 空探针 = 无定向的自由联想，按基础激活（近因/频率）浮现。
  recall(query = '', context = {}, { limit = 5, cued = false, probeOnly = false, reinforce = true } = {}) {
    // probeOnly：识别时只用探针本身作线索，不掺入当前语境目标（否则会「认错人」）
    const cues = tokenize(probeOnly ? query : query + ' ' + (context.goal || ''));
    const directed = cues.length > 0;
    const threshold = this.p.retrievalThreshold - (cued ? this.p.recognitionBonus : 0);
    const scored = [];
    let tot = null; // tip-of-the-tongue：有线索通路、最接近但没过阈值的那条
    for (const tr of this.traces) {
      const hasPath = !directed || cues.some((c) => tr.cues.includes(c));
      if (!hasPath) continue; // 无线索通路 → 想都想不到（不是忘了细节，是根本没线索）
      const a = this._activation(tr, cues) + this._contextMatch(tr, context)
        + logisticNoise(this.p.noise);
      if (a >= threshold) {
        scored.push({ trace: tr, activation: a });
      } else if (a >= threshold - this.p.totMargin) {
        if (!tot || a > tot.activation) tot = { trace: tr, activation: a };
      }
    }
    scored.sort((x, y) => y.activation - x.activation);
    const hits = scored.slice(0, limit).map((s) => ({
      ...s,
      recollection: this._reconstruct(s.trace, s.activation, threshold),
      latency: this._latency(s.activation),
    }));
    // 提取本身也是一次复述（提取练习/测试效应）：被真正回忆到的记忆得到轻微强化。
    // reinforce=false 用于「只是想想看」的模拟回忆（如 A/B 内省），不改变记忆状态。
    if (reinforce) for (const h of hits) { h.trace.uses.push(this._t()); h.trace.strength += 0.2; }
    return { hits, tipOfTongue: tot ? this._totHint(tot.trace) : null };
  }

  // === 识别：给一个具体探针(probe)，等于强线索 + 降阈值，「一看就想起来」 ===
  recognize(probe, context = {}) {
    const r = this.recall(probe, context, { limit: 3, cued: true, probeOnly: true });
    return {
      recognized: r.hits.length > 0,
      hits: r.hits,
      // 识别能把话到嘴边的记忆「唤醒」：探针作为线索补全了提取
      unlockedFromTOT: r.tipOfTongue,
    };
  }

  // 检索延迟：ACT-R 的 RT = F·e^(-A)，激活越高回忆越快
  _latency(a) { return +(0.4 * Math.exp(-a)).toFixed(3); }

  // 重构式回忆：激活高→逐字回忆；激活中→只记要点(gist)；勉强过阈→模糊+低置信
  _reconstruct(tr, a, threshold) {
    const margin = a - threshold;
    if (margin > 1.2) return { fidelity: 'verbatim', text: tr.content, confidence: 0.95 };
    if (margin > 0.4) {
      return {
        fidelity: 'gist',
        text: tr.gist || this._makeGist(tr),
        confidence: +(0.6 + margin * 0.15).toFixed(2),
      };
    }
    return {
      fidelity: 'fuzzy',
      text: `（模糊）好像是关于「${tr.cues.slice(0, 3).join('、')}」的？`,
      confidence: +(0.3 + margin * 0.2).toFixed(2),
    };
  }

  _totHint(tr) {
    return {
      feeling: '话到嘴边——记得有这么回事，但一时想不起细节',
      cues: tr.cues.slice(0, 3),
      hintId: tr.id,
    };
  }

  // 抽取要点：这里用启发式（首句 + 高频线索）。产品中可换成一次 LLM 摘要。
  _makeGist(tr) {
    const firstClause = String(tr.content).split(/[。.!?！？\n]/)[0].slice(0, 40);
    return firstClause || tr.cues.slice(0, 4).join('、');
  }

  _forget(tr) {
    this._unindex(tr);
    this.traces = this.traces.filter((x) => x !== tr);
  }

  // === 睡眠巩固：离线重放。参考「睡眠优先巩固弱而重要的记忆」+ 相似记忆整合 ===
  // 返回一份「梦境报告」，说明这轮巩固/整合/遗忘了什么，便于观察与调试。
  consolidate() {
    const report = { replayed: [], integrated: [], forgotten: [] };
    const floor = this.p.retrievalThreshold - 2.5; // 低于此地板 → 真正遗忘（不可提取）

    // 1) 重放：短期里「重要但还弱」的项优先被巩固进长期（睡眠偏爱弱记忆）
    for (const tr of this.traces.filter((x) => x.store === 'STM')) {
      const worth = tr.salience + tr.strength * 0.3;
      if (worth >= 0.6) {
        tr.strength += 1 + tr.salience;       // 重放强化
        tr.uses.push(this._t());
        if (tr.strength >= this.p.consolidateThreshold) {
          tr.store = 'LTM';
          tr.gist = this._makeGist(tr);
        }
        report.replayed.push(tr.id);
      }
    }

    // 2) 整合：把线索高度重叠的长期记忆归并（语义化 / 图式化，细节丢失但主干加强）
    const ltm = this.traces.filter((x) => x.store === 'LTM');
    const merged = new Set();
    for (let i = 0; i < ltm.length; i++) {
      if (merged.has(ltm[i].id)) continue;
      for (let j = i + 1; j < ltm.length; j++) {
        if (merged.has(ltm[j].id)) continue;
        if (this._overlap(ltm[i].cues, ltm[j].cues) >= 0.5) {
          // 归并：保留强的一条，吸收另一条的线索与强度
          const [keep, drop] = ltm[i].strength >= ltm[j].strength
            ? [ltm[i], ltm[j]] : [ltm[j], ltm[i]];
          keep.strength += drop.strength * 0.5;
          const extra = drop.cues.filter((c) => !keep.cues.includes(c));
          keep.cues.push(...extra);
          this._index(keep);
          keep.gist = this._makeGist(keep);
          this._forget(drop);
          merged.add(drop.id);
          report.integrated.push({ kept: keep.id, absorbed: drop.id });
        }
      }
    }

    // 3) 遗忘：激活跌破地板的记忆被清除（模拟不可逆遗忘，释放干扰）
    for (const tr of [...this.traces]) {
      if (this._baseLevel(tr) < floor) {
        this._forget(tr);
        report.forgotten.push(tr.id);
      }
    }
    return report;
  }

  _overlap(a, b) {
    const sa = new Set(a), inter = b.filter((x) => sa.has(x)).length;
    return inter / Math.max(1, Math.min(a.length, b.length));
  }

  // === 内省：当前「脑中」的记忆快照，按激活排序，供调试与 UI 展示 ===
  introspect(context = {}) {
    const cues = tokenize(context.goal || '');
    return this.traces
      .map((tr) => ({
        id: tr.id,
        store: tr.store,
        content: tr.content.slice(0, 60),
        salience: +tr.salience.toFixed(2),
        strength: +tr.strength.toFixed(2),
        activation: +this._activation(tr, cues).toFixed(2),
        uses: tr.uses.length,
      }))
      .sort((a, b) => b.activation - a.activation);
  }

  // 序列化（供持久化）。时间戳是「时间单位」制，跨进程仍可用（基于绝对 now/timeScale）。
  toJSON() {
    return {
      p: this.p,
      sessionOrder: this.sessionOrder,
      traces: this.traces.map((t) => ({ ...t })),
    };
  }
  static fromJSON(obj) {
    const m = new HumanMemory(obj.p);
    m.sessionOrder = obj.sessionOrder || [];
    m.traces = (obj.traces || []).map((o) => Object.assign(new Trace({
      content: o.content, cues: o.cues, context: o.context,
      salience: o.salience, createdAt: o.createdAt,
    }), o));
    m.assoc = new Map();
    for (const t of m.traces) m._index(t);
    return m;
  }
}

export default HumanMemory;
