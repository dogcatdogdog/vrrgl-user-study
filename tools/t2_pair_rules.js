/**
 * T2 配对校验规则（纯函数，无 DOM）
 *
 * 同时给本地选点工具和 Node 测试使用。Python 构建脚本里有一份等价实现
 * （tools/build_stimuli.py），两边必须保持同一套阈值和计算口径：
 *   · 度数从 edges 重算，不信任 target_degree
 *   · 只用已发布的 2 位小数坐标
 *   · 欧氏距离，单位是 900×620 画布像素
 *   · near = 两个目标各自到「除这对之外最近节点」距离的较小者
 */

export const T2_RULES = Object.freeze({
  minDegree: 16,
  maxDegree: 35,
  minRatio: 1.25,
  maxRatio: 1.8,
  minPairDistancePx: 25.0,
  minNearestOtherPx: 8.0,
  coordinateDecimals: 2,
  epsilon: 1e-6,
});

/** 两个不同节点的规范化（字典序）配对；非法时抛错。 */
export function canonicalPair(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) {
    throw new Error('配对必须是两个非空节点 id');
  }
  if (a === b) throw new Error('配对的两个节点不能相同');
  return a <= b ? [a, b] : [b, a];
}

/** 从无向边表重算度数。自环/悬空边由构建脚本的 check 负责。 */
export function degreeMapFromEdges(edges) {
  const deg = new Map();
  for (const e of edges || []) {
    deg.set(e.s, (deg.get(e.s) || 0) + 1);
    deg.set(e.t, (deg.get(e.t) || 0) + 1);
  }
  return deg;
}

/** 节点 id → {id,x,y}。 */
export function nodeMap(stimulus) {
  const m = new Map();
  for (const n of stimulus?.nodes || []) m.set(n.id, n);
  return m;
}

function roundCoord(v, decimals = T2_RULES.coordinateDecimals) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** 度数比（高度 / 低度）。 */
export function ratioOf(degA, degB) {
  const hi = Math.max(degA, degB);
  const lo = Math.min(degA, degB);
  return lo > 0 ? hi / lo : Infinity;
}

/**
 * 单个布局下的候选配对指标。
 * @returns {{layout:string,dAB:number|null,nearestOther:number|null,
 *            degrees:Record<string,number>,ratio:number|null,
 *            pass:boolean,reasons:string[]}}
 */
export function computeLayoutMetrics(stimulus, pair, rules = T2_RULES) {
  const reasons = [];
  const layout = stimulus?.layout || '?';
  const pos = nodeMap(stimulus);
  const deg = degreeMapFromEdges(stimulus?.edges);
  const [a, b] = Array.isArray(pair) && pair.length === 2 ? pair : [];
  const out = {
    layout,
    dAB: null,
    nearestOther: null,
    degrees: {},
    ratio: null,
    pass: false,
    reasons,
  };
  if (!a || !b) {
    reasons.push('需要恰好两个节点');
    return out;
  }
  if (!pos.has(a) || !pos.has(b)) {
    reasons.push(`节点不存在：${!pos.has(a) ? a : b}`);
    return out;
  }
  const da = deg.get(a) || 0;
  const db = deg.get(b) || 0;
  out.degrees = { [a]: da, [b]: db };
  out.ratio = ratioOf(da, db);

  const pa = pos.get(a);
  const pb = pos.get(b);
  out.dAB = Math.hypot(
    roundCoord(pa.x) - roundCoord(pb.x),
    roundCoord(pa.y) - roundCoord(pb.y),
  );

  let nearest = Infinity;
  for (const n of stimulus.nodes || []) {
    if (n.id === a || n.id === b) continue;
    const nx = roundCoord(n.x);
    const ny = roundCoord(n.y);
    nearest = Math.min(nearest, Math.hypot(roundCoord(pa.x) - nx, roundCoord(pa.y) - ny));
    nearest = Math.min(nearest, Math.hypot(roundCoord(pb.x) - nx, roundCoord(pb.y) - ny));
  }
  out.nearestOther = Number.isFinite(nearest) ? nearest : Infinity;

  if (out.dAB < rules.minPairDistancePx - rules.epsilon) {
    reasons.push(`${layout}: 两目标距离 ${out.dAB.toFixed(1)} < ${rules.minPairDistancePx}`);
  }
  if (out.nearestOther < rules.minNearestOtherPx - rules.epsilon) {
    reasons.push(`${layout}: 目标到最近其他节点 ${out.nearestOther.toFixed(1)} < ${rules.minNearestOtherPx}`);
  }
  out.pass = reasons.length === 0;
  return out;
}

