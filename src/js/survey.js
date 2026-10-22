/**
 * 问卷模块（docs/03 §6）
 *
 * 人口学 → 图素养前测 → 逐 trial 易读性 → NASA-TLX → PREVis（默认关）→ 偏好排序（默认关）
 *
 * PREVis 的适配性问题（docs/03 §6.5）尚未定论，所以按【方案 A】实现：
 * 默认关闭，题目做成可配模块；启用前请先读原论文确认能否多次施测。
 */

import { t } from './i18n.js';

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function field(labelText) {
  const row = h('div', 'field');
  row.append(h('label', 'field-label', labelText));
  return row;
}

function select(name, options) {
  const s = h('select');
  s.name = name;
  for (const o of options) {
    const opt = h('option', null, typeof o === 'string' ? o : o.label);
    opt.value = typeof o === 'string' ? o : o.value;
    s.append(opt);
  }
  return s;
}

function likert(name, min = 1, max = 7, labels = null) {
  const wrap = h('div', 'likert');
  for (let i = min; i <= max; i++) {
    const l = h('label', 'likert-item');
    const r = document.createElement('input');
    r.type = 'radio'; r.name = name; r.value = String(i);
    l.append(r, h('span', null, String(i)));
    wrap.append(l);
  }
  if (labels) {
    const ends = h('div', 'likert-ends');
    ends.append(h('span', null, labels[0]), h('span', null, labels[1]));
    wrap.append(ends);
  }
  return wrap;
}

// ─────────────────────────── 人口学 ───────────────────────────

export function demographics(container, cfg) {
  return new Promise((resolve) => {
    container.replaceChildren();
    const f = h('form', 'survey');
    f.append(h('h2', null, t('demographics.title')));

    const age = field(t('demographics.age')); const ageIn = document.createElement('input');
    ageIn.type = 'number'; ageIn.name = 'age'; ageIn.min = '18'; ageIn.max = '120'; ageIn.required = true;
    age.append(ageIn); f.append(age);

    const g = field(t('demographics.gender'));
    const gs = select('gender', [
      { value: 'F', label: t('demographics.genderF') },
      { value: 'M', label: t('demographics.genderM') },
      { value: 'O', label: t('demographics.genderO') },
      { value: 'NA', label: t('demographics.genderNA') },
    ]);
    g.append(gs); f.append(g);

    const fl = field(t('demographics.field'));
    const fs = select('field', [
      { value: 'CS', label: t('demographics.fieldCS') },
      { value: 'DS', label: t('demographics.fieldDS') },
      { value: 'OT', label: t('demographics.fieldOT') },
    ]);
    fl.append(fs); f.append(fl);

    const ot = field(t('demographics.fieldOther'));
    const otIn = document.createElement('input'); otIn.type = 'text'; otIn.name = 'field_other';
    ot.append(otIn); f.append(ot);

    const gf = field(t('demographics.familiarity'));
    gf.append(likert('graph_familiarity', 1, 7,
      [t('demographics.familiarityLow'), t('demographics.familiarityHigh')]));
    f.append(gf);

    const fr = field(t('demographics.frequency'));
    fr.append(select('graph_frequency', [
      { value: 'daily', label: t('demographics.freqDaily') },
      { value: 'weekly', label: t('demographics.freqWeekly') },
      { value: 'monthly', label: t('demographics.freqMonthly') },
      { value: 'rarely', label: t('demographics.freqRarely') },
      { value: 'never', label: t('demographics.freqNever') },
    ]));
    f.append(fr);

    const btn = h('button', 'btn primary', t('common.continue'));
    btn.type = 'submit';
    f.append(btn);
    const err = h('p', 'error', '');
    f.append(err);

    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const fam = fd.get('graph_familiarity');
      if (!fam) { err.textContent = t('demographics.needFamiliarity'); return; }
      resolve({
        age: Number(fd.get('age')),
        gender: fd.get('gender'),
        field: fd.get('field'),
        field_other: fd.get('field_other') || null,
        graph_familiarity: Number(fam),
        graph_frequency: fd.get('graph_frequency'),
      });
    });

    container.append(f);
  });
}

