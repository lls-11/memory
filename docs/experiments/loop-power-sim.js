#!/usr/bin/env node
// docs/experiments/loop-power-sim.js
//
// 「三感闭环」的蒙特卡洛功效分析
// ================================
// 配合 docs/experiments/three-senses-loop.md 的 Study 2（循环放大实验）使用。
//
// 数据生成模型（多层 VAR(1)，含被试随机截距）：
//
//   y_{i,t} = A · y_{i,t-1} + u_i + e_{i,t}
//   y = [H, M, D]ᵀ = [无助感, 无意义感, 绝望感]
//
//        ┌ φ  0  c ┐        a : H → M （无助 → 无意义）
//   A =  │ a  φ  0 │        b : M → D （无意义 → 绝望）
//        └ 0  b  φ ┘        c : D → H （绝望 → 无助，闭环边）
//
// 估计端不施加任何零约束：对每个结果变量用「被试内去均值 + OLS + 聚类稳健 SE」
// （固定效应估计量，近似 RI-CLPM 的被试内部分），估出完整 3×3 的 Â，再取
//   â = Â[M][H]，b̂ = Â[D][M]，ĉ = Â[H][D]
//
// 三个预注册判据的功效：
//   (1) 联合显著检验：三条边同时 p<.05 且符号为正  → 闭环存在的必要条件
//   (2) 环增益 loop gain = a·b·c 的 bootstrap CI 不含 0
//   (3) 谱半径 ρ(Â) 的点估计与分布（描述性，非通过/不通过判据，见文档 §7.3）
//
// 已知偏差：T 较小时固定效应估计量对自回归系数 φ 有 Nickell 向下偏差（≈ -1/T），
// 交叉滞后路径受影响较小。脚本会同时打印 â/b̂/ĉ/φ̂ 的均值，便于看到偏差量级；
// 正式预注册时建议用 Mplus / brms 的 RI-CLPM 复核（本脚本给出的是保守下界）。
//
// 用法：
//   node docs/experiments/loop-power-sim.js                    # 默认网格
//   node docs/experiments/loop-power-sim.js --a .10 --b .10 --c .10 --nsim 2000
//   node docs/experiments/loop-power-sim.js --N 200 --T 6 --verbose

// ---------------------------------------------------------------- 工具：随机数
let seed = 20260917;
function rand() {                      // xorshift32，保证结果可复现
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return (seed >>> 8) / 16777216;
}
function randn() {                     // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ------------------------------------------------------ 工具：小矩阵线性代数
function matInv3(M) {                  // 3×3 求逆（余子式法）
  const [[a, b, c], [d, e, f], [g, h, i]] = M;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    [(e * i - f * h), -(b * i - c * h), (b * f - c * e)],
    [-(d * i - f * g), (a * i - c * g), -(a * f - c * d)],
    [(d * h - e * g), -(a * h - b * g), (a * e - b * d)],
  ];
  return inv.map(r => r.map(x => x / det));
}
function matMul(A, B) {
  const n = A.length, m = B[0].length, k = B.length;
  const C = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let t = 0; t < k; t++) s += A[i][t] * B[t][j];
      C[i][j] = s;
    }
  return C;
}
function spectralRadius(A, iters = 500) { // 幂迭代取主特征值绝对值
  let v = [1, 0.5, 0.25], lam = 0;
  for (let k = 0; k < iters; k++) {
    const w = A.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
    const norm = Math.hypot(w[0], w[1], w[2]);
    if (norm < 1e-12) return 0;
    v = w.map(x => x / norm);
    lam = norm;
  }
  return lam;
}

// ------------------------------------------------------------------ 数据生成
// 返回 persons: [{ y: [[H,M,D] × (T+1)] }]，第 0 期为诱导后的起点，之后 T 期为测量轮
function simulate({ N, T, a, b, c, phi, sdU, sdE, burnin = 10 }) {
  const A = [[phi, 0, c], [a, phi, 0], [0, b, phi]];
  const persons = [];
  for (let i = 0; i < N; i++) {
    const u = [randn() * sdU, randn() * sdU, randn() * sdU];
    let y = [randn() * sdE, randn() * sdE, randn() * sdE];
    for (let t = 0; t < burnin + T; t++) {
      const next = A.map((row, j) =>
        row[0] * y[0] + row[1] * y[1] + row[2] * y[2] + u[j] + randn() * sdE);
      y = next;
      if (t === burnin - 1) persons.push({ y: [y.slice()] });
      else if (t >= burnin) persons[persons.length - 1].y.push(y.slice());
    }
  }
  return persons;
}

