/**
 * Latin square 分派与试次顺序（docs/01 §8.1）
 *
 * 🔴 最容易写错的一环。约束：
 *   ① 每个被试对每张图只看到【一种】布局
 *   ② 每种布局恰好覆盖 6 张图（24 / 4），每 (布局 × 度档) 单元 2 张
 *   ③ 跨被试看，每张图在每种布局下出现的总次数相等
 *
 * 🔴 trial 数提醒：T1 与 T4 **各跑一次完整的 24 张图**，共用同一份「图 → 布局」映射
 *   ⇒ 每任务 24 trial，**共 48**。
 *   若把「每张图只出现一次」读成全局约束，会得出 16 —— 正好是正确值的一半，且不会报错。
 */

/** 跨进程稳定的字符串哈希（不能用内置 hash，见 docs/01 §2.2 的确定性要求）。 */
export function hashString(str) {
  let h = 2166136261 >>> 0;              // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 —— 小而稳的确定性 PRNG。 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates，用给定 rng —— 确定性。 */
export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 取（或分配）被试序号，用于均衡 offset。
 *
 * 🔴 **这里曾经有一个致命 bug**（2026-09-28 修）：
 *    原实现只用 localStorage 里的计数器。实验室共用一台机器时没问题
 *    （计数器递增 → offset 0,1,2,3 轮转），但**众包场景下每个被试的浏览器
 *    都是全新的、localStorage 是空的** → 每个人都拿到 index 0 → offset 恒为 0
 *    → 「图 → 布局」映射**永远固定**。
 *
 *    后果（实测模拟，16 人）：64 个 (图,布局) 组合只出现 **16 个**，
 *    且每个布局被**永久绑死**在固定的 4 张图上 ——
 *    LPFD 的差异与那 4 张图的难度完全混淆，**实验无法解释**。
 *
 *    注意 `docs/01 §8.1` 预警过这一条（「若走 Prolific，可用『已完成人数 mod 4』」），
 *    但那需要一个服务端计数；本地计数器在众包上等于恒定偏移。
 *
 * 现方案 `auto` —— 按「这台浏览器之前有没有别的被试」自动选来源：
 *   · **共用浏览器（实验室）** → 计数器，offset 精确轮转
 *   · **独立浏览器（众包）** → `hash(pid) % n`，跨被试均衡且无需服务端
 *
 * 两者都保证同一条不变式：**没有任何一张图被永久绑定到某一种布局**。
 */
export function getOrAssignParticipantIndex(pid, store, opts = {}) {
  const { source = 'auto' } = opts;
  const COUNTER = 'vrrgl.counter';
  const MAP = 'vrrgl.pidIndex';

  // 大模数：offsetFor 会再取模，这里避免小模数带来的碰撞偏见
  const hashIndex = () => hashString(pid) % 1_000_003;

  try {
    const map = JSON.parse(store.getItem(MAP) || '{}');
    if (map[pid] !== undefined) return map[pid];      // 同一 pid 重复访问 → 固定不变

    const sharedBrowser = Object.keys(map).length > 0;   // 这台浏览器已见过别的被试
    let index;

    if (source === 'hash' || (source === 'auto' && !sharedBrowser)) {
      index = hashIndex();
    } else {
      index = parseInt(store.getItem(COUNTER) || '0', 10);
      store.setItem(COUNTER, String(index + 1));
    }

    map[pid] = index;
    store.setItem(MAP, JSON.stringify(map));
    return index;
  } catch {
    return hashIndex();                               // localStorage 不可用 → 哈希
  }
}

/** 本被试的 offset（0..3）。 */
export function offsetFor(participantIndex, nLayouts) {
  return ((participantIndex % nLayouts) + nLayouts) % nLayouts;
}

/**
 * 🔴 把图按【度档】分组排序 —— 这是让「每 (布局 × 度档) 单元恰好 2 张」成立的前提。
 *
 * 若按 graph_id 字典序排（case1_low_0, case1_mid_3, case2_high_0, …），
 * 度档在索引上是乱的，`(i+offset)%4` 分完之后每个单元会是 1/2/3 张而不是 2 张 ——
 * 实测过：{"LPFD|high":1, "KK|high":3, "FR|low":3, …}。
 *
 * 按档排（低 8 张 → 高 8 张）后，每一档的 8 个索引 i..i+7 都恰好
 * 覆盖 4 种布局各 2 次（因为 8 = 2 × 4）。
 */
export function orderGraphIds(graphIds, bandOf, bandOrder = ['low', 'high']) {
  const byBand = {};
  for (const g of graphIds) (byBand[bandOf[g]] ||= []).push(g);
  const out = [];
  for (const b of bandOrder) out.push(...(byBand[b] || []).slice().sort());
  // 未归入已知档的（不该出现）追加在后，不静默丢弃
  const known = new Set(out);
  for (const g of graphIds) if (!known.has(g)) out.push(g);
  return out;
}

/**
 * 产出「图 → 布局」映射。**只有一份**，T1 与 T4 共用（docs/01 §8.1）。
 *
 * ⚠️ `graphIds` 必须是 orderGraphIds() 排过序的，否则 (布局 × 度档) 平衡不成立。
 *
 * @param {string[]} graphIds 16 张图（按度档排好），顺序即索引 i
 * @param {string[]} layouts  ['LPFD','KK','FR','FA2']
 * @param {number}   offset   本被试的偏移
 * @returns {Record<string,string>}
 */
export function assignLayouts(graphIds, layouts, offset) {
  const out = {};
  graphIds.forEach((g, i) => {
    out[g] = layouts[(i + offset) % layouts.length];
  });
  return out;
}

/** 把一个刺激改造成另一个任务用的副本（不改原对象）。 */
export function asTask(stim, task) {
  return {
    ...stim,
    task,
    stimulus_id: String(stim.stimulus_id || '').replace(/^T[124]_/, `${task}_`),
  };
}

/** 按图分组的刺激索引：键为 `${graphId}|${layout}`（分隔符必须保持一致）。 */
export function indexStimuli(stimuli) {
  const idx = {};
  for (const s of stimuli) {
    const k = `${s.graph_id}|${s.layout}`;
    (idx[k] ||= {})[s.task] = s;
  }
  return idx;
}

/**
 * 构造正式 trial 列表。
 *
 * - T1 / T4 各 16 条，共用同一 offset ⇒ 同一张图在两个任务里是**同一种布局**
 * - 任务分块（先 T1 后 T4，或反之，按 pid 交替），块内用 pid 派生种子随机
 * - attention check 插在主试次之间（docs/01 §5）
 */
export function buildTrialPlan({ stimuli, graphIds: rawGraphIds, layouts, pid, participantIndex,
                                 offset: forcedOffset, cfg, forcedLayout = null }) {
  // 按度档排序 —— 见 orderGraphIds 的说明，这是单元平衡的前提。
  // 档位顺序从 config 取（现在是 low/high 两档，不能写死三档）
  const bandOf = {};
  for (const s of stimuli) bandOf[s.graph_id] = s.degree_level;
  // T1 图集只包含有 T1 记录的图；T2 使用独立的图集
  const t1Set = new Set(stimuli.filter((s) => s.task === 'T1').map((s) => s.graph_id));
  const graphIds = orderGraphIds(rawGraphIds.filter((g) => t1Set.has(g)), bandOf, cfg.degreeLevels);

  // 复测模式：强制所有图使用同一种布局（不等于 Latin square，offset 无意义）
  if (forcedLayout && !layouts.includes(forcedLayout)) {
    throw new Error(`[randomize] forcedLayout "${forcedLayout}" 不在布局列表里`);
  }
  // 编号表预先分派了 offset（精确均衡）；没有时退回按被试序号取模
  const offset = forcedLayout ? 0 : ((typeof forcedOffset === 'number')
    ? ((forcedOffset % layouts.length) + layouts.length) % layouts.length
    : offsetFor(participantIndex, layouts.length));
  const mapping = forcedLayout
    ? Object.fromEntries(graphIds.map((g) => [g, forcedLayout]))
    : assignLayouts(graphIds, layouts, offset);
  // T2 使用独立的图集（8 张较大图），布局单独轮转；每个被试每布局 2 张图
  // 保持刺激生成顺序（不是字典序）：case2/case1 需要相隔 4 个索引以平衡布局
  const t2GraphIds = [...new Set(stimuli.filter((s) => s.task === 'T2').map((s) => s.graph_id))];
  const t2Mapping = forcedLayout
    ? Object.fromEntries(t2GraphIds.map((g) => [g, forcedLayout]))
    : Object.fromEntries(t2GraphIds.map((g, i) => [g, layouts[(i + offset) % layouts.length]]));
  const idx = indexStimuli(stimuli);
  const enabled = Object.entries(cfg.tasks).filter(([, t]) => t.enabled).map(([k]) => k);

  const rng = makeRng(hashString(pid + '|order'));
  const blocks = {};

  for (const task of enabled) {
    if (task === 'T2') continue;   // T2 的图集与 T1 相同，但题面不同 —— 见下
    const list = [];
    for (const g of graphIds) {
      const layout = mapping[g];
      const s = idx[`${g}|${layout}`]?.[task];
      if (!s) throw new Error(`[randomize] 找不到 ${task} 刺激：${g} / ${layout}`);
      list.push({ task, stimulus: s, graphId: g, layout, phase: 'main' });
    }
    blocks[task] = shuffle(list, rng);
  }

  if (enabled.includes('T2')) {
    if (cfg.tasks.T2?.mode === 'compare') {
      // T2 = 接近对比较：使用 stimulus 里预生成的 T2 记录（每图可能有多对）
      const list = stimuli
        .filter((s) => s.task === 'T2' && s.layout === t2Mapping[s.graph_id])
        .map((s) => ({ task: 'T2', stimulus: s, graphId: s.graph_id, layout: s.layout, phase: 'main' }));
      if (!list.length) throw new Error('[randomize] 找不到 T2 接近对刺激');
      blocks.T2 = shuffle(list, rng);
    } else {
      // 旧版 T2（计数）：复用 T1 的图与目标节点，但派生成独立对象
      const list = [];
      for (const g of graphIds) {
        const layout = mapping[g];
        const s = idx[`${g}|${layout}`]?.T1;
        if (!s) throw new Error(`[randomize] 找不到 T2 用的刺激：${g} / ${layout}`);
        list.push({ task: 'T2', stimulus: asTask(s, 'T2'), graphId: g, layout, phase: 'main' });
      }
      blocks.T2 = shuffle(list, rng);
    }
  }

  // 块序按 pid 交替
  const order = enabled.filter((t) => blocks[t]);
  if (hashString(pid + '|blockorder') % 2 === 1) order.reverse();

  let trials = [];
  for (const t of order) trials = trials.concat(blocks[t]);

  // attention check 均匀插入（不放在第一题）
  const nCheck = cfg.attentionChecks || 0;
  if (nCheck > 0 && trials.length > nCheck) {
    const withChecks = [];
    const gap = Math.floor(trials.length / (nCheck + 1));
    let ci = 0;
    trials.forEach((tr, i) => {
      if (ci < nCheck && i > 0 && i % gap === 0) {
        withChecks.push({ task: 'ATTENTION', phase: 'attention', checkIndex: ci });
        ci++;
      }
      withChecks.push(tr);
    });
    while (ci < nCheck) { withChecks.push({ task: 'ATTENTION', phase: 'attention', checkIndex: ci }); ci++; }
    trials = withChecks;
  }

  return { offset, mapping, t2Mapping, trials };
}

/**
 * 复测计划：只跑指定的 (图, 任务) 列表，全部使用 items 里给定的布局。
 * items 来自 stimuli/review_errors.json，例如 [{graph_id, task:'T1', layout:'LPFD'}]
 */
export function buildReviewPlan({ stimuli, items, pid }) {
  const idx = indexStimuli(stimuli);
  const trials = [];
  for (const it of items) {
    // T1 与 T2 共用同一份刺激几何；T2 从 T1 派生，保证 stimulus_id/task 正确
    const base = idx[`${it.graph_id}|${it.layout}`]?.T1;
    if (!base) {
      throw new Error(`[randomize] 复测题缺失：${it.graph_id} / ${it.layout}`);
    }
    const stimulus = it.task === 'T2' ? asTask(base, 'T2') : base;
    trials.push({
      task: it.task, stimulus, graphId: it.graph_id, layout: it.layout, phase: 'main',
    });
  }
  const rng = makeRng(hashString(pid + '|redo'));
  const mapping = {};
  for (const it of items) mapping[it.graph_id] = it.layout;
  return { offset: 0, mapping, trials: shuffle(trials, rng) };
}

/** 练习 trial（题数由 config 推导，仅对 enabled 生效 —— docs/01 §3.1）。 */
export function buildPracticePlan({ practiceStimuli, pid, cfg }) {
  const enabled = Object.entries(cfg.tasks).filter(([, t]) => t.enabled).map(([k]) => k);

  const byTask = {};
  for (const s of practiceStimuli) (byTask[s.task] ||= []).push(s);

  // ⚠️ T2 没有独立的练习刺激：它问的是**同一个目标节点**的度数，
  //    所以直接复用 T1 的练习图（题面不同、作答控件不同，图完全一样）。
  //    不做这步的话，T2 开启时被试会在正式试次里第一次遇到「数邻居」——
  //    而 docs/01 §3.1 要求 T2 开启时练习题数为 5。
  // 仅旧版“计数 T2”可复用 T1 练习；compare 版必须有自己的左右节点对
  if (enabled.includes('T2') && cfg.tasks.T2?.mode !== 'compare'
      && !(byTask.T2 || []).length && (byTask.T1 || []).length) {
    byTask.T2 = byTask.T1.map((s) => asTask(s, 'T2'));
  }

  const wanted = enabled
    .flatMap((task) => Array.from({ length: cfg.practiceTrials[task] || 0 }, () => task))
    .filter((t) => (byTask[t] || []).length);

  const rng = makeRng(hashString(pid + '|practice'));
  const out = [];
  const used = {};
  for (const t of shuffle(wanted, rng)) {
    used[t] = used[t] || 0;
    const pool = byTask[t] || [];
    if (used[t] >= pool.length) continue;
    out.push({ task: t, stimulus: pool[used[t]], phase: 'practice' });
    used[t]++;
  }
  return out;
}
