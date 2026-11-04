/**
 * T2 选点复核工具（本地研究用）
 *
 * 用法：
 *   python tools/serve.py
 *   http://127.0.0.1:8000/tools/t2_pair_tool.html
 *
 * 规则：
 *   · 原配对始终以蓝色显示；候选配对以红色描边显示。
 *   · 同一组候选节点会同时套到四种布局；任一布局几何不达标就不允许导出。
 *   · 默认在 LPFD 大图上选点；点击 KK/FR/FA2 缩略图可切换大图。
 *   · 导出 stimuli/t2_overrides_pilot6.json，交给 build_stimuli.py --t2-overrides。
 */

import { CONFIG } from '../src/js/config.js';
import { GraphRenderer } from '../src/js/render.js';
import {
  criteriaFromConfig, groupT2Records, validateCandidate,
  computeLayoutMetrics, degreeMapFromEdges, canonicalPair, sharedNodeWarnings,
} from './t2_pair_rules.js';

const LAYOUTS = CONFIG.layouts;
const STORAGE_KEY = 'vrrgl.t2PairTool.v1';
const EXPORT_NAME = 't2_overrides_pilot6.json';

const state = {
  groups: [],
  byKey: new Map(),
  entries: new Map(),
  renderers: {},
  cards: {},
  activeKey: null,
  activeLayout: 'LPFD',
  fingerprint: '',
  errors: [],
  saveTimer: null,
  bannerTimer: null,
};

const $ = (sel) => document.querySelector(sel);
const keyOf = (g) => `${g.graphId}|${g.index}`;
const entryOf = (g) => state.entries.get(keyOf(g));
const activeGroup = () => state.byKey.get(state.activeKey);
const activeEntry = () => state.entries.get(state.activeKey);

function samePair(a, b) {
  return Array.isArray(a) && Array.isArray(b)
    && a.length === 2 && b.length === 2 && a[0] === b[0] && a[1] === b[1];
}

function canonicalPicks(picks) {
  if (!Array.isArray(picks) || picks.length !== 2) return null;
  try { return canonicalPair(picks[0], picks[1]); } catch { return null; }
}

function ratioText(degrees, pair) {
  if (!pair || pair.length !== 2) return '—';
  const a = degrees?.[pair[0]] ?? 0;
  const b = degrees?.[pair[1]] ?? 0;
  const lo = Math.min(a, b);
  return lo > 0 ? (Math.max(a, b) / lo).toFixed(2) : '—';
}

function answerOf(degrees, pair) {
  if (!pair || pair.length !== 2) return null;
  return (degrees?.[pair[0]] ?? 0) >= (degrees?.[pair[1]] ?? 0) ? pair[0] : pair[1];
}

function fmt(x) {
  return Number.isFinite(x) ? x.toFixed(1) : '—';
}

