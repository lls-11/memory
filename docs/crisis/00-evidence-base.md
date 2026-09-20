# 证据基础、分级规则与核查记录

> 本文是 [`01-dbt-for-crisis.md`](./01-dbt-for-crisis.md) 与
> [`02-risk-assessment.md`](./02-risk-assessment.md) 的**共用证据层**。
> 两份文档里的 `[R#]` 编号指向 §3 的文献表；`【实证】【共识】【推论】【本项目】`
> 四类标记的含义见 §1。
>
> **核查日期：2026-09-20。** §2 记录了这次核查**改动了什么、为什么改**——
> 有五条是实质修正，不是补引文。

---

## 1. 证据分级：四类标记

一份要给真人用的危机干预材料，最危险的不是写错，而是**让人分不清哪句有实证、
哪句是我的推论**。所以每条实质主张都带一个标记：

| 标记 | 含义 | 可以怎么用 |
|---|---|---|
| **【实证】** | 有直接的实证文献支持，附 `[R#]`，并注明研究设计与效应量 | 可作为规程依据 |
| **【共识】** | 领域内成熟共识或权威教材/指南的专家意见，但**无强实证**（或我未查到） | 可用，但须知道它靠的是专家共识 |
| **【推论】** | 我从前述实证或共识推出的，**无直接文献** | 须由专业人员复核后再用 |
| **【本项目】** | 本项目自己的理论主张，**未经任何检验** | **不得作为规程依据**，只能当假设 |

三条使用规则：

1. **【推论】与【本项目】不得单独支撑一条会改变临床动作的规则。**
   凡这两类标记出现在"必须 / 禁止"级别的条文上，该条文须降格为"建议"，
   或补上实证依据后才升格。
2. **标记缺失视为【推论】。** 未标记不等于有实证。
3. **文献表的核验状态另有标记**（§3 的"核"列）：
   `✔` = 本次联网核实到出处与主要结论；`○` = 按领域常识引用，**未核实原文**。
   `○` 类不得作为规程依据。

---

## 2. 核查记录：这次改了什么

### 2.1 五条实质修正（不是补引文，是结论变了）

**修正一 · 「习得性无助」的理论基础在 2016 年被原作者反转**

- 原文（`01` §2）：把无助感描述为"习得性无助"，即**学会了**"行动与结果无关"。
- 核查发现：Maier & Seligman (2016) `[R1]` 明确写道原始理论"got it backward"——
  **被动与无望是哺乳类面对长期厌恶事件的未习得的默认反应**（由背侧中脑中央灰质
  / 背侧 raphe 核的 5-HT 活动介导）；**被习得的是"控制"**——
  由内侧前额叶检测到可控性，进而自动抑制那条被动通路。
- 改动：`01` §2.1 增加这段反转，并把无助感的机制表述从"学会了无助"改为
  **"未能习得控制（或已习得的控制被环境撤销）"**。
- **这条修正反而强化了原有的干预建议**：`01` §5.3 规则二（给一次必然成功的
  最小可控单元）之所以有效，正因为**检测到可控性**是抑制被动的机制本身，
  而不只是"心理鼓励"。原来的建议对，但理由给错了。

**修正二 · 「既往自杀企图是最强的单一预测因子」是过度陈述**

- 原文（`02` §3.1）：「最强的单一预测因子」。
- 核查发现：Ribeiro et al. (2016) 的纵向研究元分析 `[R12]`（39 项研究之外的
  独立分析，样本量大）给出的是**任何自我伤害性想法或行为史 → 后续自杀企图
  风险约 2 倍、死于自杀约 1.5 倍**；该文标题即在追问"真实的效应量到底多大"，
  并明确讨论其**临床效用有限**。
- 改动：改为**"最稳定复现的预测因子之一，但效应量中等（OR 约 2），
  个体层面的预测效用有限"**，并与 §8 的方法论边界对齐。
- 这条修正与"永久提升基线关注等级"的建议**不冲突**：
  基线调整靠的是它的稳定性，不是它的预测力。

**修正三 · 「突然平静」从红旗降级为「禁止自动降级」的触发条件**

- 原文（`02` §5 红旗 11）：列为必须升级的红旗。
- 核查发现：这是**临床经验与专家意见**，广泛出现在预警清单与临床评论中，
  但我未查到支持它作为独立风险因子的前瞻性证据；相反，有文献指出
  情绪好转者中真正走向企图的只占很小比例，**其单独的预测价值有限**。
- 改动：从"红旗（必须启动）"移出，改为**"禁止自动降级"规则**——
  即它不触发升级，但**禁止**系统在此情形下下调等级，须人工确认。
  标记由【实证】改为【共识】。