// ─────────────────────────── 图素养前测 ───────────────────────────

/**
 * 计分用 Log Absolute Error（docs/03 §6.3）：
 *   |ln(max(ans,1)) − ln(max(truth,1))|
 * node 型题（点出度数最大的节点）按 0/1 计。
 *
 * ⚠️ 题库来源：stimuli/literacy.json 的 instrument 标为 study_specific ——
 *    题项为自行编写，**不是** Zoss NVL / GGR 量表原文（详见 stimuli/README.md）。
 */
export function literacy(container, items) {
  return new Promise((resolve) => {
    container.replaceChildren();
    const f = h('form', 'survey');
    f.append(h('h2', null, t('literacy.title')));
    f.append(h('p', 'hint', t('literacy.hint')));

    const answers = [];
    items.forEach((it, i) => {
      const sec = h('section', 'literacy-item');
      sec.append(h('h3', null, t('literacy.question', { n: i + 1 })));
      sec.append(h('p', null, it.prompt));

      // ⚠️ **每一题都要画图** —— 包括数值题。
      //    第一版只在 answer_kind === 'node' 时建 SVG，于是「这网络里有多少条边」
      //    这类题被试看不到网络，只能瞎填。所有题型都是「读图」题，图是必需品。
      const wrap = h('div', 'literacy-graph');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      wrap.append(svg);
      sec.append(wrap);

      if (it.answer_kind === 'node') {
        answers.push({ item: it, value: null, svg, kind: 'node' });
      } else {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = it.answer_kind === 'float' ? '0.1' : '1';
        inp.className = 'num';
        inp.style.marginTop = '0.6rem';
        sec.append(inp);
        answers.push({ item: it, input: inp, svg, kind: it.answer_kind });
      }
      f.append(sec);
    });

    const btn = h('button', 'btn primary', t('common.continue'));
    btn.type = 'submit';
    f.append(btn);
    const err = h('p', 'error', '');
    f.append(err);

    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const missing = answers.findIndex((a) => a.kind === 'node'
        ? !a.value : a.input.value === '');
      if (missing >= 0) {
        err.textContent = `Please answer question ${missing + 1}.`;
        return;
      }
      let sum = 0;
      const detail = answers.map((a) => {
        const truth = a.item.ground_truth;
        if (a.kind === 'node') {
          const correct = a.value === truth ? 1 : 0;
          sum += 1 - correct;
          return { item_id: a.item.item_id, task_type: a.item.task_type,
                   answer: a.value, truth, correct };
        }
        const ans = Number(a.input.value);
        const lae = Math.abs(Math.log(Math.max(ans, 1)) - Math.log(Math.max(truth, 1)));
        sum += lae;
        return { item_id: a.item.item_id, task_type: a.item.task_type,
                 answer: ans, truth, log_abs_error: Math.round(lae * 1e4) / 1e4 };
      });
      resolve({
        instrument: 'study_specific',
        score: Math.round((sum / answers.length) * 1e4) / 1e4,
        mean_log_abs_error: Math.round((sum / answers.length) * 1e4) / 1e4,
        total: answers.length,
        answers: detail,
      });
    });

    container.append(f);
    // 图需要在 DOM 插入后再画 —— 每一题都画
    requestAnimationFrame(() => {
      for (const a of answers) {
        if (!a.svg || !a.item.nodes?.length) continue;
        drawLiteracyGraph(a.svg, a.item, a.kind === 'node' ? (id) => {
          a.value = id;
          a.svg.querySelectorAll('circle').forEach((c) => {
            c.setAttribute('stroke', c.dataset.id === id ? '#e53935' : 'none');
            c.setAttribute('stroke-width', c.dataset.id === id ? 3 : 0);
          });
        } : null);
      }
    });
  });
}