// -------------------------------------------- 固定效应估计 + 聚类稳健标准误
// 对每个结果 j：Δy_{i,t}^{(j)} ~ [ΔH_{i,t-1}, ΔM_{i,t-1}, ΔD_{i,t-1}]（Δ = 被试内去均值）
function fitVAR(persons) {
  // 先把每个被试的滞后对 (x_{t-1}, y_t) 收集起来，再按被试内均值中心化
  const rows = [];                     // { pid, x:[3], y:[3] }
  persons.forEach((p, pid) => {
    for (let t = 1; t < p.y.length; t++) rows.push({ pid, x: p.y[t - 1], y: p.y[t] });
  });
  const mx = new Map(), my = new Map(), cnt = new Map();
  for (const r of rows) {
    if (!mx.has(r.pid)) { mx.set(r.pid, [0, 0, 0]); my.set(r.pid, [0, 0, 0]); cnt.set(r.pid, 0); }
    for (let k = 0; k < 3; k++) { mx.get(r.pid)[k] += r.x[k]; my.get(r.pid)[k] += r.y[k]; }
    cnt.set(r.pid, cnt.get(r.pid) + 1);
  }
  for (const pid of cnt.keys())
    for (let k = 0; k < 3; k++) { mx.get(pid)[k] /= cnt.get(pid); my.get(pid)[k] /= cnt.get(pid); }
  const X = rows.map(r => r.x.map((v, k) => v - mx.get(r.pid)[k]));
  const Y = rows.map(r => r.y.map((v, k) => v - my.get(r.pid)[k]));
  const pid = rows.map(r => r.pid);

  // X'X 与其逆（三个方程共用）
  const XtX = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const x of X)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) XtX[i][j] += x[i] * x[j];
  const XtXinv = matInv3(XtX);
  if (!XtXinv) return null;

  const Ahat = [], SE = [];
  for (let j = 0; j < 3; j++) {
    const Xty = [0, 0, 0];
    for (let n = 0; n < X.length; n++)
      for (let i = 0; i < 3; i++) Xty[i] += X[n][i] * Y[n][j];
    const beta = XtXinv.map(row => row[0] * Xty[0] + row[1] * Xty[1] + row[2] * Xty[2]);
    // 聚类稳健（CR0，按被试聚类）：(X'X)⁻¹ (Σ_i X_i'e_i e_i'X_i) (X'X)⁻¹
    const scoreByPid = new Map();
    for (let n = 0; n < X.length; n++) {
      const e = Y[n][j] - (X[n][0] * beta[0] + X[n][1] * beta[1] + X[n][2] * beta[2]);
      if (!scoreByPid.has(pid[n])) scoreByPid.set(pid[n], [0, 0, 0]);
      const s = scoreByPid.get(pid[n]);
      for (let i = 0; i < 3; i++) s[i] += X[n][i] * e;
    }
    const meat = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const s of scoreByPid.values())
      for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) meat[i][k] += s[i] * s[k];
    const G = scoreByPid.size, K = 3;
    const adj = (G / (G - 1)) * ((X.length - 1) / (X.length - K));   // 小样本校正
    const V = matMul(matMul(XtXinv, meat), XtXinv).map(r => r.map(x => x * adj));
    Ahat.push(beta);
    SE.push([Math.sqrt(V[0][0]), Math.sqrt(V[1][1]), Math.sqrt(V[2][2])]);
  }
  return { Ahat, SE, nObs: X.length };
}

// ------------------------------------------------- 环增益的被试级 bootstrap
function bootLoopGain(persons, B = 400) {
  const N = persons.length, gains = [];
  for (let bIdx = 0; bIdx < B; bIdx++) {
    const samp = [];
    for (let i = 0; i < N; i++) samp.push(persons[Math.floor(rand() * N)]);
    const f = fitVAR(samp);
    if (!f) continue;
    gains.push(f.Ahat[1][0] * f.Ahat[2][1] * f.Ahat[0][2]);   // â·b̂·ĉ
  }
  gains.sort((x, y) => x - y);
  if (!gains.length) return null;
  const q = p => gains[Math.min(gains.length - 1, Math.max(0, Math.round(p * (gains.length - 1))))];
  return { lo: q(0.025), hi: q(0.975) };
}