- 理由：作为"禁止降级"的规则，它的代价是多一次人工确认；
  作为"必须升级"的红旗，它的代价是大量误报冲淡真红旗。后者不值得。

**修正四 · 「不自杀契约有害」降调为「无实证支持」；并补上被漏掉的替代方案**

- 原文（`02` §8）：「不自杀契约无效，甚至有害」。
- 核查发现：Rudd, Mandrusiak & Joiner (2006) `[R9]` 的结论是**无任何实证支持
  其有效性**，并存在概念与实务上的一系列问题（包括给临床者虚假安心）；
  "有害"方面的直接证据较弱。
- 改动：改为**"无实证支持，且会给干预者虚假保证"**，删去"有害"的断言。
- 同时补一处漏掉的内容：该文提出的替代方案是**"治疗承诺声明"
  （Commitment to Treatment Statement, CTS）**——承诺投入治疗与使用技巧，
  而非承诺不自杀。它与安全计划**并列**，不是二选一：
  CTS 替代的是"承诺"，安全计划替代的是"计划"。

**修正五 · 技巧训练是 DBT 里被成分分析证明承重的那一块**

- 原文（`01` §4.4）：把技巧库当作"改变侧的工具"陈列。
- 核查发现：Linehan et al. (2015) `[R2]` 是一项**随机临床试验 + 成分分析**，
  比较"技巧训练 + 个案管理"、"个体治疗 + 活动小组"与标准 DBT，结论是
  **包含技巧训练的方案才能有效减少自杀企图与自伤**。
- 改动：`01` §4.4 增加这条实证，并明确：**技巧训练不是 DBT 的附属模块，
  是成分分析里承重的那一块**。这同时为 `04`（替代行为设计）整份文档提供了
  它此前缺少的实证依据。

### 2.2 五条补上具体数字（原来只有方向，没有量级）

| 原文位置 | 原来的表述 | 补上的实证 |
|---|---|---|
| `02` §2.3 激越 | "自杀行为最近端的状态之一" | Busch et al. (2003) `[R3]`：76 例住院期间/出院即刻的自杀，**79% 在自杀前一周达到重度或极重度焦虑和/或激越** |
| `02` §2.3 失眠 | "独立于抑郁的急性风险因子" | Pigeon et al. (2012) `[R13]`：39 项研究、147,753 人，睡眠障碍 → 自杀意念/企图/死亡的 **RR 1.95–2.95**；**抑郁不调节**该关联 |
| `02` §5 红旗 10 出院窗口 | "出院后 1–3 个月" | Chung et al. (2017) `[R4]`：100 项研究、17,857 例自杀，出院后**前 3 个月 1132/10 万人年**（约为全球自杀率的 100 倍）；**因自杀意念或行为入院者达 2078/10 万人年** |
| `02` §2.2 限制手段 | "循证性最强的措施之一" | Zalsman et al. (2016) `[R8]`：10 年系统综述，**限制致命手段有强证据**，且**向其他方式的替代有限** |
| `02` §8 安全计划 | "循证支持明确" | Stanley et al. (2018) `[R11]`：VA 急诊的**队列比较研究（非随机对照）**，SPI + 随访组 6 个月内**自杀行为少 45%**，门诊就诊率约为 2 倍 |

> 最后一行的研究设计要标明：**它是队列比较，不是 RCT**。
> 把它说成 RCT 会高估证据等级。

### 2.3 一处必须呈现的反对意见

`02` §8 的核心主张（风险分层不能预测个体行为）有扎实的支持
`[R5][R6][R7][R14]`，但**这个立场在领域内并非无人反对**：
已有文献从方法学角度批评这些批评"过时"、并主张新一代预测模型的表现值得重估
`[R15]`。

**我没有读到该文全文，因此不对双方孰是孰非下判断。** 但材料里必须写明存在争论，
否则是把一方观点当成定论。

对本项目的实际影响不大——因为本材料的做法（不用等级分配资源、
用二维矩阵驱动动作、把"低风险"明确排除为不行动的依据）在两种立场下都成立。

### 2.4 明确标注为【本项目】的部分

**"三感 = 动机链三处断裂"这一模型，以及由它推出的闭环与跃迁点，是本项目的
理论主张，未经任何检验。**

其构成部件各自有文献根基：

- 无助感 ← 习得性无助及其 2016 年重构 `[R1]`
- 绝望感 ← 绝望理论（Abramson et al. 1989）`[R16]`、Beck 绝望量表 `[R17]`
- 无意义感 ← 意义的三成分（目的/重要性/连贯性）`[R18][R19]`

