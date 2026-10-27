/**
 * Latin square 分派单测（docs/01 §8.1）—— 无需浏览器
 *
 *     node tools/test_randomize.mjs
 *
 * 覆盖 docs/01 §8.1 的三条约束 + 两条最容易写错的地方：
 *   · T1 与 T4 共用同一个 offset（同一张图在两个任务里是**同一种布局**）
 *   · trial 总数 = 16 + 16 = 32（不是 16）
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildTrialPlan, assignLayouts, offsetFor, hashString, makeRng, shuffle,
  getOrAssignParticipantIndex,
} from '../src/js/randomize.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const N_GRAPHS = 16;          // docs/02 §3.3
const PER_BAND = 8;
const PER_LAYOUT = N_GRAPHS / 4;   // 4 张/布局

const cfg = {
  layouts: ['LPFD', 'KK', 'FR', 'FA2'],
  degreeLevels: ['low', 'high'],
  tasks: { T1: { enabled: true }, T4: { enabled: true }, T2: { enabled: false } },
  attentionChecks: 2,
  practiceTrials: { T1: 2, T4: 2, T2: 1 },
};

const stimuli = JSON.parse(readFileSync(join(ROOT, 'stimuli/stimuli.json'), 'utf8')).stimuli;
const graphIds = [...new Set(stimuli.map((s) => s.graph_id))].sort();
const bandOf = Object.fromEntries(stimuli.map((s) => [s.graph_id, s.degree_level]));

let failures = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { console.log(`  PASS  ${msg}`); }
  else { console.log(`  FAIL  ${msg}${extra ? '  → ' + extra : ''}`); failures++; }
};

console.log(`\n刺激池：${graphIds.length} 张图 × ${cfg.layouts.length} 布局\n`);

// ── 1. 结构检查 ──
console.log('1) 刺激池本身');
ok(graphIds.length === N_GRAPHS, `${N_GRAPHS} 张图（实际 ${graphIds.length}）`);
const bands = {};
for (const g of graphIds) bands[bandOf[g]] = (bands[bandOf[g]] || 0) + 1;
ok(bands.low === PER_BAND && bands.high === PER_BAND,
  `每度档 ${PER_BAND} 张（共两档）`, JSON.stringify(bands));

// ── 2. 单被试：三条约束 ──
console.log('\n2) 单被试分派（三条约束）');
const P = 12;
const combos = {};          // (graph, layout) → 跨被试出现次数
const offsets = [];

for (let p = 0; p < P; p++) {
  const pid = `P${String(p).padStart(3, '0')}`;
  const plan = buildTrialPlan({
    stimuli, graphIds, layouts: cfg.layouts, pid, participantIndex: p, cfg,
  });
  offsets.push(plan.offset);

  const perGraph = {};
  for (const [g, layout] of Object.entries(plan.mapping)) {
    perGraph[g] = (perGraph[g] || []).concat(layout);
    const k = `${g}|${layout}`;
    combos[k] = (combos[k] || 0) + 1;
  }

  if (p === 0) {
    const dup = Object.entries(perGraph).filter(([, v]) => v.length !== 1);
    ok(dup.length === 0, '① 每张图只对应【一种】布局', JSON.stringify(dup.slice(0, 2)));

    const layoutCount = {};
    for (const l of Object.values(plan.mapping)) layoutCount[l] = (layoutCount[l] || 0) + 1;
    ok(cfg.layouts.every((l) => layoutCount[l] === PER_LAYOUT),
      `② 每种布局覆盖 ${PER_LAYOUT} 张`, JSON.stringify(layoutCount));

    const cell = {};
    for (const [g, l] of Object.entries(plan.mapping)) {
      const k = `${l}|${bandOf[g]}`;
      cell[k] = (cell[k] || 0) + 1;
    }
    const bad = Object.entries(cell).filter(([, v]) => v !== 2);
    ok(bad.length === 0, '② 每 (布局 × 度档) 单元 2 张', JSON.stringify(cell));

    // 🔴 最容易错的一条：trial 总数
    const main = plan.trials.filter((t) => t.phase === 'main' && t.task !== 'ATTENTION');
    const t1 = main.filter((t) => t.task === 'T1').length;
    const t4 = main.filter((t) => t.task === 'T4').length;
    ok(t1 === N_GRAPHS && t4 === N_GRAPHS && main.length === 2 * N_GRAPHS,
      `trial 总数 = ${2 * N_GRAPHS}（T1 ${N_GRAPHS} + T4 ${N_GRAPHS}）`,
      `T1=${t1} T4=${t4} 合计=${main.length}`);
    ok(plan.trials.filter((t) => t.task === 'ATTENTION').length === 2,
      'attention check = 2');

    // 🔴 T1 与 T4 必须用同一种布局
    const byG = {};
    for (const t of main) (byG[t.graphId] ||= []).push(t.layout);
    const mismatch = Object.entries(byG).filter(([, v]) => new Set(v).size !== 1);
    ok(mismatch.length === 0,
      'T1 与 T4 对同一张图用【同一种布局】（未做跨任务错位）',
      JSON.stringify(mismatch.slice(0, 2)));
  }
}

// ── 3. 跨被试均衡 ──
console.log('\n3) 跨被试均衡');
const counts = Object.values(combos);
const min = Math.min(...counts), max = Math.max(...counts);
ok(min === max, `每个 (图,布局) 组合出现次数完全相等`, `min=${min} max=${max}`);
ok(Object.keys(combos).length === N_GRAPHS * 4,
  `覆盖全部 ${N_GRAPHS * 4} 个组合`, `实际 ${Object.keys(combos).length}`);

const offCount = {};
for (const o of offsets) offCount[o] = (offCount[o] || 0) + 1;
ok(Object.keys(offCount).length === 4 && new Set(Object.values(offCount)).size === 1,
  `offset 按被试均衡轮转（${P} 人 → 每个 offset 各 ${P / 4} 次）`, JSON.stringify(offCount));

// ── 4. 确定性 ──
console.log('\n4) 确定性');
const a = buildTrialPlan({ stimuli, graphIds, layouts: cfg.layouts, pid: 'SAME', participantIndex: 3, cfg });
const b = buildTrialPlan({ stimuli, graphIds, layouts: cfg.layouts, pid: 'SAME', participantIndex: 3, cfg });
ok(JSON.stringify(a) === JSON.stringify(b), '同一 pid 重复调用结果逐字节一致');

const c = buildTrialPlan({ stimuli, graphIds, layouts: cfg.layouts, pid: 'OTHER', participantIndex: 3, cfg });
ok(JSON.stringify(a.trials) !== JSON.stringify(c.trials), '不同 pid 的块内顺序不同');

// ── 5. 分派工具本身 ──
console.log('\n5) 工具函数');
const m = assignLayouts(['g0', 'g1', 'g2', 'g3'], cfg.layouts, 1);
ok(JSON.stringify(m) === JSON.stringify({ g0: 'KK', g1: 'FR', g2: 'FA2', g3: 'LPFD' }),
  'assignLayouts 按 offset 轮转', JSON.stringify(m));
ok(offsetFor(0, 4) === 0 && offsetFor(5, 4) === 1 && offsetFor(4, 4) === 0, 'offsetFor 取模');
ok(hashString('abc') === hashString('abc') && hashString('abc') !== hashString('abd'),
  'hashString 稳定且可区分');

// ── 6. 练习计划 ──
console.log('\n6) 练习计划（题数由 config 推导，仅对 enabled 生效）');
const practiceStimuli = JSON.parse(readFileSync(join(ROOT, 'stimuli/practice.json'), 'utf8')).stimuli;
const { buildPracticePlan } = await import('../src/js/randomize.js');
const p1 = buildPracticePlan({ practiceStimuli, pid: 'P001', cfg });
ok(p1.length === 4, 'T2 关闭 → 练习 4 题', `实际 ${p1.length}`);
ok(p1.every((t) => t.task === 'T1' || t.task === 'T4'), '练习只含启用的任务');

const cfgT2 = { ...cfg, tasks: { ...cfg.tasks, T2: { enabled: true } } };
const p2 = buildPracticePlan({ practiceStimuli, pid: 'P001', cfg: cfgT2 });
ok(p2.length === 5, 'T2 开启 → 练习 5 题（T1:2 + T4:2 + T2:1）', `实际 ${p2.length}`);
ok(p2.filter((t) => t.task === 'T2').length === 1, 'T2 有独立练习（复用 T1 的图）');
ok(p2.every((t) => t.stimulus.nodes?.length), '每题都带完整的图数据');

// ── 7. offset 来源：实验室 vs 众包 ──
// 🔴 这是曾经的真 bug：只用 localStorage 计数器时，众包每个被试都是全新浏览器
//    → index 恒为 0 → offset 恒为 0 → 「图 → 布局」映射永久固定。
console.log('\n7) offset 来源（实验室共用浏览器 vs 众包独立浏览器）');
{
  const fakeStore = () => {
    const m = {};
    return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
  };

  // 共用浏览器：同一 store 连续跑 N 人
  const shared = fakeStore();
  const sharedCover = {};
  for (let p = 0; p < 16; p++) {
    const pid = `LAB${p}`;
    const idx = getOrAssignParticipantIndex(pid, shared, { source: 'auto' });
    for (const [g, l] of Object.entries(assignLayouts(graphIds, cfg.layouts, offsetFor(idx, 4)))) {
      (sharedCover[g] ||= new Set()).add(l);
    }
  }
  ok(Object.values(sharedCover).every((s) => s.size === 4),
    '实验室（共用浏览器）：每张图都覆盖到全部 4 种布局',
    JSON.stringify(Object.values(sharedCover).map((s) => s.size)));

  // 独立浏览器：每人一个全新 store —— 模拟众包
  const freshCover = {};
  for (let p = 0; p < 40; p++) {
    const store = fakeStore();
    const idx = getOrAssignParticipantIndex(`PRO${p}`, store, { source: 'auto' });
    for (const [g, l] of Object.entries(assignLayouts(graphIds, cfg.layouts, offsetFor(idx, 4)))) {
      (freshCover[g] ||= new Set()).add(l);
    }
  }
  ok(Object.values(freshCover).every((s) => s.size === 4),
    '众包（独立浏览器）：每张图仍覆盖到全部 4 种布局 ← 修掉的那个 bug',
    JSON.stringify(Object.values(freshCover).map((s) => s.size)));

  // 反证：强制用计数器 + 全新 store = 老行为，必然失败
  const brokenCover = {};
  for (let p = 0; p < 16; p++) {
    const store = fakeStore();
    const idx = getOrAssignParticipantIndex(`OLD${p}`, store, { source: 'counter' });
    for (const [g, l] of Object.entries(assignLayouts(graphIds, cfg.layouts, offsetFor(idx, 4)))) {
      (brokenCover[g] ||= new Set()).add(l);
    }
  }
  ok(Object.values(brokenCover).every((s) => s.size === 1),
    '反证：强制 counter + 独立浏览器 → 每张图只见到 1 种布局（这就是修掉前众包会发生的）',
    JSON.stringify(Object.values(brokenCover).map((s) => s.size)));

  // 同一 pid 重复访问必须拿到同一个 offset（刷新后不变）
  const s2 = fakeStore();
  ok(getOrAssignParticipantIndex('X', s2, {}) === getOrAssignParticipantIndex('X', s2, {}),
    '同一 pid 重复访问 offset 固定不变');
}

// 8) 当前实际配置：T4 关闭，T1（感知型）+ T2，共 32 题、3 个练习
{
  const { CONFIG } = await import('../src/js/config.js');
  const plan = buildTrialPlan({
    stimuli, graphIds, layouts: CONFIG.layouts, pid: 'REAL01', participantIndex: 0, cfg: CONFIG,
  });
  const main = plan.trials.filter((x) => x.phase === 'main');
  ok(CONFIG.tasks.T1.wording === 'factual', '当前配置：T1 事实型措辞', CONFIG.tasks.T1.wording);
  ok(main.length === 32, '当前配置：32 个正式题', String(main.length));
  ok(main.filter((x) => x.task === 'T1').length === 16
    && main.filter((x) => x.task === 'T2').length === 16, '当前配置：T1 / T2 各 16');
  ok(!plan.trials.some((x) => x.task === 'T4'), '当前配置：没有 T4');
  const pr = buildPracticePlan({ practiceStimuli, pid: 'REAL01', cfg: CONFIG });
  ok(pr.length === 3, '当前配置：3 个练习', String(pr.length));
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`);
process.exit(failures ? 1 : 0);