function drawLiteracyGraph(svg, item, onPick) {
  const NS = 'http://www.w3.org/2000/svg';
  svg.setAttribute('viewBox', '0 0 900 620');
  // 图素养题用的是小图，按容器宽度等比显示即可（与实验刺激的固定 900 不同）。
  // ⚠️ height 只能用 CSS 写 —— SVG 的 height **属性**不接受 "auto"，会被解析报错。
  svg.setAttribute('width', '100%');
  svg.style.height = 'auto';
  svg.style.maxWidth = '560px';
  svg.style.background = '#fff';
  const pos = new Map(item.nodes.map((n) => [n.id, n]));
  for (const e of item.edges) {
    const a = pos.get(e.s), b = pos.get(e.t);
    if (!a || !b) continue;
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', a.x); l.setAttribute('y1', a.y);
    l.setAttribute('x2', b.x); l.setAttribute('y2', b.y);
    l.setAttribute('stroke', '#9e9e9e'); l.setAttribute('stroke-width', 2);
    svg.append(l);
  }
  for (const n of item.nodes) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', n.x); c.setAttribute('cy', n.y); c.setAttribute('r', 5);
    c.setAttribute('fill', '#9e9e9e');
    c.dataset.id = n.id;
    if (onPick) {
      c.style.cursor = 'pointer';
      c.addEventListener('click', () => onPick(n.id));
    }
    svg.append(c);
  }
}

// ─────────────────────────── 逐 trial 易读性 ───────────────────────────

/** docs/03 §6.4：唯一能拿到逐布局主观数据的途径。 */
export function perTrialEase(container, index) {
  return new Promise((resolve) => {
    container.replaceChildren();
    const f = h('form', 'survey ease');
    f.append(h('h2', null, t('ease.title', { n: index + 1 })));
    f.append(h('p', null, t('ease.question')));
    f.append(likert('ease', 1, 7, [t('ease.veryDifficult'), t('ease.veryEasy')]));
    const btn = h('button', 'btn primary', t('common.continue'));
    btn.type = 'submit';
    f.append(btn);
    const err = h('p', 'error', '');
    f.append(err);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = new FormData(f).get('ease');
      if (!v) { err.textContent = t('ease.chooseValue'); return; }
      resolve(Number(v));
    });
    container.append(f);
  });
}

// ─────────────────────────── NASA-TLX ───────────────────────────

const TLX = [
  ['mental', 'Mental demand', 'How mentally demanding was the task?'],
  ['physical', 'Physical demand', 'How physically demanding was the task?'],
  ['temporal', 'Temporal demand', 'How hurried or rushed was the pace of the task?'],
  ['performance', 'Performance', 'How successful were you in accomplishing what you were asked to do?'],
  ['effort', 'Effort', 'How hard did you have to work to accomplish your level of performance?'],
  ['frustration', 'Frustration', 'How insecure, discouraged, irritated, stressed and annoyed were you?'],
];