但**把三者串成一条有方向的动机链（行动→结果→价值→未来），
并主张它们按 H→M→D 顺序传导**，是本项目的假设，不是文献结论。

因此：

- `01` §1.2、§5.3、`03` §4.2 的相关条文全部标【本项目】；
- 由该模型推出的具体干预规则（如"绝望感高就缩短时间视野"）标【推论】，
  **不得写成"必须"**，只能是"建议"；
- 其检验途径已在 `03` §4.2（个案层面）与
  [`../experiments/three-senses-loop.md`](../experiments/three-senses-loop.md)（群体层面）给出。

---

## 3. 文献表

「核」列：`✔` = 本次联网核实到出处与主要结论；`○` = **未核实原文**，按领域常识引用。
页码以检索到的书目信息为准，正式引用前请核对原文。

### 已核实

| # | 文献 | 核 | 本材料用它支持什么 |
|---|---|:--:|---|
| R1 | Maier SF, Seligman MEP. (2016). Learned helplessness at fifty: Insights from neuroscience. *Psychological Review*, 123(4), 349–367. | ✔ | 被动是默认、控制才是习得的；据此重述无助感机制（修正一）|
| R2 | Linehan MM, et al. (2015). Dialectical behavior therapy for high suicide risk in individuals with borderline personality disorder: A randomized clinical trial and component analysis. *JAMA Psychiatry*, 72(5), 475–482. | ✔ | 技巧训练是承重成分（修正五）|
| R3 | Busch KA, Fawcett J, Jacobs DG. (2003). Clinical correlates of inpatient suicide. *J Clin Psychiatry*, 64(1), 14–19. | ✔ | 激越/重度焦虑是近端风险（79%）；且标准风险评估作用有限 |
| R4 | Chung DT, et al. (2017). Suicide rates after discharge from psychiatric facilities: A systematic review and meta-analysis. *JAMA Psychiatry*, 74(7), 694–702. | ✔ | 出院后前 3 个月的风险量级 |
| R5 | Carter G, et al. (2017). Predicting suicidal behaviours using clinical instruments: systematic review and meta-analysis of positive predictive values for risk scales. *Br J Psychiatry*, 210(6), 387–395. | ✔ | 风险量表的阳性预测值过低，不足以分配资源 |
| R6 | Large M, et al. (2016). Meta-analysis of longitudinal cohort studies of suicide risk assessment among psychiatric patients: Heterogeneity in results and lack of improvement over time. *PLOS ONE*, 11(6), e0156322. | ✔ | 风险评估的表现异质且未随时间改善 |
| R7 | Hawton K, Lascelles K, Pitman A, Gilbert S, Silverman M. (2022). Assessment of suicide risk in mental health practice: shifting from prediction to therapeutic assessment, formulation, and risk management. *Lancet Psychiatry*, 9(11), 922–928. | ✔ | 从预测转向治疗性评估与个案formulation（仅核实出处与论旨，未读全文）|
| R8 | Zalsman G, et al. (2016). Suicide prevention strategies revisited: 10-year systematic review. *Lancet Psychiatry*, 3(7), 646–659. | ✔ | 限制手段有强证据、方式替代有限 |
| R9 | Rudd MD, Mandrusiak M, Joiner TE. (2006). The case against no-suicide contracts: The commitment to treatment statement as a practice alternative. *J Clin Psychol*, 62(2), 243–251. | ✔ | 不自杀契约无实证支持；CTS 作为替代（修正四）|
| R10 | Stanley B, Brown GK. (2012). Safety planning intervention: A brief intervention to mitigate suicide risk. *Cognitive and Behavioral Practice*, 19(2), 256–264. | ✔ | 安全计划六步的原始出处 |
| R11 | Stanley B, et al. (2018). Comparison of the Safety Planning Intervention with follow-up vs usual care of suicidal patients treated in the emergency department. *JAMA Psychiatry*, 75(9), 894–900. | ✔ | SPI+ 的效果（**队列比较，非 RCT**）|
| R12 | Ribeiro JD, Franklin JC, Fox KR, Bentley KH, Kleiman EM, Chang BP, Nock MK. (2016). Self-injurious thoughts and behaviors as risk factors for future suicide ideation, attempts, and death: a meta-analysis of longitudinal studies. *Psychological Medicine*, 46(2), 225–236. | ✔ | 自伤史 → 后续企图约 2 倍、死亡约 1.5 倍；效应量中等（修正二）|
| R13 | Pigeon WR, Pinquart M, Conner K. (2012). Meta-analysis of sleep disturbance and suicidal thoughts and behaviors. *J Clin Psychiatry*, 73(9), e1160–e1167. | ✔ | 睡眠障碍 RR 1.95–2.95，抑郁不调节 |
| R14 | Large MM, et al. (2018). Suicide risk assessment: Risk stratification is not accurate enough to be clinically useful and alternative approaches are needed. *Crisis*, 39(4). | ✔ | 分层不足以用于临床决策 |
| R15 | （反对意见）Suicide risk assessment tools and prediction models: new evidence, methodological innovations, outdated criticisms. (2024). *PMC11021746*. | ✔ | **仅核实其存在与论旨**；用于呈现争论（§2.3），未读全文 |

