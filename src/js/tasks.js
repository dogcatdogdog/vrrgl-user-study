/**
 * 各任务的交互与判分（docs/03 §2–§4）
 *
 * T1 邻居识别 —— 单击切换 + 拖拽矩形框选（**二者必须同时支持**）；手绘 lasso 可配
 * T4 hub 识别 —— 点击两个高亮之一【即提交】，不设确认按钮
 * T2 邻居计数 —— 数字输入 + Submit（默认关闭，但必须完整可用）
 */

// ─────────────────────────── 题干 ───────────────────────────

import { t } from './i18n.js';

export function promptFor(task, cfg) {
  // GVRRI 的 VRR 措辞 —— 只换一行字，交互与判分完全相同（docs/03 §10 #1）
  if (task === 'T1') {
    return t(cfg.tasks.T1.wording === 'perceptual' ? 'trial.t1Perceptual' : 'trial.t1Factual');
  }
  if (task === 'T4') return t('trial.t4');
  if (task === 'T2') return t('trial.t2');
  if (task === 'ATTENTION') return t('attention.text');
  return '';
}


// ─────────────────────────── 判分 ───────────────────────────

const inter = (a, b) => [...a].filter((x) => b.has(x)).length;

/** T1：主指标 jaccard（docs/03 §2.5）。 */
export function scoreT1(selected, truth) {
  const S = new Set(selected);
  const N = new Set(truth);
  const i = inter(S, N);
  const union = new Set([...S, ...N]).size;
  const round4 = (x) => Math.round(x * 1e4) / 1e4;
  return {
    metric: 'jaccard',
    jaccard: union ? round4(i / union) : 0,
    precision: S.size ? round4(i / S.size) : 0,
    recall: N.size ? round4(i / N.size) : 0,
    exact: S.size === N.size && i === N.size ? 1 : 0,
    missed: N.size - i,
    false_pos: S.size - i,
    n_selected: S.size,
    n_truth: N.size,
  };
}

/** T4：0/1，是否点中度数更高的那个（docs/03 §3.6）。 */
export function scoreT4(clicked, stimulus) {
  const answer = stimulus.ground_truth?.answer;
  return {
    metric: 'accuracy',
    correct: clicked === answer ? 1 : 0,
    answer,
    clicked: clicked ?? null,
  };
}

/** T2：主指标为绝对误差（docs/03 §4.4）。 */
export function scoreT2(answer, stimulus) {
  const truth = stimulus.target_degree;
  const err = Math.abs(answer - truth);
  return { metric: 'abs_error', error: err, exact: err === 0 ? 1 : 0, answer, truth };
}

// ─────────────────────────── 练习反馈 ───────────────────────────

/** docs/03 §2.8 / §3.9 —— 练习**才**给反馈，正式试次一律不给。 */
export function practiceFeedback(task, result, stimulus) {
  if (task === 'T1') {
    return t('feedback.t1', {
      n: result.n_truth,
      found: result.n_truth - result.missed,
      extra: result.false_pos,
      jaccard: result.jaccard.toFixed(2),
    });
  }
  if (task === 'T4') {
    const [a, b] = stimulus.pair;
    const d = stimulus.target_degree;
    const hi = d[a] >= d[b] ? a : b;
    const lo = hi === a ? b : a;
    return t('feedback.t4', {
      verdict: t(result.correct ? 'feedback.t4Correct' : 'feedback.t4Wrong'),
      hi: d[hi], lo: d[lo],
    });
  }
  if (task === 'T2') {
    return t('feedback.t2', { truth: result.truth, answer: result.answer, error: result.error });
  }
  return '';
}

// ─────────────────────────── 交互控制器 ───────────────────────────

/**
 * 把 renderer 的事件接成某个任务的作答控件。
 *
 * 返回 { mount, unmount, getResponse, submit, isReady }。
 * 计时由调用方（record.js）负责，这里只管交互。
 */
export class TaskController {
  constructor({ renderer, cfg, onSubmit }) {
    this.r = renderer;
    this.cfg = cfg;
    this.onSubmit = onSubmit;       // (response, meta) => void
    this.task = null;
    this.stimulus = null;
    this._drag = null;
    this._lasso = null;
    this._nSelected = 0;
  }

  mount(task, stimulus) {
    this.task = task;
    this.stimulus = stimulus;
    this._nSelected = 0;
    const cfg = this.cfg;

    // 目标节点（T4 是两个，T1/T2 是一个）
    const targets = task === 'T4' ? stimulus.targets : [stimulus.targets[0]];
    this.r.draw(stimulus, { targets, selected: [] });
    this.r.setSelected([]);

    if (task === 'T1') this._mountT1();
    else if (task === 'T4') this._mountT4();
    else if (task === 'T2') this._mountT2();
    else if (task === 'ATTENTION') { /* 前庭校验不画图 */ }
  }