// ------------------------------------------------------------------- 单格实验
function runCell({ N, T, a, b, c, phi, sdU, sdE, nsim, boot }) {
  let jointHits = 0, bootHits = 0, bootRuns = 0;
  const est = { a: [], b: [], c: [], phi: [], rho: [] };
  const CRIT = 1.959964;               // 双侧 α=.05
  for (let s = 0; s < nsim; s++) {
    const persons = simulate({ N, T, a, b, c, phi, sdU, sdE });
    const f = fitVAR(persons);
    if (!f) continue;
    const ah = f.Ahat[1][0], bh = f.Ahat[2][1], ch = f.Ahat[0][2];
    const az = ah / f.SE[1][0], bz = bh / f.SE[2][1], cz = ch / f.SE[0][2];
    if (az > CRIT && bz > CRIT && cz > CRIT) jointHits++;
    est.a.push(ah); est.b.push(bh); est.c.push(ch);
    est.phi.push((f.Ahat[0][0] + f.Ahat[1][1] + f.Ahat[2][2]) / 3);
    est.rho.push(spectralRadius(f.Ahat));
    if (boot && s < boot.nsim) {
      bootRuns++;
      const ci = bootLoopGain(persons, boot.B);
      if (ci && ci.lo > 0) bootHits++;
    }
  }
  const mean = xs => xs.reduce((u, v) => u + v, 0) / xs.length;
  const sd = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
  return {
    N, T,
    powerJoint: jointHits / nsim,
    powerBoot: bootRuns ? bootHits / bootRuns : null,
    bootRuns,
    aHat: mean(est.a), bHat: mean(est.b), cHat: mean(est.c), phiHat: mean(est.phi),
    rhoHat: mean(est.rho), rhoSD: sd(est.rho),
  };
}

// ----------------------------------------------------------------------- CLI
function argv(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : Number(v);
}

const P = {
  a: argv('a', 0.15), b: argv('b', 0.15), c: argv('c', 0.15),  // 预期的三条闭环边
  phi: argv('phi', 0.35),                                       // 自回归（惯性）
  sdU: argv('sdU', 0.80),                                       // 被试间 SD（随机截距）
  sdE: argv('sdE', 1.00),                                       // 被试内残差 SD
  nsim: argv('nsim', 1000),
};
const grid = argv('N', null)
  ? [{ N: argv('N', 200), T: argv('T', 6) }]
  : [100, 150, 200, 300].flatMap(N => [5, 6, 8].map(T => ({ N, T })));
const boot = argv('noboot', false) ? null : { nsim: 200, B: 400 };

console.log('三感闭环 · 蒙特卡洛功效分析');
console.log('模型: y_t = A y_{t-1} + u_i + e_t   (H→M=a, M→D=b, D→H=c, 自回归=φ)');
console.log(`真值: a=${P.a} b=${P.b} c=${P.c} φ=${P.phi} | SD_between=${P.sdU} SD_within=${P.sdE}`);
console.log(`每格 ${P.nsim} 次重复；环增益 bootstrap: ${boot ? `前 ${boot.nsim} 次 × B=${boot.B}` : '关闭'}`);
console.log('真值谱半径 ρ(A) =', spectralRadius([[P.phi, 0, P.c], [P.a, P.phi, 0], [0, P.b, P.phi]]).toFixed(3));
console.log('');
console.log('   N    T | 功效:联合显著  功效:环增益CI |    â      b̂      ĉ      φ̂   |  ρ̂(SD)');
console.log('---------+----------------------------+-------------------------------+-----------');
for (const g of grid) {
  const r = runCell({ ...P, ...g, boot });
  const pb = r.powerBoot === null ? '    —  ' : (r.powerBoot * 100).toFixed(1).padStart(6) + '%';
  console.log(
    `${String(r.N).padStart(4)} ${String(r.T).padStart(4)} | ` +
    `${(r.powerJoint * 100).toFixed(1).padStart(11)}% ${pb.padStart(16)} | ` +
    `${r.aHat.toFixed(3).padStart(6)} ${r.bHat.toFixed(3).padStart(6)} ` +
    `${r.cHat.toFixed(3).padStart(6)} ${r.phiHat.toFixed(3).padStart(6)}   | ` +
    `${r.rhoHat.toFixed(3)}(${r.rhoSD.toFixed(3)})`);
}
console.log('');
console.log('注: φ̂ 的向下偏差是固定效应估计量在短面板下的 Nickell 偏差（≈ -1/T），属预期现象；');
console.log('    交叉滞后路径 â/b̂/ĉ 受其影响较小。正式预注册请用 RI-CLPM 复核本表。');