/**
 * 校验一组候选配对（两个节点）。
 *
 * @param {object} args
 * @param {Record<string, object>} args.recordsByLayout 四个布局的刺激记录
 * @param {string[]} args.picks 候选节点（0/1/2 个；非 2 个时视为未完成）
 * @param {string[]} args.layouts 期望的布局顺序
 * @param {object} [args.rules]
 * @returns {{status:'draft'|'invalid'|'valid',valid:boolean,reasons:string[],
 *            perLayout:object[],degrees:Record<string,number>,ratio:number|null,
 *            answer:string|null}}
 */
export function validateCandidate({ recordsByLayout, picks, layouts, rules = T2_RULES }) {
  const reasons = [];
  const chosen = Array.isArray(picks) ? picks.filter(Boolean) : [];
  if (chosen.length !== 2) {
    return {
      status: 'draft', valid: false, reasons: ['请选择两个节点'], perLayout: [],
      degrees: {}, ratio: null, answer: null,
    };
  }

  let pair;
  try {
    pair = canonicalPair(chosen[0], chosen[1]);
  } catch (e) {
    return {
      status: 'invalid', valid: false, reasons: [e.message], perLayout: [],
      degrees: {}, ratio: null, answer: null,
    };
  }

  const missing = (layouts || []).filter((l) => !recordsByLayout?.[l]);
  if (missing.length) {
    return {
      status: 'invalid', valid: false, reasons: [`缺少布局记录：${missing.join(', ')}`],
      perLayout: [], degrees: {}, ratio: null, answer: null,
    };
  }

  // 四个布局的拓扑必须一致；否则不是同一道题
  const first = recordsByLayout[layouts[0]];
  const firstIds = new Set((first.nodes || []).map((n) => n.id));
  const firstEdges = JSON.stringify(first.edges || []);
  for (const layout of layouts) {
    const rec = recordsByLayout[layout];
    const ids = new Set((rec.nodes || []).map((n) => n.id));
    if (ids.size !== firstIds.size || [...firstIds].some((id) => !ids.has(id))) {
      reasons.push(`${layout}: 节点集合与其他布局不一致`);
    }
    if (JSON.stringify(rec.edges || []) !== firstEdges) {
      reasons.push(`${layout}: 边集合与其他布局不一致`);
    }
  }

  const deg = degreeMapFromEdges(first.edges);
  const da = deg.get(pair[0]) || 0;
  const db = deg.get(pair[1]) || 0;
  const degrees = { [pair[0]]: da, [pair[1]]: db };
  const ratio = ratioOf(da, db);

  if (da < rules.minDegree || db < rules.minDegree) {
    reasons.push(`两节点度数都要 ≥ ${rules.minDegree}（当前 ${da}/${db}）`);
  }
  if (da > rules.maxDegree || db > rules.maxDegree) {
    reasons.push(`两节点度数都要 ≤ ${rules.maxDegree}（当前 ${da}/${db}）`);
  }
  if (ratio < rules.minRatio - rules.epsilon || ratio > rules.maxRatio + rules.epsilon) {
    reasons.push(`度数比 ${ratio.toFixed(3)} 不在 [${rules.minRatio}, ${rules.maxRatio}]`);
  }

  const perLayout = (layouts || []).map((layout) => {
    const m = computeLayoutMetrics(recordsByLayout[layout], pair, rules);
    for (const r of m.reasons) reasons.push(r);
    return m;
  });

  const answer = da >= db ? pair[0] : pair[1];
  const valid = reasons.length === 0;
  return {
    status: chosen.length === 2 ? (valid ? 'valid' : 'invalid') : 'draft',
    valid,
    reasons,
    perLayout,
    degrees,
    ratio,
    answer,
  };
}