### 未核实原文（按领域常识引用，待查）

| # | 文献 | 核 | 用途 |
|---|---|:--:|---|
| R16 | Abramson LY, Metalsky GI, Alloy LB. (1989). Hopelessness depression: A theory-based subtype of depression. *Psychological Review*, 96(2). | ○ | 绝望的稳定-全局归因 |
| R17 | Beck AT, et al. (1974). The measurement of pessimism: The Hopelessness Scale. *J Consult Clin Psychol*, 42(6). | ○ | 绝望的测量 |
| R18 | Martela F, Steger MF. (2016). The three meanings of meaning in life. *J Positive Psychology*. | ○ | 意义的三成分 |
| R19 | George LS, Park CL. (2016). Meaning in life as comprehension, purpose, and mattering. *Review of General Psychology*. | ○ | 同上 |
| R20 | Linehan MM. (1993). *Cognitive-Behavioral Treatment of Borderline Personality Disorder*. Guilford. | ○ | 生物社会理论、辩证策略、目标行为层级 |
| R21 | Linehan MM. (2015). *DBT Skills Training Manual*, 2nd ed. Guilford. | ○ | TIPP、PLEASE、DEAR MAN 等技巧的规程 |
| R22 | Linehan MM. (1997). Validation and psychotherapy. In *Empathy Reconsidered*. APA. | ○ | 验证六级 |
| R23 | Hiroto DS, Seligman MEP. (1975). Generality of learned helplessness in man. *JPSP*, 31(2). | ○ | 人类习得性无助的三联设计 |
| R24 | Spencer SJ, Zanna MP, Fong GT. (2005). Establishing a causal chain. *JPSP*, 89(6). | ○ | 实验因果链设计（用于三感实验设计）|
| R25 | Joiner TE. (2005). *Why People Die by Suicide*. Harvard UP. | ○ | 获得性能力 |
| R26 | Gould MS, et al. 自杀集群与传染效应相关研究 | ○ | `06` §5.2 的传染效应——**引文不完整，须补** |

> **R26 是一处已知缺口**：`06` 文档的"传染效应"与 postvention 建议目前只有
> 【共识】级支撑，本次未核实。若该建议要写进机构规程，须先补这一块的文献。

---

## 4. 解释链条的统一格式

需求要求"完整的解释链条"。`01` 与 `02` 中所有核心主张自本次修订起按同一格式展开：

```
理论 → 机制 → 可观察指标 → 现场动作 → 证据等级
```

四点约定：

1. **"机制"必须可被否证**——写不出"如果机制为假会看到什么"的，退回【推论】；
2. **"可观察指标"必须是访谈或行为里真能拿到的东西**，不是构念名称；
3. **"现场动作"必须能对应到 `01` 的五层优先级或 `02` 的矩阵格**；
4. **证据等级取链条上最弱的一环**——理论有实证但机制是推论，整条即【推论】。

第 4 条是这套格式最重要的一条：它防止"用一篇好文献给一整串推论背书"。

---

## 5. 这次核查没能做到的

诚实列出，避免这份材料被当成已完成文献工作的产物：

1. **只核实了 15 条文献的出处与主要结论，其中 R7、R15 未读全文**；
   R16–R26 完全未核实。
2. **没有做系统检索。** 本次是针对已写下的主张做定点查证，
   不是从文献出发做综述——因此可能遗漏与本材料结论相反的证据。
3. **没有检索中文文献与中国大陆数据。** 本材料中所有涉及中国大学生的具体判断
   （校园情境约束、求助障碍、辅导员双重角色）均为【共识】或【推论】，
   **无本土实证支撑**，这是最需要补的一块。
4. **R26（传染效应/postvention）的引文不完整。**
5. 所有效应量均取自检索摘要，**未核对原文表格**。

> 建议的下一步：对第 3 项（本土数据）与第 4 项（传染效应）做一次真正的系统检索，
> 其余按 §3 的 `○` 列逐条补核。