async function hashText(text) {
  try {
    if (globalThis.crypto?.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* 回退到 FNV */ }
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `fnv-${h.toString(16)}`;
}

// ─────────────────────────── 初始化 ───────────────────────────

async function boot() {
  wireStaticControls();
  renderCriteria();
  try {
    const res = await fetch('../stimuli/stimuli.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const doc = JSON.parse(text);
    state.fingerprint = await hashText(text);

    const { groups, errors } = groupT2Records(doc.stimuli || [], LAYOUTS);
    state.groups = groups;
    state.errors = errors;
    for (const g of groups) {
      state.byKey.set(keyOf(g), g);
      state.entries.set(keyOf(g), {
        original: [...g.original],
        picks: [],
        note: '',
        reviewed: false,
        changed: false,
        validation: null,
      });
    }

    buildCards();
    restoreState();
    syncActiveLayoutClasses();
    renderCriteria();

    const initial = state.activeKey && state.byKey.has(state.activeKey)
      ? state.activeKey
      : (groups[0] ? keyOf(groups[0]) : null);
    if (initial) setActiveKey(initial);
    else showBanner('没有找到 T2 配对记录。', 'error');

    refreshAll();
    if (state.errors.length) {
      showBanner(`stimuli.json 结构有问题：\n${state.errors.join('\n')}`, 'error');
    } else if (state.bannerText) {
      showBanner(state.bannerText, 'info');
    }
  } catch (e) {
    showBanner(
      `无法加载 ../stimuli/stimuli.json：${e.message}\n`
      + '请用 python tools/serve.py 启动本地服务器，再访问 '
      + 'http://127.0.0.1:8000/tools/t2_pair_tool.html',
      'error',
    );
  }
}

function renderCriteria() {
  $('#criteria').textContent = '度数 16–35 · 比值 1.25–1.8 · 四布局 dAB ≥ 25px、near ≥ 8px';
}

function buildCards() {
  const grid = $('#canvas-grid');
  grid.replaceChildren();
  for (const layout of LAYOUTS) {
    const card = document.createElement('div');
    card.className = 'layout-card';
    card.dataset.layout = layout;

    const head = document.createElement('div');
    head.className = 'card-head';
    const title = document.createElement('span');
    title.className = 'card-title';
    title.textContent = layout;
    const hint = document.createElement('span');
    hint.className = 'card-hint';
    hint.textContent = '点击放大';
    head.append(title, hint);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    card.append(head, svg);
    grid.append(card);

    const renderer = new GraphRenderer(svg, CONFIG);
    state.renderers[layout] = renderer;
    state.cards[layout] = { card, hint, svg };

    card.addEventListener('click', () => {
      if (state.activeLayout !== layout) setActiveLayout(layout);
    });
    svg.addEventListener('click', (e) => {
      if (state.activeLayout !== layout) return;
      const id = renderer.nodeAt(e.clientX, e.clientY);
      if (id) applyPick(id);
    });
    svg.addEventListener('mousemove', (e) => {
      if (state.activeLayout !== layout) return;
      updateHover(renderer.nodeAt(e.clientX, e.clientY));
    });
    svg.addEventListener('mouseleave', () => updateHover(null));
  }
  syncActiveLayoutClasses();
}

function wireStaticControls() {
  $('#pair-list').addEventListener('click', (e) => {
    const row = e.target.closest('.pair-row');
    if (row?.dataset.key) setActiveKey(row.dataset.key);
  });
  $('#accept').addEventListener('click', acceptCandidate);
  $('#reset').addEventListener('click', resetToOriginal);
  $('#clear').addEventListener('click', clearPicks);
  $('#next').addEventListener('click', nextUnreviewed);
  $('#reset-view').addEventListener('click', () => state.renderers[state.activeLayout]?.resetView());
  $('#export').addEventListener('click', exportOverrides);
  $('#note').addEventListener('input', (e) => {
    const entry = activeEntry();
    if (!entry) return;
    entry.note = e.target.value;
    saveState();
  });
}

// ─────────────────────────── 视图状态 ───────────────────────────

function syncActiveLayoutClasses() {
  for (const layout of LAYOUTS) {
    const c = state.cards[layout];
    if (!c) continue;
    const on = layout === state.activeLayout;
    c.card.classList.toggle('active', on);
    c.hint.textContent = on ? '选点' : '点击放大';
  }
}

function setActiveLayout(layout) {
  if (!LAYOUTS.includes(layout) || layout === state.activeLayout) return;
  state.renderers[state.activeLayout]?.resetView();
  state.activeLayout = layout;
  syncActiveLayoutClasses();
  drawAll();
  saveState();
}

function setActiveKey(key) {
  if (!state.byKey.has(key)) return;
  const changed = state.activeKey !== key;
  state.activeKey = key;
  // 换到另一组配对时回到 LPFD 大图（用户的工作流是在 LPFD 上选点）；
  // 同一组内切换缩略图不受影响。
  if (changed) state.activeLayout = 'LPFD';
  for (const layout of LAYOUTS) state.renderers[layout]?.resetView();
  syncActiveLayoutClasses();
  drawAll();
  refreshAll();
  saveState();
}

function drawAll() {
  const g = activeGroup();
  const entry = activeEntry();
  if (!g || !entry) return;
  for (const layout of LAYOUTS) {
    const renderer = state.renderers[layout];
    const rec = g.recordsByLayout[layout];
    if (!renderer) continue;
    if (!rec) { renderer.clear?.(); continue; }
    renderer.draw(rec, { targets: g.original, selected: entry.picks });
  }
}

function updateHover(id) {
  const el = $('#hover-status');
  const g = activeGroup();
  if (!g) return;
  if (!id) {
    el.textContent = '把鼠标移到节点上查看 ID 和度数';
    return;
  }
  const rec = g.recordsByLayout[state.activeLayout] || Object.values(g.recordsByLayout)[0];
  const deg = degreeMapFromEdges(rec?.edges || []);
  el.textContent = `${id} · deg ${deg.get(id) ?? 0}`;
}

// ─────────────────────────── 选点 ───────────────────────────

function applyPick(id) {
  const g = activeGroup();
  const entry = activeEntry();
  if (!g || !entry) return;
  const i = entry.picks.indexOf(id);
  if (i >= 0) entry.picks.splice(i, 1);
  else if (entry.picks.length < 2) entry.picks.push(id);
  else entry.picks = [entry.picks[1], id];
  entry.reviewed = false;
  recomputeEntry(entry, g);
  drawAll();
  refreshAll();
  saveState();
}

function recomputeEntry(entry, group) {
  if (entry.picks.length === 2) {
    entry.validation = validateCandidate({
      recordsByLayout: group.recordsByLayout,
      picks: entry.picks,
      layouts: LAYOUTS,
    });
  } else {
    entry.validation = null;
  }
  const cand = canonicalPicks(entry.picks);
  entry.changed = !!cand && !samePair(cand, group.original);
}

function acceptCandidate() {
  const g = activeGroup();
  const entry = activeEntry();
  if (!g || !entry || entry.picks.length !== 2 || !entry.validation?.valid) return;
  entry.reviewed = true;
  recomputeEntry(entry, g);
  refreshAll();
  saveState();
}

function resetToOriginal() {
  const g = activeGroup();
  const entry = activeEntry();
  if (!g || !entry) return;
  entry.picks = [...g.original];
  entry.reviewed = true;
  recomputeEntry(entry, g);
  drawAll();
  refreshAll();
  saveState();
}

function clearPicks() {
  const g = activeGroup();
  const entry = activeEntry();
  if (!g || !entry) return;
  entry.picks = [];
  entry.reviewed = false;
  recomputeEntry(entry, g);
  drawAll();
  refreshAll();
  saveState();
}

function nextUnreviewed() {
  if (!state.groups.length) return;
  const idx = state.groups.findIndex((g) => keyOf(g) === state.activeKey);
  const ordered = idx >= 0
    ? [...state.groups.slice(idx + 1), ...state.groups.slice(0, idx + 1)]
    : state.groups;
  const next = ordered.find((g) => !entryOf(g)?.reviewed);
  if (!next) {
    showBanner('全部配对都已复核。', 'ok');
    return;
  }
  if (keyOf(next) === state.activeKey) {
    showBanner('当前这组是最后一组未复核。', 'info');
    return;
  }
  setActiveKey(keyOf(next));
}

// ─────────────────────────── 渲染面板 ───────────────────────────

function refreshAll() {
  refreshSidebar();
  refreshDetails();
  refreshProgress();
  refreshExportButton();
}

function statusText(entry) {
  if (entry.reviewed) return entry.changed ? '已修改' : '原样';
  if (entry.picks.length === 2) return entry.validation?.valid ? '待确认' : '无效';
  if (entry.picks.length === 1) return '已选 1';
  return '未复核';
}

function statusClass(entry) {
  if (entry.reviewed) return entry.changed ? 'changed' : 'original';
  if (entry.picks.length === 2) return entry.validation?.valid ? 'draft' : 'invalid';
  if (entry.picks.length === 1) return 'draft';
  return 'unreviewed';
}

function refreshSidebar() {
  const list = $('#pair-list');
  list.replaceChildren();
  let lastGraph = null;
  let block = null;
  for (const g of state.groups) {
    const entry = entryOf(g);
    if (!entry) continue;
    if (g.graphId !== lastGraph) {
      block = document.createElement('div');
      block.className = 'graph-block';
      const t = document.createElement('div');
      t.className = 'graph-title';
      t.textContent = g.graphId;
      block.append(t);
      list.append(block);
      lastGraph = g.graphId;
    }
    const row = document.createElement('div');
    row.className = 'pair-row' + (keyOf(g) === state.activeKey ? ' active' : '');
    row.dataset.key = keyOf(g);
    row.title = entry.note || '';

    const label = document.createElement('span');
    label.className = 'pair-label';
    label.textContent = `p${g.index}`;

    const ids = document.createElement('span');
    ids.className = 'pair-ids';
    const cand = canonicalPicks(entry.picks);
    ids.textContent = entry.changed && cand
      ? `${cand.join(', ')} ← ${g.original.join(', ')}`
      : g.original.join(', ');

    const chip = document.createElement('span');
    chip.className = `chip ${statusClass(entry)}`;
    chip.textContent = statusText(entry);

    row.append(label, ids, chip);
    block.append(row);
  }
}

function refreshDetails() {
  const g = activeGroup();
  const entry = activeEntry();
  if (!g || !entry) return;

  const rec0 = g.recordsByLayout[LAYOUTS[0]] || Object.values(g.recordsByLayout)[0];
  const deg = degreeMapFromEdges(rec0?.edges || []);
  const original = g.original;

  $('#pair-title').textContent = `${g.graphId} · p${g.index} · ${rec0?.nodes?.length ?? '?'} 个节点`;
  const od = { [original[0]]: deg.get(original[0]) ?? 0, [original[1]]: deg.get(original[1]) ?? 0 };
  const cand = canonicalPicks(entry.picks);
  const cd = cand
    ? { [cand[0]]: deg.get(cand[0]) ?? 0, [cand[1]]: deg.get(cand[1]) ?? 0 }
    : null;

  const summary = $('#pair-summary');
  summary.replaceChildren();
  const oldLine = document.createElement('div');
  oldLine.className = 'pair-old';
  oldLine.textContent = `原配对：${original.join(', ')}（deg ${od[original[0]]} / ${od[original[1]]}，`
    + `比值 ${ratioText(od, original)}，答案 ${answerOf(od, original)}）`;
  const nowLine = document.createElement('div');
  nowLine.className = 'pair-now';
  if (!entry.picks.length) {
    nowLine.textContent = '候选：未选点（原配对以蓝色显示）';
  } else if (entry.picks.length === 1) {
    const id = entry.picks[0];
    nowLine.textContent = `候选：已选 ${id}（deg ${deg.get(id) ?? 0}），再选一个节点`;
  } else if (cd) {
    nowLine.textContent = `候选：${cand.join(', ')}（deg ${cd[cand[0]]} / ${cd[cand[1]]}，`
      + `比值 ${ratioText(cd, cand)}，答案 ${answerOf(cd, cand)}）`
      + (entry.changed ? ' · 已修改' : ' · 与原配对相同');
  } else {
    nowLine.textContent = '候选：两个节点不能相同';
  }
  summary.append(oldLine, nowLine);

  renderMetrics(g, entry, original, cand);
  renderReasons(entry);
  renderWarnings(g, entry, cand);

  const note = $('#note');
  if (document.activeElement !== note) note.value = entry.note || '';

  $('#accept').disabled = !(entry.picks.length === 2 && entry.validation?.valid);
}

function renderMetrics(g, entry, original, cand) {
  const root = $('#metrics');
  root.replaceChildren();
  const table = document.createElement('table');
  table.className = 'metrics';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const text of ['布局', '原 dAB', '原 near', '候选 dAB', '候选 near', '候选结果']) {
    const th = document.createElement('th');
    th.textContent = text;
    hr.append(th);
  }
  thead.append(hr);
  const tbody = document.createElement('tbody');

  for (const layout of LAYOUTS) {
    const rec = g.recordsByLayout[layout];
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = layout;
    tr.append(name);
    if (!rec) {
      for (let i = 0; i < 5; i++) {
        const td = document.createElement('td');
        td.textContent = '缺少记录';
        tr.append(td);
      }
      tbody.append(tr);
      continue;
    }
    const om = computeLayoutMetrics(rec, original);
    const cm = cand ? computeLayoutMetrics(rec, cand) : null;

    const cells = [
      fmt(om.dAB),
      fmt(om.nearestOther),
      cm ? fmt(cm.dAB) : '—',
      cm ? fmt(cm.nearestOther) : '—',
    ];
    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    const verdict = document.createElement('td');
    if (!cm) {
      verdict.textContent = '—';
    } else {
      verdict.textContent = cm.pass ? '通过' : '失败';
      verdict.className = cm.pass ? 'pass' : 'fail';
    }
    tr.append(verdict);
    tbody.append(tr);
  }

  table.append(thead, tbody);
  root.append(table);
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = 'dAB / near 单位是 900×620 画布像素；候选必须四种布局全部通过。';
  root.append(note);
}

function renderReasons(entry) {
  const el = $('#reasons');
  if (entry.picks.length === 2 && entry.validation && !entry.validation.valid) {
    el.textContent = entry.validation.reasons.join('\n');
  } else if (entry.picks.length === 1) {
    el.textContent = '再选一个节点后自动校验。';
  } else {
    el.textContent = '';
  }
}

function renderWarnings(g, entry, cand) {
  const el = $('#warnings');
  const warnings = [];
  // 只对“改过”的配对提示共享/重复；原配方本来就允许少数配对共用节点。
  if (cand && entry.changed) {
    const others = state.groups
      .filter((x) => x.graphId === g.graphId && x.index !== g.index)
      .map((x) => {
        const e = entryOf(x);
        return e && e.picks.length === 2 ? canonicalPicks(e.picks) : x.original;
      });
    warnings.push(...sharedNodeWarnings(cand, others));
  }
  if (entry.changed && !entry.note.trim()) {
    warnings.push('修改过的配对建议填写备注（审计用）。');
  }
  el.textContent = warnings.join('\n');
}

function refreshProgress() {
  const total = state.groups.length;
  const reviewed = [...state.entries.values()].filter((e) => e.reviewed).length;
  const changed = [...state.entries.values()].filter((e) => e.reviewed && e.changed).length;
  $('#progress').textContent = `已复核 ${reviewed}/${total} · 已修改 ${changed}`;
}

function exportCheck() {
  if (state.errors.length) return { ok: false, msg: 'stimuli.json 结构有错误，先修复再导出' };
  const reviewed = [];
  for (const g of state.groups) {
    const entry = entryOf(g);
    if (!entry) continue;
    if (entry.picks.length === 2) {
      const v = validateCandidate({
        recordsByLayout: g.recordsByLayout,
        picks: entry.picks,
        layouts: LAYOUTS,
      });
      if (!v.valid) {
        return { ok: false, msg: `${g.graphId} p${g.index} 候选无效：${v.reasons.join('；')}` };
      }
    }
    if (entry.reviewed) {
      if (entry.picks.length !== 2) {
        return { ok: false, msg: `${g.graphId} p${g.index} 已确认但没有两个点` };
      }
      reviewed.push(g);
    }
  }
  if (!reviewed.length) return { ok: false, msg: '至少复核一组后再导出' };
  return { ok: true, reviewed };
}

function refreshExportButton() {
  const check = exportCheck();
  const btn = $('#export');
  btn.disabled = !check.ok;
  btn.title = check.ok ? `导出 ${check.reviewed.length} 组已复核配对` : check.msg;
  $('#next').disabled = state.groups.every((g) => entryOf(g)?.reviewed);
}

// ─────────────────────────── 导出 ───────────────────────────

function exportOverrides() {
  const check = exportCheck();
  if (!check.ok) {
    showBanner(check.msg, 'error');
    return;
  }
  const pairs = [];
  for (const g of state.groups) {
    const entry = entryOf(g);
    if (!entry?.reviewed) continue;
    const pair = canonicalPicks(entry.picks);
    if (!pair) {
      showBanner(`${g.graphId} p${g.index} 没有有效的两个节点`, 'error');
      return;
    }
    const v = validateCandidate({
      recordsByLayout: g.recordsByLayout,
      picks: pair,
      layouts: LAYOUTS,
    });
    if (!v.valid) {
      showBanner(`${g.graphId} p${g.index} 候选无效：${v.reasons.join('；')}`, 'error');
      return;
    }
    pairs.push({
      graph_id: g.graphId,
      index: g.index,
      original: [...g.original],
      pair,
      changed: !samePair(pair, g.original),
      note: entry.note.trim(),
    });
  }

  const doc = {
    version: '1.0',
    created_at: new Date().toISOString(),
    criteria: criteriaFromConfig(CONFIG),
    pairs,
  };
  const blob = new Blob([`${JSON.stringify(doc, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = EXPORT_NAME;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  showBanner(`已导出 ${pairs.length} 组。请把 ${EXPORT_NAME} 保存到 stimuli/ 目录，再运行构建脚本。`, 'ok');
}

// ─────────────────────────── 本地持久化 ───────────────────────────

function saveState() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    const entries = {};
    for (const [key, e] of state.entries) {
      entries[key] = {
        original: e.original,
        picks: e.picks,
        note: e.note,
        reviewed: e.reviewed,
      };
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        fingerprint: state.fingerprint,
        activeKey: state.activeKey,
        activeLayout: state.activeLayout,
        entries,
      }));
    } catch { /* localStorage 不可用时静默；导出文件才是权威 */ }
  }, 200);
}

function restoreState() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return;
  }
  if (!data || data.version !== 1) return;

  if (data.fingerprint && data.fingerprint !== state.fingerprint) {
    state.bannerText = 'stimuli.json 已变化：只恢复原配对仍匹配的条目，其余需要重新复核。';
  }

  for (const g of state.groups) {
    const saved = data.entries?.[keyOf(g)];
    if (!saved) continue;
    if (JSON.stringify(saved.original) !== JSON.stringify(g.original)) continue;

    const entry = entryOf(g);
    const nodeIds = new Set(
      Object.values(g.recordsByLayout).flatMap((r) => (r.nodes || []).map((n) => n.id)),
    );
    entry.picks = Array.isArray(saved.picks)
      ? saved.picks.filter((id) => nodeIds.has(id)).slice(0, 2)
      : [];
    entry.note = typeof saved.note === 'string' ? saved.note : '';
    entry.reviewed = !!saved.reviewed;
    recomputeEntry(entry, g);
    if (entry.reviewed && (entry.picks.length !== 2 || !entry.validation?.valid)) {
      entry.reviewed = false;
    }
  }

  if (data.activeLayout && LAYOUTS.includes(data.activeLayout)) state.activeLayout = data.activeLayout;
  if (data.activeKey && state.byKey.has(data.activeKey)) state.activeKey = data.activeKey;
}

// ─────────────────────────── 提示 ───────────────────────────

function showBanner(msg, kind = 'error') {
  const el = $('#banner');
  clearTimeout(state.bannerTimer);
  el.hidden = false;
  el.className = `banner ${kind}`;
  el.textContent = msg;
  if (kind === 'ok') {
    state.bannerTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }
}

boot();