/** 同图其他配对（实际生效的 pair）的共享节点/重复配对提醒。 */
export function sharedNodeWarnings(pair, otherPairs) {
  const warnings = [];
  if (!Array.isArray(pair) || pair.length !== 2) return warnings;
  const [a, b] = pair;
  for (const other of otherPairs || []) {
    if (!Array.isArray(other) || other.length !== 2) continue;
    if (other[0] === a && other[1] === b) {
      warnings.push(`与另一组配对完全相同：${a}, ${b}`);
    } else if (other.includes(a) || other.includes(b)) {
      warnings.push(`与另一组配对共用节点：${other.join(', ')}`);
    }
  }
  return warnings;
}

/** 导出到覆盖文件的 criteria（与 Python expected_override_criteria 对齐）。 */
export function criteriaFromConfig(cfg, rules = T2_RULES) {
  return {
    layouts: [...(cfg?.layouts || [])],
    canvas: {
      width: cfg?.canvas?.width,
      height: cfg?.canvas?.height,
    },
    normalization: cfg?.normalization === 'bounding_box' ? 'bounding_box' : 'median_edge_length',
    min_degree: rules.minDegree,
    max_degree: rules.maxDegree,
    min_degree_ratio: rules.minRatio,
    max_degree_ratio: rules.maxRatio,
    min_pair_distance_px: rules.minPairDistancePx,
    min_target_to_nearest_other_px: rules.minNearestOtherPx,
    degree_source: 'edges',
    coordinate_decimals: rules.coordinateDecimals,
  };
}

/** 从 stimulus_id 解析配对索引和布局；失败返回 null。 */
export function parsePairStimulusId(stimulusId, layouts) {
  const escaped = (layouts || []).map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!escaped.length) return null;
  const re = new RegExp(`_p(\\d+)_(${escaped.join('|')})$`);
  const m = String(stimulusId || '').match(re);
  return m ? { index: Number(m[1]), layout: m[2] } : null;
}

/**
 * 把 T2 刺激按 (graph_id, pair index) 分组，并检查结构完整性。
 * @returns {{groups:Array<{graphId:string,index:number,recordsByLayout:object,
 *            original:string[]}>, errors:string[]}}
 */
export function groupT2Records(stimuli, layouts) {
  const errors = [];
  const byKey = new Map();
  const order = [];
  for (const s of stimuli || []) {
    if (s.task !== 'T2') continue;
    const parsed = parsePairStimulusId(s.stimulus_id, layouts);
    if (!parsed) {
      errors.push(`无法解析 stimulus_id：${s.stimulus_id}`);
      continue;
    }
    const key = `${s.graph_id}|${parsed.index}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        graphId: s.graph_id,
        index: parsed.index,
        recordsByLayout: {},
        original: null,
      });
      order.push(key);
    }
    const g = byKey.get(key);
    if (g.recordsByLayout[parsed.layout]) {
      errors.push(`${key}: 布局 ${parsed.layout} 重复`);
    }
    g.recordsByLayout[parsed.layout] = s;
  }

  const groups = order.map((key) => {
    const g = byKey.get(key);
    const missing = (layouts || []).filter((l) => !g.recordsByLayout[l]);
    if (missing.length) errors.push(`${key}: 缺少布局 ${missing.join(', ')}`);
    const first = g.recordsByLayout[layouts[0]] || Object.values(g.recordsByLayout)[0];
    if (first) {
      const pair = Array.isArray(first.pair) ? first.pair : first.targets;
      if (Array.isArray(pair) && pair.length === 2) g.original = canonicalPair(pair[0], pair[1]);
      else errors.push(`${key}: 原始配对不是两个节点`);
      for (const layout of layouts) {
        const rec = g.recordsByLayout[layout];
        if (!rec) continue;
        const p = Array.isArray(rec.pair) ? rec.pair : rec.targets;
        if (JSON.stringify(p) !== JSON.stringify(pair)) {
          errors.push(`${key}: ${layout} 的配对与其他布局不一致`);
        }
      }
    }
    return g;
  });

  groups.sort((x, y) => (x.graphId === y.graphId ? x.index - y.index : String(x.graphId).localeCompare(String(y.graphId))));
  return { groups, errors };
}