export function nasaTlx(container, cfg) {
  return new Promise((resolve) => {
    container.replaceChildren();
    const f = h('form', 'survey');
    f.append(h('h2', null, t('tlx.title')));
    f.append(h('p', 'hint', t('tlx.hint')));

    const scales = {};
    for (const [key, label, q] of TLX) {
      const row = field(t(`tlx.${key}`));
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = '0'; inp.max = '100'; inp.step = '5';
      inp.value = '50'; inp.name = key;
      const out = h('span', 'range-value', '50');
      inp.addEventListener('input', () => { out.textContent = inp.value; });
      const line = h('div', 'range-line');
      line.append(inp, out);
      row.append(line);
      f.append(row);
      scales[key] = inp;
    }

    // 加权版本：15 对成对比较（docs/03 §6.6）
    let pairsDone = false;
    if (cfg.survey.tlxWeighted) {
      const sec = h('section', 'tlx-pairs');
      sec.append(h('h3', null, t('tlx.pairsTitle')));
      const pairs = [];
      for (let i = 0; i < TLX.length; i++) {
        for (let j = i + 1; j < TLX.length; j++) pairs.push([TLX[i], TLX[j]]);
      }
      const answers = new Array(pairs.length).fill(null);
      pairs.forEach(([a, b], k) => {
        const row = h('div', 'tlx-pair');
        const name = `pair${k}`;
        for (const s of [a, b]) {
          const l = h('label', 'tlx-opt');
          const r = document.createElement('input');
          r.type = 'radio'; r.name = name; r.value = s[0];
          r.addEventListener('change', () => { answers[k] = s[0]; });
          l.append(r, h('span', null, s[1]));
          row.append(l);
        }
        sec.append(row);
      });
      f.append(sec);
      f._pairs = { pairs, answers };
    }

    const btn = h('button', 'btn primary', t('common.continue'));
    btn.type = 'submit';
    f.append(btn);
    const err = h('p', 'error', '');
    f.append(err);

    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      for (const [key] of TLX) out[key] = Number(scales[key].value);
      if (cfg.survey.tlxWeighted) {
        const { answers } = f._pairs;
        if (answers.some((a) => a === null)) {
          err.textContent = t('tlx.answerAllPairs');
          return;
        }
        const weights = {};
        for (const a of answers) weights[a] = (weights[a] || 0) + 1;
        resolve({ scores: out, weights, weighted: true });
        return;
      }
      resolve({ scores: out, weighted: false });
    });

    container.append(f);
  });
}

// ─────────────────────────── PREVis（默认关）───────────────────────────

/**
 * ⚠️ 适配性待确认（docs/03 §6.5）。PREVis 是为「评价一个可视化」设计的，
 * 而被试看的是几十张不同的图。按方案 A 默认关闭。
 * 若要启用，请先读 docs/refs/PREVis_companion_guide.pdf 确认能否多次施测，
 * 再把题目填到这里。
 */
export const PREVIS_ITEMS = [
  // 4 子量表：understand / layout / dataread / datafeat
  // 题目文本待从 PREVis 施测指南补充
];

export function previs(container, cfg) {
  if (!cfg.survey.prevIs || !PREVIS_ITEMS.length) return Promise.resolve(null);
  return Promise.resolve(null);   // 占位：填入题目后实现
}

// ─────────────────────────── 偏好排序（默认关）───────────────────────────

/**
 * ⚠️ 这个屏会**明确告诉被试有多种画法**，所以必须放在所有正式试次之后（docs/03 §6.7）。
 * 界面上只用「左/中/右」指代位置，布局名只在数据文件里出现。
 */
export function preference(container, layoutOrder) {
  return new Promise((resolve) => {
    container.replaceChildren();
    const f = h('form', 'survey');
    f.append(h('h2', null, t('preference.title')));
    f.append(h('p', 'hint', t('preference.hint')));

    const ranks = {};
    layoutOrder.forEach((_, i) => {
      const posKey = ['posLeft', 'posMiddleLeft', 'posMiddleRight', 'posRight'][i];
      const row = field(t('preference.position', { pos: t(`preference.${posKey}`) }));
      const s = select(`rank_${i}`, ['1', '2', '3', '4']);
      s.value = String(i + 1);
      s.addEventListener('change', () => { ranks[i] = s.value; });
      ranks[i] = s.value;
      row.append(s);
      f.append(row);
    });

    const btn = h('button', 'btn primary', t('common.finish'));
    btn.type = 'submit';
    f.append(btn);
    const err = h('p', 'error', '');
    f.append(err);

    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const vals = Object.values(ranks).map(Number).sort();
      const ok = vals.every((v, i) => v === i + 1);
      if (!ok) { err.textContent = t('preference.useEachRank'); return; }
      // 只把【布局名】写进数据；界面自始至终没出现过布局名
      const byRank = [];
      for (let r = 1; r <= 4; r++) {
        const idx = Object.keys(ranks).find((k) => Number(ranks[k]) === r);
        byRank.push(layoutOrder[Number(idx)]);
      }
      resolve({ ranking: byRank });
    });

    container.append(f);
  });
}
