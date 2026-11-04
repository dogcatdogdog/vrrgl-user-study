#!/usr/bin/env node
/**
 * T2 配对规则单测。
 *
 * 运行：node tools/test_t2_rules.mjs
 * 依赖：只读 stimuli/stimuli.json + tools/t2_pair_rules.js，无第三方包。
 */

import { readFileSync } from 'node:fs';
import {
  T2_RULES, canonicalPair, degreeMapFromEdges, computeLayoutMetrics,
  validateCandidate, sharedNodeWarnings, criteriaFromConfig,
  parsePairStimulusId, groupT2Records,
} from './t2_pair_rules.js';

let failures = 0;
function ok(cond, name, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
}

const stimuliDoc = JSON.parse(readFileSync(new URL('../stimuli/stimuli.json', import.meta.url), 'utf-8'));
const stimuli = stimuliDoc.stimuli || [];
const layouts = stimuliDoc.meta?.layouts || ['LPFD', 'KK', 'FR', 'FA2'];
const t2 = stimuli.filter((s) => s.task === 'T2');

console.log('\n1) 当前刺激结构');
{
  const { groups, errors } = groupT2Records(t2, layouts);
  ok(errors.length === 0, '结构无错误', errors.join('; '));
  ok(groups.length === 16, '16 组配对', String(groups.length));
  ok(groups.every((g) => Object.keys(g.recordsByLayout).length === 4), '每组四布局齐全');
  ok(groups.every((g) => g.original && g.original.length === 2), '每组有原始配对');
}

console.log('\n2) 当前 16 组原始配对必须全部通过四布局校验');
{
  const { groups } = groupT2Records(t2, layouts);
  for (const g of groups) {
    const r = validateCandidate({
      recordsByLayout: g.recordsByLayout,
      picks: g.original,
      layouts,
    });
    ok(r.valid, `${g.graphId} p${g.index} 原配对通过`, r.reasons.join('; '));
  }
}

console.log('\n3) canonicalPair');
{
  ok(JSON.stringify(canonicalPair('n9', 'n10')) === '["n10","n9"]', '按字典序排序');
  let threw = false;
  try { canonicalPair('n1', 'n1'); } catch { threw = true; }
  ok(threw, '同一节点被拒绝');
}

console.log('\n4) 合成候选：度数 / 比值 / 几何');
{
  // a、b 两个目标，其余为填充节点；dAB 和 near 可控。
  const make = ({ aDeg, bDeg, dAB = 100, near = 20, layout = 'LPFD' }) => {
    const nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: dAB, y: 0 }];
    const edges = [];
    const nFill = Math.max(aDeg, bDeg, 1) + 1;
    for (let i = 0; i < nFill; i++) {
      nodes.push({ id: `f${i}`, x: 40 + i * 9, y: near });
    }
    // 额外放两个贴近目标的填充点，让 near 可控
    nodes.push({ id: 'na', x: 0, y: near }, { id: 'nb', x: dAB, y: near });
    for (let i = 0; i < aDeg; i++) edges.push({ s: 'a', t: `f${i}` });
    for (let i = 0; i < bDeg; i++) edges.push({ s: 'b', t: `f${i}` });
    return { layout, nodes, edges };
  };
  const recs = (opts) => Object.fromEntries(layouts.map((l) => [l, make({ ...opts, layout: l })]));
  const validate = (opts) => validateCandidate({ recordsByLayout: recs(opts), picks: ['a', 'b'], layouts });

  ok(validate({ aDeg: 20, bDeg: 28 }).valid, '合法候选通过（20/28，dAB=100，near=20）');
  ok(!validate({ aDeg: 15, bDeg: 28 }).valid, '低度方 15 < 16 被拒绝');
  ok(!validate({ aDeg: 36, bDeg: 42 }).valid, '高度方 > 35 被拒绝');
  ok(!validate({ aDeg: 20, bDeg: 23 }).valid, '比值 1.15 < 1.25 被拒绝');
  ok(!validate({ aDeg: 16, bDeg: 30 }).valid, '比值 1.875 > 1.8 被拒绝');
  ok(!validate({ aDeg: 20, bDeg: 28, dAB: 10 }).valid, 'dAB=10 < 25 被拒绝');
  ok(!validate({ aDeg: 20, bDeg: 28, near: 5 }).valid, 'near=5 < 8 被拒绝');
  ok(validate({ aDeg: 20, bDeg: 28, dAB: 25, near: 8 }).valid, '恰好等于阈值应通过（25/8）');
}

console.log('\n5) 缺布局 / 缺节点');
{
  const { groups } = groupT2Records(t2, layouts);
  const g = groups[0];
  const partial = Object.fromEntries(Object.entries(g.recordsByLayout).slice(0, 3));
  ok(!validateCandidate({ recordsByLayout: partial, picks: g.original, layouts }).valid,
    '少一个布局被拒绝');
  ok(!validateCandidate({ recordsByLayout: g.recordsByLayout, picks: ['nope', g.original[1]], layouts }).valid,
    '不存在的节点被拒绝');
}

console.log('\n6) 共享节点 / 重复配对提醒');
{
  ok(sharedNodeWarnings(['n1', 'n2'], [['n2', 'n3']]).length === 1, '共享节点给出提醒');
  ok(sharedNodeWarnings(['n1', 'n2'], [['n1', 'n2']]).some((w) => w.includes('完全相同')), '重复配对给出提醒');
  ok(sharedNodeWarnings(['n1', 'n2'], [['n3', 'n4']]).length === 0, '无关联不提醒');
}

console.log('\n7) stimulus_id 解析（图名含空格/下划线）');
{
  ok(JSON.stringify(parsePairStimulusId('T2_Moviegalaxies - Babel_graph_p0_LPFD', layouts))
    === '{"index":0,"layout":"LPFD"}', '空格图名解析正确');
  ok(JSON.stringify(parsePairStimulusId('T2_GD12-dt_case2_p2_FA2', layouts))
    === '{"index":2,"layout":"FA2"}', '下划线图名解析正确');
  ok(parsePairStimulusId('T1_foo_LPFD', layouts) === null, '非 T2 格式返回 null');
}

console.log('\n8) criteria 与配置一致');
{
  const c = criteriaFromConfig({
    layouts,
    canvas: { width: 900, height: 620 },
    normalization: 'bounding_box',
  });
  ok(c.min_degree === T2_RULES.minDegree && c.min_degree_ratio === T2_RULES.minRatio
    && c.min_pair_distance_px === T2_RULES.minPairDistancePx
    && c.min_target_to_nearest_other_px === T2_RULES.minNearestOtherPx,
  'criteria 阈值与 T2_RULES 一致');
  ok(c.layouts.join(',') === layouts.join(','), 'criteria 布局顺序一致');
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`);
process.exit(failures ? 1 : 0);