  unmount() {
    if (this._teardown) { this._teardown(); this._teardown = null; }
    this._drag = null;
    this._lasso = null;
  }

  // ── T1 ──
  _mountT1() {
    const svg = this.r.svg;
    const inter = this.cfg.interactions;

    const down = (e) => {
      if (e.button !== 0) return;
      const hit = this.r.nodeAt(e.clientX, e.clientY);
      if (hit) {
        // 单击切换
        if (inter.clickToToggle) {
          this.r.toggleSelected(hit);
          this._syncSelected();
        }
        return;
      }
      // 空白处起手：框选 或 手绘
      const p = this.r._toCanvas(e.clientX, e.clientY);
      if (inter.freehandLasso) this._lasso = [p];
      else this._drag = { x0: p.x, y0: p.y };
      svg.setPointerCapture?.(e.pointerId);
    };

    const move = (e) => {
      const p = this.r._toCanvas(e.clientX, e.clientY);
      if (this._lasso) {
        this._lasso.push(p);
        this._drawLasso();
      } else if (this._drag) {
        this.r.showRubber(this._drag.x0, this._drag.y0, p.x, p.y);
      }
    };

    const up = (e) => {
      const p = this.r._toCanvas(e.clientX, e.clientY);
      if (this._lasso) {
        const inside = this._lassoSelect(this._lasso);
        for (const id of inside) this.r.selected.add(id);
        this._lasso = null;
        this.r.hideRubber();
        this._syncSelected();
      } else if (this._drag) {
        const d = this._drag;
        // 位移过小视为误触，不当框选
        if (Math.abs(p.x - d.x0) > 3 || Math.abs(p.y - d.y0) > 3) {
          const inside = this.r.nodesInRect(d.x0, d.y0, p.x, p.y);
          for (const id of inside) this.r.selected.add(id);   // 只增不减
          this._syncSelected();
        }
        this._drag = null;
        this.r.hideRubber();
      }
    };

    svg.addEventListener('pointerdown', down);
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    this._teardown = () => {
      svg.removeEventListener('pointerdown', down);
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      this._clearLasso();
    };
  }

  _drawLasso() {
    if (!this._lassoG) {
      this._lassoG = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      this._lassoG.setAttribute('fill', 'rgba(33,150,243,0.10)');
      this._lassoG.setAttribute('stroke', '#2196f3');
      this._lassoG.setAttribute('stroke-dasharray', '4 3');
      this._lassoG.setAttribute('pointer-events', 'none');
      this.r.gView.append(this._lassoG);
    }
    const d = this._lasso.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + ' Z';
    this._lassoG.setAttribute('d', d);
  }

  _clearLasso() {
    this._lassoG?.remove();
    this._lassoG = null;
  }

  /** 射线法：点是否在多边形内。 */
  _lassoSelect(poly) {
    const ptIn = (x, y) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    return this.stimulus.nodes.filter((n) => ptIn(n.x, n.y)).map((n) => n.id);
  }

  _syncSelected() {
    this._nSelected = this.r.selected.size;
    this._onSelectionChange?.(this._nSelected);
  }

  // ── T4 ──
  _mountT4() {
    const svg = this.r.svg;
    const click = (e) => {
      // 并列时优先两个高亮节点（见 render.nodeAt 的说明）
      const hit = this.r.nodeAt(e.clientX, e.clientY, new Set(this.stimulus.targets));
      // 只接受两个高亮节点之一
      if (!hit || !this.stimulus.targets.includes(hit)) return;
      this.r.setSelected([hit]);
      this.unmount();
      // 点击即提交，不设确认按钮（docs/03 §3.4）
      this.onSubmit({ clicked: hit });
    };
    svg.addEventListener('click', click);
    this._teardown = () => svg.removeEventListener('click', click);
  }

  // ── T2 ──
  _mountT2() {
    // 作答控件在 HTML 侧（数字输入 + Submit），这里只负责画图
  }

  /** 表单任务的提交入口（T1 的 Submit / T2 的 Submit）。 */
  submitForm(value) {
    if (this.task === 'T1') {
      const sel = [...this.r.selected];
      if (!sel.length) return false;      // 至少选中 1 个才能提交（docs/03 §2.4）
      this.unmount();
      this.onSubmit({ selected: sel });
      return true;
    }
    if (this.task === 'T2') {
      if (value === '' || value === null || Number.isNaN(Number(value))) return false;
      this.unmount();
      this.onSubmit({ answer: Number(value) });
      return true;
    }
    return false;
  }
}
